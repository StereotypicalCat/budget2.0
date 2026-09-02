import { test, expect } from "bun:test";
import { equalSlices, sliceTotal, slicesBalance } from "./plans.ts";
import { CURRENCY_DIGITS } from "./types.ts";

/**
 * Every currency this app supports today happens to have 2 decimal places, so
 * code that hardcodes 2 is indistinguishable from code that reads
 * CURRENCY_DIGITS. This forces the table for the duration of one test, which
 * is the only way to prove the table is actually consulted without making the
 * product decision to add a non-2dp currency.
 */
function withDigits(currency: "DKK" | "USD" | "EUR", digits: number, body: () => void) {
  const original = CURRENCY_DIGITS[currency];
  CURRENCY_DIGITS[currency] = digits;
  try {
    body();
  } finally {
    CURRENCY_DIGITS[currency] = original;
  }
}

test("equal slices divide the total across consecutive months", () => {
  const slices = equalSlices({ amount: 3000, currency: "DKK" }, "2026-10", 6);
  expect(slices).toHaveLength(6);
  expect(slices[0]).toEqual({ month: "2026-10", amount: { amount: 500, currency: "DKK" } });
  expect(slices[5]!.month).toBe("2027-03");
});

test("uneven totals still sum exactly, the last slice absorbing the drift", () => {
  const slices = equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 3);
  expect(slices.map((s) => s.amount.amount)).toEqual([33.33, 33.33, 33.34]);
  expect(sliceTotal(slices)).toBe(100);
});

test("a single slice takes the whole total", () => {
  const slices = equalSlices({ amount: 99.99, currency: "DKK" }, "2026-01", 1);
  expect(slices).toEqual([
    { month: "2026-01", amount: { amount: 99.99, currency: "DKK" } },
  ]);
});

test("a count below one is rejected", () => {
  expect(() => equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 0)).toThrow(
    /at least one month/i,
  );
});

test("slicesBalance reports the shortfall the editor must show", () => {
  const slices = equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 2);
  expect(slicesBalance({ amount: 100, currency: "DKK" }, slices)).toBe(0);

  slices[0]!.amount.amount = 30;
  expect(slicesBalance({ amount: 100, currency: "DKK" }, slices)).toBe(20);
});

test("sliceTotal rounds to the slices' own currency, not always to 2 places", () => {
  withDigits("EUR", 0, () => {
    const slices = [
      { month: "2026-01" as const, amount: { amount: 10.4, currency: "EUR" as const } },
      { month: "2026-02" as const, amount: { amount: 10.4, currency: "EUR" as const } },
    ];
    expect(sliceTotal(slices)).toBe(21);
  });
});
