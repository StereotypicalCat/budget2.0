import { test, expect, describe } from "bun:test";
import {
  resolveRule,
  ruleForPost,
  isOverridden,
  allocationFor,
  incomeFor,
} from "./allocation.ts";
import type { Dataset, FxRate, Post } from "./types.ts";

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    name: "Food",
    order: 0,
    archived: false,
    currency: "DKK",
    standingRule: { kind: "fixed", amount: { amount: 400, currency: "DKK" } },
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
    fxRates: rates,
    posts: [post()],
    months: [
      { id: "2026-09", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases: [],
    ...overrides,
  };
}

describe("resolveRule", () => {
  test("a fixed rule in base currency is its amount", () => {
    expect(
      resolveRule({ kind: "fixed", amount: { amount: 400, currency: "DKK" } }, 20000, "DKK", rates),
    ).toBe(400);
  });

  test("a fixed rule in a foreign currency converts to base", () => {
    expect(
      resolveRule({ kind: "fixed", amount: { amount: 50, currency: "EUR" } }, 20000, "DKK", rates),
    ).toBe(373);
  });

  test("a percentage rule resolves against income", () => {
    expect(resolveRule({ kind: "percentOfIncome", percent: 25 }, 20000, "DKK", rates)).toBe(5000);
  });

  test("a percentage rule rounds", () => {
    expect(resolveRule({ kind: "percentOfIncome", percent: 33 }, 1000.5, "DKK", rates)).toBe(330.17);
  });

  test("a percentage above 100 is permitted", () => {
    expect(resolveRule({ kind: "percentOfIncome", percent: 150 }, 1000, "DKK", rates)).toBe(1500);
  });
});

describe("override precedence", () => {
  test("a month override wins over the standing rule", () => {
    const data = dataset({
      months: [
        {
          id: "2026-09",
          income: { amount: 20000, currency: "DKK" },
          ruleOverrides: { p1: { kind: "fixed", amount: { amount: 999, currency: "DKK" } } },
        },
      ],
    });
    expect(allocationFor(data, "p1", "2026-09")).toBe(999);
    expect(isOverridden(data.months[0], "p1")).toBe(true);
  });

  test("without an override the standing rule applies", () => {
    const data = dataset();
    expect(allocationFor(data, "p1", "2026-09")).toBe(400);
    expect(isOverridden(data.months[0], "p1")).toBe(false);
  });

  test("ruleForPost falls back to the standing rule when the month is unknown", () => {
    expect(ruleForPost(undefined, post())).toEqual({
      kind: "fixed",
      amount: { amount: 400, currency: "DKK" },
    });
  });
});

describe("incomeFor", () => {
  test("returns the month's income", () => {
    expect(incomeFor(dataset(), "2026-09")).toBe(20000);
  });

  test("a month with no record has zero income", () => {
    expect(incomeFor(dataset(), "2026-10")).toBe(0);
  });
});

test("a percentage allocation in a month with no record is zero", () => {
  const data = dataset({
    posts: [post({ standingRule: { kind: "percentOfIncome", percent: 25 } })],
  });
  expect(allocationFor(data, "p1", "2026-10")).toBe(0);
});

test("an unknown post id throws", () => {
  expect(() => allocationFor(dataset(), "nope", "2026-09")).toThrow(/nope/);
});
