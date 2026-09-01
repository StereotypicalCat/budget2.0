import { test, expect, describe } from "bun:test";
import { toBase, fromBase, MissingRateError } from "./fx.ts";
import type { FxRate } from "./types.ts";

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

describe("toBase", () => {
  test("passes base-currency values through untouched", () => {
    expect(toBase({ amount: 100, currency: "DKK" }, "DKK", rates)).toBe(100);
  });

  test("converts using baseUnitsPerOne", () => {
    expect(toBase({ amount: 10, currency: "EUR" }, "DKK", rates)).toBe(74.6);
  });

  test("rounds the conversion result", () => {
    expect(toBase({ amount: 3.33, currency: "USD" }, "DKK", rates)).toBe(22.98);
  });

  test("throws MissingRateError naming the currency", () => {
    expect(() => toBase({ amount: 1, currency: "USD" }, "DKK", [])).toThrow(
      MissingRateError,
    );
    try {
      toBase({ amount: 1, currency: "USD" }, "DKK", []);
    } catch (error) {
      expect((error as MissingRateError).currency).toBe("USD");
    }
  });
});

describe("fromBase", () => {
  test("passes base through untouched", () => {
    expect(fromBase(100, "DKK", "DKK", rates)).toBe(100);
  });

  test("inverts the conversion", () => {
    expect(fromBase(74.6, "EUR", "DKK", rates)).toBe(10);
  });
});
