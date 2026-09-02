import { BASE_PATH, withBase } from "./basePath.ts";
import { requestUpdate } from "./swUpdate.ts";

let waiting: ServiceWorker | null = null;

/**
 * Registers the worker and calls `onUpdateReady` when a new version is waiting.
 * Without an explicit update path, a stale worker can pin the user to an old
 * build indefinitely.
 */
export function registerServiceWorker(onUpdateReady: () => void): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  void navigator.serviceWorker
    .register(withBase("sw.js"), { scope: BASE_PATH })
    .then((registration) => {
      if (registration.waiting) {
        waiting = registration.waiting;
        onUpdateReady();
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            waiting = installing;
            onUpdateReady();
          }
        });
      });
    })
    .catch(() => {
      // An unavailable worker must never break the app; it just means no offline.
    });
}

/**
 * Reloads only once the new worker is actually in control. Posting
 * SKIP_WAITING and reloading on the next line raced activation, and when the
 * reload won, the reloaded page still found a waiting worker and showed the
 * update prompt again — forever. See src/ui/swUpdate.ts for the measurement.
 */
export function applyUpdate(): void {
  const target = waiting;
  waiting = null;

  if (!target) {
    window.location.reload();
    return;
  }

  requestUpdate({
    postSkipWaiting: () => target.postMessage({ type: "SKIP_WAITING" }),
    onControllerChange: (listener) => {
      navigator.serviceWorker.addEventListener("controllerchange", listener);
      return () =>
        navigator.serviceWorker.removeEventListener("controllerchange", listener);
    },
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    reload: () => window.location.reload(),
  });
}
