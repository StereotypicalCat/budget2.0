import { toBase } from "./fx.ts";
import { roundMoney } from "./money.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Month,
  MonthId,
  Post,
  PostId,
  Rule,
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

export function ruleForPost(month: Month | undefined, post: Post): Rule {
  return month?.ruleOverrides[post.id] ?? post.standingRule;
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
  return resolveRule(
    ruleForPost(month, post),
    incomeFor(dataset, monthId),
    dataset.settings.baseCurrency,
    dataset.fxRates,
  );
}
