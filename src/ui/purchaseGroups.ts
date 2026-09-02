import type { MonthId, Purchase } from "../domain/types.ts";

export interface PurchaseGroup {
  /** An ISO date, or the sentinel "carried" / "undated". */
  key: string;
  /** "Sat 12 September", or a sentence for the two sentinel groups. */
  label: string;
  purchases: Purchase[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Sorted last, in this order, after every dated group:
 *   - `carried`: a finance plan's later slices. The row belongs in this month
 *     because money moves this month, but its own date does not, so filing it
 *     under that date would put "14 August" inside the September list.
 *   - `undated`: a purchase date may legally be "YYYY-MM" with no day.
 */
const CARRIED = "carried";
const UNDATED = "undated";

/**
 * Weekday without a timezone. `new Date("2026-09-01")` is UTC midnight, so
 * `getDay()` anywhere west of Greenwich reports the previous day and every
 * heading would be off by one. Building the date in UTC and reading it back in
 * UTC is the whole fix.
 */
function weekday(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${weekday(year, month, day)} ${day} ${MONTHS[month - 1]}`;
}

/**
 * Groups a month's purchase rows under date headings, most recent day first.
 * Order within a day is preserved, so a row just entered stays where it was
 * put rather than jumping.
 *
 * Takes the rows already filtered for the month — deciding WHICH purchases
 * touch a month is `sliceAmountForMonth`'s job, and this must not second-guess
 * it.
 */
export function groupPurchasesByDate(
  purchases: Purchase[],
  monthId: MonthId,
): PurchaseGroup[] {
  const byKey = new Map<string, Purchase[]>();

  for (const purchase of purchases) {
    const hasDay = /^\d{4}-\d{2}-\d{2}$/.test(purchase.date);
    const key = !purchase.date.startsWith(monthId)
      ? CARRIED
      : hasDay
        ? purchase.date
        : UNDATED;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(purchase);
    else byKey.set(key, [purchase]);
  }

  const dated = [...byKey.keys()]
    .filter((key) => key !== CARRIED && key !== UNDATED)
    .sort()
    .reverse();

  const order = [
    ...dated,
    ...(byKey.has(UNDATED) ? [UNDATED] : []),
    ...(byKey.has(CARRIED) ? [CARRIED] : []),
  ];

  return order.map((key) => ({
    key,
    label:
      key === CARRIED
        ? "Financed from earlier months"
        : key === UNDATED
          ? "No day recorded"
          : dayLabel(key),
    purchases: byKey.get(key)!,
  }));
}
