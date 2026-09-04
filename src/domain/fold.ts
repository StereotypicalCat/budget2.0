import { allocationFor } from "./allocation.ts";
import { chargesForMonth, expectedForMonth } from "./charges.ts";
import { roundMoney } from "./money.ts";
import { compareMonths, monthRange } from "./months.ts";
import { occurrencesByMonth } from "./occurrences.ts";
import type { Dataset, MonthId, PostId } from "./types.ts";

export interface PostMonthFigures {
  carriedIn: number;
  allocation: number;
  charges: number;
  /** carriedIn + allocation - charges. Negative means overspent. */
  remaining: number;
  /**
   * Unconfirmed recurring occurrences landing in this month, base currency.
   * Money committed but not yet moved.
   */
  expected: number;
  /** The previous month's `projected`. */
  projectedCarriedIn: number;
  /**
   * projectedCarriedIn + allocation - charges - expected.
   *
   * A second, parallel balance: what is left once commitments are counted.
   * It never influences `remaining`, so adding a recurring cost cannot move a
   * figure the owner already reconciled against their bank.
   */
  projected: number;
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
  expected: 0,
  projectedCarriedIn: 0,
  projected: 0,
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
  const { foldStartMonth } = dataset.settings;
  const baseDigits = dataset.settings.digits;
  const fold: Fold = new Map();

  if (compareMonths(upToMonth, foldStartMonth) < 0) return fold;

  // One walk for every recurring cost, because under `lastCharge` anchoring a
  // month's occurrences depend on every confirmation before it.
  const occurrences = occurrencesByMonth(dataset, upToMonth);

  const carried = new Map<PostId, number>();
  const carriedProjected = new Map<PostId, number>();

  for (const monthId of monthRange(foldStartMonth, upToMonth)) {
    const charges = chargesForMonth(dataset, monthId);
    const expected = expectedForMonth(dataset, occurrences.get(monthId) ?? []);
    const monthFigures = new Map<PostId, PostMonthFigures>();

    for (const post of dataset.posts) {
      const carriedIn = carried.get(post.id) ?? 0;
      const projectedCarriedIn = carriedProjected.get(post.id) ?? 0;
      const allocation = allocationFor(dataset, post.id, monthId);
      const spent = charges.get(post.id) ?? 0;
      const due = expected.get(post.id) ?? 0;

      const remaining = roundMoney(carriedIn + allocation - spent, baseDigits);
      const projected = roundMoney(
        projectedCarriedIn + allocation - spent - due,
        baseDigits,
      );

      monthFigures.set(post.id, {
        carriedIn,
        allocation,
        charges: spent,
        remaining,
        expected: due,
        projectedCarriedIn,
        projected,
      });
      carried.set(post.id, remaining);
      carriedProjected.set(post.id, projected);
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
