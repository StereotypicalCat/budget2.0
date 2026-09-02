import { test, expect } from "bun:test";
import { DEFAULT_CURRENCY_DIGITS, SEED_CURRENCIES } from "./types.ts";

/**
 * This file used to assert "the supported currencies are exactly DKK, USD,
 * EUR". That is no longer a property of the code: the owner defines
 * currencies, so the dataset is the authority and there is nothing global to
 * assert. What remains true is what a NEW dataset starts with.
 */
test("a new dataset starts with the three currencies the app shipped with", () => {
  expect(SEED_CURRENCIES.map((c) => c.code)).toEqual(["DKK", "USD", "EUR"]);
});

test("each seeded currency carries its decimals and a symbol to type", () => {
  for (const currency of SEED_CURRENCIES) {
    expect(currency.digits).toBe(2);
    expect(currency.symbol).toBeTruthy();
    expect(currency.name).toBeTruthy();
  }
});

test("the fallback for an undefined currency is two places", () => {
  expect(DEFAULT_CURRENCY_DIGITS).toBe(2);
});
