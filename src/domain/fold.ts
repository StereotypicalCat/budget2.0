import { allocationFor } from "./allocation.ts";
import { digitsFor } from "./currencies.ts";
import { chargesForMonth } from "./charges.ts";
import { roundMoney } from "./money.ts";
import { compareMonths, monthRange } from "./months.ts";
import type { Dataset, MonthId, PostId } from "./types.ts";

export interface PostMonthFigures {
  carriedIn: number;
  allocation: number;
  charges: number;
  /** carriedIn + allocation - charges. Negative means overspent. */
  remaining: number;
}

/**
 * Frozen because `figuresFor` hands this back by shared reference for every
 * (post, month) the fold has no entry for. Unfrozen, one consumer mutating
 * its result would move every other unknown row with it.
 */
export const EMPTY_FIGURES: PostMonthFigures = Object.freeze({
  carriedIn: 0,
  allocation: 0,
  charges: 0,
  remaining: 0,
});

export type Fold = Map<MonthId, Map<PostId, PostMonthFigures>>;

/**
 * The single implementation of envelope rollover. Year and summary views
 * aggregate over this — they never recompute the math.
 *
 * Unspent allocation carries into the next month; overspend carries forward as
 * a negative balance. Archived posts are included, since their history still
 * has to fold.
 */
export function foldBalances(dataset: Dataset, upToMonth: MonthId): Fold {
  const { foldStartMonth, baseCurrency } = dataset.settings;
  const baseDigits = digitsFor(dataset.currencies, baseCurrency);
  const fold: Fold = new Map();

  if (compareMonths(upToMonth, foldStartMonth) < 0) return fold;

  const carried = new Map<PostId, number>();

  for (const monthId of monthRange(foldStartMonth, upToMonth)) {
    const charges = chargesForMonth(dataset, monthId);
    const monthFigures = new Map<PostId, PostMonthFigures>();

    for (const post of dataset.posts) {
      const carriedIn = carried.get(post.id) ?? 0;
      const allocation = allocationFor(dataset, post.id, monthId);
      const spent = charges.get(post.id) ?? 0;
      const remaining = roundMoney(carriedIn + allocation - spent, baseDigits);

      monthFigures.set(post.id, {
        carriedIn,
        allocation,
        charges: spent,
        remaining,
      });
      carried.set(post.id, remaining);
    }

    fold.set(monthId, monthFigures);
  }

  return fold;
}

export function figuresFor(
  fold: Fold,
  postId: PostId,
  monthId: MonthId,
): PostMonthFigures {
  return fold.get(monthId)?.get(postId) ?? EMPTY_FIGURES;
}
