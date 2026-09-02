import type { Dataset, MonthId, Post } from "./types.ts";

export const SCHEMA_VERSION = 2;

const SEED_POST_NAMES = ["Video Games", "Food", "Events and Social"] as const;

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * The first-run dataset. Takes the start month as an argument because the
 * domain layer must not read the ambient clock.
 */
export function createSeedDataset(startMonth: MonthId): Dataset {
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
    fxRates: [],
    posts,
    months: [
      { id: startMonth, income: { amount: 0, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases: [],
  };
}
