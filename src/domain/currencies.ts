import {
  DEFAULT_CURRENCY_DIGITS,
  type Currency,
  type CurrencyDef,
  type Dataset,
} from "./types.ts";

/**
 * How many decimals a currency rounds to.
 *
 * Digits used to be a module-level constant table, which made "add a
 * currency" a code change. They now live in the dataset, so every rounding
 * site has to be told which digits to use — that threading is deliberate, and
 * the reason `roundMoney` takes a number rather than a code.
 *
 * An undefined currency falls back to two places rather than throwing. A
 * missing definition is a data problem the import validator rejects at the
 * boundary; deep inside the fold, two decimals is right for almost every
 * currency and a throw would take the whole balance view down.
 */
export function digitsFor(
  currencies: readonly CurrencyDef[],
  code: Currency,
): number {
  const found = currencies.find((currency) => currency.code === code);
  return found ? found.digits : DEFAULT_CURRENCY_DIGITS;
}

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
