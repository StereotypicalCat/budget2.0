import type { Dataset, FxRate, MonthId, Post } from "./types.ts";

export const SCHEMA_VERSION = 2;

const SEED_POST_NAMES = ["Video Games", "Food", "Events and Social"] as const;

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * The first-run dataset. Takes the start month AND the seed exchange rates as
 * arguments because the domain layer must read neither the ambient clock nor
 * the ambient environment. The store passes `BAKED_FX_RATES`; callers that
 * want a bare dataset pass nothing.
 */
export function createSeedDataset(
  startMonth: MonthId,
  fxRates: readonly FxRate[] = [],
): Dataset {
  const posts: Post[] = SEED_POST_NAMES.map((name, order) => ({
    id: newId(),
    name,
    order,
    archived: false,
    currency: "DKK",
    // A new user has genuinely not budgeted anything yet. This is a different
    // state from a rule of zero, and the app distinguishes them.
    rules: [],
  }));

  return {
    settings: {
      baseCurrency: "DKK",
      foldStartMonth: startMonth,
      schemaVersion: SCHEMA_VERSION,
    },
    // Copied, so a caller passing shared constants cannot have them edited
    // out from under it the first time the user changes a rate.
    fxRates: fxRates.map((rate) => ({ ...rate })),
    posts,
    months: [
      { id: startMonth, income: { amount: 0, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases: [],
  };
}
