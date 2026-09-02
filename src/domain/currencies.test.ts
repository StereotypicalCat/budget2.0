import { test, expect, describe } from "bun:test";
import { digitsFor, currencyCodes, findCurrency, normalizeCurrencyCode } from "./currencies.ts";
import type { CurrencyDef } from "./types.ts";

const TABLE: CurrencyDef[] = [
  { code: "DKK", digits: 2, symbol: "kr" },
  { code: "JPY", digits: 0, symbol: "¥" },
  { code: "KWD", digits: 3 },
];

describe("digitsFor", () => {
  test("reads the digits the owner recorded, not an assumed 2", () => {
    expect(digitsFor(TABLE, "DKK")).toBe(2);
    expect(digitsFor(TABLE, "JPY")).toBe(0);
    expect(digitsFor(TABLE, "KWD")).toBe(3);
  });

  /**
   * Deep inside the fold a throw would take the whole balance view down over
   * a data problem the import validator already rejects at the boundary. Two
   * places is right for almost every currency in existence.
   */
  test("an unknown currency falls back to two places rather than throwing", () => {
    expect(digitsFor(TABLE, "XYZ")).toBe(2);
    expect(digitsFor([], "DKK")).toBe(2);
  });
});

describe("normalizeCurrencyCode", () => {
  test("codes are identity, so case and padding cannot fork one currency in two", () => {
    expect(normalizeCurrencyCode(" usd ")).toBe("USD");
    expect(normalizeCurrencyCode("Jpy")).toBe("JPY");
  });
});

test("currencyCodes keeps the owner's order", () => {
  expect(currencyCodes(TABLE)).toEqual(["DKK", "JPY", "KWD"]);
});

test("findCurrency returns the definition, or nothing", () => {
  expect(findCurrency(TABLE, "JPY")?.symbol).toBe("¥");
  expect(findCurrency(TABLE, "XYZ")).toBeUndefined();
});
