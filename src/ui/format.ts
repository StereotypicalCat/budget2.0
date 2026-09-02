import type { Currency } from "../domain/types.ts";

// Pinned locale: output must not vary between the user's machine and CI.
const NUMBER = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(amount: number): string {
  return NUMBER.format(amount);
}

export function formatMoney(amount: number, currency: Currency): string {
  return `${formatAmount(amount)} ${currency}`;
}

/**
 * A signed amount with no currency code. For columns whose currency is stated
 * once in the header — the month view's post table, where every figure is in
 * the dataset's base currency, and repeating the code on all thirty cells only
 * bought a line wrap at phone width.
 */
export function formatSignedAmount(amount: number): string {
  return `${amount > 0 ? "+" : ""}${formatAmount(amount)}`;
}

export function formatSignedMoney(amount: number, currency: Currency): string {
  return `${formatSignedAmount(amount)} ${currency}`;
}
