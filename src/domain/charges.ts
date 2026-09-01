import { toBase } from "./fx.ts";
import { distributeByAmount, distributeByWeight, roundMoney } from "./money.ts";
import { compareMonths, monthOf } from "./months.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Money,
  MonthId,
  PostId,
  Purchase,
} from "./types.ts";

export interface Charge {
  postId: PostId;
  /** Base currency. */
  amount: number;
}

export function remainderIndexOf(purchase: Purchase): number {
  const index = purchase.splits.findIndex((s) => s.absorbsRemainder);
  if (index === -1) {
    throw new Error(
      `Purchase ${purchase.id} has no split flagged absorbsRemainder`,
    );
  }
  return index;
}

/**
 * How the whole purchase divides across its posts, in the purchase's own
 * currency. Parts sum exactly to the total.
 */
export function splitPartsOfTotal(purchase: Purchase): number[] {
  const index = remainderIndexOf(purchase);
  const values = purchase.splits.map((s) => s.value);
  const total = purchase.total.amount;
  const currency = purchase.total.currency;
  return purchase.splitMode === "percent"
    ? distributeByWeight(total, values, index, currency)
    : distributeByAmount(total, values, index, currency);
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
): Charge[] {
  const slice = sliceAmountForMonth(purchase, monthId);
  if (!slice) return [];

  const sliceBase = toBase(slice, baseCurrency, rates);
  const index = remainderIndexOf(purchase);
  const weights = splitPartsOfTotal(purchase);
  const parts = distributeByWeight(sliceBase, weights, index, baseCurrency);

  return purchase.splits.map((split, i) => ({
    postId: split.postId,
    amount: parts[i]!,
  }));
}

/** Total charged per post in `monthId`, in base currency. */
export function chargesForMonth(
  dataset: Dataset,
  monthId: MonthId,
): Map<PostId, number> {
  const totals = new Map<PostId, number>();
  for (const purchase of dataset.purchases) {
    const charges = chargesForPurchaseInMonth(
      purchase,
      monthId,
      dataset.settings.baseCurrency,
      dataset.fxRates,
    );
    for (const charge of charges) {
      const previous = totals.get(charge.postId) ?? 0;
      totals.set(
        charge.postId,
        roundMoney(previous + charge.amount, dataset.settings.baseCurrency),
      );
    }
  }
  return totals;
}
