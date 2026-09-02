import { test, expect, describe } from "bun:test";
import { foldBalances, figuresFor } from "./fold.ts";
import type { Dataset, Post, Purchase } from "./types.ts";

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
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
    fxRates: [],
    posts,
    months: [
      { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-02", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-03", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases,
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
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
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
  });
});
