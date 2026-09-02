import { test, expect, describe } from "bun:test";
import * as actions from "./actions.ts";
import { createSeedDataset } from "../domain/seed.ts";
import { currencyUsage } from "../domain/currencies.ts";
import type { Dataset } from "../domain/types.ts";

const draft = (): Dataset => createSeedDataset("2026-09");

describe("adding a currency", () => {
  test("appends it with the digits and symbol given", () => {
    const data = draft();
    actions.addCurrency(data, { code: "JPY", digits: 0, symbol: "¥", name: "Japanese yen" });
    expect(data.currencies.at(-1)).toEqual({
      code: "JPY",
      digits: 0,
      symbol: "¥",
      name: "Japanese yen",
    });
  });

  test("the code is normalised, because a code is identity", () => {
    // "usd" and "USD" must never become two currencies: the code keys the FX
    // table and every stored Money.
    const data = draft();
    actions.addCurrency(data, { code: " jpy ", digits: 0 });
    expect(data.currencies.at(-1)!.code).toBe("JPY");
  });

  test("a duplicate is refused rather than shadowing the original", () => {
    const data = draft();
    expect(() => actions.addCurrency(data, { code: "usd", digits: 2 })).toThrow(/USD/);
    expect(data.currencies.filter((c) => c.code === "USD")).toHaveLength(1);
  });

  test.each([
    ["not letters", "US1"],
    ["too short", "U"],
    ["empty", "   "],
  ])("a code that is %s is refused", (_label, code) => {
    expect(() => actions.addCurrency(draft(), { code, digits: 2 })).toThrow();
  });

  test.each([[-1], [5], [1.5]])("invalid decimal places (%p) are refused", (digits) => {
    expect(() => actions.addCurrency(draft(), { code: "JPY", digits })).toThrow(/decimal/i);
  });
});

describe("editing a currency", () => {
  test("changes the digits, symbol and name but never the code", () => {
    const data = draft();
    actions.updateCurrency(data, "USD", { digits: 3, symbol: "US$" });
    const usd = data.currencies.find((c) => c.code === "USD")!;
    expect(usd).toEqual({ code: "USD", digits: 3, symbol: "US$", name: "US dollar" });
  });

  test("an unknown code throws", () => {
    expect(() => actions.updateCurrency(draft(), "JPY", { digits: 0 })).toThrow(/JPY/);
  });
});

describe("removing a currency", () => {
  test("removes one nothing references", () => {
    const data = draft();
    actions.addCurrency(data, { code: "JPY", digits: 0 });
    actions.removeCurrency(data, "JPY");
    expect(data.currencies.map((c) => c.code)).toEqual(["DKK", "USD", "EUR"]);
  });

  test("its exchange rate goes with it, so no orphan row is left behind", () => {
    const data = draft();
    actions.addCurrency(data, { code: "JPY", digits: 0 });
    actions.setFxRate(data, {
      currency: "JPY",
      baseUnitsPerOne: 0.045,
      updatedAt: "2026-09-01",
      source: "manual",
    });
    actions.removeCurrency(data, "JPY");
    expect(data.fxRates.find((r) => r.currency === "JPY")).toBeUndefined();
  });

  test("the base currency cannot be removed", () => {
    expect(() => actions.removeCurrency(draft(), "DKK")).toThrow(/base/i);
  });

  /**
   * The same reasoning as posts being archived rather than deleted: stored
   * Money references the code. Removing a currency in use would leave amounts
   * pointing at a definition that no longer exists — and the import validator
   * would then refuse the owner's own exported file.
   */
  test("a currency still referenced by a purchase cannot be removed", () => {
    const data = draft();
    actions.addPurchase(data, {
      date: "2026-09-04",
      description: "Indie bundle",
      total: { amount: 27.5, currency: "EUR" },
      splitMode: "percent",
      splits: [{ postId: data.posts[0]!.id, value: 100, absorbsRemainder: true }],
      schedule: null,
    });
    expect(() => actions.removeCurrency(data, "EUR")).toThrow(/in use/i);
  });

  test("a currency referenced only by a post's display setting cannot be removed", () => {
    const data = draft();
    actions.updatePost(data, data.posts[0]!.id, { currency: "USD" });
    expect(() => actions.removeCurrency(data, "USD")).toThrow(/in use/i);
  });
});

describe("currencyUsage", () => {
  test("names where a currency is referenced, so the UI can say why", () => {
    const data = draft();
    actions.setIncome(data, "2026-10", { amount: 100, currency: "USD" });
    expect(currencyUsage(data, "USD")).toContain("month 2026-10");
    expect(currencyUsage(data, "JPY")).toEqual([]);
  });

  test("a fixed allocation rule counts as a reference", () => {
    const data = draft();
    actions.setRuleFrom(data, data.posts[0]!.id, "2026-09", {
      kind: "fixed",
      amount: { amount: 50, currency: "EUR" },
    });
    expect(currencyUsage(data, "EUR").join(" ")).toMatch(/rule/i);
  });
});
