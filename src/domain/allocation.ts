import { toBase } from "./fx.ts";
import { roundMoney } from "./money.ts";
import { compareMonths } from "./months.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Month,
  MonthId,
  Post,
  PostId,
  Rule,
  RuleVersion,
} from "./types.ts";

/** Resolves a rule to a base-currency amount. Percentages may exceed 100. */
export function resolveRule(
  rule: Rule,
  income: number,
  baseCurrency: Currency,
  rates: FxRate[],
): number {
  if (rule.kind === "fixed") {
    return toBase(rule.amount, baseCurrency, rates);
  }
  return roundMoney((income * rule.percent) / 100, baseCurrency);
}

/**
 * The version in effect for `monthId`: the last one whose `from` is at or
 * before it, or null when the post was not yet budgeted.
 *
 * Scans rather than assuming sorted order. The array is kept sorted by
 * `setRuleFrom`, but a hand-edited import must still resolve correctly.
 */
export function ruleAt(post: Post, monthId: MonthId): RuleVersion | null {
  let effective: RuleVersion | null = null;
  for (const version of post.rules) {
    if (compareMonths(version.from, monthId) > 0) continue;
    if (effective === null || compareMonths(version.from, effective.from) > 0) {
      effective = version;
    }
  }
  return effective;
}

/**
 * Precedence: a one-month override wins outright; otherwise the version in
 * effect; otherwise nothing, which the caller renders as an allocation of zero.
 */
export function ruleForPost(
  month: Month | undefined,
  post: Post,
  monthId: MonthId,
): Rule | null {
  const override = month?.ruleOverrides[post.id];
  if (override) return override;
  return ruleAt(post, monthId)?.rule ?? null;
}

export function isOverridden(month: Month | undefined, postId: PostId): boolean {
  return month?.ruleOverrides[postId] !== undefined;
}

export function incomeFor(dataset: Dataset, monthId: MonthId): number {
  const month = dataset.months.find((m) => m.id === monthId);
  if (!month) return 0;
  return toBase(month.income, dataset.settings.baseCurrency, dataset.fxRates);
}

export function allocationFor(
  dataset: Dataset,
  postId: PostId,
  monthId: MonthId,
): number {
  const post = dataset.posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Unknown post: ${postId}`);
  const month = dataset.months.find((m) => m.id === monthId);
  const rule = ruleForPost(month, post, monthId);
  if (rule === null) return 0;
  return resolveRule(
    rule,
    incomeFor(dataset, monthId),
    dataset.settings.baseCurrency,
    dataset.fxRates,
  );
}
