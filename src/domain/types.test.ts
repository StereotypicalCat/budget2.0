import { test, expect } from "bun:test";
import { DEFAULT_DIGITS, SEED_CURRENCIES } from "./types.ts";

/**
 * This file used to assert "the supported currencies are exactly DKK, USD,
 * EUR". That is no longer a property of the code: the owner defines
 * currencies, so the dataset is the authority and there is nothing global to
 * assert. What remains true is what a NEW dataset starts with.
 */
test("a new dataset starts with the currencies the app shipped with", () => {
  expect(SEED_CURRENCIES.map((c) => c.code)).toEqual(["DKK", "USD", "EUR", "GBP"]);
});

test("sterling carries the pound sign, so \"10£\" parses", () => {
  const gbp = SEED_CURRENCIES.find((c) => c.code === "GBP")!;
  expect(gbp.symbol).toBe("£");
});

test("each seeded currency carries a symbol to type and a name to read", () => {
  for (const currency of SEED_CURRENCIES) {
    expect(currency.symbol).toBeTruthy();
    expect(currency.name).toBeTruthy();
  }
});

/**
 * Decimals are not a property of a currency here — they are one setting for
 * the whole dataset. A definition still carrying `digits` would be a leftover
 * that the import validator drops and nothing reads.
 */
test("no seeded currency declares decimals of its own", () => {
  for (const currency of SEED_CURRENCIES) {
    expect("digits" in currency).toBe(false);
  }
});

test("a new dataset rounds to two places", () => {
  expect(DEFAULT_DIGITS).toBe(2);
});
