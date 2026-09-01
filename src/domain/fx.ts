import { roundMoney } from "./money.ts";
import type { Currency, FxRate, Money } from "./types.ts";

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
): number {
  if (value.currency === baseCurrency) {
    return roundMoney(value.amount, baseCurrency);
  }
  return roundMoney(value.amount * rateFor(value.currency, rates), baseCurrency);
}

/** Converts a base-currency amount into `target`, rounded. */
export function fromBase(
  amount: number,
  target: Currency,
  baseCurrency: Currency,
  rates: FxRate[],
): number {
  if (target === baseCurrency) return roundMoney(amount, target);
  return roundMoney(amount / rateFor(target, rates), target);
}
