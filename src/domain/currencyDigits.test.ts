import { test, expect, describe } from "bun:test";
import { roundMoney, distributeByWeight, distributeByAmount } from "./money.ts";
import { toBase, fromBase } from "./fx.ts";
import { equalSlices, sliceTotal } from "./plans.ts";
import { resolveRule } from "./allocation.ts";
import { foldBalances, figuresFor } from "./fold.ts";
import { monthView } from "./views.ts";
import { SCHEMA_VERSION } from "./seed.ts";
import type { CurrencyDef, Dataset } from "./types.ts";

/**
 * Decimal places are ONE setting for the whole dataset — `settings.digits` —
 * and every currency rounds to it. See
 * docs/specs/2026-09-02-global-decimals-design.md for what that gave up.
 *
 * Two decimals is right for every currency the app ships with, so code that
 * hardcodes 2 is indistinguishable from code that reads the setting. Driving a
 * dataset at zero decimals is the only thing that tells them apart, and that
 * is what this file exists for: it proves digits reach each rounding site FROM
 * THE DATASET. It can no longer prove they vary per currency, because they no
 * longer do.
 *
 * Yen are the reason zero is a real setting and not a contrivance: ¥3333.3 is
 * not a number that can exist.
 */
const DIGITS = 0;

const JPY: CurrencyDef = { code: "JPY", symbol: "¥" };
const USD: CurrencyDef = { code: "USD", symbol: "$" };
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

  test("a percentage allocation at zero decimals yields whole units", () => {
    const rate = resolveRule(
      { kind: "percentOfIncome", percent: 33.333 },
      10_000,
      "JPY",
      [],
      DIGITS,
    );
    expect(rate).toBe(3333);
    expect(Number.isInteger(rate)).toBe(true);
  });

  test("an FX conversion at zero decimals yields whole units both ways", () => {
    const rates = [
      { currency: "USD", baseUnitsPerOne: 151.234567, updatedAt: "2026-01-01", source: "manual" as const },
    ];
    expect(toBase({ amount: 10, currency: "USD" }, "JPY", rates, DIGITS)).toBe(1512);
    // Back out: 1512 / 151.234567 = 9.9977..., and the SAME setting rounds it,
    // so 10. Under per-currency digits this rounded to USD's two places; the
    // arithmetic differs, the "no fractional unit escapes" property does not.
    expect(fromBase(1512, "USD", "JPY", rates, DIGITS)).toBe(10);
    expect(Number.isInteger(fromBase(1512, "USD", "JPY", rates, DIGITS))).toBe(true);
  });

  test("a split distributed at zero decimals still sums exactly", () => {
    const parts = distributeByWeight(1000, [1, 1, 1], 2, DIGITS);
    expect(parts).toEqual([333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.every(Number.isInteger)).toBe(true);
  });

  test("fixed amounts distributed at zero decimals still sum exactly", () => {
    const parts = distributeByAmount(1000, [333.4, 333.4, 0], 2, DIGITS);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.every(Number.isInteger)).toBe(true);
  });

  test("a finance plan divides into whole units and sums exactly", () => {
    const slices = equalSlices({ amount: 1000, currency: "JPY" }, "2026-01", 3, DIGITS);
    expect(slices.map((s) => s.amount.amount)).toEqual([333, 333, 334]);
    expect(sliceTotal(slices, DIGITS)).toBe(1000);
  });
});

describe("the fold at zero decimals", () => {
  function dataset(): Dataset {
    return {
      settings: {
        baseCurrency: "JPY",
        foldStartMonth: "2026-01",
        schemaVersion: SCHEMA_VERSION,
        digits: DIGITS,
      },
      currencies: CURRENCIES,
      fxRates: [
        { currency: "USD", baseUnitsPerOne: 151.234567, updatedAt: "2026-01-01", source: "manual" },
      ],
      posts: [
        {
          id: "food",
          name: "Food",
          order: 0,
          archived: false,
          currency: "JPY",
          rules: [{ from: "2026-01", rule: { kind: "percentOfIncome", percent: 33.333 } }],
        },
        // Never budgeted (rules: []) — allocation is always zero, so this
        // post's only figures are what the recurring cost below projects onto
        // it. Isolates the expected/projected track from the allocation math
        // "food" already covers.
        {
          id: "fun",
          name: "Fun",
          order: 1,
          archived: false,
          currency: "JPY",
          rules: [],
        },
      ],
      months: [
        { id: "2026-01", income: { amount: 10_000, currency: "JPY" }, ruleOverrides: {} },
        { id: "2026-02", income: { amount: 10_000, currency: "JPY" }, ruleOverrides: {} },
      ],
      purchases: [],
      // Unconfirmed on purpose: a confirmed occurrence becomes an ordinary
      // Purchase and would be counted as `charges`, not `expected` — the
      // wrong track for this guard. $7 at 151.234567 converts to a non-whole
      // 1058.641969, and split 3/4 (fixed, not percent — the OTHER split
      // mode) divides unevenly too, so both the FX conversion and the split
      // division are exercised at zero decimals.
      recurring: [
        {
          id: "gym",
          name: "Gym",
          order: 0,
          archived: false,
          amount: { amount: 7, currency: "USD" },
          startDate: "2026-01",
          recurrence: { kind: "everyNMonths", n: 1 },
          anchoring: "calendar",
          splitMode: "fixed",
          splits: [
            { postId: "food", value: 3, absorbsRemainder: false },
            { postId: "fun", value: 0, absorbsRemainder: true },
          ],
        },
      ],
    };
  }

  test("no figure the fold produces has a fractional yen in it", () => {
    const fold = foldBalances(dataset(), "2026-02");
    for (const month of ["2026-01", "2026-02"]) {
      for (const postId of ["food", "fun"]) {
        const figures = figuresFor(fold, postId, month);
        for (const [name, value] of Object.entries(figures)) {
          expect(Number.isInteger(value)).toBe(true);
          expect(`${postId} ${month} ${name} = ${value}`).toBe(
            `${postId} ${month} ${name} = ${Math.round(value)}`,
          );
        }
      }
    }
    expect(figuresFor(fold, "food", "2026-01").allocation).toBe(3333);
    expect(figuresFor(fold, "food", "2026-02").carriedIn).toBe(3333);

    // The recurring cost's $7 converts to ¥1059, split 3/4 (fixed) onto
    // food/fun — a wrong implementation that rounds either the FX conversion
    // or the split at 2 decimals produces fractional yen here, which the
    // Number.isInteger sweep above would already fail; these pin the exact
    // whole-unit figures so a regression names the wrong number, not just
    // "not an integer".
    expect(figuresFor(fold, "food", "2026-01").expected).toBe(454);
    expect(figuresFor(fold, "food", "2026-01").projected).toBe(2879);
    expect(figuresFor(fold, "fun", "2026-01").expected).toBe(605);
    expect(figuresFor(fold, "fun", "2026-01").projected).toBe(-605);
    // Second month: the cost recurs, so the projected balance keeps
    // absorbing it — proof this is a running division, not a one-off.
    expect(figuresFor(fold, "food", "2026-02").projected).toBe(5758);
    expect(figuresFor(fold, "fun", "2026-02").projected).toBe(-1210);
  });

  test("the month view's totals are whole units too", () => {
    const view = monthView(dataset(), "2026-01");
    expect(Number.isInteger(view.totalAllocation)).toBe(true);
    expect(Number.isInteger(view.unallocated)).toBe(true);
    expect(view.unallocated).toBe(10_000 - 3333);
    // The view embeds each post's expected/projected figures too — same
    // sweep as the fold test above, through the view's own aggregation path.
    for (const row of view.rows) {
      for (const [name, value] of Object.entries(row.figures)) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  /**
   * The setting is what is read, not the base currency's old per-currency
   * entry and not a constant: moving it to 2 has to change the numbers.
   */
  test("raising the setting to two decimals changes what the fold produces", () => {
    const twoPlaces = { ...dataset(), settings: { ...dataset().settings, digits: 2 } };
    const fold = foldBalances(twoPlaces, "2026-01");
    expect(figuresFor(fold, "food", "2026-01").allocation).toBe(3333.3);

    // Same recurring cost, same $7 — at two decimals the FX conversion and
    // the fixed split both leave a fraction: 3333 → 3333.3, and the projected
    // track moves right along with it.
    expect(figuresFor(fold, "food", "2026-01").expected).toBe(453.7);
    expect(figuresFor(fold, "food", "2026-01").projected).toBe(2879.6);
    expect(figuresFor(fold, "fun", "2026-01").expected).toBe(604.94);
    expect(figuresFor(fold, "fun", "2026-01").projected).toBe(-604.94);
  });
});
