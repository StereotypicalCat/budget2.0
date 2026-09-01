import { test, expect, describe } from "bun:test";
import * as actions from "./actions.ts";
import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset } from "../domain/types.ts";

function draft(): Dataset {
  return createSeedDataset("2026-09");
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

  test("setIncome rounds the amount to the currency's minor unit", () => {
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
    const post = actions.addPost(data, "Travel", "EUR", {
      kind: "percentOfIncome",
      percent: 5,
    });
    expect(post.order).toBe(3);
    expect(post.archived).toBe(false);
    expect(data.posts).toHaveLength(4);
  });

  test("addPost rounds a fixed standing rule's amount and a percent's percent", () => {
    const data = draft();
    const fixedPost = actions.addPost(data, "Rent", "DKK", {
      kind: "fixed",
      amount: { amount: 12.345, currency: "DKK" },
    });
    expect(fixedPost.standingRule).toEqual({
      kind: "fixed",
      amount: { amount: 12.35, currency: "DKK" },
    });

    const percentPost = actions.addPost(data, "Travel", "EUR", {
      kind: "percentOfIncome",
      percent: 12.3456,
    });
    expect(percentPost.standingRule).toEqual({
      kind: "percentOfIncome",
      percent: 12.35,
    });
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

  test("updatePost rounds a fixed standing rule's amount and a percent's percent", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.updatePost(data, postId, {
      standingRule: { kind: "fixed", amount: { amount: 12.345, currency: "DKK" } },
    });
    expect(data.posts.find((p) => p.id === postId)!.standingRule).toEqual({
      kind: "fixed",
      amount: { amount: 12.35, currency: "DKK" },
    });

    actions.updatePost(data, postId, {
      standingRule: { kind: "percentOfIncome", percent: 12.3456 },
    });
    expect(data.posts.find((p) => p.id === postId)!.standingRule).toEqual({
      kind: "percentOfIncome",
      percent: 12.35,
    });
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
});
