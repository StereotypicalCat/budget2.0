import { test, expect } from "bun:test";
import { equalSlices, sliceTotal, slicesBalance } from "./plans.ts";

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
