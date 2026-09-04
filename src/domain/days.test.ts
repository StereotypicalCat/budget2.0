import { describe, expect, test } from "bun:test";
import { addDays, fromDayOrdinal, toDayOrdinal, weekdayOf } from "./days.ts";

describe("day ordinals", () => {
  test("the epoch is day zero", () => {
    expect(toDayOrdinal("1970-01-01")).toBe(0);
  });

  test("known dates convert to known ordinals", () => {
    expect(toDayOrdinal("1969-12-31")).toBe(-1);
    expect(toDayOrdinal("2000-03-01")).toBe(11017);
    expect(toDayOrdinal("2026-09-03")).toBe(20699);
  });

  test("every date in a four-year window round-trips", () => {
    // 2024 is a leap year, 2025 and 2026 are not, so this covers both.
    for (let ordinal = toDayOrdinal("2024-01-01"); ordinal <= toDayOrdinal("2027-12-31"); ordinal++) {
      expect(toDayOrdinal(fromDayOrdinal(ordinal))).toBe(ordinal);
    }
  });

  test("leap day exists in 2024 and not in 2026", () => {
    expect(fromDayOrdinal(toDayOrdinal("2024-02-28") + 1)).toBe("2024-02-29");
    expect(fromDayOrdinal(toDayOrdinal("2026-02-28") + 1)).toBe("2026-03-01");
  });

  test("century rules: 1900 is not a leap year, 2000 is", () => {
    expect(fromDayOrdinal(toDayOrdinal("1900-02-28") + 1)).toBe("1900-03-01");
    expect(fromDayOrdinal(toDayOrdinal("2000-02-28") + 1)).toBe("2000-02-29");
  });

  test("a month-only date is rejected, not silently treated as the first", () => {
    expect(() => toDayOrdinal("2026-09")).toThrow(/day-granular/);
  });

  test("an impossible day is rejected", () => {
    expect(() => toDayOrdinal("2026-02-30")).toThrow();
    expect(() => toDayOrdinal("2026-13-01")).toThrow();
  });
});

describe("addDays", () => {
  test("crosses a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  test("crosses a year boundary", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
  });

  test("a 28-day cycle lands on the same weekday every time", () => {
    let date = "2026-01-05";
    const weekday = weekdayOf(date);
    for (let i = 0; i < 13; i++) {
      date = addDays(date, 28);
      expect(weekdayOf(date)).toBe(weekday);
    }
  });

  test("a 30-day cycle drifts through the calendar", () => {
    // The phone bill's shape: 30 days is not a month, so it walks backwards
    // through the month over a year.
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });
});

describe("weekdayOf", () => {
  test("the epoch was a Thursday", () => {
    expect(weekdayOf("1970-01-01")).toBe(4);
  });

  test("known weekdays", () => {
    expect(weekdayOf("2026-09-03")).toBe(4); // Thursday
    expect(weekdayOf("2026-09-06")).toBe(0); // Sunday
    expect(weekdayOf("2026-09-07")).toBe(1); // Monday
  });

  test("seven consecutive days cover every weekday exactly once", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 7; i++) seen.add(weekdayOf(addDays("2026-09-03", i)));
    expect(seen.size).toBe(7);
  });
});
