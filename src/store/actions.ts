import { newId } from "../domain/seed.ts";
import { compareMonths, monthOf } from "../domain/months.ts";
import { toDayOrdinal } from "../domain/days.ts";
import { roundMoney } from "../domain/money.ts";
import { currencyUsage, normalizeCurrencyCode } from "../domain/currencies.ts";
import type {
  Currency,
  CurrencyDef,
  Dataset,
  FxRate,
  IsoDate,
  Money,
  Month,
  MonthId,
  Post,
  PostId,
  Purchase,
  PurchaseId,
  Recurrence,
  RecurringCost,
  RecurringCostId,
  Rule,
  RuleVersion,
  Schedule,
  Split,
} from "../domain/types.ts";

/**
 * Every function here mutates a draft Dataset in place. They are called from
 * store.mutate(), which clones before applying and writes through afterwards.
 *
 * Every MONEY amount that flows through here is rounded to the dataset's
 * decimal places (via roundMoney) before it lands in the draft, per AGENTS.md's
 * "round before persisting" rule. FxRate.baseUnitsPerOne is deliberately
 * exempted in setFxRate below — an exchange rate is not money, and rounding
 * it to cents would be wrong in kind (see the comment there).
 */

function requirePost(draft: Dataset, postId: PostId): Post {
  const post = draft.posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Unknown post: ${postId}`);
  return post;
}

function requirePurchase(draft: Dataset, purchaseId: PurchaseId): Purchase {
  const purchase = draft.purchases.find((p) => p.id === purchaseId);
  if (!purchase) throw new Error(`Unknown purchase: ${purchaseId}`);
  return purchase;
}

/** Rounds a non-money percentage (e.g. Rule.percent, Split.value) to 2 decimals. */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

function roundMoneyValue(draft: Dataset, money: Money): Money {
  return {
    amount: roundMoney(money.amount, draft.settings.digits),
    currency: money.currency,
  };
}

function roundRule(draft: Dataset, rule: Rule): Rule {
  if (rule.kind === "fixed") {
    return { kind: "fixed", amount: roundMoneyValue(draft, rule.amount) };
  }
  return { kind: "percentOfIncome", percent: round2(rule.percent) };
}

/**
 * A split's `value` is a percentage in "percent" mode and MONEY in the
 * purchase's currency in "fixed" mode, so the two round differently: a
 * percentage always to 2 decimals, money to the dataset's decimal places.
 * Rounding both to a hardcoded 2 is correct only while that setting is 2.
 */
function roundSplits(
  draft: Dataset,
  splits: Split[],
  splitMode: Purchase["splitMode"],
  _currency: Currency,
): Split[] {
  const digits = draft.settings.digits;
  return splits.map((split) => ({
    ...split,
    value: splitMode === "fixed" ? roundMoney(split.value, digits) : round2(split.value),
  }));
}

function roundSchedule(draft: Dataset, schedule: Schedule | null): Schedule | null {
  if (!schedule) return null;
  return {
    ...schedule,
    slices: schedule.slices.map((slice) => ({
      month: slice.month,
      amount: roundMoneyValue(draft, slice.amount),
    })),
  };
}

export function ensureMonth(draft: Dataset, monthId: MonthId): Month {
  const existing = draft.months.find((m) => m.id === monthId);
  if (existing) return existing;
  const created: Month = {
    id: monthId,
    income: { amount: 0, currency: draft.settings.baseCurrency },
    ruleOverrides: {},
  };
  draft.months.push(created);
  draft.months.sort((a, b) => a.id.localeCompare(b.id));
  return created;
}

export function setIncome(draft: Dataset, monthId: MonthId, income: Money): void {
  ensureMonth(draft, monthId).income = roundMoneyValue(draft, income);
}

export function setRuleOverride(
  draft: Dataset,
  monthId: MonthId,
  postId: PostId,
  rule: Rule | null,
): void {
  const month = ensureMonth(draft, monthId);
  if (rule === null) {
    delete month.ruleOverrides[postId];
    return;
  }
  month.ruleOverrides[postId] = roundRule(draft, rule);
}

export function addPost(draft: Dataset, name: string, currency: Currency): Post {
  const post: Post = {
    id: newId(),
    name,
    order: draft.posts.length,
    archived: false,
    currency,
    rules: [],
  };
  draft.posts.push(post);
  return post;
}

export function updatePost(
  draft: Dataset,
  postId: PostId,
  changes: Partial<Omit<Post, "id">>,
): void {
  const post = requirePost(draft, postId);
  const resolved: Partial<Omit<Post, "id">> = { ...changes };
  Object.assign(post, resolved);
}

/** Archives rather than deletes, because purchases reference posts. */
export function setPostArchived(
  draft: Dataset,
  postId: PostId,
  archived: boolean,
): void {
  requirePost(draft, postId).archived = archived;
}

export function movePost(draft: Dataset, postId: PostId, direction: -1 | 1): void {
  const ordered = [...draft.posts].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((p) => p.id === postId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return;
  const a = ordered[index]!;
  const b = ordered[target]!;
  [a.order, b.order] = [b.order, a.order];
}

/**
 * Inserts or replaces the version starting at `from`, keeping `rules` sorted.
 * Replacing rather than appending is what keeps the effective rule
 * unambiguous: two versions sharing a month would both be "in effect", and
 * ruleAt would resolve to whichever the sort happened to leave last.
 */
export function setRuleFrom(
  draft: Dataset,
  postId: PostId,
  from: MonthId,
  rule: Rule,
): void {
  const post = requirePost(draft, postId);
  const version: RuleVersion = { from, rule: roundRule(draft, rule) };
  const existing = post.rules.findIndex((v) => v.from === from);
  if (existing === -1) post.rules.push(version);
  else post.rules[existing] = version;
  post.rules.sort((a, b) => compareMonths(a.from, b.from));
}

/**
 * Deletes the version starting at `from`. Removing the earliest one means the
 * months before the next version now resolve to no rule, and allocate zero.
 */
export function removeRuleFrom(draft: Dataset, postId: PostId, from: MonthId): void {
  const post = requirePost(draft, postId);
  post.rules = post.rules.filter((v) => v.from !== from);
}

export function addPurchase(
  draft: Dataset,
  purchase: Omit<Purchase, "id">,
): Purchase {
  const created: Purchase = {
    ...purchase,
    id: newId(),
    total: roundMoneyValue(draft, purchase.total),
    splits: roundSplits(draft, purchase.splits, purchase.splitMode, purchase.total.currency),
    schedule: roundSchedule(draft, purchase.schedule),
  };
  draft.purchases.push(created);
  // Make sure every month the purchase touches exists, so income can be
  // entered against it later.
  const months = created.schedule
    ? created.schedule.slices.map((s) => s.month)
    : [monthOf(created.date)];
  for (const monthId of months) ensureMonth(draft, monthId);
  return created;
}

export function updatePurchase(
  draft: Dataset,
  purchaseId: PurchaseId,
  changes: Partial<Omit<Purchase, "id">>,
): void {
  const purchase = requirePurchase(draft, purchaseId);
  const resolved: Partial<Omit<Purchase, "id">> = { ...changes };
  if (changes.total) {
    resolved.total = roundMoneyValue(draft, changes.total);
  }
  if (changes.splits) {
    // Either field may be absent from a partial update; the stored purchase
    // supplies whichever one is, so the mode and currency always agree with
    // the values being rounded.
    resolved.splits = roundSplits(
      draft,
      changes.splits,
      changes.splitMode ?? purchase.splitMode,
      (resolved.total ?? purchase.total).currency,
    );
  }
  if (changes.schedule !== undefined) {
    resolved.schedule = roundSchedule(draft, changes.schedule);
  }
  Object.assign(purchase, resolved);
}

export function deletePurchase(draft: Dataset, purchaseId: PurchaseId): void {
  draft.purchases = draft.purchases.filter((p) => p.id !== purchaseId);
}

export function cancelScheduleFrom(
  draft: Dataset,
  purchaseId: PurchaseId,
  monthId: MonthId,
): void {
  const purchase = requirePurchase(draft, purchaseId);
  if (!purchase.schedule) {
    throw new Error(`Purchase ${purchaseId} has no finance plan to cancel`);
  }
  purchase.schedule.cancelledFromMonth = monthId;
}

/**
 * Stores the rate exactly as passed. Exchange rates are not money: they are
 * kept at six decimal places (see fxApi.ts's toFixed(6)), and rounding one to
 * the dataset's decimals would quantize a rate below 0.01 straight to zero.
 */
/** Codes are identity, so they are validated the same way on every path. */
const CURRENCY_CODE = /^[A-Z]{2,8}$/;

function requireCurrencyDef(def: CurrencyDef): CurrencyDef {
  const code = normalizeCurrencyCode(def.code);
  if (!CURRENCY_CODE.test(code)) {
    throw new Error(`Currency code "${def.code}" must be 2-8 letters`);
  }
  return {
    code,
    ...(def.symbol?.trim() ? { symbol: def.symbol.trim() } : {}),
    ...(def.name?.trim() ? { name: def.name.trim() } : {}),
  };
}

export function addCurrency(draft: Dataset, def: CurrencyDef): CurrencyDef {
  const currency = requireCurrencyDef(def);
  if (draft.currencies.some((existing) => existing.code === currency.code)) {
    throw new Error(`Currency ${currency.code} is already defined`);
  }
  draft.currencies.push(currency);
  return currency;
}

export function updateCurrency(
  draft: Dataset,
  code: Currency,
  changes: Partial<Omit<CurrencyDef, "code">>,
): void {
  const existing = draft.currencies.find((currency) => currency.code === code);
  if (!existing) throw new Error(`Unknown currency: ${code}`);
  // The code is identity — it keys the FX table and every stored Money — so it
  // is deliberately not editable. Renaming one means adding the new code,
  // moving what refers to it, and removing the old.
  Object.assign(existing, requireCurrencyDef({ ...existing, ...changes, code }));
}

/**
 * Refuses to remove a currency anything still refers to, naming what refers to
 * it. Its exchange rate goes with it, so no orphan row survives.
 */
export function removeCurrency(draft: Dataset, code: Currency): void {
  const used = currencyUsage(draft, code);
  if (used.length > 0) {
    const isBase = draft.settings.baseCurrency === code;
    throw new Error(
      isBase
        ? `${code} is the base currency; choose another base before removing it`
        : `${code} is in use by ${used.slice(0, 3).join(", ")}${used.length > 3 ? ` and ${used.length - 3} more` : ""}`,
    );
  }
  draft.currencies = draft.currencies.filter((currency) => currency.code !== code);
  draft.fxRates = draft.fxRates.filter((rate) => rate.currency !== code);
}

export function setFxRate(draft: Dataset, rate: FxRate): void {
  const index = draft.fxRates.findIndex((r) => r.currency === rate.currency);
  if (index === -1) draft.fxRates.push(rate);
  else draft.fxRates[index] = rate;
}

/**
 * Removes a currency's rate row entirely. A cleared rate MUST become an
 * absent row, not a stored 0: toBase() throws MissingRateError for an absent
 * row but silently converts to 0 for a stored zero rate, which would corrupt
 * every purchase in that currency without any error surfacing. Callers (the
 * currency settings input) must route a cleared/invalid rate here instead of
 * through setFxRate with a 0.
 */
export function removeFxRate(draft: Dataset, currency: Currency): void {
  draft.fxRates = draft.fxRates.filter((r) => r.currency !== currency);
}

/** The base currency never has a rate row of its own. */
/**
 * The decimal places every amount rounds to, dataset-wide.
 *
 * Amounts already stored are deliberately NOT rewritten. Moving the setting is
 * a rounding rule going forward: 49.95 stays 49.95 and displays as 50, while
 * every total recomputes at the new precision. Rewriting each `Money` would be
 * a destructive whole-dataset write — the kind that owes the owner a backup
 * export first — and it is lossy one way, since 2 -> 0 discards what 0 -> 2
 * cannot bring back.
 *
 * Throws rather than clamping: a digit count outside 0-4 is a caller bug, and
 * silently storing 2 instead is how a wrong number becomes invisible. The
 * Settings input guards before calling, so no event handler sees this throw.
 */
export function setDigits(draft: Dataset, digits: number): void {
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) {
    throw new Error("Decimal places must be a whole number between 0 and 4");
  }
  draft.settings.digits = digits;
}

export function setBaseCurrency(draft: Dataset, currency: Currency): void {
  draft.settings.baseCurrency = currency;
  draft.fxRates = draft.fxRates.filter((r) => r.currency !== currency);
}

function requireRecurringCost(draft: Dataset, id: RecurringCostId): RecurringCost {
  const cost = draft.recurring.find((c) => c.id === id);
  if (!cost) throw new Error(`Unknown recurring cost: ${id}`);
  return cost;
}

/**
 * The projection walk in `domain/occurrences.ts` terminates only if every step
 * strictly advances, and `n` is what guarantees that. The JSON importer checks
 * the same thing; this is the other write path, and both have to hold or the
 * fold can hang.
 */
function requireRecurrence(recurrence: Recurrence): Recurrence {
  if (!Number.isInteger(recurrence.n)) {
    throw new Error(`A recurrence interval must be a whole number, not ${recurrence.n}`);
  }
  if (recurrence.n < 1) {
    throw new Error(`A recurrence interval must be at least 1, not ${recurrence.n}`);
  }
  if (recurrence.kind === "everyNWeeks") {
    if (!Number.isInteger(recurrence.weekday) || recurrence.weekday < 0 || recurrence.weekday > 6) {
      throw new Error(`A weekday must be 0-6 (0 is Sunday), not ${recurrence.weekday}`);
    }
  }
  return recurrence;
}

const DAY_GRANULAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `everyNMonths` walks the cursor through `monthOf`, so it tolerates either
 * granularity of `startDate`. `everyNDays` and `everyNWeeks` hand it straight
 * to `addDays`, which throws on a month-only date — so those kinds require a
 * day-granular `startDate` here, at the boundary, rather than three months
 * later when a fold walks off the end of it.
 *
 * Shape alone is not enough: "2026-09-31" is day-SHAPED but calendar-
 * impossible (September has 30 days), and would otherwise reach `addDays` (or
 * sit unnoticed under `everyNMonths`) and throw three months later out of the
 * fold instead of here. Route a day-granular value through `toDayOrdinal` and
 * a month-granular one through `monthOf` — both already throw on exactly
 * that — and translate whatever they throw into this file's own error style.
 */
function requireStartDateGranularity(recurrence: Recurrence, startDate: IsoDate): void {
  const dayGranular = DAY_GRANULAR_DATE.test(startDate);
  if (recurrence.kind !== "everyNMonths" && !dayGranular) {
    throw new Error(
      `A "${recurrence.kind}" recurrence needs a day-granular startDate ("YYYY-MM-DD"), not "${startDate}"`,
    );
  }
  try {
    if (dayGranular) toDayOrdinal(startDate);
    else monthOf(startDate);
  } catch (error) {
    throw new Error(
      `A "${recurrence.kind}" recurrence needs a valid startDate, not "${startDate}" (${(error as Error).message})`,
    );
  }
}

export function addRecurringCost(
  draft: Dataset,
  cost: Omit<RecurringCost, "id" | "order">,
): RecurringCost {
  const recurrence = requireRecurrence(cost.recurrence);
  requireStartDateGranularity(recurrence, cost.startDate);
  const created: RecurringCost = {
    ...cost,
    id: newId(),
    order: draft.recurring.length,
    recurrence,
    amount: roundMoneyValue(draft, cost.amount),
    splits: roundSplits(draft, cost.splits, cost.splitMode, cost.amount.currency),
  };
  draft.recurring.push(created);
  return created;
}

/**
 * `archived` and `endedFrom` are excluded on purpose: they are a coherent
 * pair (`archived` mirrors "`endedFrom` is set") maintained ONLY by
 * `setRecurringCostEndedFrom`, and a caller able to pass either through here
 * could desynchronise them — a bill that reads as live but is dimmed, or
 * ended but not. Route a change to either field through
 * `setRecurringCostEndedFrom` (or its `endRecurringCost`/`restoreRecurringCost`
 * convenience wrappers) instead.
 */
export function updateRecurringCost(
  draft: Dataset,
  id: RecurringCostId,
  changes: Partial<Omit<RecurringCost, "id" | "archived" | "endedFrom">>,
): void {
  const cost = requireRecurringCost(draft, id);
  const resolved: Partial<Omit<RecurringCost, "id" | "archived" | "endedFrom">> = { ...changes };

  if (changes.recurrence) {
    resolved.recurrence = requireRecurrence(changes.recurrence);
  }
  // Runs on every update, not just one that touches recurrence or startDate:
  // either field alone can break the pairing (a kind flip against an
  // untouched month-only startDate is exactly how this bug was reached).
  requireStartDateGranularity(
    resolved.recurrence ?? cost.recurrence,
    resolved.startDate ?? cost.startDate,
  );
  if (changes.amount) {
    resolved.amount = roundMoneyValue(draft, changes.amount);
  }
  if (changes.splits) {
    // Either field may be absent from a partial update; the stored cost
    // supplies whichever one is, so the mode and currency always agree with
    // the values being rounded.
    resolved.splits = roundSplits(
      draft,
      changes.splits,
      changes.splitMode ?? cost.splitMode,
      (resolved.amount ?? cost.amount).currency,
    );
  }

  Object.assign(cost, resolved);
}

export function moveRecurringCost(
  draft: Dataset,
  id: RecurringCostId,
  direction: -1 | 1,
): void {
  const ordered = [...draft.recurring].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((c) => c.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return;
  const a = ordered[index]!;
  const b = ordered[target]!;
  [a.order, b.order] = [b.order, a.order];
}

/**
 * Sets or clears `endedFrom` directly — what the Settings "Ends" column edits
 * — keeping `archived` coherent with it. The rule: `archived` mirrors
 * "`endedFrom` is set", same as `endRecurringCost`/`restoreRecurringCost`
 * below, which now both delegate here. That is what stops the two fields
 * diverging into a bill that reads as live but is dimmed, or ended but not.
 *
 * Both fields, because they mean different things: `endedFrom` stops the
 * PROJECTION, and `archived` only flags the row — same as a post, it stays
 * listed (sorted in, rendered at reduced opacity) rather than being filtered
 * out. Archiving alone would leave the bill projecting forever; setting
 * `endedFrom` alone would leave a dead bill undimmed in the list. Neither
 * touches a past occurrence, so no historical figure moves.
 *
 * `endedFrom` itself is unchecked here — no granularity rule applies to it
 * (§10; it is only ever compared lexicographically, never reaches
 * `addDays`) — so the caller validates it is a real `IsoDate` before this is
 * called, the same way the "Starts" field already does for `startDate`.
 */
export function setRecurringCostEndedFrom(
  draft: Dataset,
  id: RecurringCostId,
  endedFrom: IsoDate | undefined,
): void {
  const cost = requireRecurringCost(draft, id);
  if (endedFrom === undefined) {
    delete cost.endedFrom;
    cost.archived = false;
  } else {
    cost.endedFrom = endedFrom;
    cost.archived = true;
  }
}

/** The one-click convenience: stop a bill from `from` onward and dim it. */
export function endRecurringCost(draft: Dataset, id: RecurringCostId, from: IsoDate): void {
  setRecurringCostEndedFrom(draft, id, from);
}

/** The one-click convenience: clear the cancellation and un-dim the row. */
export function restoreRecurringCost(draft: Dataset, id: RecurringCostId): void {
  setRecurringCostEndedFrom(draft, id, undefined);
}

/**
 * Turns one projected occurrence into a real purchase.
 *
 * `occurrenceDate` is the slot being claimed and goes into `source`;
 * `overrides.date` is when the money actually moved and goes on the purchase.
 * They differ whenever a bill is paid off schedule, and under `lastCharge`
 * anchoring it is the latter that rebases the series — which is the whole of
 * the phone-bill behaviour.
 *
 * Deleting the purchase later un-confirms the slot, with nothing to reconcile.
 */
export function confirmOccurrence(
  draft: Dataset,
  recurringId: RecurringCostId,
  occurrenceDate: IsoDate,
  overrides: { date?: IsoDate; amount?: Money } = {},
): Purchase {
  const cost = requireRecurringCost(draft, recurringId);
  return addPurchase(draft, {
    date: overrides.date ?? occurrenceDate,
    description: cost.name,
    total: overrides.amount ?? cost.amount,
    splitMode: cost.splitMode,
    // Copied, not shared: editing the purchase's splits must not rewrite the
    // cost's, and `mutate` clones the draft rather than deep-freezing it.
    splits: cost.splits.map((split) => ({ ...split })),
    schedule: null,
    source: { recurringId, occurrenceDate },
  });
}
