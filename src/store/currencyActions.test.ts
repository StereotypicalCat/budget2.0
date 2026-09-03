import { test, expect, describe } from "bun:test";
import * as actions from "./actions.ts";
import { createSeedDataset } from "../domain/seed.ts";
import { currencyUsage } from "../domain/currencies.ts";
import type { Dataset } from "../domain/types.ts";

const draft = (): Dataset => createSeedDataset("2026-09");

describe("adding a currency", () => {
  test("appends it with the symbol and name given", () => {
    const data = draft();
    actions.addCurrency(data, { code: "JPY", symbol: "¥", name: "Japanese yen" });
    expect(data.currencies.at(-1)).toEqual({
      code: "JPY",
      symbol: "¥",
      name: "Japanese yen",
    });
  });

  // Decimals are a dataset-wide setting, so there is nothing per-currency to
  // carry. A definition arriving with one keeps nothing of it.
  test("a stray digits field is not stored on the definition", () => {
    const data = draft();
    actions.addCurrency(data, { code: "JPY", digits: 0 } as any);
    expect("digits" in data.currencies.at(-1)!).toBe(false);
  });

  test("the code is normalised, because a code is identity", () => {
    // "usd" and "USD" must never become two currencies: the code keys the FX
    // table and every stored Money.
    const data = draft();
    actions.addCurrency(data, { code: " jpy " });
    expect(data.currencies.at(-1)!.code).toBe("JPY");
  });

  test("a duplicate is refused rather than shadowing the original", () => {
    const data = draft();
    expect(() => actions.addCurrency(data, { code: "usd" })).toThrow(/USD/);
    expect(data.currencies.filter((c) => c.code === "USD")).toHaveLength(1);
  });

  test.each([
    ["not letters", "US1"],
    ["too short", "U"],
    ["empty", "   "],
  ])("a code that is %s is refused", (_label, code) => {
    expect(() => actions.addCurrency(draft(), { code })).toThrow();
  });

});

describe("editing a currency", () => {
  test("changes the symbol and name but never the code", () => {
    const data = draft();
    actions.updateCurrency(data, "USD", { symbol: "US$" });
    const usd = data.currencies.find((c) => c.code === "USD")!;
    expect(usd).toEqual({ code: "USD", symbol: "US$", name: "US dollar" });
  });

  test("an unknown code throws", () => {
    expect(() => actions.updateCurrency(draft(), "JPY", { symbol: "¥" })).toThrow(/JPY/);
  });
});

describe("removing a currency", () => {
  test("removes one nothing references", () => {
    const data = draft();
    actions.addCurrency(data, { code: "JPY" });
    actions.removeCurrency(data, "JPY");
    expect(data.currencies.map((c) => c.code)).toEqual(["DKK", "USD", "EUR", "GBP"]);
  });

  test("its exchange rate goes with it, so no orphan row is left behind", () => {
    const data = draft();
    actions.addCurrency(data, { code: "JPY" });
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

describe("the decimal-places setting", () => {
  test("setDigits writes the whole dataset's decimal places", () => {
    const data = draft();
    actions.setDigits(data, 0);
    expect(data.settings.digits).toBe(0);
  });

  test("it does not rewrite amounts already stored", () => {
    // Moving the setting is a rounding rule going forward, not a data rewrite:
    // 2 -> 0 cannot be undone, and rewriting every Money is a destructive
    // whole-dataset write that would owe the owner a backup first.
    const data = draft();
    data.months[0]!.income = { amount: 20_000.55, currency: "DKK" };
    actions.setDigits(data, 0);
    expect(data.months[0]!.income.amount).toBe(20_000.55);
  });

  test.each([
    ["fractional", 1.5],
    ["negative", -1],
    ["beyond four places", 5],
    ["not a number", Number.NaN],
  ])("a %s value is refused rather than stored", (_label, value) => {
    const data = draft();
    expect(() => actions.setDigits(data, value)).toThrow();
    expect(data.settings.digits).toBe(2);
  });

  test("the bounds themselves are accepted", () => {
    for (const digits of [0, 1, 2, 3, 4]) {
      const data = draft();
      actions.setDigits(data, digits);
      expect(data.settings.digits).toBe(digits);
    }
  });
});
