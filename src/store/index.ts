import { monthOf } from "../domain/months.ts";
import { readDataset, writeDataset } from "./db.ts";
import { createSnapshotStore } from "./snapshot.ts";

/** The current month, read at module load. The UI owns the clock; the domain does not. */
export const currentMonth = monthOf(new Date().toISOString().slice(0, 10));

export const store = createSnapshotStore(
  { read: readDataset, write: writeDataset },
  currentMonth,
);

export * from "./snapshot.ts";
export { UnsupportedSchemaError } from "./migrations.ts";
