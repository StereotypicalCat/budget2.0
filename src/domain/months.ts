import type { IsoDate, MonthId } from "./types.ts";

function parse(id: MonthId): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(id);
  if (!match) throw new Error(`Invalid MonthId: ${id}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function format(year: number, month: number): MonthId {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Months since year 0. Avoids Date and therefore avoids timezones entirely. */
function toOrdinal(id: MonthId): number {
  const { year, month } = parse(id);
  return year * 12 + (month - 1);
}

function fromOrdinal(ordinal: number): MonthId {
  return format(Math.floor(ordinal / 12), (ordinal % 12) + 1);
}

export function monthOf(date: IsoDate): MonthId {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) throw new Error(`Invalid IsoDate: ${date}`);
  return `${match[1]}-${match[2]}`;
}

export function yearOf(id: MonthId): number {
  return parse(id).year;
}

export function addMonths(id: MonthId, count: number): MonthId {
  return fromOrdinal(toOrdinal(id) + count);
}

export function nextMonth(id: MonthId): MonthId {
  return addMonths(id, 1);
}

export function prevMonth(id: MonthId): MonthId {
  return addMonths(id, -1);
}

export function compareMonths(a: MonthId, b: MonthId): number {
  return toOrdinal(a) - toOrdinal(b);
}

export function monthRange(from: MonthId, to: MonthId): MonthId[] {
  const start = toOrdinal(from);
  const end = toOrdinal(to);
  const out: MonthId[] = [];
  for (let i = start; i <= end; i++) out.push(fromOrdinal(i));
  return out;
}

export function monthsOfYear(year: number): MonthId[] {
  return monthRange(format(year, 1), format(year, 12));
}
