/**
 * Sequencing for "apply the waiting service worker, then reload".
 *
 * Pure, with every browser touchpoint injected, because the bug it fixes is
 * entirely about ORDER and order is what a test can pin. The old code was:
 *
 *     waiting.postMessage({ type: "SKIP_WAITING" });
 *     window.location.reload();
 *
 * Measured in Chrome: at the moment of that reload the new worker was still
 * `installed` and the controller had not changed — it changed 2 ms later. So
 * the reload raced activation. When the reload won, the fresh page load still
 * found `registration.waiting` and showed "A new version is ready" again, and
 * pressing Reload re-entered the same race. The prompt never went away.
 *
 * The window is wider than 2 ms in practice: the worker's `activate` handler
 * deletes every stale cache before calling `clients.claim()`.
 */
export interface UpdateHandle {
  /** Tells the waiting worker to activate now. */
  postSkipWaiting(): void;
  /** Subscribes to the page's controller changing. Returns an unsubscribe. */
  onControllerChange(listener: () => void): () => void;
  setTimer(fn: () => void, ms: number): () => void;
  reload(): void;
}

/**
 * `timeoutMs` is a backstop, not a delay: a worker that ignores SKIP_WAITING —
 * the deliberately inert one the dev server serves, or a broken build — must
 * not leave the Reload button doing nothing at all. It reloads anyway, because
 * that is what the user asked for.
 */
export function requestUpdate(handle: UpdateHandle, timeoutMs = 3000): void {
  let reloaded = false;

  const finish = () => {
    if (reloaded) return;
    reloaded = true;
    stopListening();
    cancelTimer();
    handle.reload();
  };

  // Subscribe BEFORE posting. Activation can complete in a couple of
  // milliseconds, and a listener attached afterwards would miss it and fall
  // through to the timeout every time.
  const stopListening = handle.onControllerChange(finish);
  const cancelTimer = handle.setTimer(finish, timeoutMs);

  handle.postSkipWaiting();
}
