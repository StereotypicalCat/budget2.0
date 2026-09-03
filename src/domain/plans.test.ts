import { test, expect } from "bun:test";
import { equalSlices, sliceTotal, slicesBalance } from "./plans.ts";

/**
 * Digits are passed in rather than looked up, so a dataset rounding to a
 * different number of places is expressed directly instead of by
 * monkey-patching a constant, which is what this file used to have to do.
 */
const DKK = 2;

test("equal slices divide the total across consecutive months", () => {
  const slices = equalSlices({ amount: 3000, currency: "DKK" }, "2026-10", 6, DKK);
  expect(slices).toHaveLength(6);
  expect(slices[0]).toEqual({ month: "2026-10", amount: { amount: 500, currency: "DKK" } });
  expect(slices[5]!.month).toBe("2027-03");
});

test("uneven totals still sum exactly, the last slice absorbing the drift", () => {
  const slices = equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 3, DKK);
  expect(slices.map((s) => s.amount.amount)).toEqual([33.33, 33.33, 33.34]);
  expect(sliceTotal(slices, DKK)).toBe(100);
});

test("a single slice takes the whole total", () => {
  const slices = equalSlices({ amount: 99.99, currency: "DKK" }, "2026-01", 1, DKK);
  expect(slices).toEqual([
    { month: "2026-01", amount: { amount: 99.99, currency: "DKK" } },
  ]);
});

test("a count below one is rejected", () => {
  expect(() => equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 0, DKK)).toThrow(
    /at least one month/i,
  );
});

test("slicesBalance reports the shortfall the editor must show", () => {
  const slices = equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 2, DKK);
  expect(slicesBalance({ amount: 100, currency: "DKK" }, slices, DKK)).toBe(0);

  slices[0]!.amount.amount = 30;
  expect(slicesBalance({ amount: 100, currency: "DKK" }, slices, DKK)).toBe(20);
});

test("sliceTotal rounds to the digits it is given, not always to 2 places", () => {
  const slices = [
    { month: "2026-01", amount: { amount: 10.4, currency: "EUR" } },
    { month: "2026-02", amount: { amount: 10.4, currency: "EUR" } },
  ];
  expect(sliceTotal(slices, 0)).toBe(21);
  expect(sliceTotal(slices, 2)).toBe(20.8);
});
