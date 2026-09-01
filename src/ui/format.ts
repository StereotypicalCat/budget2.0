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

export function formatSignedMoney(amount: number, currency: Currency): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatMoney(amount, currency)}`;
}
