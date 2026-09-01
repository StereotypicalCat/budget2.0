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

  // All mutations run through this chain, one at a time, so a mutation
  // always clones from the snapshot the previous mutation committed rather
  // than from a stale snapshot captured before it. Without this, two
  // mutations issued before either's write resolves both clone the same
  // starting point and the one that commits last silently discards the
  // other's change.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    // Keep the chain alive after a failure, but the caller still sees the
    // rejection via `run`, which is returned unmodified below.
    queue = run.catch(() => undefined);
    return run;
  }

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

    mutate(fn) {
      return enqueue(async () => {
        const draft = structuredClone(get());
        fn(draft);
        await commit(draft);
      });
    },

    replace(dataset) {
      return enqueue(() => commit(dataset));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
