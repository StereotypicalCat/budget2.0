import { useSyncExternalStore } from "react";
import { store } from "../../store/index.ts";
import type { Dataset } from "../../domain/types.ts";

/**
 * Subscribes to the snapshot store. Every mutation replaces the snapshot
 * object, so reference equality is a correct change signal.
 */
export function useDataset(): Dataset {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
  );
}
