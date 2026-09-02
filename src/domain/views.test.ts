import { test, expect, describe } from "bun:test";
import { monthView, yearView, summaryView, datasetMonthSpan } from "./views.ts";
import type { Dataset, Post, Purchase } from "./types.ts";

function post(id: string, order: number, percent: number, archived = false): Post {
  return {
    id,
    name: id,
    order,
    archived,
    currency: "DKK",
    rules: [{ from: "2026-01", rule: { kind: "percentOfIncome", percent } }],
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

const data: Dataset = {
  settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
  fxRates: [],
  posts: [post("food", 0, 20), post("games", 1, 10)],
  months: [
    { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
    {
      id: "2026-02",
      income: { amount: 10000, currency: "DKK" },
      ruleOverrides: { games: { kind: "fixed", amount: { amount: 2000, currency: "DKK" } } },
    },
  ],
  purchases: [spend("a", "food", 500, "2026-01-10"), spend("b", "games", 300, "2026-02-10")],
};

describe("monthView", () => {
  test("reports income, allocations, and the unallocated remainder", () => {
    const view = monthView(data, "2026-01");
    expect(view.income).toBe(10000);
    expect(view.totalAllocation).toBe(3000);
    expect(view.totalCharges).toBe(500);
    expect(view.unallocated).toBe(7000);
  });

  test("rows are ordered by post order and carry their figures", () => {
    const view = monthView(data, "2026-01");
    expect(view.rows.map((r) => r.post.id)).toEqual(["food", "games"]);
    expect(view.rows[0]!.figures.charges).toBe(500);
    expect(view.rows[0]!.figures.remaining).toBe(1500);
  });

  test("flags rows whose rule is overridden this month", () => {
    const view = monthView(data, "2026-02");
    expect(view.rows.find((r) => r.post.id === "games")!.overridden).toBe(true);
    expect(view.rows.find((r) => r.post.id === "food")!.overridden).toBe(false);
  });

  test("unallocated goes negative when percentages exceed income", () => {
    const greedy: Dataset = { ...data, posts: [post("food", 0, 80), post("games", 1, 40)] };
    expect(monthView(greedy, "2026-01").unallocated).toBe(-2000);
  });

  test("archived posts appear only when they have activity", () => {
    const withArchived: Dataset = {
      ...data,
      posts: [...data.posts, post("old", 2, 0, true)],
    };
    expect(monthView(withArchived, "2026-01").rows.map((r) => r.post.id)).toEqual([
      "food",
      "games",
    ]);

    const withActivity: Dataset = {
      ...withArchived,
      purchases: [...data.purchases, spend("c", "old", 50, "2026-01-11")],
    };
    expect(monthView(withActivity, "2026-01").rows.map((r) => r.post.id)).toEqual([
      "food",
      "games",
      "old",
    ]);
  });
});

describe("yearView", () => {
  test("returns twelve months with per-post totals and a closing balance", () => {
    const view = yearView(data, 2026);
    expect(view.months).toHaveLength(12);
    expect(view.incomeByMonth[0]).toBe(10000);
    expect(view.incomeByMonth[2]).toBe(0);
    expect(view.totalIncome).toBe(20000);

    const food = view.rows.find((r) => r.post.id === "food")!;
    expect(food.byMonth).toHaveLength(12);
    expect(food.totalCharges).toBe(500);
    expect(food.totalAllocation).toBe(4000);
    expect(food.closingBalance).toBe(3500);
  });

  test("the closing balance is December's remaining, carrying all year", () => {
    const games = yearView(data, 2026).rows.find((r) => r.post.id === "games")!;
    expect(games.totalAllocation).toBe(3000);
    expect(games.closingBalance).toBe(2700);
  });
});

describe("summaryView", () => {
  test("totals charges by post and by month across a range", () => {
    const view = summaryView(data, "2026-01", "2026-02");
    expect(view.totalCharges).toBe(800);
    expect(view.totalIncome).toBe(20000);
    expect(view.byPost.find((r) => r.post.id === "food")!.charges).toBe(500);
    expect(view.byMonth).toHaveLength(2);
    expect(view.byMonth[1]!.charges).toBe(300);
  });

  test("an empty range totals zero", () => {
    const view = summaryView(data, "2026-05", "2026-04");
    expect(view.totalCharges).toBe(0);
    expect(view.byMonth).toHaveLength(0);
  });
});

test("datasetMonthSpan covers foldStartMonth through the latest activity", () => {
  expect(datasetMonthSpan(data)).toEqual({ from: "2026-01", to: "2026-02" });
});

test("datasetMonthSpan includes future finance-plan slices", () => {
  const financed: Dataset = {
    ...data,
    purchases: [
      {
        id: "f1",
        date: "2026-01-05",
        description: "Console",
        total: { amount: 3000, currency: "DKK" },
        splitMode: "percent",
        splits: [{ postId: "games", value: 100, absorbsRemainder: true }],
        schedule: {
          slices: [
            { month: "2026-01", amount: { amount: 1500, currency: "DKK" } },
            { month: "2026-06", amount: { amount: 1500, currency: "DKK" } },
          ],
        },
      },
    ],
  };
  expect(datasetMonthSpan(financed)).toEqual({ from: "2026-01", to: "2026-06" });
});

test("datasetMonthSpan of an empty dataset is a single month", () => {
  const bare: Dataset = { ...data, months: [], purchases: [] };
  expect(datasetMonthSpan(bare)).toEqual({ from: "2026-01", to: "2026-01" });
});
