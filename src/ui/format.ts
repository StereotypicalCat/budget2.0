import type { Currency } from "../domain/types.ts";

/**
 * Display is a rounding boundary, and `settings.digits` is what it rounds to —
 * so digits are passed in here exactly as they are to `roundMoney`, with no
 * default. A pinned 2 used to live in this file, which made the setting
 * invisible at zero (whole yen still read "3,333.00") and lossy at three or
 * four, where it hid precision the dataset genuinely holds.
 *
 * The locale stays pinned: output must not vary between the owner's machine
 * and CI. Formatters are cached per digit count, because constructing an
 * `Intl.NumberFormat` is the expensive part and a table with thirty money
 * cells would otherwise build thirty of them per render.
 */
const FORMATTERS = new Map<number, Intl.NumberFormat>();

function formatter(digits: number): Intl.NumberFormat {
  let found = FORMATTERS.get(digits);
  if (!found) {
    found = new Intl.NumberFormat("en-GB", {
      // Both bounds, so an even 200 reads "200.00" beside "199.95" and a
      // column of money still lines up.
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    FORMATTERS.set(digits, found);
  }
  return found;
}

export function formatAmount(amount: number, digits: number): string {
  return formatter(digits).format(amount);
}

export function formatMoney(amount: number, currency: Currency, digits: number): string {
  return `${formatAmount(amount, digits)} ${currency}`;
}

/**
 * A signed amount with no currency code. For columns whose currency is stated
 * once in the header — the month view's post table, where every figure is in
 * the dataset's base currency, and repeating the code on all thirty cells only
 * bought a line wrap at phone width.
 */
export function formatSignedAmount(amount: number, digits: number): string {
  return `${amount > 0 ? "+" : ""}${formatAmount(amount, digits)}`;
}

export function formatSignedMoney(
  amount: number,
  currency: Currency,
  digits: number,
): string {
  return `${formatSignedAmount(amount, digits)} ${currency}`;
}
