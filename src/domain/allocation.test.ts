import { test, expect, describe } from "bun:test";
import {
  resolveRule,
  ruleAt,
  ruleForPost,
  isOverridden,
  allocationFor,
  incomeFor,
} from "./allocation.ts";
import { foldBalances, figuresFor } from "./fold.ts";
import type { Dataset, FxRate, Post, Rule } from "./types.ts";

/** Digits for the currencies these tests use; all real-world 2dp. */
const TEST_CURRENCIES = [
  { code: "DKK", digits: 2, symbol: "kr" },
  { code: "USD", digits: 2, symbol: "$" },
  { code: "EUR", digits: 2, symbol: "\u20ac" },
];

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

const pct = (percent: number): Rule => ({ kind: "percentOfIncome", percent });
const fixed = (amount: number): Rule => ({
  kind: "fixed",
  amount: { amount, currency: "DKK" },
});

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    name: "Food",
    order: 0,
    archived: false,
    currency: "DKK",
    rules: [{ from: "2026-01", rule: fixed(400) }],
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 2 },
    currencies: TEST_CURRENCIES,
    fxRates: rates,
    posts: [post()],
    months: [
      { id: "2026-01", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases: [],
    ...overrides,
  };
}

describe("resolveRule", () => {
  test("a fixed rule in base currency is its amount", () => {
    expect(resolveRule(fixed(400), 20000, "DKK", rates, TEST_CURRENCIES)).toBe(400);
  });

  test("a fixed rule in a foreign currency converts to base", () => {
    expect(
      resolveRule({ kind: "fixed", amount: { amount: 50, currency: "EUR" } }, 20000, "DKK", rates, TEST_CURRENCIES),
    ).toBe(373);
  });

  test("a percentage rule resolves against income", () => {
    expect(resolveRule(pct(25), 20000, "DKK", rates, TEST_CURRENCIES)).toBe(5000);
  });

  test("a percentage above 100 is permitted", () => {
    expect(resolveRule(pct(150), 1000, "DKK", rates, TEST_CURRENCIES)).toBe(1500);
  });
});

describe("ruleAt", () => {
  const p = post({
    rules: [
      { from: "2026-04", rule: pct(10) },
      { from: "2026-07", rule: pct(15) },
    ],
  });

  test("returns null before the earliest version", () => {
    expect(ruleAt(p, "2026-03")).toBeNull();
  });

  test("applies from the version's own month", () => {
    expect(ruleAt(p, "2026-04")?.rule).toEqual(pct(10));
  });

  test("keeps applying between versions", () => {
    expect(ruleAt(p, "2026-06")?.rule).toEqual(pct(10));
  });

  test("the later version takes over from its month", () => {
    expect(ruleAt(p, "2026-07")?.rule).toEqual(pct(15));
  });

  test("the last version continues indefinitely", () => {
    expect(ruleAt(p, "2030-11")?.rule).toEqual(pct(15));
  });

  test("a post with no versions has no rule at all", () => {
    expect(ruleAt(post({ rules: [] }), "2026-06")).toBeNull();
  });

  test("resolves correctly even if the array is not sorted", () => {
    const unsorted = post({
      rules: [
        { from: "2026-07", rule: pct(15) },
        { from: "2026-04", rule: pct(10) },
      ],
    });
    expect(ruleAt(unsorted, "2026-05")?.rule).toEqual(pct(10));
    expect(ruleAt(unsorted, "2026-08")?.rule).toEqual(pct(15));
  });
});

describe("precedence", () => {
  test("a month override beats the effective version", () => {
    const data = dataset({
      posts: [post({ rules: [{ from: "2026-01", rule: fixed(400) }] })],
      months: [
        {
          id: "2026-01",
          income: { amount: 20000, currency: "DKK" },
          ruleOverrides: { p1: fixed(999) },
        },
      ],
    });
    expect(allocationFor(data, "p1", "2026-01")).toBe(999);
    expect(isOverridden(data.months[0], "p1")).toBe(true);
  });

  test("without an override the effective version applies", () => {
    expect(allocationFor(dataset(), "p1", "2026-01")).toBe(400);
  });

  test("no applicable version means an allocation of zero", () => {
    const data = dataset({ posts: [post({ rules: [{ from: "2026-06", rule: fixed(400) }] })] });
    expect(allocationFor(data, "p1", "2026-01")).toBe(0);
  });

  test("a post with no versions allocates zero rather than throwing", () => {
    expect(allocationFor(dataset({ posts: [post({ rules: [] })] }), "p1", "2026-01")).toBe(0);
  });

  test("an override still applies in a month with no version", () => {
    const data = dataset({
      posts: [post({ rules: [] })],
      months: [
        {
          id: "2026-01",
          income: { amount: 20000, currency: "DKK" },
          ruleOverrides: { p1: fixed(250) },
        },
      ],
    });
    expect(allocationFor(data, "p1", "2026-01")).toBe(250);
  });

  test("ruleForPost returns null when nothing applies", () => {
    expect(ruleForPost(undefined, post({ rules: [] }), "2026-01")).toBeNull();
  });

  test("an unknown post id throws", () => {
    expect(() => allocationFor(dataset(), "nope", "2026-01")).toThrow(/nope/);
  });
});

describe("incomeFor", () => {
  test("returns the month's income", () => {
    expect(incomeFor(dataset(), "2026-01")).toBe(20000);
  });

  test("a month with no record has zero income", () => {
    expect(incomeFor(dataset(), "2026-10")).toBe(0);
  });
});

describe("the fold across a rule change", () => {
  // The feature's headline behaviour: 10% through June, 15% from July, with the
  // rollover carrying correctly across the boundary.
  const data: Dataset = {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-05", schemaVersion: 2 },
    currencies: TEST_CURRENCIES,
    fxRates: [],
    posts: [
      post({
        rules: [
          { from: "2026-04", rule: pct(10) },
          { from: "2026-07", rule: pct(15) },
        ],
      }),
    ],
    months: ["2026-05", "2026-06", "2026-07", "2026-08"].map((id) => ({
      id,
      income: { amount: 10000, currency: "DKK" },
      ruleOverrides: {},
    })),
    purchases: [],
  };

  test("the allocation steps up in the version's month", () => {
    const fold = foldBalances(data, "2026-08");
    expect(figuresFor(fold, "p1", "2026-06").allocation).toBe(1000);
    expect(figuresFor(fold, "p1", "2026-07").allocation).toBe(1500);
  });

  test("unspent budget carries across the change", () => {
    const fold = foldBalances(data, "2026-08");
    // 1000 + 1000 = 2000 carried into July, + 1500 = 3500, + 1500 = 5000.
    expect(figuresFor(fold, "p1", "2026-07").carriedIn).toBe(2000);
    expect(figuresFor(fold, "p1", "2026-08").remaining).toBe(5000);
  });

  test("a version dated before the fold start is legal but inert", () => {
    // The fold never evaluates months before its start, so such a version
    // simply has no effect until the fold start moves earlier.
    const early: Dataset = {
      ...data,
      posts: [
        post({
          rules: [
            { from: "2020-01", rule: pct(99) },
            { from: "2026-04", rule: pct(10) },
          ],
        }),
      ],
    };
    const fold = foldBalances(early, "2026-06");
    expect(figuresFor(fold, "p1", "2026-05").allocation).toBe(1000);
    expect(fold.has("2020-01")).toBe(false);
  });

  test("an archived post still resolves its rules, because it still folds", () => {
    const archived: Dataset = {
      ...data,
      posts: [post({ archived: true, rules: [{ from: "2026-05", rule: pct(10) }] })],
    };
    const fold = foldBalances(archived, "2026-06");
    expect(figuresFor(fold, "p1", "2026-05").allocation).toBe(1000);
    expect(figuresFor(fold, "p1", "2026-06").carriedIn).toBe(1000);
  });

  test("months before the earliest version allocate nothing", () => {
    const early: Dataset = {
      ...data,
      settings: { ...data.settings, foldStartMonth: "2026-02" },
      months: [
        { id: "2026-02", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
        ...data.months,
      ],
    };
    const fold = foldBalances(early, "2026-05");
    expect(figuresFor(fold, "p1", "2026-02").allocation).toBe(0);
    expect(figuresFor(fold, "p1", "2026-05").allocation).toBe(1000);
  });
});
