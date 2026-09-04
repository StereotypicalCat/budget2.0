import { test, expect, describe } from "bun:test";
import { foldBalances, figuresFor, EMPTY_FIGURES } from "./fold.ts";
import { createSeedDataset } from "./seed.ts";
import type { Dataset, Post, Purchase } from "./types.ts";

/** Digits for the currencies these tests use; all real-world 2dp. */
const TEST_CURRENCIES = [
  { code: "DKK", symbol: "kr" },
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "\u20ac" },
];

/** The dataset\'s decimal places; every currency rounds to this. */
const DIGITS = 2;

function post(id: string, fixed: number, archived = false): Post {
  return {
    id,
    name: id,
    order: 0,
    archived,
    currency: "DKK",
    rules: [{ from: "2026-01", rule: { kind: "fixed", amount: { amount: fixed, currency: "DKK" } } }],
  };
}

function spend(id: string, postId: string, amount: number, date: string): Purchase {
  return {
    id,
    date,
    description: id,
    total: { amount, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    schedule: null,
  };
}

function dataset(posts: Post[], purchases: Purchase[]): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1, digits: DIGITS },
    currencies: TEST_CURRENCIES,
    fxRates: [],
    posts,
    months: [
      { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-02", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-03", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases,
    recurring: [],
  };
}

describe("envelope rollover", () => {
  test("the first month carries in zero", () => {
    const fold = foldBalances(dataset([post("food", 500)], []), "2026-01");
    expect(figuresFor(fold, "food", "2026-01")).toEqual({
      carriedIn: 0,
      allocation: 500,
      charges: 0,
      remaining: 500,
      expected: 0,
      projectedCarriedIn: 0,
      projected: 500,
    });
  });

  test("unspent allocation carries into the next month", () => {
    const data = dataset([post("food", 500)], [spend("a", "food", 300, "2026-01-05")]);
    const fold = foldBalances(data, "2026-02");
    expect(figuresFor(fold, "food", "2026-01").remaining).toBe(200);
    expect(figuresFor(fold, "food", "2026-02")).toEqual({
      carriedIn: 200,
      allocation: 500,
      charges: 0,
      remaining: 700,
      expected: 0,
      projectedCarriedIn: 200,
      projected: 700,
    });
  });

  test("overspend carries forward as debt", () => {
    const data = dataset([post("food", 500)], [spend("a", "food", 700, "2026-01-05")]);
    const fold = foldBalances(data, "2026-02");
    expect(figuresFor(fold, "food", "2026-01").remaining).toBe(-200);
    expect(figuresFor(fold, "food", "2026-02").carriedIn).toBe(-200);
    expect(figuresFor(fold, "food", "2026-02").remaining).toBe(300);
  });

  test("the chain accumulates across three months", () => {
    const data = dataset(
      [post("food", 500)],
      [spend("a", "food", 100, "2026-01-05"), spend("b", "food", 900, "2026-02-05")],
    );
    const fold = foldBalances(data, "2026-03");
    expect(figuresFor(fold, "food", "2026-01").remaining).toBe(400);
    expect(figuresFor(fold, "food", "2026-02").remaining).toBe(0);
    expect(figuresFor(fold, "food", "2026-03").remaining).toBe(500);
  });

  test("editing an early purchase changes every later month", () => {
    const before = foldBalances(
      dataset([post("food", 500)], [spend("a", "food", 100, "2026-01-05")]),
      "2026-03",
    );
    const after = foldBalances(
      dataset([post("food", 500)], [spend("a", "food", 200, "2026-01-05")]),
      "2026-03",
    );
    expect(figuresFor(before, "food", "2026-03").remaining).toBe(1400);
    expect(figuresFor(after, "food", "2026-03").remaining).toBe(1300);
  });
});

test("archived posts are still folded", () => {
  const data = dataset(
    [post("food", 500), post("old", 100, true)],
    [spend("a", "old", 40, "2026-01-05")],
  );
  const fold = foldBalances(data, "2026-02");
  expect(figuresFor(fold, "old", "2026-02").carriedIn).toBe(60);
});

test("percentage allocations follow the month's income", () => {
  const data: Dataset = {
    ...dataset([], []),
    posts: [
      {
        id: "food",
        name: "Food",
        order: 0,
        archived: false,
        currency: "DKK",
        rules: [{ from: "2026-01", rule: { kind: "percentOfIncome", percent: 10 } }],
      },
    ],
    months: [
      { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-02", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} },
    ],
  };
  const fold = foldBalances(data, "2026-02");
  expect(figuresFor(fold, "food", "2026-01").allocation).toBe(1000);
  expect(figuresFor(fold, "food", "2026-02").allocation).toBe(2000);
  expect(figuresFor(fold, "food", "2026-02").remaining).toBe(3000);
});

test("months before foldStartMonth contribute nothing", () => {
  const data: Dataset = {
    ...dataset([post("food", 500)], [spend("a", "food", 5000, "2025-06-01")]),
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1, digits: DIGITS },
  };
  const fold = foldBalances(data, "2026-01");
  expect(fold.has("2025-06")).toBe(false);
  expect(figuresFor(fold, "food", "2026-01").carriedIn).toBe(0);
});

test("figuresFor returns zeroes for a month outside the fold", () => {
  const fold = foldBalances(dataset([post("food", 500)], []), "2026-01");
  expect(figuresFor(fold, "food", "2030-01")).toEqual({
    carriedIn: 0,
    allocation: 0,
    charges: 0,
    remaining: 0,
    expected: 0,
    projectedCarriedIn: 0,
    projected: 0,
  });
});

describe("the empty-figures fallback", () => {
  // figuresFor returns EMPTY_FIGURES by SHARED REFERENCE for any (post, month)
  // the fold has no entry for. One consumer mutating that object would move
  // every other unknown row with it — in a budgeting app, silently.
  test("cannot be mutated through the value figuresFor hands back", () => {
    const fold = foldBalances(dataset([post("food", 500)], []), "2026-01");
    const missing = figuresFor(fold, "no-such-post", "2026-01");

    expect(() => {
      (missing as { allocation: number }).allocation = 999;
    }).toThrow(TypeError);

    expect(figuresFor(fold, "another-missing-post", "2026-01").allocation).toBe(0);
  });
});

function datasetWithRent(): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 7, digits: 2 },
    currencies: [{ code: "DKK", symbol: "kr", name: "Danish krone" }],
    fxRates: [],
    posts: [
      {
        id: "housing",
        name: "Housing",
        order: 0,
        archived: false,
        currency: "DKK",
        rules: [{ from: "2026-01", rule: { kind: "fixed", amount: { amount: 10000, currency: "DKK" } } }],
      },
    ],
    months: [],
    purchases: [],
    recurring: [
      {
        id: "rent",
        name: "Rent",
        order: 0,
        archived: false,
        amount: { amount: 8000, currency: "DKK" },
        startDate: "2026-01",
        recurrence: { kind: "everyNMonths", n: 1 },
        anchoring: "calendar",
        splitMode: "percent",
        splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      },
    ],
  };
}

describe("the projected track", () => {
  test("with no recurring costs, projected shadows remaining exactly", () => {
    // The behaviour-preservation guard. Every existing dataset must fold to
    // figures it already folded to, with the new track adding nothing.
    const data = createSeedDataset("2026-01");
    data.months.push({ id: "2026-01", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} });
    const fold = foldBalances(data, "2026-06");

    for (const post of data.posts) {
      for (const month of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]) {
        const figures = figuresFor(fold, post.id, month);
        expect(figures.expected).toBe(0);
        expect(figures.projectedCarriedIn).toBe(figures.carriedIn);
        expect(figures.projected).toBe(figures.remaining);
      }
    }
  });

  test("an unconfirmed occurrence lowers projected and leaves remaining alone", () => {
    const data = datasetWithRent();
    const figures = figuresFor(foldBalances(data, "2026-01"), "housing", "2026-01");

    expect(figures.charges).toBe(0);
    expect(figures.expected).toBe(8000);
    expect(figures.remaining).toBe(10000);
    expect(figures.projected).toBe(2000);
  });

  test("the projected shortfall carries forward on its own track", () => {
    const data = datasetWithRent();
    const fold = foldBalances(data, "2026-02");
    const february = figuresFor(fold, "housing", "2026-02");

    expect(february.carriedIn).toBe(10000);
    expect(february.projectedCarriedIn).toBe(2000);
    expect(february.remaining).toBe(20000);
    // 2000 carried on the projected track + 10000 allocated - 8000 expected.
    expect(february.projected).toBe(4000);
  });

  test("confirming every occurrence reconverges the two tracks", () => {
    const data = datasetWithRent();
    data.purchases.push({
      id: "p1",
      date: "2026-01",
      description: "Rent",
      total: { amount: 8000, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null,
      source: { recurringId: "rent", occurrenceDate: "2026-01" },
    });

    const figures = figuresFor(foldBalances(data, "2026-01"), "housing", "2026-01");
    expect(figures.charges).toBe(8000);
    expect(figures.expected).toBe(0);
    expect(figures.projected).toBe(figures.remaining);
  });

  test("EMPTY_FIGURES carries the new fields", () => {
    expect(EMPTY_FIGURES.expected).toBe(0);
    expect(EMPTY_FIGURES.projected).toBe(0);
    expect(EMPTY_FIGURES.projectedCarriedIn).toBe(0);
  });
});
