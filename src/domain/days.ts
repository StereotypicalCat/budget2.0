import type { IsoDate } from "./types.ts";

/**
 * Day-level arithmetic, in the same character as `months.ts`: integer maths on
 * a day ordinal, never a `Date`.
 *
 * `months.ts` avoids `Date` to avoid timezones, and the reasoning applies here
 * with more force. "2026-03-29" names the same day everywhere; the instant a
 * `Date` would give it does not, and a recurrence that steps 28 days must not
 * gain or lose one at a DST boundary or in a different host timezone.
 *
 * Only the day-granular recurrences need this. `everyNMonths` stays on
 * `months.ts`, because rent occurs IN a month rather than on a date.
 */

const DAY_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Days since 1970-01-01, by Howard Hinnant's `days_from_civil`. Proleptic
 * Gregorian, exact for every date this app can hold, and pure integer maths.
 *
 * The algorithm shifts the year to start in March so that the leap day is the
 * LAST day of the year rather than an insertion in the middle, which is what
 * removes every special case from the day-of-year term.
 */
export function toDayOrdinal(date: IsoDate): number {
  const match = DAY_DATE.exec(date);
  if (!match) {
    throw new Error(`Not a day-granular IsoDate: ${date}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in IsoDate: ${date}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid day in IsoDate: ${date}`);
  }

  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The exact inverse of `toDayOrdinal` (Hinnant's `civil_from_days`). */
export function fromDayOrdinal(ordinal: number): IsoDate {
  const z = ordinal + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth + (shiftedMonth < 10 ? 3 : -9);
  const calendarYear = month <= 2 ? year + 1 : year;

  return `${String(calendarYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: IsoDate, count: number): IsoDate {
  return fromDayOrdinal(toDayOrdinal(date) + count);
}

/** 0 = Sunday. Day 0 of the ordinal was a Thursday, hence the + 4. */
export function weekdayOf(date: IsoDate): number {
  const shifted = (toDayOrdinal(date) + 4) % 7;
  return shifted < 0 ? shifted + 7 : shifted;
}
