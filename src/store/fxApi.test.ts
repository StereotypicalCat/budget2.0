import { test, expect, describe } from "bun:test";
import { buildFxUrl, parseFxResponse, DEFAULT_FX_API_URL } from "./fxApi.ts";

/** What the caller asked the service for, and so what it will accept back. */
const ALLOWED = ["DKK", "USD", "EUR"];

describe("buildFxUrl", () => {
  test("substitutes the base and target placeholders", () => {
    expect(buildFxUrl(DEFAULT_FX_API_URL, "DKK", ["USD", "EUR"])).toBe(
      "https://api.frankfurter.app/latest?from=DKK&to=USD,EUR",
    );
  });
});

describe("parseFxResponse", () => {
  test("inverts the rates into base units per one unit", () => {
    // The API returns how many target units 1 base unit buys; we store the
    // inverse, so 1 EUR = 7.46 DKK becomes baseUnitsPerOne 7.46.
    const rates = parseFxResponse({ rates: { EUR: 0.134048, USD: 0.144928 } }, "DKK", ALLOWED);
    expect(rates.find((r) => r.currency === "EUR")!.baseUnitsPerOne).toBeCloseTo(7.46, 2);
    expect(rates.every((r) => r.source === "api")).toBe(true);
    expect(rates.every((r) => r.updatedAt !== "")).toBe(true);
  });

  test("skips the base currency's own row if the API returns one", () => {
    const rates = parseFxResponse({ rates: { DKK: 1, EUR: 0.134 } }, "DKK", ALLOWED);
    expect(rates.map((r) => r.currency)).toEqual(["EUR"]);
  });

  test("ignores currencies this dataset does not define", () => {
    const rates = parseFxResponse({ rates: { GBP: 0.11, EUR: 0.134 } }, "DKK", ALLOWED);
    expect(rates.map((r) => r.currency)).toEqual(["EUR"]);
  });

  test("rejects a response with no rates object", () => {
    expect(() => parseFxResponse({}, "DKK", ALLOWED)).toThrow(/rates/);
    expect(() => parseFxResponse("nope", "DKK", ALLOWED)).toThrow(/rates/);
  });

  test("rejects a zero or negative rate rather than storing an infinity", () => {
    expect(() => parseFxResponse({ rates: { EUR: 0 } }, "DKK", ALLOWED)).toThrow(/EUR/);
  });
});

test("an explicit updatedAt is used instead of the clock", () => {
  // The build bakes rates in with the BUILD date, not the date the browser
  // happens to run parseFxResponse.
  const rates = parseFxResponse({ rates: { EUR: 0.13378, USD: 0.15505 } }, "DKK", ALLOWED, "2026-09-01");
  expect(rates.map((r) => r.updatedAt)).toEqual(["2026-09-01", "2026-09-01"]);
  expect(rates.every((r) => r.source === "api")).toBe(true);
});
