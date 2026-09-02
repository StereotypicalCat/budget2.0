import type { Currency } from "../domain/types.ts";

export interface CurrencyOption {
  code: Currency;
  /** "$", "kr", "€". Optional: a currency can be entered by code alone. */
  symbol?: string;
}

export interface ParsedMoney {
  amount: number;
  currency: Currency;
}

/**
 * Reads an amount AND its currency out of one field, so "30$" means thirty
 * dollars without touching a separate dropdown. Entry speed is a stated
 * product feature; a second control per amount is the opposite of it.
 *
 * Returns null for anything that is not yet a money value, including a
 * half-typed "30." — committing that as 30 would fight the user mid-keystroke.
 * An unrecognised currency also returns null rather than falling back, because
 * silently reading "30 GBP" as 30 DKK books money at the wrong currency.
 */
export function parseMoneyInput(
  text: string,
  options: readonly CurrencyOption[],
  fallback: Currency,
): ParsedMoney | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const currency = detectCurrency(trimmed, options);
  if (currency === "unknown") return null;

  const amount = parseAmount(stripCurrency(trimmed, options));
  if (amount === null) return null;

  return { amount, currency: currency ?? fallback };
}

/**
 * A three-letter code beats a symbol: "$30 USD" is contradictory, and the code
 * is the more deliberate signal. Returns `null` when no currency was written
 * at all, and "unknown" when something currency-shaped was written that this
 * dataset has no currency for.
 */
function detectCurrency(
  text: string,
  options: readonly CurrencyOption[],
): Currency | null | "unknown" {
  const codes = new Map(options.map((o) => [o.code.toUpperCase(), o.code]));

  // A bare three-letter word, not part of a longer word.
  const words = text.toUpperCase().match(/[A-Z]{2,}/g) ?? [];
  for (const word of words) {
    const matched = codes.get(word);
    if (matched) return matched;
  }

  // Longest symbol first, so "kr." cannot be shadowed by "kr".
  const symbols = options
    .filter((o) => o.symbol)
    .sort((a, b) => b.symbol!.length - a.symbol!.length);
  for (const option of symbols) {
    if (text.includes(option.symbol!)) return option.code;
  }

  // Anything left that is neither digits, separators nor a sign is a currency
  // this dataset does not define.
  if (/[^\d\s.,+-]/.test(text)) return "unknown";

  // A word that is not a known code is unknown too ("30 GBP").
  if (words.length > 0) return "unknown";

  return null;
}

function stripCurrency(text: string, options: readonly CurrencyOption[]): string {
  let out = text;
  for (const option of options) {
    if (option.symbol) out = out.split(option.symbol).join(" ");
    out = out.replace(new RegExp(option.code, "gi"), " ");
  }
  return out;
}

/**
 * Separator handling, which is where this earns its tests. When BOTH "." and
 * "," appear, the last one is the decimal point — that covers "1.234,56" and
 * "1,234.56" without knowing the user's locale. When only one appears, it
 * groups thousands if exactly three digits follow and is a decimal point
 * otherwise, so "1,500" is fifteen hundred and "1,5" is one and a half.
 */
function parseAmount(text: string): number | null {
  // Normalise every kind of space to a plain one before splitting.
  const spaced = text.replace(/\s+/g, " ").trim();
  if (spaced === "") return null;

  const sign = spaced.startsWith("-") ? -1 : 1;
  const unsigned = spaced.replace(/^[+-]\s*/, "");

  // A space only ever GROUPS thousands, so every group after the first must be
  // exactly three digits. Without this, "30 40" silently becomes 3040 — two
  // amounts typed by mistake, committed as one much larger one.
  const groups = unsigned.split(" ").filter((group) => group !== "");
  if (groups.length === 0) return null;
  if (groups.length > 1) {
    const allGrouped = groups
      .slice(1)
      .every((group) => /^\d{3}([.,]\d+)?$/.test(group));
    if (!allGrouped) return null;
  }

  const digits = groups.join("");
  if (!/^[\d.,]+$/.test(digits)) return null;
  if (/^[.,]+$/.test(digits)) return null;
  // A trailing separator means the number is still being typed.
  if (/[.,]$/.test(digits)) return null;

  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let decimalAt = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const only = Math.max(lastDot, lastComma);
    if (digits.length - only - 1 !== 3) decimalAt = only;
  }

  const whole = (decimalAt === -1 ? digits : digits.slice(0, decimalAt)).replace(
    /[.,]/g,
    "",
  );
  const fraction = decimalAt === -1 ? "" : digits.slice(decimalAt + 1);
  if (/[.,]/.test(fraction)) return null;

  const value = Number(
    `${whole === "" ? "0" : whole}.${fraction === "" ? "0" : fraction}`,
  );
  return Number.isFinite(value) ? sign * value : null;
}

