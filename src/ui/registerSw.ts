import { BASE_PATH, withBase } from "./basePath.ts";

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

export function applyUpdate(): void {
  waiting?.postMessage({ type: "SKIP_WAITING" });
  waiting = null;
  window.location.reload();
}
