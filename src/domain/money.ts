/**
 * Money is a float. Two rules make that safe, and both are about WHERE
 * rounding happens rather than how.
 *
 * Digits are passed in, never defaulted here. They come from the dataset —
 * `settings.digits`, one value for every currency alike — so every call site
 * has to be told. That is deliberate friction: a default of 2 would look right
 * for every currency the app ships with, so a missed call site would pass the
 * whole suite and be wrong only once the setting moves off 2.
 */

/**
 * Rounds to the dataset's decimal places. `toFixed` rounds the double's actual
 * decimal value, which is the most predictable option available for binary
 * floats. Call this after every division and FX conversion, and before
 * persisting.
 */
export function roundMoney(amount: number, digits: number): number {
  return Number(amount.toFixed(digits));
}

function withRemainder(
  total: number,
  parts: number[],
  remainderIndex: number,
  digits: number,
): number[] {
  const result = [...parts];
  let othersSum = 0;
  for (let i = 0; i < result.length; i++) {
    if (i !== remainderIndex) othersSum += result[i]!;
  }
  // Never round this independently — subtraction is what makes the parts sum
  // exactly to the total.
  result[remainderIndex] = roundMoney(total - othersSum, digits);
  return result;
}

/** Splits `total` proportionally to `weights`. Weights need not sum to 100. */
export function distributeByWeight(
  total: number,
  weights: number[],
  remainderIndex: number,
  digits: number,
): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  // All-zero weights would divide by zero. A zero-total purchase is legal (and
  // reachable via import), so the whole amount goes to the remainder instead of
  // throwing and taking the whole fold down with it.
  const parts = weights.map((w, i) =>
    i === remainderIndex || weightSum === 0
      ? 0
      : roundMoney((total * w) / weightSum, digits),
  );
  return withRemainder(total, parts, remainderIndex, digits);
}

/** Uses `amounts` as-is; `remainderIndex` absorbs any shortfall or excess. */
export function distributeByAmount(
  total: number,
  amounts: number[],
  remainderIndex: number,
  digits: number,
): number[] {
  const parts = amounts.map((a, i) =>
    i === remainderIndex ? 0 : roundMoney(a, digits),
  );
  return withRemainder(total, parts, remainderIndex, digits);
}
