import { distributeByWeight, roundMoney } from "./money.ts";
import { addMonths } from "./months.ts";
import type { Money, MonthId, ScheduleSlice } from "./types.ts";

/** Splits a total into `count` consecutive monthly slices that sum exactly. */
export function equalSlices(
  total: Money,
  startMonth: MonthId,
  count: number,
): ScheduleSlice[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("A finance plan needs at least one month");
  }
  const weights = new Array(count).fill(1);
  const amounts = distributeByWeight(
    total.amount,
    weights,
    count - 1,
    total.currency,
  );
  return amounts.map((amount, i) => ({
    month: addMonths(startMonth, i),
    amount: { amount, currency: total.currency },
  }));
}

/**
 * Every slice of a schedule carries the purchase's currency, so the first one
 * names the currency to round in. Rounding to a hardcoded 2 places would be
 * wrong for any currency whose minor unit is not hundredths.
 */
export function sliceTotal(slices: ScheduleSlice[]): number {
  const sum = slices.reduce((total, s) => total + s.amount.amount, 0);
  return roundMoney(sum, slices[0]?.amount.currency);
}

/** total - sum(slices). Positive means the plan is short of the total. */
export function slicesBalance(total: Money, slices: ScheduleSlice[]): number {
  return roundMoney(total.amount - sliceTotal(slices), total.currency);
}
