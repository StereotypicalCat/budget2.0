import { roundMoney } from "./money.ts";
import { digitsFor } from "./currencies.ts";
import type { Currency, CurrencyDef, FxRate, Money } from "./types.ts";

export class MissingRateError extends Error {
  constructor(public readonly currency: Currency) {
    super(`No exchange rate configured for ${currency}`);
    this.name = "MissingRateError";
  }
}

function rateFor(currency: Currency, rates: FxRate[]): number {
  const found = rates.find((r) => r.currency === currency);
  if (!found) throw new MissingRateError(currency);
  return found.baseUnitsPerOne;
}

/** Converts a Money value into the base currency, rounded. */
export function toBase(
  value: Money,
  baseCurrency: Currency,
  rates: FxRate[],
  currencies: readonly CurrencyDef[],
): number {
  const digits = digitsFor(currencies, baseCurrency);
  if (value.currency === baseCurrency) {
    return roundMoney(value.amount, digits);
  }
  return roundMoney(value.amount * rateFor(value.currency, rates), digits);
}

/** Converts a base-currency amount into `target`, rounded. */
export function fromBase(
  amount: number,
  target: Currency,
  baseCurrency: Currency,
  rates: FxRate[],
  currencies: readonly CurrencyDef[],
): number {
  const digits = digitsFor(currencies, target);
  if (target === baseCurrency) return roundMoney(amount, digits);
  return roundMoney(amount / rateFor(target, rates), digits);
}
