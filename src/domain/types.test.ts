import { test, expect } from "bun:test";
import { CURRENCIES, CURRENCY_DIGITS } from "./types.ts";

test("supported currencies are exactly DKK, USD, EUR", () => {
  expect(CURRENCIES).toEqual(["DKK", "USD", "EUR"]);
});

test("every supported currency has 2 decimal digits", () => {
  for (const c of CURRENCIES) {
    expect(CURRENCY_DIGITS[c]).toBe(2);
  }
});
