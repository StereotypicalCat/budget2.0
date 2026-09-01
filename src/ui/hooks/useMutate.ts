import { useCallback, useState } from "react";
import { store } from "../../store/index.ts";
import type { Dataset } from "../../domain/types.ts";

/**
 * Wraps store.mutate so a failed write surfaces to the user instead of
 * vanishing into an unhandled rejection. The snapshot is unchanged on failure,
 * so the UI keeps showing the last saved state.
 */
export function useMutate() {
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback((fn: (draft: Dataset) => void) => {
    store.mutate(fn).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  return { mutate, error, clearError: useCallback(() => setError(null), []) };
}
