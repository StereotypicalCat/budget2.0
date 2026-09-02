import { newId } from "../domain/seed.ts";
import { monthOf } from "../domain/months.ts";
import { roundMoney } from "../domain/money.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Money,
  Month,
  MonthId,
  Post,
  PostId,
  Purchase,
  PurchaseId,
  Rule,
  Schedule,
  Split,
} from "../domain/types.ts";

/**
 * Every function here mutates a draft Dataset in place. They are called from
 * store.mutate(), which clones before applying and writes through afterwards.
 *
 * Every MONEY amount that flows through here is rounded to its currency's
 * minor unit (via roundMoney) before it lands in the draft, per CLAUDE.md's
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

function roundMoneyValue(money: Money): Money {
  return { amount: roundMoney(money.amount, money.currency), currency: money.currency };
}

function roundRule(rule: Rule): Rule {
  if (rule.kind === "fixed") {
    return { kind: "fixed", amount: roundMoneyValue(rule.amount) };
  }
  return { kind: "percentOfIncome", percent: round2(rule.percent) };
}

function roundSplits(splits: Split[]): Split[] {
  return splits.map((split) => ({ ...split, value: round2(split.value) }));
}

function roundSchedule(schedule: Schedule | null): Schedule | null {
  if (!schedule) return null;
  return {
    ...schedule,
    slices: schedule.slices.map((slice) => ({
      month: slice.month,
      amount: roundMoneyValue(slice.amount),
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
  ensureMonth(draft, monthId).income = roundMoneyValue(income);
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
  month.ruleOverrides[postId] = roundRule(rule);
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

export function addPurchase(
  draft: Dataset,
  purchase: Omit<Purchase, "id">,
): Purchase {
  const created: Purchase = {
    ...purchase,
    id: newId(),
    total: roundMoneyValue(purchase.total),
    splits: roundSplits(purchase.splits),
    schedule: roundSchedule(purchase.schedule),
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
    resolved.total = roundMoneyValue(changes.total);
  }
  if (changes.splits) {
    resolved.splits = roundSplits(changes.splits);
  }
  if (changes.schedule !== undefined) {
    resolved.schedule = roundSchedule(changes.schedule);
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
 * kept at six decimal places (see fxApi.ts's toFixed(6)), and rounding to a
 * currency's minor unit would quantize a rate below 0.01 straight to zero.
 */
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
export function setBaseCurrency(draft: Dataset, currency: Currency): void {
  draft.settings.baseCurrency = currency;
  draft.fxRates = draft.fxRates.filter((r) => r.currency !== currency);
}
