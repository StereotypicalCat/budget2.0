import { monthOf } from "../domain/months.ts";
import { readDataset, writeDataset } from "./db.ts";
import { createSnapshotStore } from "./snapshot.ts";
import { BAKED_FX_RATES } from "./bakedRates.ts";
import type { IsoDate } from "../domain/types.ts";

/** The current month, read at module load. The UI owns the clock; the domain does not. */
export const currentMonth = monthOf(new Date().toISOString().slice(0, 10));

/**
 * Today, day-granular, read at module load. The UI owns the clock; the domain
 * does not. `ExpectedBand`'s "Coming up" group needs the actual day — a
 * coming-up occurrence is confirmed EARLY, so the purchase it writes must be
 * dated today rather than the future slot, which is exactly what rebases a
 * `lastCharge` series.
 */
export const today: IsoDate = new Date().toISOString().slice(0, 10);

export const store = createSnapshotStore(
  { read: readDataset, write: writeDataset },
  currentMonth,
  // First run only, so a fresh install can convert a EUR purchase on day one.
  // Never a backstop for a rate the user has cleared.
  BAKED_FX_RATES,
);

export * from "./snapshot.ts";
export { UnsupportedSchemaError } from "./migrations.ts";
