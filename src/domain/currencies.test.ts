import { test, expect, describe } from "bun:test";
import { currencyCodes, findCurrency, normalizeCurrencyCode } from "./currencies.ts";
import type { CurrencyDef } from "./types.ts";

const TABLE: CurrencyDef[] = [
  { code: "DKK", symbol: "kr" },
  { code: "JPY", symbol: "¥" },
  { code: "KWD" },
];

/*
 * `digitsFor` was tested here. Decimal places are one dataset-wide setting
 * now, so there is no per-currency resolution left to assert; that the setting
 * reaches every rounding site is what src/domain/currencyDigits.test.ts drives.
 */

describe("normalizeCurrencyCode", () => {
  test("codes are identity, so case and padding cannot fork one currency in two", () => {
    expect(normalizeCurrencyCode(" usd ")).toBe("USD");
    expect(normalizeCurrencyCode("Jpy")).toBe("JPY");
  });
});

test("currencyCodes keeps the owner's order", () => {
  expect(currencyCodes(TABLE)).toEqual(["DKK", "JPY", "KWD"]);
});

test("findCurrency returns the definition, or nothing", () => {
  expect(findCurrency(TABLE, "JPY")?.symbol).toBe("¥");
  expect(findCurrency(TABLE, "XYZ")).toBeUndefined();
});
