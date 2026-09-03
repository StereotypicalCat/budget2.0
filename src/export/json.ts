import type { Currency, CurrencyDef, Dataset, MonthId } from "../domain/types.ts";
import { migrate } from "../store/migrations.ts";

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export function exportDatasetJson(dataset: Dataset): string {
  return JSON.stringify(dataset, null, 2);
}

export function describeDataset(dataset: Dataset) {
  return {
    posts: dataset.posts.length,
    months: dataset.months.length,
    purchases: dataset.purchases.length,
  };
}

export function exportFilename(monthId: MonthId): string {
  return `budget-${monthId}.json`;
}

// Shape AND range: months 01-12 only. A shape-only regex (\d{2}) lets
// "2026-13" through import and it then silently normalizes to a different
// month inside the balance fold (the same defect fixed earlier in
// src/domain/months.ts). This is the import path that made it reachable.
const MONTH_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
/**
 * A purchase date is "YYYY-MM-DD", or "YYYY-MM" when it has no specific day.
 * Validated here so a malformed date is rejected at the boundary rather than
 * throwing out of `monthOf()` deep inside the balance fold.
 */
const PURCHASE_DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

const ANCHORINGS = new Set(["calendar", "lastCharge"]);
const RECURRENCE_KINDS = new Set(["everyNMonths", "everyNDays", "everyNWeeks"]);
const SPLIT_MODES = new Set(["percent", "fixed"]);

/**
 * `Currency` is an open string now, so this — not the type system — is what
 * stops a code the dataset never defined reaching the fold, where it would
 * throw MissingRateError or round at a guessed number of decimals.
 */
function requireCurrency(
  value: unknown,
  where: string,
  defined: ReadonlySet<Currency>,
): Currency {
  if (typeof value !== "string" || !defined.has(value)) {
    throw new ImportValidationError(
      `Unsupported currency ${String(value)} in ${where}. Define it under Settings first.`,
    );
  }
  return value;
}

/** Codes are identity: they key the FX table and every stored Money. */
const CURRENCY_CODE = /^[A-Z]{2,8}$/;

/**
 * Validates the currency table itself, before anything is checked against it.
 * A duplicate code would make two definitions compete for the same identity —
 * the code keys the FX table and every stored Money.
 *
 * Decimal places are NOT checked here any more: they are one dataset-wide
 * setting, validated below. A per-currency `digits` surviving in a hand-edited
 * file is dropped rather than refused — an unknown field is no reason to turn
 * away the owner's only backup.
 */
function requireCurrencyTable(data: Record<string, unknown>): CurrencyDef[] {
  const raw = data.currencies;
  if (!Array.isArray(raw)) {
    throw new ImportValidationError('Dataset field "currencies" is missing or not an array');
  }
  if (raw.length === 0) {
    throw new ImportValidationError("A dataset must define at least one currency");
  }

  const seen = new Set<string>();
  const table: CurrencyDef[] = [];

  for (const entry of raw as Array<Record<string, unknown>>) {
    const code = entry?.code;
    if (typeof code !== "string" || !CURRENCY_CODE.test(code)) {
      throw new ImportValidationError(
        `Currency code ${JSON.stringify(code)} is not 2-8 uppercase letters`,
      );
    }
    if (seen.has(code)) {
      throw new ImportValidationError(
        `Currency "${code}" is defined twice; which decimals apply would be arbitrary`,
      );
    }
    seen.add(code);

    if (entry.symbol !== undefined && typeof entry.symbol !== "string") {
      throw new ImportValidationError(`Currency "${code}" has a non-string symbol`);
    }
    if (entry.name !== undefined && typeof entry.name !== "string") {
      throw new ImportValidationError(`Currency "${code}" has a non-string name`);
    }

    table.push({
      code,
      ...(typeof entry.symbol === "string" ? { symbol: entry.symbol } : {}),
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
    });
  }

  return table;
}

function requireArray(data: Record<string, unknown>, key: string): unknown[] {
  const value = data[key];
  if (!Array.isArray(value)) {
    throw new ImportValidationError(`Dataset field "${key}" is missing or not an array`);
  }
  return value;
}

/**
 * `n` is checked hard rather than clamped. The projection walk in
 * `domain/occurrences.ts` terminates only if every step strictly advances, and
 * a clamped zero would silently give the owner a schedule their file does not
 * describe. Rejecting tells them the file is wrong; clamping tells them
 * nothing and quietly changes a bill.
 */
function requireRecurrence(recurrence: any, label: string): void {
  if (!recurrence || !RECURRENCE_KINDS.has(recurrence.kind)) {
    throw new ImportValidationError(
      `${label} has a recurrence of unknown kind "${String(recurrence?.kind)}"`,
    );
  }
  if (typeof recurrence.n !== "number" || !Number.isInteger(recurrence.n)) {
    throw new ImportValidationError(
      `${label} has a recurrence interval that is not a whole number: ${String(recurrence.n)}`,
    );
  }
  if (recurrence.n < 1) {
    throw new ImportValidationError(
      `${label} has a recurrence interval of ${recurrence.n}; it must be at least 1`,
    );
  }
  if (recurrence.kind === "everyNWeeks") {
    const { weekday } = recurrence;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new ImportValidationError(
        `${label} has a weekday of ${String(weekday)}; it must be 0-6, where 0 is Sunday`,
      );
    }
  }
}

/**
 * Shared by the purchases loop and the recurring-costs loop below — the only
 * two places a `splitMode`/`splits` pair occurs, and both feed the identical
 * `distributeByWeight`/`distributeByAmount` branch in `domain/charges.ts`.
 * One helper means the two write paths cannot silently drift into checking
 * to different standards; the two loops used to each carry their own copy of
 * the "no splits" / "one absorber" / "unknown post" checks, so this replaces
 * both rather than adding a third copy.
 *
 * `splitMode` must be one of the two known modes: `charges.ts` picks its
 * distribution function with `splitMode === "percent" ? ... : ...`, so any
 * OTHER string silently takes the "fixed" branch and treats an intended
 * percentage as an absolute amount — a silently wrong number, not a throw.
 *
 * Every split's `value` must be a finite number. A non-finite value (missing,
 * a string, NaN, Infinity) would otherwise propagate through
 * `distributeByWeight`/`distributeByAmount` as NaN, and `roundMoney(NaN,
 * digits)` returns NaN rather than throwing — it would corrupt a total
 * silently, deep inside the fold.
 *
 * NEGATIVE values, values over 100, and splits that do not sum to the total
 * are all deliberately UNCHECKED — AGENTS.md lists these as intentional
 * (a refund is a normal line, and the absorbing split reconciles the sum by
 * design). Only non-numbers are rejected here.
 */
function requireSplits(
  splits: unknown,
  splitMode: unknown,
  label: string,
  postIds: ReadonlySet<string>,
): void {
  if (!SPLIT_MODES.has(splitMode as string)) {
    throw new ImportValidationError(
      `${label} has an unknown splitMode "${String(splitMode)}"`,
    );
  }
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new ImportValidationError(`${label} has no splits; at least one split is required`);
  }
  const absorbers = (splits as Array<Record<string, unknown>>).filter(
    (s) => s?.absorbsRemainder,
  ).length;
  if (absorbers !== 1) {
    throw new ImportValidationError(
      `${label} has ${absorbers} splits flagged absorbsRemainder; exactly one is required`,
    );
  }
  for (const split of splits as Array<Record<string, unknown>>) {
    if (!postIds.has(split?.postId as string)) {
      throw new ImportValidationError(`${label} references unknown post "${String(split?.postId)}"`);
    }
    if (typeof split?.value !== "number" || !Number.isFinite(split.value)) {
      throw new ImportValidationError(
        `${label} has a split value that is not a finite number: ${String(split?.value)}`,
      );
    }
  }
}

/**
 * Validates far enough that the fold cannot throw on the imported data: every
 * split points at a real post, every purchase has exactly one remainder
 * absorber, every MonthId parses, and every rule version resolves
 * unambiguously to a number rather than to NaN or a missing rate.
 */
export function parseDatasetJson(text: string): Dataset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ImportValidationError(
      `File is not valid JSON: ${(error as Error).message}`,
    );
  }

  let dataset: Dataset;
  try {
    dataset = migrate(raw);
  } catch (error) {
    throw new ImportValidationError((error as Error).message);
  }

  const data = dataset as unknown as Record<string, unknown>;
  const currencies = requireCurrencyTable(data);
  // The validated table replaces the raw one, so what comes back is normalised:
  // trimmed symbols and names, and no stray per-currency `digits` left over
  // from a hand-edited or pre-v6 file.
  dataset.currencies = currencies;
  const defined = new Set(currencies.map((currency) => currency.code));
  requireArray(data, "posts");
  requireArray(data, "months");
  requireArray(data, "purchases");
  requireArray(data, "fxRates");

  requireCurrency(dataset.settings.baseCurrency, "settings.baseCurrency", defined);
  // One setting, every currency. Bad digits here would round every amount in
  // the dataset to nonsense, so this is checked before anything is folded.
  const digits = dataset.settings.digits;
  if (typeof digits !== "number" || !Number.isInteger(digits) || digits < 0 || digits > 4) {
    throw new ImportValidationError(
      `settings.digits is ${String(digits)}; expected a whole number of decimal places between 0 and 4`,
    );
  }
  if (!MONTH_ID.test(dataset.settings.foldStartMonth)) {
    throw new ImportValidationError(
      `Invalid foldStartMonth "${dataset.settings.foldStartMonth}"`,
    );
  }

  const postIds = new Set(dataset.posts.map((p) => p.id));
  for (const post of dataset.posts) {
    requireCurrency(post.currency, `post "${post.name}"`, defined);

    const rules = (post as unknown as Record<string, unknown>).rules;
    if (!Array.isArray(rules)) {
      throw new ImportValidationError(`Post "${post.name}" is missing its rules array`);
    }
    const seenFrom = new Set<string>();
    for (const version of rules as Array<Record<string, unknown>>) {
      const from = String(version.from);
      if (!MONTH_ID.test(from)) {
        throw new ImportValidationError(
          `Post "${post.name}" has a rule with an invalid start month "${from}"`,
        );
      }
      if (seenFrom.has(from)) {
        throw new ImportValidationError(
          `Post "${post.name}" has two rules starting in "${from}"; the effective rule would be ambiguous`,
        );
      }
      seenFrom.add(from);

      // The rule's VALUE is deliberately unvalidated — a percentage above 100
      // and a negative amount are both legal. Its SHAPE is not: an unknown
      // kind falls through resolveRule's percentage branch and turns every
      // figure after it into NaN, and an unsupported currency throws
      // MissingRateError deep inside the fold rather than here.
      const rule = (version.rule ?? {}) as {
        kind?: unknown;
        amount?: { currency?: unknown };
      };
      if (rule.kind === "fixed") {
        requireCurrency(rule.amount?.currency, `post "${post.name}" rule from ${from}`, defined);
      } else if (rule.kind !== "percentOfIncome") {
        throw new ImportValidationError(
          `Post "${post.name}" has a rule from "${from}" of unknown kind "${String(rule.kind)}"`,
        );
      }
    }
  }

  const recurring = Array.isArray(data.recurring) ? (data.recurring as any[]) : [];
  dataset.recurring = recurring;
  // Optional chaining, not `.id` directly: a null/non-object entry must fall
  // through to the loop below and fail there with an ImportValidationError,
  // not throw a raw TypeError here while merely collecting ids.
  const recurringIds = new Set(recurring.map((cost: any) => cost?.id));

  for (const cost of recurring) {
    if (!cost || typeof cost !== "object") {
      throw new ImportValidationError(
        `A recurring cost is missing or not an object: ${JSON.stringify(cost)}`,
      );
    }
    const label = `Recurring cost "${cost.name}"`;
    requireCurrency(cost.amount?.currency, label, defined);

    if (!PURCHASE_DATE.test(cost.startDate)) {
      throw new ImportValidationError(`${label} has an invalid start date "${cost.startDate}"`);
    }
    if (cost.endedFrom !== undefined && !PURCHASE_DATE.test(cost.endedFrom)) {
      throw new ImportValidationError(`${label} has an invalid ended-from date "${cost.endedFrom}"`);
    }
    requireRecurrence(cost.recurrence, label);

    if (!ANCHORINGS.has(cost.anchoring)) {
      throw new ImportValidationError(
        `${label} has an unknown anchoring "${String(cost.anchoring)}"`,
      );
    }
    requireSplits(cost.splits, cost.splitMode, label, postIds);
  }

  for (const month of dataset.months) {
    if (!MONTH_ID.test(month.id)) {
      throw new ImportValidationError(`Invalid month id "${month.id}"`);
    }
    requireCurrency(month.income.currency, `month ${month.id} income`, defined);
  }

  for (const purchase of dataset.purchases) {
    const label = `purchase "${purchase.description}"`;
    requireCurrency(purchase.total.currency, label, defined);

    if (!PURCHASE_DATE.test(purchase.date)) {
      throw new ImportValidationError(`${label} has an invalid date "${purchase.date}"`);
    }
    requireSplits(purchase.splits, purchase.splitMode, label, postIds);
    for (const slice of purchase.schedule?.slices ?? []) {
      if (!MONTH_ID.test(slice.month)) {
        throw new ImportValidationError(`${label} has invalid slice month "${slice.month}"`);
      }
      requireCurrency(slice.amount.currency, `${label} slice ${slice.month}`, defined);
    }

    if (purchase.source !== undefined) {
      // `null` is not `undefined`, so it reaches here without being "no
      // source". The field is typed as absent-or-object, never null, so a
      // null (or any other non-object) is malformed input, not a missing
      // field — reject it cleanly rather than dereferencing it into a raw
      // TypeError. `schedule?.slices ?? []` two blocks up is the same
      // defensive style applied to a sibling field that IS legitimately null.
      if (!purchase.source || typeof purchase.source !== "object") {
        throw new ImportValidationError(
          `${label} has a source that is not an object: ${JSON.stringify(purchase.source)}`,
        );
      }
      if (!recurringIds.has(purchase.source.recurringId)) {
        throw new ImportValidationError(
          `${label} names unknown recurring cost "${purchase.source.recurringId}"`,
        );
      }
      if (!PURCHASE_DATE.test(purchase.source.occurrenceDate)) {
        throw new ImportValidationError(
          `${label} has an invalid occurrence date "${purchase.source.occurrenceDate}"`,
        );
      }
    }
  }

  return dataset;
}
