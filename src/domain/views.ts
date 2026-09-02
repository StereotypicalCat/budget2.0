import { incomeFor, isOverridden } from "./allocation.ts";
import { digitsFor } from "./currencies.ts";
import { figuresFor, foldBalances, type Fold, type PostMonthFigures } from "./fold.ts";
import { roundMoney } from "./money.ts";
import { compareMonths, monthOf, monthRange, monthsOfYear } from "./months.ts";
import type { Dataset, MonthId, Post } from "./types.ts";

export interface MonthPostRow {
  post: Post;
  figures: PostMonthFigures;
  overridden: boolean;
}

export interface MonthViewModel {
  monthId: MonthId;
  income: number;
  totalAllocation: number;
  totalCharges: number;
  /** income - totalAllocation. Negative when allocations exceed income. */
  unallocated: number;
  /**
   * How many rows are overspent — `remaining < 0`, so a post at exactly zero
   * does not count. Computed here rather than in the component because it is
   * the month-level answer to "did I overspend", and it belongs where the
   * rest of the month's arithmetic is tested.
   */
  overspentCount: number;
  rows: MonthPostRow[];
}

function hasActivity(figures: PostMonthFigures): boolean {
  return (
    figures.carriedIn !== 0 || figures.allocation !== 0 || figures.charges !== 0
  );
}

function visiblePosts(dataset: Dataset): Post[] {
  return [...dataset.posts].sort((a, b) => a.order - b.order);
}

export function monthView(dataset: Dataset, monthId: MonthId): MonthViewModel {
  const fold = foldBalances(dataset, monthId);
  const month = dataset.months.find((m) => m.id === monthId);
  const income = incomeFor(dataset, monthId);

  const rows: MonthPostRow[] = [];
  for (const post of visiblePosts(dataset)) {
    const figures = figuresFor(fold, post.id, monthId);
    // Archived posts stay visible only while they still have activity.
    if (post.archived && !hasActivity(figures)) continue;
    rows.push({ post, figures, overridden: isOverridden(month, post.id) });
  }

  const base = dataset.settings.baseCurrency;
  const baseDigits = digitsFor(dataset.currencies, base);
  const totalAllocation = roundMoney(
    rows.reduce((sum, r) => sum + r.figures.allocation, 0),
    baseDigits,
  );
  const totalCharges = roundMoney(
    rows.reduce((sum, r) => sum + r.figures.charges, 0),
    baseDigits,
  );

  return {
    monthId,
    income,
    totalAllocation,
    totalCharges,
    unallocated: roundMoney(income - totalAllocation, baseDigits),
    overspentCount: rows.filter((r) => r.figures.remaining < 0).length,
    rows,
  };
}

export interface YearPostRow {
  post: Post;
  /** Twelve entries, January to December. */
  byMonth: PostMonthFigures[];
  totalAllocation: number;
  totalCharges: number;
  /** December's remaining balance. */
  closingBalance: number;
}

export interface YearViewModel {
  year: number;
  months: MonthId[];
  incomeByMonth: number[];
  totalIncome: number;
  totalCharges: number;
  rows: YearPostRow[];
}

export function yearView(dataset: Dataset, year: number): YearViewModel {
  const months = monthsOfYear(year);
  const fold = foldBalances(dataset, months[11]!);
  const base = dataset.settings.baseCurrency;
  const baseDigits = digitsFor(dataset.currencies, base);

  const incomeByMonth = months.map((m) => incomeFor(dataset, m));

  const rows: YearPostRow[] = visiblePosts(dataset).map((post) => {
    const byMonth = months.map((m) => figuresFor(fold, post.id, m));
    return {
      post,
      byMonth,
      totalAllocation: roundMoney(
        byMonth.reduce((sum, f) => sum + f.allocation, 0),
        baseDigits,
      ),
      totalCharges: roundMoney(
        byMonth.reduce((sum, f) => sum + f.charges, 0),
        baseDigits,
      ),
      closingBalance: byMonth[11]!.remaining,
    };
  });

  return {
    year,
    months,
    incomeByMonth,
    totalIncome: roundMoney(
      incomeByMonth.reduce((a, b) => a + b, 0),
      baseDigits,
    ),
    totalCharges: roundMoney(
      rows.reduce((sum, r) => sum + r.totalCharges, 0),
      baseDigits,
    ),
    rows,
  };
}

export interface SummaryViewModel {
  from: MonthId;
  to: MonthId;
  byPost: { post: Post; charges: number }[];
  byMonth: { monthId: MonthId; charges: number }[];
  totalCharges: number;
  totalIncome: number;
}

export function summaryView(
  dataset: Dataset,
  from: MonthId,
  to: MonthId,
): SummaryViewModel {
  const months = monthRange(from, to);
  const base = dataset.settings.baseCurrency;
  const baseDigits = digitsFor(dataset.currencies, base);
  const fold: Fold =
    months.length > 0 ? foldBalances(dataset, months[months.length - 1]!) : new Map();

  const byPost = visiblePosts(dataset).map((post) => ({
    post,
    charges: roundMoney(
      months.reduce((sum, m) => sum + figuresFor(fold, post.id, m).charges, 0),
      baseDigits,
    ),
  }));

  const byMonth = months.map((monthId) => ({
    monthId,
    charges: roundMoney(
      dataset.posts.reduce(
        (sum, p) => sum + figuresFor(fold, p.id, monthId).charges,
        0,
      ),
      baseDigits,
    ),
  }));

  return {
    from,
    to,
    byPost,
    byMonth,
    totalCharges: roundMoney(
      byMonth.reduce((sum, m) => sum + m.charges, 0),
      baseDigits,
    ),
    totalIncome: roundMoney(
      months.reduce((sum, m) => sum + incomeFor(dataset, m), 0),
      baseDigits,
    ),
  };
}

/**
 * The months worth rendering: from the fold start to the latest month touched
 * by any month record or purchase slice, including future finance-plan slices.
 */
export function datasetMonthSpan(dataset: Dataset): { from: MonthId; to: MonthId } {
  const from = dataset.settings.foldStartMonth;
  let to = from;

  const consider = (candidate: MonthId) => {
    if (compareMonths(candidate, to) > 0) to = candidate;
  };

  for (const month of dataset.months) consider(month.id);
  for (const purchase of dataset.purchases) {
    if (purchase.schedule) {
      for (const slice of purchase.schedule.slices) consider(slice.month);
    } else {
      consider(monthOf(purchase.date));
    }
  }

  return { from, to };
}
