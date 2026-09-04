import { test, expect, describe } from "bun:test";
import {
  splitPartsOfTotal,
  sliceAmountForMonth,
  chargesForPurchaseInMonth,
  chargesForMonth,
  expectedForMonth,
} from "./charges.ts";
import { roundMoney } from "./money.ts";
import { occurrencesByMonth } from "./occurrences.ts";
import type { Dataset, FxRate, Purchase, RecurringCost } from "./types.ts";

/** Digits for the currencies these tests use; all real-world 2dp. */
const TEST_CURRENCIES = [
  { code: "DKK", symbol: "kr" },
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "\u20ac" },
];

/** The dataset\'s decimal places; every currency rounds to this. */
const DIGITS = 2;

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "x1",
    date: "2026-09-14",
    description: "Groceries",
    total: { amount: 200, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId: "food", value: 100, absorbsRemainder: true }],
    schedule: null,
    ...overrides,
  };
}

describe("splitPartsOfTotal", () => {
  test("a single split takes the whole total", () => {
    expect(splitPartsOfTotal(purchase(), 2)).toEqual([200]);
  });

  test("percent mode divides proportionally", () => {
    const parts = splitPartsOfTotal(
      purchase({
        splits: [
          { postId: "food", value: 60, absorbsRemainder: true },
          { postId: "events", value: 40, absorbsRemainder: false },
        ],
      }),
          2,
);
    expect(parts).toEqual([120, 80]);
  });

  test("fixed mode uses the given amounts, remainder absorbing the shortfall", () => {
    const parts = splitPartsOfTotal(
      purchase({
        splitMode: "fixed",
        splits: [
          { postId: "food", value: 120, absorbsRemainder: false },
          { postId: "events", value: 50, absorbsRemainder: true },
        ],
      }),
          2,
);
    expect(parts).toEqual([120, 80]);
  });

  test("three-way percent splits sum exactly to the total", () => {
    const parts = splitPartsOfTotal(
      purchase({
        total: { amount: 100, currency: "DKK" },
        splits: [
          { postId: "a", value: 33.33, absorbsRemainder: false },
          { postId: "b", value: 33.33, absorbsRemainder: false },
          { postId: "c", value: 33.34, absorbsRemainder: true },
        ],
      }),
          2,
);
    expect(roundMoney(parts.reduce((a, b) => a + b, 0), 2)).toBe(100);
  });
});

describe("sliceAmountForMonth", () => {
  test("an unscheduled purchase charges its whole total in the month of its date", () => {
    expect(sliceAmountForMonth(purchase(), "2026-09")).toEqual({
      amount: 200,
      currency: "DKK",
    });
  });

  test("an unscheduled purchase charges nothing in other months", () => {
    expect(sliceAmountForMonth(purchase(), "2026-10")).toBeNull();
  });

  test("a scheduled purchase charges only its slice for that month", () => {
    const financed = purchase({
      total: { amount: 3000, currency: "DKK" },
      schedule: {
        slices: [
          { month: "2026-10", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-11", amount: { amount: 500, currency: "DKK" } },
          { month: "2026-12", amount: { amount: 1500, currency: "DKK" } },
        ],
      },
    });
    expect(sliceAmountForMonth(financed, "2026-11")).toEqual({
      amount: 500,
      currency: "DKK",
    });
    expect(sliceAmountForMonth(financed, "2026-09")).toBeNull();
  });

  test("cancellation drops the cancelled month and every later one", () => {
    const cancelled = purchase({
      total: { amount: 3000, currency: "DKK" },
      schedule: {
        slices: [
          { month: "2026-10", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-11", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-12", amount: { amount: 1000, currency: "DKK" } },
        ],
        cancelledFromMonth: "2026-11",
      },
    });
    expect(sliceAmountForMonth(cancelled, "2026-10")).not.toBeNull();
    expect(sliceAmountForMonth(cancelled, "2026-11")).toBeNull();
    expect(sliceAmountForMonth(cancelled, "2026-12")).toBeNull();
  });
});

describe("chargesForPurchaseInMonth", () => {
  test("a simple purchase charges one post", () => {
    expect(chargesForPurchaseInMonth(purchase(), "2026-09", "DKK", rates, DIGITS)).toEqual([
      { postId: "food", amount: 200 },
    ]);
  });

  test("converts a foreign-currency purchase into base", () => {
    const eur = purchase({ total: { amount: 10, currency: "EUR" } });
    expect(chargesForPurchaseInMonth(eur, "2026-09", "DKK", rates, DIGITS)).toEqual([
      { postId: "food", amount: 74.6 },
    ]);
  });

  test("a financed split purchase divides each slice by the split ratio", () => {
    const financedSplit = purchase({
      total: { amount: 3000, currency: "DKK" },
      splits: [
        { postId: "games", value: 70, absorbsRemainder: true },
        { postId: "events", value: 30, absorbsRemainder: false },
      ],
      schedule: {
        slices: [
          { month: "2026-10", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-11", amount: { amount: 2000, currency: "DKK" } },
        ],
      },
    });
    expect(chargesForPurchaseInMonth(financedSplit, "2026-10", "DKK", rates, DIGITS)).toEqual([
      { postId: "games", amount: 700 },
      { postId: "events", amount: 300 },
    ]);
    expect(chargesForPurchaseInMonth(financedSplit, "2026-11", "DKK", rates, DIGITS)).toEqual([
      { postId: "games", amount: 1400 },
      { postId: "events", amount: 600 },
    ]);
  });

  test("a financed fixed-mode split scales the fixed amounts down per slice", () => {
    const financed = purchase({
      total: { amount: 3000, currency: "DKK" },
      splitMode: "fixed",
      splits: [
        { postId: "games", value: 2000, absorbsRemainder: true },
        { postId: "events", value: 1000, absorbsRemainder: false },
      ],
      schedule: {
        slices: [{ month: "2026-10", amount: { amount: 600, currency: "DKK" } }],
      },
    });
    expect(chargesForPurchaseInMonth(financed, "2026-10", "DKK", rates, DIGITS)).toEqual([
      { postId: "games", amount: 400 },
      { postId: "events", amount: 200 },
    ]);
  });

  test("charges in a month the purchase does not touch are empty", () => {
    expect(chargesForPurchaseInMonth(purchase(), "2026-01", "DKK", rates, DIGITS)).toEqual([]);
  });

  test("slice charges always sum to the slice total", () => {
    const odd = purchase({
      total: { amount: 100, currency: "DKK" },
      splits: [
        { postId: "a", value: 1, absorbsRemainder: false },
        { postId: "b", value: 1, absorbsRemainder: false },
        { postId: "c", value: 1, absorbsRemainder: true },
      ],
    });
    const charges = chargesForPurchaseInMonth(odd, "2026-09", "DKK", rates, DIGITS);
    expect(roundMoney(charges.reduce((sum, c) => sum + c.amount, 0), 2)).toBe(100);
  });
});

describe("chargesForMonth", () => {
  test("sums charges per post across all purchases", () => {
    const data: Dataset = {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1, digits: DIGITS },
      currencies: TEST_CURRENCIES,
      fxRates: rates,
      posts: [],
      months: [],
      purchases: [
        purchase({ id: "a" }),
        purchase({ id: "b", total: { amount: 50, currency: "DKK" } }),
        purchase({ id: "c", date: "2026-10-01" }),
      ],
      recurring: [],
    };
    const charges = chargesForMonth(data, "2026-09");
    expect(charges.get("food")).toBe(250);
    expect(charges.size).toBe(1);
  });

  test("a month with no purchases yields an empty map", () => {
    const data: Dataset = {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1, digits: DIGITS },
      currencies: TEST_CURRENCIES,
      fxRates: rates,
      posts: [],
      months: [],
      purchases: [],
      recurring: [],
    };
    expect(chargesForMonth(data, "2026-09").size).toBe(0);
  });
});

describe("expectedForMonth", () => {
  function dataset(cost: RecurringCost, purchases: Purchase[] = []): Dataset {
    return {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 7, digits: 2 },
      currencies: [
        { code: "DKK", symbol: "kr", name: "Danish krone" },
        { code: "USD", symbol: "$", name: "US dollar" },
      ],
      fxRates: [{ currency: "USD", baseUnitsPerOne: 7, updatedAt: "2026-01-01", source: "manual" }],
      posts: [],
      months: [],
      purchases,
      recurring: [cost],
    };
  }

  const rent: RecurringCost = {
    id: "r1",
    name: "Rent",
    order: 0,
    archived: false,
    amount: { amount: 8000, currency: "DKK" },
    startDate: "2026-01",
    recurrence: { kind: "everyNMonths", n: 1 },
    anchoring: "calendar",
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
  };

  test("an unconfirmed occurrence charges its post", () => {
    const data = dataset(rent);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    expect(expected.get("housing")).toBe(8000);
  });

  test("a CONFIRMED occurrence contributes nothing — it is a real purchase now", () => {
    const confirmed: Purchase = {
      id: "p1",
      date: "2026-01",
      description: "Rent",
      total: { amount: 8000, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null,
      source: { recurringId: "r1", occurrenceDate: "2026-01" },
    };
    const data = dataset(rent, [confirmed]);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    expect(expected.get("housing")).toBeUndefined();
  });

  test("a split cost divides exactly, with the remainder absorbed", () => {
    const split = {
      ...rent,
      amount: { amount: 1000, currency: "DKK" },
      splits: [
        { postId: "a", value: 33.333, absorbsRemainder: false },
        { postId: "b", value: 33.333, absorbsRemainder: false },
        { postId: "c", value: 33.334, absorbsRemainder: true },
      ],
    };
    const data = dataset(split);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    const total = ["a", "b", "c"].reduce((sum, id) => sum + expected.get(id)!, 0);
    expect(total).toBe(1000);
  });

  test("a foreign-currency cost converts to base", () => {
    const inUsd = { ...rent, amount: { amount: 15, currency: "USD" } };
    const data = dataset(inUsd);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    expect(expected.get("housing")).toBe(105);
  });

  test("two occurrences in one month sum", () => {
    const fortnightly = {
      ...rent,
      amount: { amount: 100, currency: "DKK" },
      startDate: "2026-01-05",
      recurrence: { kind: "everyNDays" as const, n: 14 },
    };
    const data = dataset(fortnightly);
    const january = occurrencesByMonth(data, "2026-01").get("2026-01")!;
    expect(january.length).toBe(2);
    expect(expectedForMonth(data, january).get("housing")).toBe(200);
  });

  test("no occurrences means an empty map, not zeros", () => {
    expect(expectedForMonth(dataset(rent), []).size).toBe(0);
  });
});
