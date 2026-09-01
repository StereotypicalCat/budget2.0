import { CURRENCY_DIGITS, type Currency } from "./types.ts";

/**
 * Rounds a float to its currency's minor unit. `toFixed` rounds the double's
 * actual decimal value, which is the most predictable option available for
 * binary floats. Call this after every division and FX conversion, and before
 * persisting.
 */
export function roundMoney(amount: number, currency: Currency = "DKK"): number {
  const digits = CURRENCY_DIGITS[currency];
  return Number(amount.toFixed(digits));
}

function withRemainder(
  total: number,
  parts: number[],
  remainderIndex: number,
  currency: Currency,
): number[] {
  const result = [...parts];
  let othersSum = 0;
  for (let i = 0; i < result.length; i++) {
    if (i !== remainderIndex) othersSum += result[i]!;
  }
  // Never round this independently — subtraction is what makes the parts sum
  // exactly to the total.
  result[remainderIndex] = roundMoney(total - othersSum, currency);
  return result;
}

/** Splits `total` proportionally to `weights`. Weights need not sum to 100. */
export function distributeByWeight(
  total: number,
  weights: number[],
  remainderIndex: number,
  currency: Currency = "DKK",
): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  // All-zero weights would divide by zero. A zero-total purchase is legal (and
  // reachable via import), so the whole amount goes to the remainder instead of
  // throwing and taking the whole fold down with it.
  const parts = weights.map((w, i) =>
    i === remainderIndex || weightSum === 0
      ? 0
      : roundMoney((total * w) / weightSum, currency),
  );
  return withRemainder(total, parts, remainderIndex, currency);
}

/** Uses `amounts` as-is; `remainderIndex` absorbs any shortfall or excess. */
export function distributeByAmount(
  total: number,
  amounts: number[],
  remainderIndex: number,
  currency: Currency = "DKK",
): number[] {
  const parts = amounts.map((a, i) =>
    i === remainderIndex ? 0 : roundMoney(a, currency),
  );
  return withRemainder(total, parts, remainderIndex, currency);
}
