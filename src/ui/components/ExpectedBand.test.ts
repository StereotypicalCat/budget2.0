import { describe, expect, test } from "bun:test";
import { resolveExpectedAmount } from "./ExpectedBand.tsx";

const DKK_USD = [
  { code: "DKK", symbol: "kr" },
  { code: "USD", symbol: "$" },
];

// I5: an unrecognised currency must not silently confirm at the cost's own
// amount. `resolveExpectedAmount` is the logic ExpectedBand's Confirm button
// uses to decide whether to write a purchase at all.
describe("resolveExpectedAmount", () => {
  test("untouched (typed undefined) is not invalid, and parses to nothing — the fast path", () => {
    const result = resolveExpectedAmount(undefined, DKK_USD, "DKK");
    expect(result.invalid).toBe(false);
    expect(result.parsed).toBeNull();
  });

  test("edited text that parses is not invalid", () => {
    const result = resolveExpectedAmount("450", DKK_USD, "DKK");
    expect(result.invalid).toBe(false);
    expect(result.parsed).toEqual({ amount: 450, currency: "DKK" });
  });

  test("edited text naming a currency the dataset doesn't have is invalid, not a silent fallback", () => {
    // This is the exact bug: "30 GBP" in a DKK/USD dataset used to fall back
    // to the cost's own amount via `parsed ?? undefined`.
    const result = resolveExpectedAmount("30 GBP", DKK_USD, "DKK");
    expect(result.invalid).toBe(true);
    expect(result.parsed).toBeNull();
  });

  test("edited text that is empty or otherwise unparseable is invalid", () => {
    expect(resolveExpectedAmount("", DKK_USD, "DKK").invalid).toBe(true);
    expect(resolveExpectedAmount("thirty", DKK_USD, "DKK").invalid).toBe(true);
  });
});
