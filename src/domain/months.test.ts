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

describe("month range validation", () => {
  test("yearOf rejects out-of-range month 13", () => {
    expect(() => yearOf("2026-13")).toThrow(/2026-13/);
  });

  test("yearOf rejects out-of-range month 00", () => {
    expect(() => yearOf("2026-00")).toThrow(/2026-00/);
  });

  test("monthOf rejects out-of-range month 13 from IsoDate", () => {
    expect(() => monthOf("2026-13-01")).toThrow(/2026-13-01/);
  });

  test("monthOf rejects out-of-range month 00 from IsoDate", () => {
    expect(() => monthOf("2026-00-15")).toThrow(/2026-00-15/);
  });

  test("valid boundary month 01 works", () => {
    expect(yearOf("2026-01")).toBe(2026);
    expect(monthOf("2026-01-01")).toBe("2026-01");
  });

  test("valid boundary month 12 works", () => {
    expect(yearOf("2026-12")).toBe(2026);
    expect(monthOf("2026-12-31")).toBe("2026-12");
  });
});

// The optional-day feature stores "YYYY-MM" when a purchase has no specific
// day. monthOf already handled that incidentally; this pins it, because the
// whole approach depends on it rather than on a migration.
test("monthOf accepts a month-only date as well as a full one", () => {
  expect(monthOf("2026-09-14")).toBe("2026-09");
  expect(monthOf("2026-09")).toBe("2026-09");
});

test("monthOf still rejects out-of-range and malformed month-only values", () => {
  expect(() => monthOf("2026-13")).toThrow(/2026-13/);
  expect(() => monthOf("2026-00")).toThrow(/2026-00/);
  expect(() => monthOf("2026-9")).toThrow(/2026-9/);
});

// Residual C1: the regex used to be `/^(\d{4})-(\d{2})/` with no trailing
// anchor, so it matched a "YYYY-MM" PREFIX of a longer string and silently
// dropped the rest — "2026-091" read back as September 2026. Such a value
// would then be un-re-importable, since PURCHASE_DATE (src/export/json.ts)
// rejects it outright.
test("monthOf rejects a value that is only a prefix match, not a full one", () => {
  expect(() => monthOf("2026-091")).toThrow(/2026-091/);
});
