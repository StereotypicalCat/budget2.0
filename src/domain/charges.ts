import { toBase } from "./fx.ts";
import { distributeByAmount, distributeByWeight, roundMoney } from "./money.ts";
import { compareMonths, monthOf } from "./months.ts";
import type { Occurrence } from "./occurrences.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Money,
  MonthId,
  PostId,
  Purchase,
  Split,
} from "./types.ts";

export interface Charge {
  postId: PostId;
  /** Base currency. */
  amount: number;
}

/**
 * Exactly one split absorbs the remainder, which is what makes the parts sum
 * exactly to the total. `label` names the owning record so the message is
 * actionable — this is reachable from a hand-edited import.
 */
export function remainderIndexIn(splits: readonly Split[], label: string): number {
  const index = splits.findIndex((s) => s.absorbsRemainder);
  if (index === -1) {
    throw new Error(`${label} has no split flagged absorbsRemainder`);
  }
  return index;
}

export function remainderIndexOf(purchase: Purchase): number {
  return remainderIndexIn(purchase.splits, `Purchase ${purchase.id}`);
}

/**
 * How an amount divides across splits, in the currency the amount is in.
 * Parts sum exactly to the total.
 */
export function splitParts(
  total: number,
  splits: readonly Split[],
  splitMode: "percent" | "fixed",
  remainderIndex: number,
  digits: number,
): number[] {
  const values = splits.map((s) => s.value);
  return splitMode === "percent"
    ? distributeByWeight(total, values, remainderIndex, digits)
    : distributeByAmount(total, values, remainderIndex, digits);
}

/**
 * How the whole purchase divides across its posts, in the purchase's own
 * currency. Parts sum exactly to the total.
 */
export function splitPartsOfTotal(purchase: Purchase, digits: number): number[] {
  return splitParts(
    purchase.total.amount,
    purchase.splits,
    purchase.splitMode,
    remainderIndexOf(purchase),
    digits,
  );
}

/**
 * Converts `amount` to base and distributes it across `splits` in the
 * proportions `weights` describes.
 *
 * Shared by real charges and expected ones deliberately. Two implementations
 * could round differently or absorb the remainder differently, and the gap
 * would surface as a penny of phantom drift between the fold's two tracks —
 * a difference with no cause the owner could ever find.
 */
export function distributeToSplits(
  amount: Money,
  splits: readonly Split[],
  weights: number[],
  remainderIndex: number,
  baseCurrency: Currency,
  rates: FxRate[],
  digits: number,
): Charge[] {
  const base = toBase(amount, baseCurrency, rates, digits);
  const parts = distributeByWeight(base, weights, remainderIndex, digits);
  return splits.map((split, i) => ({ postId: split.postId, amount: parts[i]! }));
}

/**
 * The amount charged in `monthId`, in the purchase's currency, or null if the
 * purchase does not touch that month.
 */
export function sliceAmountForMonth(
  purchase: Purchase,
  monthId: MonthId,
): Money | null {
  if (!purchase.schedule) {
    return monthOf(purchase.date) === monthId ? purchase.total : null;
  }
  const { slices, cancelledFromMonth } = purchase.schedule;
  if (cancelledFromMonth && compareMonths(monthId, cancelledFromMonth) >= 0) {
    return null;
  }
  const slice = slices.find((s) => s.month === monthId);
  return slice ? slice.amount : null;
}

/**
 * Distributes this month's slice across the purchase's posts, in base currency.
 *
 * Weights are the whole-purchase split parts, so a financed purchase divides
 * each slice in the same proportion as the purchase as a whole — which is what
 * makes splits and finance plans compose without a special case.
 */
export function chargesForPurchaseInMonth(
  purchase: Purchase,
  monthId: MonthId,
  baseCurrency: Currency,
  rates: FxRate[],
  digits: number,
): Charge[] {
  const slice = sliceAmountForMonth(purchase, monthId);
  if (!slice) return [];

  // Split proportions come from the WHOLE purchase, so a financed purchase
  // divides each slice in the same ratio as the purchase as a whole — which is
  // what makes splits and finance plans compose without a special case.
  return distributeToSplits(
    slice,
    purchase.splits,
    splitPartsOfTotal(purchase, digits),
    remainderIndexOf(purchase),
    baseCurrency,
    rates,
    digits,
  );
}

/** Total charged per post in `monthId`, in base currency. */
export function chargesForMonth(
  dataset: Dataset,
  monthId: MonthId,
): Map<PostId, number> {
  const totals = new Map<PostId, number>();
  const baseDigits = dataset.settings.digits;
  for (const purchase of dataset.purchases) {
    const charges = chargesForPurchaseInMonth(
      purchase,
      monthId,
      dataset.settings.baseCurrency,
      dataset.fxRates,
      dataset.settings.digits,
    );
    for (const charge of charges) {
      const previous = totals.get(charge.postId) ?? 0;
      totals.set(
        charge.postId,
        roundMoney(previous + charge.amount, baseDigits),
      );
    }
  }
  return totals;
}

/**
 * Total EXPECTED per post in one month, in base currency.
 *
 * The mirror of `chargesForMonth` for money that has not moved yet. Confirmed
 * occurrences are skipped: they are ordinary purchases and `chargesForMonth`
 * has already counted them. Counting both would double every settled bill.
 *
 * Takes the month's occurrences rather than a MonthId because the fold
 * computes them all in one walk — see `occurrencesByMonth`.
 */
export function expectedForMonth(
  dataset: Dataset,
  occurrences: readonly Occurrence[],
): Map<PostId, number> {
  const totals = new Map<PostId, number>();
  const digits = dataset.settings.digits;
  const byId = new Map(dataset.recurring.map((cost) => [cost.id, cost]));

  for (const occurrence of occurrences) {
    if (occurrence.confirmedBy) continue;
    const cost = byId.get(occurrence.recurringId);
    if (!cost) continue;

    const index = remainderIndexIn(cost.splits, `Recurring cost "${cost.name}"`);
    const weights = splitParts(
      cost.amount.amount,
      cost.splits,
      cost.splitMode,
      index,
      digits,
    );
    const charges = distributeToSplits(
      occurrence.amount,
      cost.splits,
      weights,
      index,
      dataset.settings.baseCurrency,
      dataset.fxRates,
      digits,
    );

    for (const charge of charges) {
      const previous = totals.get(charge.postId) ?? 0;
      totals.set(charge.postId, roundMoney(previous + charge.amount, digits));
    }
  }

  return totals;
}
