import { describe, expect, test } from "bun:test";
import { isValidStartDate, normalizedStartDateFor } from "./RecurringSection.tsx";

// C2: the "Starts" field must never be able to persist an empty or
// malformed value — `isValidStartDate` is the guard the onBlur handler uses
// to decide whether to call `mutate` at all.
describe("isValidStartDate", () => {
  test("an empty string is never valid, for any kind", () => {
    expect(isValidStartDate("", "everyNMonths")).toBe(false);
    expect(isValidStartDate("", "everyNDays")).toBe(false);
    expect(isValidStartDate("", "everyNWeeks")).toBe(false);
  });

  test("everyNMonths accepts either granularity", () => {
    expect(isValidStartDate("2026-09", "everyNMonths")).toBe(true);
    expect(isValidStartDate("2026-09-17", "everyNMonths")).toBe(true);
  });

  test("everyNMonths still rejects garbage", () => {
    expect(isValidStartDate("not-a-date", "everyNMonths")).toBe(false);
    expect(isValidStartDate("2026-13", "everyNMonths")).toBe(false);
  });

  test("a day-granular kind rejects a month-only value", () => {
    // This is the exact C1/C2 crash: monthOf() would happily hand this back,
    // but occurrencesOf hands it to addDays, which throws.
    expect(isValidStartDate("2026-09", "everyNDays")).toBe(false);
    expect(isValidStartDate("2026-09", "everyNWeeks")).toBe(false);
  });

  test("a day-granular kind accepts a day-granular value", () => {
    expect(isValidStartDate("2026-09-17", "everyNDays")).toBe(true);
    expect(isValidStartDate("2026-09-17", "everyNWeeks")).toBe(true);
  });

  test("a day-granular kind rejects a malformed day-granular-shaped value", () => {
    expect(isValidStartDate("2026-02-30", "everyNDays")).toBe(false); // no Feb 30
  });

  // Residual C1: `monthOf` only extracts the month and never checks the day,
  // so a day-SHAPED but calendar-impossible value ("2026-09-31" — September
  // has 30 days) used to pass here even under everyNMonths, and could then be
  // stored, only for foldBalances to throw three months later.
  test("everyNMonths still rejects a day-granular value with an impossible day", () => {
    expect(isValidStartDate("2026-09-31", "everyNMonths")).toBe(false);
  });

  test("everyNMonths accepts a real leap-day and rejects a non-leap Feb 29", () => {
    expect(isValidStartDate("2024-02-29", "everyNMonths")).toBe(true); // 2024 is a leap year
    expect(isValidStartDate("2026-02-29", "everyNMonths")).toBe(false); // 2026 is not
    expect(isValidStartDate("2026-02-28", "everyNMonths")).toBe(true);
  });
});

// C1: switching the unit dropdown to a day-granular kind must expand a
// month-only startDate in the same mutate call, never leaving the pairing
// unvalidated for even one render.
describe("normalizedStartDateFor", () => {
  test("expands a month-only date when switching to a day-granular kind", () => {
    expect(normalizedStartDateFor("everyNDays", "2026-09")).toBe("2026-09-01");
    expect(normalizedStartDateFor("everyNWeeks", "2026-09")).toBe("2026-09-01");
  });

  test("leaves an already day-granular date untouched", () => {
    expect(normalizedStartDateFor("everyNDays", "2026-09-17")).toBe("2026-09-17");
  });

  test("leaves the date untouched when switching to everyNMonths", () => {
    expect(normalizedStartDateFor("everyNMonths", "2026-09")).toBe("2026-09");
    expect(normalizedStartDateFor("everyNMonths", "2026-09-17")).toBe("2026-09-17");
  });
});
