import { type Currency, type CurrencyDef, type Dataset } from "./types.ts";

/*
 * `digitsFor(currencies, code)` used to live here. Decimal places are now one
 * setting for the whole dataset, `settings.digits`, so there is nothing to
 * resolve a code against: rounding sites read that field directly, and domain
 * functions that once took the currency table purely to look digits up take a
 * `digits: number` instead. A function still accepting a code it ignored would
 * only invite call sites to believe the code still mattered.
 */

/** The codes, in the order the owner arranged them. */
export function currencyCodes(currencies: readonly CurrencyDef[]): Currency[] {
  return currencies.map((currency) => currency.code);
}

export function findCurrency(
  currencies: readonly CurrencyDef[],
  code: Currency,
): CurrencyDef | undefined {
  return currencies.find((currency) => currency.code === code);
}

/**
 * Uppercased and trimmed. Codes are identity here — they key the FX table and
 * every stored Money — so "usd" and "USD" must never become two currencies.
 */
export function normalizeCurrencyCode(raw: string): Currency {
  return raw.trim().toUpperCase();
}

/**
 * Everywhere `code` is referenced by stored data, described for a human.
 *
 * The same reasoning as posts being archived rather than deleted: stored Money
 * carries the code, so removing a currency in use would leave amounts pointing
 * at a definition that no longer exists — and `parseDatasetJson` would then
 * refuse the owner's own exported file. Returning WHERE it is used lets the UI
 * explain the refusal instead of just denying it.
 */
export function currencyUsage(dataset: Dataset, code: Currency): string[] {
  const used: string[] = [];

  if (dataset.settings.baseCurrency === code) used.push("the base currency");

  for (const post of dataset.posts) {
    if (post.currency === code) used.push(`post "${post.name}"`);
    for (const version of post.rules) {
      if (version.rule.kind === "fixed" && version.rule.amount.currency === code) {
        used.push(`post "${post.name}" rule from ${version.from}`);
      }
    }
  }

  for (const month of dataset.months) {
    if (month.income.currency === code) used.push(`month ${month.id}`);
    for (const [postId, rule] of Object.entries(month.ruleOverrides)) {
      if (rule.kind === "fixed" && rule.amount.currency === code) {
        const name = dataset.posts.find((p) => p.id === postId)?.name ?? postId;
        used.push(`${month.id} override for "${name}"`);
      }
    }
  }

  for (const purchase of dataset.purchases) {
    if (purchase.total.currency === code) used.push(`purchase "${purchase.description}"`);
    for (const slice of purchase.schedule?.slices ?? []) {
      if (slice.amount.currency === code) {
        used.push(`purchase "${purchase.description}" slice ${slice.month}`);
      }
    }
  }

  return [...new Set(used)];
}
