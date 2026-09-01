export const CURRENCIES = ["DKK", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_DIGITS: Record<Currency, number> = {
  DKK: 2,
  USD: 2,
  EUR: 2,
};

/** A float amount paired with its currency. See CLAUDE.md for rounding rules. */
export interface Money {
  amount: number;
  currency: Currency;
}

/** "YYYY-MM". Never a Date. */
export type MonthId = string;
/** "YYYY-MM-DD". Never a Date. */
export type IsoDate = string;
export type PostId = string;
export type PurchaseId = string;

export type Rule =
  | { kind: "fixed"; amount: Money }
  | { kind: "percentOfIncome"; percent: number };

export interface Post {
  id: PostId;
  name: string;
  order: number;
  archived: boolean;
  /** Display currency for this post's own views only. All totals use base. */
  currency: Currency;
  standingRule: Rule;
}

export interface Month {
  id: MonthId;
  /** Always in Settings.baseCurrency. */
  income: Money;
  ruleOverrides: Record<PostId, Rule>;
}

export interface Split {
  postId: PostId;
  /** A percentage, or an amount in the purchase's currency, per Purchase.splitMode. */
  value: number;
  absorbsRemainder: boolean;
}

export interface ScheduleSlice {
  month: MonthId;
  amount: Money;
}

export interface Schedule {
  slices: ScheduleSlice[];
  /** Slices in this month AND every month after it are ignored by the fold. */
  cancelledFromMonth?: MonthId;
}

export interface Purchase {
  id: PurchaseId;
  date: IsoDate;
  description: string;
  /** In the purchase's own currency. */
  total: Money;
  splitMode: "percent" | "fixed";
  splits: Split[];
  /** null means the whole total is charged in the month of `date`. */
  schedule: Schedule | null;
}

export interface FxRate {
  currency: Currency;
  /** How many base units one unit of `currency` buys. Base has no row. */
  baseUnitsPerOne: number;
  updatedAt: string;
  source: "manual" | "api";
}

export interface Settings {
  baseCurrency: Currency;
  foldStartMonth: MonthId;
  schemaVersion: number;
}

export interface Dataset {
  settings: Settings;
  fxRates: FxRate[];
  posts: Post[];
  months: Month[];
  purchases: Purchase[];
}
