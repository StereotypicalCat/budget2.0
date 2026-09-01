// src/domain/months.test.ts
import { test, expect, describe } from "bun:test";
import {
  monthOf,
  nextMonth,
  prevMonth,
  compareMonths,
  monthRange,
  monthsOfYear,
  addMonths,
  yearOf,
} from "./months.ts";

test("monthOf extracts the month from an ISO date", () => {
  expect(monthOf("2026-09-14")).toBe("2026-09");
});

describe("month stepping", () => {
  test("nextMonth crosses the year boundary", () => {
    expect(nextMonth("2026-11")).toBe("2026-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  test("prevMonth crosses the year boundary", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
  });

  test("addMonths handles multi-year spans in both directions", () => {
    expect(addMonths("2026-09", 6)).toBe("2027-03");
    expect(addMonths("2026-09", -12)).toBe("2025-09");
    expect(addMonths("2026-09", 0)).toBe("2026-09");
  });
});

test("compareMonths orders chronologically", () => {
  expect(compareMonths("2026-01", "2026-02")).toBeLessThan(0);
  expect(compareMonths("2027-01", "2026-12")).toBeGreaterThan(0);
  expect(compareMonths("2026-05", "2026-05")).toBe(0);
});

describe("monthRange", () => {
  test("is inclusive of both ends", () => {
    expect(monthRange("2026-11", "2027-01")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  test("returns a single month when both ends match", () => {
    expect(monthRange("2026-03", "2026-03")).toEqual(["2026-03"]);
  });

  test("returns empty when `to` precedes `from`", () => {
    expect(monthRange("2026-05", "2026-04")).toEqual([]);
  });
});

test("monthsOfYear returns twelve padded months", () => {
  const months = monthsOfYear(2026);
  expect(months).toHaveLength(12);
  expect(months[0]).toBe("2026-01");
  expect(months[11]).toBe("2026-12");
});

test("yearOf parses the year", () => {
  expect(yearOf("2026-09")).toBe(2026);
});
