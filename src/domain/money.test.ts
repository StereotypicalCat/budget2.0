import { test, expect, describe } from "bun:test";
import {
  roundMoney,
  distributeByWeight,
  distributeByAmount,
} from "./money.ts";

describe("roundMoney", () => {
  test("rounds to 2 decimal places", () => {
    expect(roundMoney(1.234, 2)).toBe(1.23);
    expect(roundMoney(1.235, 2)).toBe(1.24);
    expect(roundMoney(0.1 + 0.2, 2)).toBe(0.3);
  });

  test("handles negatives symmetrically", () => {
    expect(roundMoney(-1.235, 2)).toBe(-1.24);
  });
});

describe("distributeByWeight", () => {
  test("splits proportionally", () => {
    expect(distributeByWeight(200, [60, 40], 0, 2)).toEqual([120, 80]);
  });

  test("thirds sum exactly to the total", () => {
    const parts = distributeByWeight(100, [1, 1, 1], 2, 2);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    expect(roundMoney(parts[0]! + parts[1]! + parts[2]!, 2)).toBe(100);
  });

  test("the remainder index absorbs the rounding drift", () => {
    const parts = distributeByWeight(100, [1, 1, 1], 0, 2);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  test("a single split takes the whole total", () => {
    expect(distributeByWeight(99.99, [100], 0, 2)).toEqual([99.99]);
  });

  test("weights that do not sum to 100 are still proportional", () => {
    expect(distributeByWeight(100, [1, 3], 1, 2)).toEqual([25, 75]);
  });

  test("all-zero weights put everything on the remainder rather than throwing", () => {
    // Reachable from a zero-value purchase; must not divide by zero.
    expect(distributeByWeight(100, [0, 0], 1, 2)).toEqual([0, 100]);
    expect(distributeByWeight(0, [0, 0], 0, 2)).toEqual([0, 0]);
  });
});

describe("distributeByAmount", () => {
  test("uses the given amounts as-is", () => {
    expect(distributeByAmount(200, [120, 80], 1, 2)).toEqual([120, 80]);
  });

  test("the remainder index absorbs a shortfall", () => {
    expect(distributeByAmount(200, [120, 50], 1, 2)).toEqual([120, 80]);
  });

  test("the remainder index absorbs an excess, even going negative", () => {
    expect(distributeByAmount(100, [120, 50], 1, 2)).toEqual([120, -20]);
  });

  test("parts always sum exactly to the total", () => {
    const parts = distributeByAmount(10, [3.33, 3.33, 0], 2, 2);
    expect(roundMoney(parts.reduce((a, b) => a + b, 0), 2)).toBe(10);
  });
});
