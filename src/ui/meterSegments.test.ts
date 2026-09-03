import { test, expect } from "bun:test";
import {
  allocatedPercentOfIncome,
  allocationMeterSegments,
  carryMeterSegments,
  gradientFor,
  type MeterSegment,
} from "./meterSegments.ts";
import type { PostMonthFigures } from "../domain/fold.ts";

function figures(partial: Partial<PostMonthFigures>): PostMonthFigures {
  const carriedIn = partial.carriedIn ?? 0;
  const allocation = partial.allocation ?? 0;
  const charges = partial.charges ?? 0;
  const remaining = partial.remaining ?? carriedIn + allocation - charges;
  return {
    carriedIn,
    allocation,
    charges,
    remaining,
    expected: partial.expected ?? 0,
    projectedCarriedIn: partial.projectedCarriedIn ?? carriedIn,
    projected: partial.projected ?? remaining,
  };
}

/** The shape assertions read better as a list of "token at width" pairs. */
function widths(segments: MeterSegment[]): [string, number][] {
  return segments.map((s) => [s.token, Number(s.percent.toFixed(4))]);
}

test("a post with no activity is an empty track", () => {
  expect(widths(carryMeterSegments(figures({})))).toEqual([["--budget-rule", 100]]);
});

test("an untouched allocation is all unspent track", () => {
  expect(widths(carryMeterSegments(figures({ allocation: 600 })))).toEqual([
    ["--budget-rule", 100],
  ]);
});

test("spending half the allocation fills half the track", () => {
  expect(widths(carryMeterSegments(figures({ allocation: 600, charges: 300 })))).toEqual([
    ["--budget-accent", 50],
    ["--budget-rule", 50],
  ]);
});

test("a carried-in surplus takes its share of the track before the allocation", () => {
  // 1000 carried in + 1000 allocated, half of the allocation spent: the
  // surplus is half the scale, the spend a quarter, the remainder a quarter.
  const segments = carryMeterSegments(
    figures({ carriedIn: 1000, allocation: 1000, charges: 500 }),
  );
  expect(widths(segments)).toEqual([
    ["--surplus", 50],
    ["--budget-accent", 25],
    ["--budget-rule", 25],
  ]);
});

test("overspending paints past the end of the allocation and leaves no unspent track", () => {
  // Allocation 1000, spend 1500: the scale is the spend, so the allocation is
  // the first two thirds and the overspend the last third.
  const segments = carryMeterSegments(figures({ allocation: 1000, charges: 1500 }));
  expect(widths(segments)).toEqual([
    ["--budget-accent", 66.6667],
    ["--overspend", 33.3333],
  ]);
});

test("a negative carried-in balance contributes no surplus segment", () => {
  // Transport in the demo data: behind by 1600, allocated 1100, spent 2700.
  // The debt is not on the meter — only the red Carried-in figure says why the
  // post is behind. Documented behaviour, asserted so it cannot drift.
  const segments = carryMeterSegments(
    figures({ carriedIn: -1600, allocation: 1100, charges: 2700 }),
  );
  expect(segments.some((s) => s.token === "--surplus")).toBe(false);
  expect(widths(segments)).toEqual([
    ["--budget-accent", 40.7407],
    ["--overspend", 59.2593],
  ]);
});

test("a net refund clamps to an empty spend rather than a negative width", () => {
  // Refunds are a normal line, so charges can come out below zero.
  const segments = carryMeterSegments(figures({ allocation: 500, charges: -200 }));
  expect(widths(segments)).toEqual([["--budget-rule", 100]]);
});

test("a negative allocation is an empty track, not an inverted one", () => {
  const segments = carryMeterSegments(figures({ allocation: -500 }));
  expect(widths(segments)).toEqual([["--budget-rule", 100]]);
});

test("allocating under income leaves unallocated track", () => {
  expect(widths(allocationMeterSegments(28000, 21000))).toEqual([
    ["--budget-accent", 75],
    ["--budget-rule", 25],
  ]);
});

test("allocating past income overflows instead of capping at a full bar", () => {
  // Over-budget is always allowed, so this is an ordinary state and the meter
  // has to be able to draw it. Income 1000, allocated 2000: half the track is
  // the income, half is the overflow.
  expect(widths(allocationMeterSegments(1000, 2000))).toEqual([
    ["--budget-accent", 50],
    ["--overspend", 50],
  ]);
});

test("allocating against no income is entirely overflow", () => {
  expect(widths(allocationMeterSegments(0, 2000))).toEqual([["--overspend", 100]]);
});

test("no income and no allocation is an empty track", () => {
  expect(widths(allocationMeterSegments(0, 0))).toEqual([["--budget-rule", 100]]);
});

test("a negative income is treated as none", () => {
  expect(widths(allocationMeterSegments(-500, 100))).toEqual([["--overspend", 100]]);
});

/**
 * The two properties that must hold for every input, because a segment list
 * that breaks either produces a gradient with stops out of order — which
 * paints something arbitrary rather than failing.
 */
test("every segment list is non-negative and sums to exactly 100", () => {
  const cases: PostMonthFigures[] = [
    figures({}),
    figures({ allocation: 1 }),
    figures({ charges: 1 }),
    figures({ carriedIn: -1, charges: 1 }),
    figures({ carriedIn: 0.005, allocation: 0.01, charges: 0.005 }),
    figures({ carriedIn: 1e6, allocation: 1, charges: 1e7 }),
    figures({ carriedIn: -1e6, allocation: -1, charges: -1 }),
    figures({ allocation: 8200, charges: 8200 }),
  ];

  for (const f of cases) {
    const segments = carryMeterSegments(f);
    const total = segments.reduce((sum, s) => sum + s.percent, 0);
    expect(segments.every((s) => s.percent > 0)).toBe(true);
    expect(total).toBeCloseTo(100, 8);
  }

  for (const [income, allocated] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, -1],
    [28000, 19300],
    [1, 1e9],
  ] as const) {
    const segments = allocationMeterSegments(income, allocated);
    const total = segments.reduce((sum, s) => sum + s.percent, 0);
    expect(segments.every((s) => s.percent > 0)).toBe(true);
    expect(total).toBeCloseTo(100, 8);
  }
});

test("the gradient hard-stops each segment and ends at 100%", () => {
  const css = gradientFor([
    { token: "--surplus", percent: 25 },
    { token: "--budget-accent", percent: 75 },
  ]);
  expect(css).toBe(
    "linear-gradient(to right, " +
      "var(--surplus) 0%, var(--surplus) 25%, " +
      "var(--budget-accent) 25%, var(--budget-accent) 100%)",
  );
});

test("gradient stops never run backwards, whatever the segment widths", () => {
  const css = gradientFor(carryMeterSegments(figures({ carriedIn: 1, allocation: 3, charges: 7 })));
  const stops = [...css.matchAll(/ ([\d.]+)%/g)].map((m) => Number(m[1]));
  const sorted = [...stops].sort((a, b) => a - b);
  expect(stops).toEqual(sorted);
  expect(stops.at(-1)).toBe(100);
});

test("the allocated percentage is null when there is no income to be a share of", () => {
  expect(allocatedPercentOfIncome(0, 500)).toBeNull();
  expect(allocatedPercentOfIncome(-1, 500)).toBeNull();
});

test("the allocated percentage rounds to whole percent and can exceed 100", () => {
  expect(allocatedPercentOfIncome(28000, 19300)).toBe(69);
  expect(allocatedPercentOfIncome(1000, 2000)).toBe(200);
  expect(allocatedPercentOfIncome(1000, 0)).toBe(0);
});
