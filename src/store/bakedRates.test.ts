import { test, expect, describe } from "bun:test";
import { FALLBACK_FX_RATES, parseBakedRates } from "./bakedRates.ts";
import { createSeedDataset } from "../domain/seed.ts";
import type { FxRate } from "../domain/types.ts";
import { MissingRateError, toBase } from "../domain/fx.ts";

describe("the committed fallback rates", () => {
  test("cover every non-base currency and are honestly labelled manual", () => {
    expect(FALLBACK_FX_RATES.map((r) => r.currency).sort()).toEqual(["EUR", "USD"]);
    // "api" would claim a hardcoded number came from a rate service. Settings
    // shows this field to the user.
    expect(FALLBACK_FX_RATES.every((r) => r.source === "manual")).toBe(true);
    expect(FALLBACK_FX_RATES.every((r) => r.baseUnitsPerOne > 0)).toBe(true);
  });
});

describe("reading what the build baked in", () => {
  const baked: FxRate[] = [
    { currency: "USD", baseUnitsPerOne: 6.812345, updatedAt: "2026-09-02", source: "api" },
    { currency: "EUR", baseUnitsPerOne: 7.456789, updatedAt: "2026-09-02", source: "api" },
  ];

  test("an unset variable falls back to the committed constants", () => {
    expect(parseBakedRates(undefined)).toEqual(FALLBACK_FX_RATES);
  });

  test("a well-formed payload is used as-is", () => {
    expect(parseBakedRates(JSON.stringify(baked))).toEqual(baked);
  });

  test("six decimal places survive — a rate is not money", () => {
    const [usd] = parseBakedRates(JSON.stringify(baked));
    expect(usd!.baseUnitsPerOne).toBe(6.812345);
  });

  test.each([
    ["not JSON at all", "{oh dear"],
    ["a non-array", JSON.stringify({ USD: 6.8 })],
    ["an unsupported currency", JSON.stringify([{ currency: "GBP", baseUnitsPerOne: 8.6, updatedAt: "2026-09-02", source: "api" }])],
    ["a non-positive rate", JSON.stringify([{ currency: "USD", baseUnitsPerOne: 0, updatedAt: "2026-09-02", source: "api" }])],
    ["a missing rate value", JSON.stringify([{ currency: "USD", updatedAt: "2026-09-02", source: "api" }])],
    ["an empty array", JSON.stringify([])],
  ])("%s falls back rather than booting with junk", (_label, payload) => {
    expect(parseBakedRates(payload)).toEqual(FALLBACK_FX_RATES);
  });
});

describe("what baked rates are allowed to do", () => {
  test("they seed a new dataset", () => {
    const data = createSeedDataset("2026-09", FALLBACK_FX_RATES);
    expect(data.fxRates).toEqual([...FALLBACK_FX_RATES]);
  });

  test("seeding without them still yields no rates at all", () => {
    expect(createSeedDataset("2026-09").fxRates).toEqual([]);
  });

  test("the seeded rows are copies, so editing one cannot rewrite the constants", () => {
    const data = createSeedDataset("2026-09", FALLBACK_FX_RATES);
    data.fxRates[0]!.baseUnitsPerOne = 999;
    expect(FALLBACK_FX_RATES[0]!.baseUnitsPerOne).not.toBe(999);
  });

  /**
   * The decision this guards: clearing a rate REMOVES the row so
   * MissingRateError surfaces, instead of silently converting money at a
   * number the user never chose. Baked rates seed; they never backstop.
   */
  test("they do NOT backstop a rate the user has cleared", () => {
    const data = createSeedDataset("2026-09", FALLBACK_FX_RATES);
    data.fxRates = data.fxRates.filter((r) => r.currency !== "EUR");
    expect(() =>
      toBase({ amount: 100, currency: "EUR" }, data.settings.baseCurrency, data.fxRates),
    ).toThrow(MissingRateError);
  });
});
