import { addDays, weekdayOf } from "./days.ts";
import { addMonths, compareMonths, monthOf } from "./months.ts";
import type {
  Dataset,
  IsoDate,
  Money,
  MonthId,
  Purchase,
  PurchaseId,
  Recurrence,
  RecurringCost,
  RecurringCostId,
} from "./types.ts";

/**
 * One projected charge of one recurring cost.
 *
 * Occurrences are COMPUTED on every fold and never stored. The dataset holds
 * the rule and the confirmations; everything here is derived from those two.
 */
export interface Occurrence {
  recurringId: RecurringCostId;
  /**
   * The slot this walk generated. IDENTITY: a confirmation claims a slot by
   * this date, which is not necessarily the date it was paid.
   */
  date: IsoDate;
  /** Expected amount, in the cost's own currency. */
  amount: Money;
  /** The purchase that confirmed this slot, or null while it is still expected. */
  confirmedBy: PurchaseId | null;
}

/**
 * ISO dates compare correctly as strings, and mixed granularity falls out
 * right: "2026-09" < "2026-09-17" < "2026-10", so a month-only date reads as
 * the start of that month. That is exactly what `endedFrom` needs when a
 * monthly cost is cancelled.
 */
function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}

/** Moves forward to the next occurrence of `weekday`, or stays put if already on it. */
function snapForward(date: IsoDate, weekday: number): IsoDate {
  const delta = (weekday - weekdayOf(date) + 7) % 7;
  return delta === 0 ? date : addDays(date, delta);
}

/**
 * Where the next occurrence falls, given the one before it.
 *
 * Adding a recurrence kind means adding a case here and a variant to
 * `Recurrence`. Nothing else in the app switches on the kind.
 */
export function stepFrom(date: IsoDate, recurrence: Recurrence): IsoDate {
  switch (recurrence.kind) {
    case "everyNMonths":
      // Month-granular in, month-granular out. `monthOf` also accepts a
      // day-granular date, which is what a lastCharge rebase supplies.
      return addMonths(monthOf(date), recurrence.n);
    case "everyNDays":
      return addDays(date, recurrence.n);
    case "everyNWeeks":
      return snapForward(addDays(date, 7 * recurrence.n), recurrence.weekday);
  }
}

/**
 * The purchases confirming one cost, keyed by the slot each one claims.
 *
 * Keyed by `source.occurrenceDate` rather than by `Purchase.date`, because the
 * slot is what a confirmation claims. The two differ whenever a bill is paid
 * off schedule.
 */
export function confirmationsFor(
  purchases: readonly Purchase[],
  recurringId: RecurringCostId,
): Map<IsoDate, Purchase> {
  const found = new Map<IsoDate, Purchase>();
  for (const purchase of purchases) {
    if (purchase.source?.recurringId === recurringId) {
      found.set(purchase.source.occurrenceDate, purchase);
    }
  }
  return found;
}

/**
 * Every occurrence of one cost from its start through `upToMonth`, in order.
 *
 * A walk rather than a per-month query, because under `lastCharge` anchoring
 * where the series sits in a given month depends on every confirmation before
 * it. The walk always begins at `startDate` even when that precedes the fold
 * start, because the phase depends on the whole history; callers read only the
 * months they need. The cost is trivial — thirty-five years of a 28-day cycle
 * is about thirteen thousand integer additions.
 *
 * `upToMonth` comes from the caller. This module reads no clock, which is what
 * keeps `src/domain/` pure.
 */
export function occurrencesOf(
  cost: RecurringCost,
  confirmations: ReadonlyMap<IsoDate, Purchase>,
  upToMonth: MonthId,
): Occurrence[] {
  const found: Occurrence[] = [];

  // A monthly cost is month-granular throughout, even if its start date was
  // typed with a day. Rent occurs IN a month.
  let cursor =
    cost.recurrence.kind === "everyNMonths" ? monthOf(cost.startDate) : cost.startDate;

  while (compareMonths(monthOf(cursor), upToMonth) <= 0) {
    if (cost.endedFrom && !isBefore(cursor, cost.endedFrom)) break;

    const confirmation = confirmations.get(cursor) ?? null;
    found.push({
      recurringId: cost.id,
      date: cursor,
      amount: cost.amount,
      confirmedBy: confirmation?.id ?? null,
    });

    // `lastCharge` measures from when the money ACTUALLY moved, which is what
    // makes an early charge rebase the series. An unconfirmed occurrence steps
    // from its own projected date: the projection assumes bills are paid on
    // time, and self-corrects as they are confirmed.
    const from =
      cost.anchoring === "lastCharge" && confirmation ? confirmation.date : cursor;
    const next = stepFrom(from, cost.recurrence);

    // The loop terminates only if the step strictly increases. `n >= 1` is
    // enforced at both write boundaries, so reaching this is a bug rather than
    // bad input — and a hang is the one failure mode worse than a visible
    // error. Never soften this into a break: silently dropping a bill would
    // put a wrong number on the screen, which AGENTS.md forbids outright.
    if (!isBefore(cursor, next)) {
      // Two causes, and the message names both because they need different
      // fixes. With a valid `n >= 1` a CALENDAR series can never reach this:
      // every kind adds at least one day. Only `lastCharge` can, and only when
      // a confirmation is dated more than one step before the slot it claims.
      throw new Error(
        `Recurring cost "${cost.name}" did not advance past ${cursor} (produced ${next}). ` +
          (confirmation
            ? `Purchase ${confirmation.id} claims that slot but is dated ${confirmation.date}, ` +
              `more than one step earlier — correct its date to move the series forward.`
            : `A recurrence must move strictly forward; check that n is at least 1.`),
      );
    }
    cursor = next;
  }

  return found;
}

/**
 * Every cost's occurrences through `upToMonth`, grouped by the month they land
 * in. The fold calls this once and reads a month at a time.
 */
export function occurrencesByMonth(
  dataset: Dataset,
  upToMonth: MonthId,
): Map<MonthId, Occurrence[]> {
  const byMonth = new Map<MonthId, Occurrence[]>();

  for (const cost of dataset.recurring) {
    const confirmations = confirmationsFor(dataset.purchases, cost.id);
    for (const occurrence of occurrencesOf(cost, confirmations, upToMonth)) {
      const month = monthOf(occurrence.date);
      const existing = byMonth.get(month);
      if (existing) existing.push(occurrence);
      else byMonth.set(month, [occurrence]);
    }
  }

  return byMonth;
}
