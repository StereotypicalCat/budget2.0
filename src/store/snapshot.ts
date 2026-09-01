import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset, MonthId } from "../domain/types.ts";

export interface Persistence {
  read(): Promise<Dataset | null>;
  write(dataset: Dataset): Promise<void>;
}

export type Listener = () => void;

export interface SnapshotStore {
  load(): Promise<void>;
  get(): Dataset;
  mutate(fn: (draft: Dataset) => void): Promise<void>;
  replace(dataset: Dataset): Promise<void>;
  subscribe(listener: Listener): () => void;
}

export function createSnapshotStore(
  persistence: Persistence,
  currentMonth: MonthId,
): SnapshotStore {
  let snapshot: Dataset | null = null;
  const listeners = new Set<Listener>();

  function notify() {
    for (const listener of listeners) listener();
  }

  function get(): Dataset {
    if (!snapshot) throw new Error("Snapshot store is not loaded yet");
    return snapshot;
  }

  async function commit(next: Dataset) {
    // Write first: if persistence fails, the in-memory snapshot must not have
    // moved, or the UI would show data that was never saved.
    await persistence.write(next);
    snapshot = next;
    notify();
  }

  return {
    async load() {
      const stored = await persistence.read();
      if (stored) {
        snapshot = stored;
        notify();
        return;
      }
      await commit(createSeedDataset(currentMonth));
    },

    get,

    async mutate(fn) {
      const draft = structuredClone(get());
      fn(draft);
      await commit(draft);
    },

    async replace(dataset) {
      await commit(dataset);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
