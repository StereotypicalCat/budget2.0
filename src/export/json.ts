import { CURRENCIES, type Currency, type Dataset, type MonthId } from "../domain/types.ts";
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

function requireCurrency(value: unknown, where: string): Currency {
  if (!CURRENCIES.includes(value as Currency)) {
    throw new ImportValidationError(`Unsupported currency ${String(value)} in ${where}`);
  }
  return value as Currency;
}

function requireArray(data: Record<string, unknown>, key: string): unknown[] {
  const value = data[key];
  if (!Array.isArray(value)) {
    throw new ImportValidationError(`Dataset field "${key}" is missing or not an array`);
  }
  return value;
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
  requireArray(data, "posts");
  requireArray(data, "months");
  requireArray(data, "purchases");
  requireArray(data, "fxRates");

  requireCurrency(dataset.settings.baseCurrency, "settings.baseCurrency");
  if (!MONTH_ID.test(dataset.settings.foldStartMonth)) {
    throw new ImportValidationError(
      `Invalid foldStartMonth "${dataset.settings.foldStartMonth}"`,
    );
  }

  const postIds = new Set(dataset.posts.map((p) => p.id));
  for (const post of dataset.posts) {
    requireCurrency(post.currency, `post "${post.name}"`);

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
        requireCurrency(rule.amount?.currency, `post "${post.name}" rule from ${from}`);
      } else if (rule.kind !== "percentOfIncome") {
        throw new ImportValidationError(
          `Post "${post.name}" has a rule from "${from}" of unknown kind "${String(rule.kind)}"`,
        );
      }
    }
  }

  for (const month of dataset.months) {
    if (!MONTH_ID.test(month.id)) {
      throw new ImportValidationError(`Invalid month id "${month.id}"`);
    }
    requireCurrency(month.income.currency, `month ${month.id} income`);
  }

  for (const purchase of dataset.purchases) {
    const label = `purchase "${purchase.description}"`;
    requireCurrency(purchase.total.currency, label);

    if (!PURCHASE_DATE.test(purchase.date)) {
      throw new ImportValidationError(`${label} has an invalid date "${purchase.date}"`);
    }
    if (purchase.splits.length === 0) {
      throw new ImportValidationError(`${label} has no splits; at least one split is required`);
    }
    const absorbers = purchase.splits.filter((s) => s.absorbsRemainder).length;
    if (absorbers !== 1) {
      throw new ImportValidationError(
        `${label} has ${absorbers} splits flagged absorbsRemainder; exactly one is required`,
      );
    }
    for (const split of purchase.splits) {
      if (!postIds.has(split.postId)) {
        throw new ImportValidationError(
          `${label} references unknown post "${split.postId}"`,
        );
      }
    }
    for (const slice of purchase.schedule?.slices ?? []) {
      if (!MONTH_ID.test(slice.month)) {
        throw new ImportValidationError(`${label} has invalid slice month "${slice.month}"`);
      }
      requireCurrency(slice.amount.currency, `${label} slice ${slice.month}`);
    }
  }

  return dataset;
}
