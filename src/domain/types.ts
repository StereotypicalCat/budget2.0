/**
 * A currency CODE, uppercase, normally ISO 4217 ("DKK", "JPY"). Open rather
 * than a closed union because the owner can define their own currencies:
 * a union would make that a code change.
 *
 * The safety a union gave up is replaced by validation at the boundaries —
 * `parseDatasetJson` rejects a code no currency defines, and the UI only ever
 * offers codes from the dataset's own table.
 */
export type Currency = string;

/** What the owner has told the app about one currency. */
export interface CurrencyDef {
  code: Currency;
  /** Decimal places in its minor unit: 2 for DKK, 0 for JPY, 3 for KWD. */
  digits: number;
  /** "kr", "$", "€". Optional — a currency can be typed by code alone. */
  symbol?: string;
  /** "Danish krone". Shown in Settings; never used for identity. */
  name?: string;
}

/**
 * The currencies a brand-new dataset starts with. NOT the set of valid
 * currencies — that lives in the dataset, because the owner can add more.
 */
export const SEED_CURRENCIES: readonly CurrencyDef[] = [
  { code: "DKK", digits: 2, symbol: "kr", name: "Danish krone" },
  { code: "USD", digits: 2, symbol: "$", name: "US dollar" },
  { code: "EUR", digits: 2, symbol: "\u20ac", name: "Euro" },
];

/** Used when a currency has no definition. Two places is right almost always. */
export const DEFAULT_CURRENCY_DIGITS = 2;

/** A float amount paired with its currency. See CLAUDE.md for rounding rules. */
export interface Money {
  amount: number;
  currency: Currency;
}

/** "YYYY-MM". Never a Date. */
export type MonthId = string;
/**
 * "YYYY-MM-DD", or "YYYY-MM" when a purchase has no specific day — the app is
 * about monthly spending, so a day is optional. `monthOf()` parses both.
 * Never a Date.
 */
export type IsoDate = string;
export type PostId = string;
export type PurchaseId = string;

export type Rule =
  | { kind: "fixed"; amount: Money }
  | { kind: "percentOfIncome"; percent: number };

export interface RuleVersion {
  /** The rule takes effect in this month and continues until the next version. */
  from: MonthId;
  rule: Rule;
}

export interface Post {
  id: PostId;
  name: string;
  order: number;
  archived: boolean;
  /** Display currency for this post's own views only. All totals use base. */
  currency: Currency;
  /**
   * The post's allocation rule over time, sorted ascending by `from`, at most
   * one entry per month. Empty means the post has never been budgeted, and its
   * allocation is zero — not the same as a rule of zero.
   */
  rules: RuleVersion[];
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
  /** Optional longer context, alongside the short `description` label. */
  note?: string;
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
  /** Optional: no migration needed, existing datasets leave it undefined. */
  fxApiUrl?: string;
}

export interface Dataset {
  settings: Settings;
  /**
   * Every currency this dataset knows, including the base. The owner can add
   * to it, so it — not a compile-time union — is the authority on what codes
   * are valid, what their symbols are, and how many decimals they round to.
   */
  currencies: CurrencyDef[];
  fxRates: FxRate[];
  posts: Post[];
  months: Month[];
  purchases: Purchase[];
}
