import { test, expect, describe } from "bun:test";
import * as actions from "./actions.ts";
import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset } from "../domain/types.ts";

/**
 * Decimal places are one dataset-wide setting, so a different minor unit is
 * expressed by moving `settings.digits` — no monkey-patching a module
 * constant, which is what this file used to need, and no per-currency entry
 * either, which is what it needed before that.
 */
function withDigits(digits: number, body: () => void) {
  const original = overriddenDigits;
  overriddenDigits = digits;
  try {
    body();
  } finally {
    overriddenDigits = original;
  }
}
let overriddenDigits: number | null = null;

function draft(): Dataset {
  const data = createSeedDataset("2026-09");
  if (overriddenDigits !== null) data.settings.digits = overriddenDigits;
  return data;
}

describe("months", () => {
  test("ensureMonth creates a missing month with zero income", () => {
    const data = draft();
    const month = actions.ensureMonth(data, "2026-10");
    expect(month.income.amount).toBe(0);
    expect(data.months.map((m) => m.id)).toEqual(["2026-09", "2026-10"]);
  });

  test("ensureMonth returns the existing month rather than duplicating it", () => {
    const data = draft();
    actions.ensureMonth(data, "2026-09");
    expect(data.months).toHaveLength(1);
  });

  test("setIncome creates the month if needed", () => {
    const data = draft();
    actions.setIncome(data, "2026-11", { amount: 25000, currency: "DKK" });
    expect(data.months.find((m) => m.id === "2026-11")!.income.amount).toBe(25000);
  });

  test("setIncome rounds the amount to the dataset's decimal places", () => {
    const data = draft();
    actions.setIncome(data, "2026-11", { amount: 25000.005, currency: "DKK" });
    expect(data.months.find((m) => m.id === "2026-11")!.income.amount).toBe(25000.01);
    actions.setIncome(data, "2026-12", { amount: 12.345, currency: "DKK" });
    expect(data.months.find((m) => m.id === "2026-12")!.income.amount).toBe(12.35);
  });

  test("setRuleOverride sets and clears an override", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleOverride(data, "2026-09", postId, {
      kind: "percentOfIncome",
      percent: 15,
    });
    expect(data.months[0]!.ruleOverrides[postId]).toEqual({
      kind: "percentOfIncome",
      percent: 15,
    });

    actions.setRuleOverride(data, "2026-09", postId, null);
    expect(data.months[0]!.ruleOverrides[postId]).toBeUndefined();
  });

  test("setRuleOverride rounds a fixed rule's amount and a percent rule's percent", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleOverride(data, "2026-09", postId, {
      kind: "fixed",
      amount: { amount: 12.345, currency: "DKK" },
    });
    expect(data.months[0]!.ruleOverrides[postId]).toEqual({
      kind: "fixed",
      amount: { amount: 12.35, currency: "DKK" },
    });

    actions.setRuleOverride(data, "2026-09", postId, {
      kind: "percentOfIncome",
      percent: 12.3456,
    });
    expect(data.months[0]!.ruleOverrides[postId]).toEqual({
      kind: "percentOfIncome",
      percent: 12.35,
    });
  });
});

describe("posts", () => {
  test("addPost appends with the next order value", () => {
    const data = draft();
    const post = actions.addPost(data, "Travel", "EUR");
    expect(post.order).toBe(3);
    expect(post.archived).toBe(false);
    expect(data.posts).toHaveLength(4);
  });

  test("addPost starts the post unbudgeted", () => {
    const data = draft();
    const post = actions.addPost(data, "Travel", "EUR");
    expect(post.rules).toEqual([]);
  });

  test("setPostArchived toggles without deleting", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setPostArchived(data, postId, true);
    expect(data.posts.find((p) => p.id === postId)!.archived).toBe(true);
    expect(data.posts).toHaveLength(3);
  });

  test("movePost swaps order with its neighbour", () => {
    const data = draft();
    actions.movePost(data, data.posts[1]!.id, -1);
    expect([...data.posts].sort((a, b) => a.order - b.order).map((p) => p.name)).toEqual([
      "Food",
      "Video Games",
      "Events and Social",
    ]);
  });

  test("movePost at the boundary is a no-op", () => {
    const data = draft();
    actions.movePost(data, data.posts[0]!.id, -1);
    expect(data.posts[0]!.order).toBe(0);
  });

  test("updatePost renames without touching other fields", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.updatePost(data, postId, { name: "Games" });
    const post = data.posts.find((p) => p.id === postId)!;
    expect(post.name).toBe("Games");
    expect(post.currency).toBe("DKK");
  });

  test("an unknown post id throws", () => {
    expect(() => actions.updatePost(draft(), "ghost", { name: "x" })).toThrow(/ghost/);
  });
});

describe("purchases", () => {
  const newPurchase = (postId: string) => ({
    date: "2026-09-14",
    description: "Groceries",
    total: { amount: 200, currency: "DKK" as const },
    splitMode: "percent" as const,
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    schedule: null,
  });

  test("addPurchase assigns an id and ensures the month exists", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, {
      ...newPurchase(data.posts[0]!.id),
      date: "2026-12-01",
    });
    expect(purchase.id).toBeTruthy();
    expect(data.months.map((m) => m.id)).toContain("2026-12");
  });

  test("addPurchase rounds the total amount, split values, and schedule slice amounts", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    const purchase = actions.addPurchase(data, {
      date: "2026-09-14",
      description: "Sofa",
      total: { amount: 199.995, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId, value: 33.3333, absorbsRemainder: true }],
      schedule: {
        slices: [
          { month: "2026-09", amount: { amount: 66.665, currency: "DKK" } },
          { month: "2026-10", amount: { amount: 66.665, currency: "DKK" } },
          { month: "2026-11", amount: { amount: 66.665, currency: "DKK" } },
        ],
      },
    });
    expect(purchase.total.amount).toBe(200);
    expect(purchase.splits[0]!.value).toBe(33.33);
    expect(purchase.schedule!.slices.map((s) => s.amount.amount)).toEqual([
      66.67, 66.67, 66.67,
    ]);
  });

  test("updatePurchase replaces the given fields", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, newPurchase(data.posts[0]!.id));
    actions.updatePurchase(data, purchase.id, { description: "Dinner" });
    expect(data.purchases[0]!.description).toBe("Dinner");
  });

  test("updatePurchase rounds the total amount, split values, and schedule slice amounts", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    const purchase = actions.addPurchase(data, newPurchase(postId));
    actions.updatePurchase(data, purchase.id, {
      total: { amount: 199.995, currency: "DKK" },
      splits: [{ postId, value: 33.3333, absorbsRemainder: true }],
      schedule: {
        slices: [
          { month: "2026-09", amount: { amount: 66.665, currency: "DKK" } },
        ],
      },
    });
    const updated = data.purchases.find((p) => p.id === purchase.id)!;
    expect(updated.total.amount).toBe(200);
    expect(updated.splits[0]!.value).toBe(33.33);
    expect(updated.schedule!.slices[0]!.amount.amount).toBe(66.67);
  });

  test("deletePurchase removes it", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, newPurchase(data.posts[0]!.id));
    actions.deletePurchase(data, purchase.id);
    expect(data.purchases).toHaveLength(0);
  });

  test("cancelScheduleFrom records the cancellation month", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, {
      ...newPurchase(data.posts[0]!.id),
      schedule: {
        slices: [
          { month: "2026-09", amount: { amount: 100, currency: "DKK" } },
          { month: "2026-10", amount: { amount: 100, currency: "DKK" } },
        ],
      },
    });
    actions.cancelScheduleFrom(data, purchase.id, "2026-10");
    expect(data.purchases[0]!.schedule!.cancelledFromMonth).toBe("2026-10");
  });

  test("cancelling an unscheduled purchase throws", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, newPurchase(data.posts[0]!.id));
    expect(() => actions.cancelScheduleFrom(data, purchase.id, "2026-10")).toThrow(
      /no finance plan/i,
    );
  });
});

describe("settings", () => {
  test("setFxRate inserts then updates in place", () => {
    const data = draft();
    actions.setFxRate(data, {
      currency: "EUR",
      baseUnitsPerOne: 7.46,
      updatedAt: "2026-09-01",
      source: "manual",
    });
    expect(data.fxRates).toHaveLength(1);

    actions.setFxRate(data, {
      currency: "EUR",
      baseUnitsPerOne: 7.5,
      updatedAt: "2026-09-02",
      source: "api",
    });
    expect(data.fxRates).toHaveLength(1);
    expect(data.fxRates[0]!.baseUnitsPerOne).toBe(7.5);
  });

  test("setFxRate preserves a 6-decimal rate unrounded", () => {
    const data = draft();
    actions.setFxRate(data, {
      currency: "USD",
      baseUnitsPerOne: 7.123456,
      updatedAt: "2026-09-01",
      source: "api",
    });
    expect(data.fxRates.find((r) => r.currency === "USD")!.baseUnitsPerOne).toBe(
      7.123456,
    );
  });

  test("setBaseCurrency drops the new base's own rate row", () => {
    const data = draft();
    actions.setFxRate(data, {
      currency: "EUR",
      baseUnitsPerOne: 7.46,
      updatedAt: "2026-09-01",
      source: "manual",
    });
    actions.setBaseCurrency(data, "EUR");
    expect(data.settings.baseCurrency).toBe("EUR");
    expect(data.fxRates.find((r) => r.currency === "EUR")).toBeUndefined();
  });

  test("removeFxRate filters the currency out entirely, leaving no row", () => {
    const data = draft();
    actions.setFxRate(data, {
      currency: "EUR",
      baseUnitsPerOne: 7.46,
      updatedAt: "2026-09-01",
      source: "manual",
    });
    actions.setFxRate(data, {
      currency: "USD",
      baseUnitsPerOne: 6.9,
      updatedAt: "2026-09-01",
      source: "manual",
    });

    actions.removeFxRate(data, "EUR");

    expect(data.fxRates.map((r) => r.currency)).toEqual(["USD"]);
    expect(data.fxRates.find((r) => r.currency === "EUR")).toBeUndefined();
  });

  test("removeFxRate on a currency with no row is a no-op", () => {
    const data = draft();
    actions.removeFxRate(data, "EUR");
    expect(data.fxRates).toEqual([]);
  });
});

describe("rule versions", () => {
  const pct = (percent: number) => ({ kind: "percentOfIncome" as const, percent });

  test("setRuleFrom adds a version to a post that had none", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    expect(data.posts[0]!.rules).toEqual([{ from: "2026-04", rule: pct(10) }]);
  });

  test("setRuleFrom REPLACES an existing version for the same month", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.setRuleFrom(data, postId, "2026-04", pct(15));
    expect(data.posts[0]!.rules).toHaveLength(1);
    expect(data.posts[0]!.rules[0]!.rule).toEqual(pct(15));
  });

  test("versions are kept sorted regardless of insertion order", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-07", pct(15));
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.setRuleFrom(data, postId, "2026-05", pct(12));
    expect(data.posts[0]!.rules.map((v) => v.from)).toEqual([
      "2026-04",
      "2026-05",
      "2026-07",
    ]);
  });

  test("a fixed rule is rounded at the mutation boundary", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", {
      kind: "fixed",
      amount: { amount: 12.345, currency: "DKK" },
    });
    const stored = data.posts[0]!.rules[0]!.rule;
    expect(stored.kind === "fixed" && stored.amount.amount).toBe(12.35);
  });

  test("a percentage above 100 is stored, not clamped", () => {
    const data = draft();
    actions.setRuleFrom(data, data.posts[0]!.id, "2026-04", pct(150));
    expect(data.posts[0]!.rules[0]!.rule).toEqual(pct(150));
  });

  test("removeRuleFrom deletes exactly that version", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.setRuleFrom(data, postId, "2026-07", pct(15));
    actions.removeRuleFrom(data, postId, "2026-04");
    expect(data.posts[0]!.rules).toEqual([{ from: "2026-07", rule: pct(15) }]);
  });

  test("removing a month that has no version is a no-op, not an error", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.removeRuleFrom(data, postId, "2026-09");
    expect(data.posts[0]!.rules).toHaveLength(1);
  });

  test("both throw on an unknown post id", () => {
    expect(() => actions.setRuleFrom(draft(), "ghost", "2026-04", pct(10))).toThrow(
      /Unknown post: ghost/,
    );
    expect(() => actions.removeRuleFrom(draft(), "ghost", "2026-04")).toThrow(
      /Unknown post: ghost/,
    );
  });
});

describe("split values are rounded by what they MEAN", () => {
  // In "fixed" mode a split value is money, so it must round to the dataset's
  // decimal places. In "percent" mode it is a percentage and has nothing to do
  // with money at all, so it stays at two places whatever the setting says.
  test("a fixed-mode split rounds to the dataset's decimal places", () => {
    withDigits(0, () => {
      const data = draft();
      const purchase = actions.addPurchase(data, {
        date: "2026-09-14",
        description: "Sofa",
        total: { amount: 100, currency: "EUR" },
        splitMode: "fixed",
        splits: [
          { postId: data.posts[0]!.id, value: 10.44, absorbsRemainder: false },
          { postId: data.posts[1]!.id, value: 89.56, absorbsRemainder: true },
        ],
        schedule: null,
      });
      expect(purchase.splits[0]!.value).toBe(10);
    });
  });

  test("a fixed-mode split still rounds to the setting when only splits change", () => {
    withDigits(0, () => {
      const data = draft();
      const purchase = actions.addPurchase(data, {
        date: "2026-09-14",
        description: "Sofa",
        total: { amount: 100, currency: "EUR" },
        splitMode: "fixed",
        splits: [{ postId: data.posts[0]!.id, value: 100, absorbsRemainder: true }],
        schedule: null,
      });
      actions.updatePurchase(data, purchase.id, {
        splits: [{ postId: data.posts[0]!.id, value: 42.61, absorbsRemainder: true }],
      });
      expect(data.purchases[0]!.splits[0]!.value).toBe(43);
    });
  });

  test("a percent-mode split keeps 2 decimals whatever the currency does", () => {
    withDigits(0, () => {
      const data = draft();
      const purchase = actions.addPurchase(data, {
        date: "2026-09-14",
        description: "Sofa",
        total: { amount: 100, currency: "EUR" },
        splitMode: "percent",
        splits: [{ postId: data.posts[0]!.id, value: 33.3333, absorbsRemainder: true }],
        schedule: null,
      });
      expect(purchase.splits[0]!.value).toBe(33.33);
    });
  });
});

describe("recurring costs", () => {
  function draft(): Dataset {
    const data = createSeedDataset("2026-01");
    data.posts[0]!.id = "housing";
    return data;
  }

  const rentInput = {
    name: "Rent",
    archived: false,
    amount: { amount: 8000, currency: "DKK" },
    startDate: "2026-01",
    recurrence: { kind: "everyNMonths" as const, n: 1 },
    anchoring: "calendar" as const,
    splitMode: "percent" as const,
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
  };

  test("adding assigns an id and an order", () => {
    const data = draft();
    const first = actions.addRecurringCost(data, rentInput);
    const second = actions.addRecurringCost(data, { ...rentInput, name: "Phone" });

    expect(first.id).not.toBe(second.id);
    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
    expect(data.recurring.length).toBe(2);
  });

  test("the amount is rounded to the dataset's digits before it lands", () => {
    const data = draft();
    data.settings.digits = 0;
    const cost = actions.addRecurringCost(data, { ...rentInput, amount: { amount: 8000.7, currency: "DKK" } });
    expect(cost.amount.amount).toBe(8001);
  });

  test("a recurrence with n below 1 is refused", () => {
    // The projection walk terminates only if every step advances, and the
    // importer is not the only write path.
    const data = draft();
    expect(() => actions.addRecurringCost(data, { ...rentInput, recurrence: { kind: "everyNDays", n: 0 } }))
      .toThrow(/at least 1/);
    expect(() => actions.addRecurringCost(data, { ...rentInput, recurrence: { kind: "everyNDays", n: 1.5 } }))
      .toThrow(/whole number/);
  });

  test("a weekday outside 0-6 is refused", () => {
    const data = draft();
    expect(() =>
      actions.addRecurringCost(data, { ...rentInput, recurrence: { kind: "everyNWeeks", n: 1, weekday: 7 } }),
    ).toThrow(/weekday/);
  });

  test("updating validates the new recurrence too", () => {
    const data = draft();
    const cost = actions.addRecurringCost(data, rentInput);
    expect(() =>
      actions.updateRecurringCost(data, cost.id, { recurrence: { kind: "everyNDays", n: 0 } }),
    ).toThrow(/at least 1/);
  });

  describe("startDate granularity (C1)", () => {
    test("adding a day-granular kind with a month-only startDate is refused", () => {
      const data = draft();
      expect(() =>
        actions.addRecurringCost(data, {
          ...rentInput,
          startDate: "2026-01",
          recurrence: { kind: "everyNDays", n: 30 },
        }),
      ).toThrow(/day-granular/);
      expect(() =>
        actions.addRecurringCost(data, {
          ...rentInput,
          startDate: "2026-01",
          recurrence: { kind: "everyNWeeks", n: 1, weekday: 1 },
        }),
      ).toThrow(/day-granular/);
    });

    test("adding a day-granular kind with a day-granular startDate succeeds", () => {
      const data = draft();
      const cost = actions.addRecurringCost(data, {
        ...rentInput,
        startDate: "2026-01-05",
        recurrence: { kind: "everyNDays", n: 30 },
      });
      expect(cost.startDate).toBe("2026-01-05");
    });

    test("everyNMonths accepts either granularity", () => {
      const data = draft();
      expect(() => actions.addRecurringCost(data, { ...rentInput, startDate: "2026-01" })).not.toThrow();
      expect(() =>
        actions.addRecurringCost(data, { ...rentInput, startDate: "2026-01-15" }),
      ).not.toThrow();
    });

    // This is the exact bug: a monthly cost is created (startDate "2026-09"),
    // then the unit dropdown switches it to a day-granular kind WITHOUT
    // touching startDate — the only way a real edit reaches this, since the
    // add form always starts as everyNMonths.
    test("updating just the recurrence kind against an untouched month-only startDate is refused", () => {
      const data = draft();
      const cost = actions.addRecurringCost(data, { ...rentInput, startDate: "2026-09" });
      expect(() =>
        actions.updateRecurringCost(data, cost.id, { recurrence: { kind: "everyNDays", n: 30 } }),
      ).toThrow(/day-granular/);
      expect(() =>
        actions.updateRecurringCost(data, cost.id, {
          recurrence: { kind: "everyNWeeks", n: 1, weekday: 3 },
        }),
      ).toThrow(/day-granular/);
      // Refused, so nothing committed — still the original month-granular kind.
      expect(data.recurring[0]!.recurrence.kind).toBe("everyNMonths");
    });

    test("updating just startDate to a month-only value against a stored day-granular kind is refused", () => {
      const data = draft();
      const cost = actions.addRecurringCost(data, {
        ...rentInput,
        startDate: "2026-01-05",
        recurrence: { kind: "everyNDays", n: 30 },
      });
      expect(() => actions.updateRecurringCost(data, cost.id, { startDate: "2026-01" })).toThrow(
        /day-granular/,
      );
    });

    test("updating recurrence and startDate together to a consistent day-granular pair succeeds", () => {
      const data = draft();
      const cost = actions.addRecurringCost(data, { ...rentInput, startDate: "2026-09" });
      actions.updateRecurringCost(data, cost.id, {
        recurrence: { kind: "everyNDays", n: 30 },
        startDate: "2026-09-01",
      });
      expect(data.recurring[0]!.startDate).toBe("2026-09-01");
      expect(data.recurring[0]!.recurrence.kind).toBe("everyNDays");
    });

    // Residual C1: shape alone ("YYYY-MM-DD") is not calendar validity.
    // September has 30 days, so "2026-09-31" is day-SHAPED but impossible.
    // `requireStartDateGranularity` used a shape-only regex and let this
    // through even under everyNMonths; downstream, foldBalances throws
    // "Invalid day in IsoDate" out of addDays/toDayOrdinal.
    test("a calendar-impossible startDate is refused, even under everyNMonths", () => {
      const data = draft();
      expect(() =>
        actions.addRecurringCost(data, { ...rentInput, startDate: "2026-09-31" }),
      ).toThrow(/2026-09-31/);

      const cost = actions.addRecurringCost(data, rentInput);
      expect(() =>
        actions.updateRecurringCost(data, cost.id, { startDate: "2026-09-31" }),
      ).toThrow(/2026-09-31/);
      // Refused, so nothing committed beyond the one successful add above.
      expect(data.recurring.length).toBe(1);
      expect(data.recurring[0]!.startDate).toBe(rentInput.startDate);
    });

    // Second half of the same reproduction: even if a calendar-impossible
    // startDate is already sitting in the draft (e.g. from data written
    // before this fix existed), switching the recurrence kind must not wave
    // it through — requireStartDateGranularity re-validates on every update,
    // not only ones that touch startDate.
    test("switching kind against an already-impossible stored startDate is refused", () => {
      const data = draft();
      const cost = actions.addRecurringCost(data, rentInput);
      // Bypass the public API to simulate a bad value already on disk.
      data.recurring[0]!.startDate = "2026-09-31";
      expect(() =>
        actions.updateRecurringCost(data, cost.id, { recurrence: { kind: "everyNDays", n: 7 } }),
      ).toThrow(/2026-09-31/);
      expect(data.recurring[0]!.recurrence.kind).toBe("everyNMonths");
    });

    // Residual C1: monthOf's regex used to be unanchored (`/^(\d{4})-(\d{2})/`
    // with no trailing `$`), so it matched a "YYYY-MM" PREFIX of a longer,
    // malformed string and silently dropped the rest.
    test("an unanchored-month-shaped garbage value is refused", () => {
      const data = draft();
      expect(() =>
        actions.addRecurringCost(data, { ...rentInput, startDate: "2026-091" }),
      ).toThrow(/2026-091/);

      const cost = actions.addRecurringCost(data, rentInput);
      expect(() =>
        actions.updateRecurringCost(data, cost.id, { startDate: "2026-091" }),
      ).toThrow(/2026-091/);
    });

    test("legitimate calendar-valid dates still pass", () => {
      const data = draft();
      expect(() => actions.addRecurringCost(data, { ...rentInput, startDate: "2026-09" })).not.toThrow();
      expect(() =>
        actions.addRecurringCost(data, {
          ...rentInput,
          startDate: "2024-02-29", // 2024 is a leap year
          recurrence: { kind: "everyNDays", n: 1 },
        }),
      ).not.toThrow();
      expect(() =>
        actions.addRecurringCost(data, {
          ...rentInput,
          startDate: "2026-02-28", // 2026 is not a leap year
          recurrence: { kind: "everyNDays", n: 1 },
        }),
      ).not.toThrow();
    });
  });

  test("ending sets both endedFrom and archived", () => {
    const data = draft();
    const cost = actions.addRecurringCost(data, rentInput);
    actions.endRecurringCost(data, cost.id, "2026-06");

    expect(data.recurring[0]!.endedFrom).toBe("2026-06");
    expect(data.recurring[0]!.archived).toBe(true);
  });

  test("restoring clears both", () => {
    const data = draft();
    const cost = actions.addRecurringCost(data, rentInput);
    actions.endRecurringCost(data, cost.id, "2026-06");
    actions.restoreRecurringCost(data, cost.id);

    expect(data.recurring[0]!.endedFrom).toBeUndefined();
    expect(data.recurring[0]!.archived).toBe(false);
  });

  test("moving swaps order with its neighbour", () => {
    const data = draft();
    const first = actions.addRecurringCost(data, rentInput);
    const second = actions.addRecurringCost(data, { ...rentInput, name: "Phone" });
    actions.moveRecurringCost(data, second.id, -1);

    expect(data.recurring.find((c) => c.id === second.id)!.order).toBe(0);
    expect(data.recurring.find((c) => c.id === first.id)!.order).toBe(1);
  });
});

describe("confirmOccurrence", () => {
  function draft(): Dataset {
    const data = createSeedDataset("2026-01");
    data.posts[0]!.id = "housing";
    actions.addRecurringCost(data, {
      name: "Rent",
      archived: false,
      amount: { amount: 8000, currency: "DKK" },
      startDate: "2026-01",
      recurrence: { kind: "everyNMonths", n: 1 },
      anchoring: "calendar",
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    });
    return data;
  }

  test("writes an ordinary purchase carrying the slot it claims", () => {
    const data = draft();
    const purchase = actions.confirmOccurrence(data, data.recurring[0]!.id, "2026-03");

    expect(purchase.source).toEqual({ recurringId: data.recurring[0]!.id, occurrenceDate: "2026-03" });
    expect(purchase.date).toBe("2026-03");
    expect(purchase.total).toEqual({ amount: 8000, currency: "DKK" });
    expect(purchase.description).toBe("Rent");
    expect(purchase.schedule).toBeNull();
    expect(data.purchases.length).toBe(1);
  });

  test("the purchase date may differ from the slot — this is the data-cap case", () => {
    const data = draft();
    const purchase = actions.confirmOccurrence(data, data.recurring[0]!.id, "2026-03", { date: "2026-02-12" });

    expect(purchase.source!.occurrenceDate).toBe("2026-03");
    expect(purchase.date).toBe("2026-02-12");
  });

  test("an overridden amount is what gets recorded", () => {
    const data = draft();
    const purchase = actions.confirmOccurrence(data, data.recurring[0]!.id, "2026-03", {
      amount: { amount: 8250, currency: "DKK" },
    });
    expect(purchase.total.amount).toBe(8250);
  });

  test("the month the purchase lands in is created, so income can be entered", () => {
    const data = draft();
    actions.confirmOccurrence(data, data.recurring[0]!.id, "2026-05");
    expect(data.months.some((m) => m.id === "2026-05")).toBe(true);
  });

  test("splits are copied, not shared with the cost", () => {
    const data = draft();
    const purchase = actions.confirmOccurrence(data, data.recurring[0]!.id, "2026-03");
    purchase.splits[0]!.value = 50;
    expect(data.recurring[0]!.splits[0]!.value).toBe(100);
  });

  test("an unknown cost throws", () => {
    expect(() => actions.confirmOccurrence(draft(), "nope", "2026-03")).toThrow(/Unknown recurring cost/);
  });
});
