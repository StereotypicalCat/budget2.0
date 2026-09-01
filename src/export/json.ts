import { CURRENCIES, type Currency, type Dataset, type MonthId } from "../domain/types.ts";
import { migrate } from "../store/migrations.ts";

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export function exportDatasetJson(dataset: Dataset): string {
  return JSON.stringify(dataset, null, 2);
}

export function describeDataset(dataset: Dataset) {
  return {
    posts: dataset.posts.length,
    months: dataset.months.length,
    purchases: dataset.purchases.length,
  };
}

export function exportFilename(monthId: MonthId): string {
  return `budget-${monthId}.json`;
}

// Shape AND range: months 01-12 only. A shape-only regex (\d{2}) lets
// "2026-13" through import and it then silently normalizes to a different
// month inside the balance fold (the same defect fixed earlier in
// src/domain/months.ts). This is the import path that made it reachable.
const MONTH_ID = /^\d{4}-(0[1-9]|1[0-2])$/;

function requireCurrency(value: unknown, where: string): Currency {
  if (!CURRENCIES.includes(value as Currency)) {
    throw new ImportValidationError(`Unsupported currency ${String(value)} in ${where}`);
  }
  return value as Currency;
}

function requireArray(data: Record<string, unknown>, key: string): unknown[] {
  const value = data[key];
  if (!Array.isArray(value)) {
    throw new ImportValidationError(`Dataset field "${key}" is missing or not an array`);
  }
  return value;
}

/**
 * Validates far enough that the fold cannot throw on the imported data: every
 * split points at a real post, every purchase has exactly one remainder
 * absorber, and every MonthId parses.
 */
export function parseDatasetJson(text: string): Dataset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ImportValidationError(
      `File is not valid JSON: ${(error as Error).message}`,
    );
  }

  let dataset: Dataset;
  try {
    dataset = migrate(raw);
  } catch (error) {
    throw new ImportValidationError((error as Error).message);
  }

  const data = dataset as unknown as Record<string, unknown>;
  requireArray(data, "posts");
  requireArray(data, "months");
  requireArray(data, "purchases");
  requireArray(data, "fxRates");

  requireCurrency(dataset.settings.baseCurrency, "settings.baseCurrency");
  if (!MONTH_ID.test(dataset.settings.foldStartMonth)) {
    throw new ImportValidationError(
      `Invalid foldStartMonth "${dataset.settings.foldStartMonth}"`,
    );
  }

  const postIds = new Set(dataset.posts.map((p) => p.id));
  for (const post of dataset.posts) {
    requireCurrency(post.currency, `post "${post.name}"`);
  }

  for (const month of dataset.months) {
    if (!MONTH_ID.test(month.id)) {
      throw new ImportValidationError(`Invalid month id "${month.id}"`);
    }
    requireCurrency(month.income.currency, `month ${month.id} income`);
  }

  for (const purchase of dataset.purchases) {
    const label = `purchase "${purchase.description}"`;
    requireCurrency(purchase.total.currency, label);

    if (purchase.splits.length === 0) {
      throw new ImportValidationError(`${label} has no splits; at least one split is required`);
    }
    const absorbers = purchase.splits.filter((s) => s.absorbsRemainder).length;
    if (absorbers !== 1) {
      throw new ImportValidationError(
        `${label} has ${absorbers} splits flagged absorbsRemainder; exactly one is required`,
      );
    }
    for (const split of purchase.splits) {
      if (!postIds.has(split.postId)) {
        throw new ImportValidationError(
          `${label} references unknown post "${split.postId}"`,
        );
      }
    }
    for (const slice of purchase.schedule?.slices ?? []) {
      if (!MONTH_ID.test(slice.month)) {
        throw new ImportValidationError(`${label} has invalid slice month "${slice.month}"`);
      }
      requireCurrency(slice.amount.currency, `${label} slice ${slice.month}`);
    }
  }

  return dataset;
}
