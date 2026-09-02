import { test, expect, describe } from "bun:test";
import { roundMoney, distributeByWeight, distributeByAmount } from "./money.ts";
import { toBase, fromBase } from "./fx.ts";
import { equalSlices, sliceTotal } from "./plans.ts";
import { resolveRule } from "./allocation.ts";
import { foldBalances, figuresFor } from "./fold.ts";
import { monthView } from "./views.ts";
import type { CurrencyDef, Dataset } from "./types.ts";

/**
 * Every currency the app shipped with has two decimal places, so code that
 * hardcodes 2 is indistinguishable from code that reads the dataset. Now that
 * the owner can define currencies, that stops being true — and a zero-decimal
 * currency is the only thing that can prove digits actually flow from the
 * dataset to each rounding site rather than being assumed.
 *
 * JPY is the real-world case: yen have no minor unit, so ¥3333.3 is not a
 * number that can exist.
 */
const JPY: CurrencyDef = { code: "JPY", digits: 0, symbol: "¥" };
const USD: CurrencyDef = { code: "USD", digits: 2, symbol: "$" };
const CURRENCIES = [JPY, USD];

describe("rounding takes its digits from the dataset", () => {
  test("roundMoney rounds to the digits it is given", () => {
    expect(roundMoney(3333.3, 0)).toBe(3333);
    expect(roundMoney(3333.335, 2)).toBe(3333.34);
    // 1.234, not 1.235: the double nearest 1.2345 is slightly BELOW it, and
    // toFixed rounds the double's actual value. That is the documented
    // trade-off in money.ts — predictable, if occasionally surprising.
    expect(roundMoney(1.2345, 3)).toBe(1.234);
  });

  test("a percentage allocation in a zero-decimal currency yields whole units", () => {
    const rate = resolveRule(
      { kind: "percentOfIncome", percent: 33.333 },
      10_000,
      "JPY",
      [],
      CURRENCIES,
    );
    expect(rate).toBe(3333);
    expect(Number.isInteger(rate)).toBe(true);
  });

  test("an FX conversion into a zero-decimal base yields whole units", () => {
    const rates = [
      { currency: "USD", baseUnitsPerOne: 151.234567, updatedAt: "2026-01-01", source: "manual" as const },
    ];
    expect(toBase({ amount: 10, currency: "USD" }, "JPY", rates, CURRENCIES)).toBe(1512);
    // And back out: 1512 / 151.234567 = 9.9977..., rounded to USD's TWO
    // decimals, so 10 — not the three-decimal 9.998.
    expect(fromBase(1512, "USD", "JPY", rates, CURRENCIES)).toBe(10);
  });

  test("a split distributed in a zero-decimal currency still sums exactly", () => {
    const parts = distributeByWeight(1000, [1, 1, 1], 2, 0);
    expect(parts).toEqual([333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.every(Number.isInteger)).toBe(true);
  });

  test("fixed amounts distributed in a zero-decimal currency still sum exactly", () => {
    const parts = distributeByAmount(1000, [333.4, 333.4, 0], 2, 0);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.every(Number.isInteger)).toBe(true);
  });

  test("a finance plan divides into whole units and sums exactly", () => {
    const slices = equalSlices({ amount: 1000, currency: "JPY" }, "2026-01", 3, 0);
    expect(slices.map((s) => s.amount.amount)).toEqual([333, 333, 334]);
    expect(sliceTotal(slices, 0)).toBe(1000);
  });
});

describe("the fold in a zero-decimal currency", () => {
  function dataset(): Dataset {
    return {
      settings: { baseCurrency: "JPY", foldStartMonth: "2026-01", schemaVersion: 3 },
      currencies: CURRENCIES,
      fxRates: [],
      posts: [
        {
          id: "food",
          name: "Food",
          order: 0,
          archived: false,
          currency: "JPY",
          rules: [{ from: "2026-01", rule: { kind: "percentOfIncome", percent: 33.333 } }],
        },
      ],
      months: [
        { id: "2026-01", income: { amount: 10_000, currency: "JPY" }, ruleOverrides: {} },
        { id: "2026-02", income: { amount: 10_000, currency: "JPY" }, ruleOverrides: {} },
      ],
      purchases: [],
    };
  }

  test("no figure the fold produces has a fractional yen in it", () => {
    const fold = foldBalances(dataset(), "2026-02");
    for (const month of ["2026-01", "2026-02"]) {
      const figures = figuresFor(fold, "food", month);
      for (const [name, value] of Object.entries(figures)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(`${month} ${name} = ${value}`).toBe(`${month} ${name} = ${Math.round(value)}`);
      }
    }
    expect(figuresFor(fold, "food", "2026-01").allocation).toBe(3333);
    expect(figuresFor(fold, "food", "2026-02").carriedIn).toBe(3333);
  });

  test("the month view's totals are whole units too", () => {
    const view = monthView(dataset(), "2026-01");
    expect(Number.isInteger(view.totalAllocation)).toBe(true);
    expect(Number.isInteger(view.unallocated)).toBe(true);
    expect(view.unallocated).toBe(10_000 - 3333);
  });
});
