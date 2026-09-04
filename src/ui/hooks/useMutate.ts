import { useCallback, useState } from "react";
import { store } from "../../store/index.ts";
import type { Dataset } from "../../domain/types.ts";

/**
 * Wraps store.mutate so a failed write surfaces to the user instead of
 * vanishing into an unhandled rejection. The snapshot is unchanged on failure,
 * so the UI keeps showing the last saved state.
 *
 * `mutate` returns whether the write landed, and the returned promise never
 * rejects — the error is already in `error` by the time it settles. A caller
 * that only fires and forgets can ignore it; one that would otherwise dismiss
 * its own UI (a dialog, say) can wait and keep it open, because a refusal the
 * user cannot see is barely better than one that never happened.
 */
export function useMutate() {
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback((fn: (draft: Dataset) => void): Promise<boolean> => {
    return store.mutate(fn).then(
      () => true,
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      },
    );
  }, []);

  return { mutate, error, clearError: useCallback(() => setError(null), []) };
}
