import { newId } from "../domain/seed.ts";
import { compareMonths, monthOf } from "../domain/months.ts";
import { roundMoney } from "../domain/money.ts";
import { currencyUsage, digitsFor, normalizeCurrencyCode } from "../domain/currencies.ts";
import type {
  Currency,
  CurrencyDef,
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
  RuleVersion,
  Schedule,
  Split,
} from "../domain/types.ts";

/**
 * Every function here mutates a draft Dataset in place. They are called from
 * store.mutate(), which clones before applying and writes through afterwards.
 *
 * Every MONEY amount that flows through here is rounded to its currency's
 * minor unit (via roundMoney) before it lands in the draft, per AGENTS.md's
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
    amount: roundMoney(money.amount, digitsFor(draft.currencies, money.currency)),
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
 * percentage to 2 decimals, money to its currency's minor unit. Rounding
 * both to a hardcoded 2 places is correct only while every supported
 * currency happens to use hundredths.
 */
function roundSplits(
  draft: Dataset,
  splits: Split[],
  splitMode: Purchase["splitMode"],
  currency: Currency,
): Split[] {
  const digits = digitsFor(draft.currencies, currency);
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
 * kept at six decimal places (see fxApi.ts's toFixed(6)), and rounding to a
 * currency's minor unit would quantize a rate below 0.01 straight to zero.
 */
/** Codes are identity, so they are validated the same way on every path. */
const CURRENCY_CODE = /^[A-Z]{2,8}$/;

function requireCurrencyDef(def: CurrencyDef): CurrencyDef {
  const code = normalizeCurrencyCode(def.code);
  if (!CURRENCY_CODE.test(code)) {
    throw new Error(`Currency code "${def.code}" must be 2-8 letters`);
  }
  if (!Number.isInteger(def.digits) || def.digits < 0 || def.digits > 4) {
    throw new Error(
      `Currency "${code}" needs a whole number of decimal places between 0 and 4`,
    );
  }
  return {
    code,
    digits: def.digits,
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
export function setBaseCurrency(draft: Dataset, currency: Currency): void {
  draft.settings.baseCurrency = currency;
  draft.fxRates = draft.fxRates.filter((r) => r.currency !== currency);
}
