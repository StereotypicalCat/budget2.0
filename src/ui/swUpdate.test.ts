import { test, expect, describe } from "bun:test";
import { requestUpdate, type UpdateHandle } from "./swUpdate.ts";

function fakeHandle() {
  const events: string[] = [];
  let controllerListener: (() => void) | null = null;
  let timer: { fn: () => void; ms: number } | null = null;
  let unsubscribed = false;

  const handle: UpdateHandle = {
    postSkipWaiting() {
      events.push("postSkipWaiting");
    },
    onControllerChange(listener) {
      events.push("listen");
      controllerListener = listener;
      return () => {
        unsubscribed = true;
      };
    },
    setTimer(fn, ms) {
      timer = { fn, ms };
      return () => {};
    },
    reload() {
      events.push("reload");
    },
  };

  return {
    handle,
    events,
    get unsubscribed() {
      return unsubscribed;
    },
    fireControllerChange: () => controllerListener?.(),
    fireTimeout: () => timer?.fn(),
    get timerMs() {
      return timer?.ms;
    },
  };
}

describe("applying a waiting service worker", () => {
  /**
   * The bug: applyUpdate posted SKIP_WAITING and called reload() on the very
   * next line. Measured in Chrome, the controller had NOT changed at that
   * instant — it changed 2 ms later — so the reload raced activation. When the
   * reload won, the fresh page still saw registration.waiting and showed
   * "A new version is ready" again, and clicking Reload re-entered the same
   * race. The prompt never went away.
   */
  test("does not reload until the new worker actually takes control", () => {
    const f = fakeHandle();
    requestUpdate(f.handle);
    expect(f.events).toEqual(["listen", "postSkipWaiting"]);
    expect(f.events).not.toContain("reload");
  });

  test("listens before posting, or a fast activation is missed entirely", () => {
    const f = fakeHandle();
    requestUpdate(f.handle);
    expect(f.events.indexOf("listen")).toBeLessThan(f.events.indexOf("postSkipWaiting"));
  });

  test("reloads once the controller changes", () => {
    const f = fakeHandle();
    requestUpdate(f.handle);
    f.fireControllerChange();
    expect(f.events).toEqual(["listen", "postSkipWaiting", "reload"]);
  });

  /**
   * A worker that ignores SKIP_WAITING — the deliberately inert one the dev
   * server serves, or a genuinely broken build — must not leave the Reload
   * button dead. Reload anyway; the user asked for it.
   */
  test("reloads anyway if the worker never takes control", () => {
    const f = fakeHandle();
    requestUpdate(f.handle, 1500);
    expect(f.timerMs).toBe(1500);
    f.fireTimeout();
    expect(f.events).toEqual(["listen", "postSkipWaiting", "reload"]);
  });

  test("reloads exactly once when both the change and the timeout fire", () => {
    const f = fakeHandle();
    requestUpdate(f.handle);
    f.fireControllerChange();
    f.fireTimeout();
    expect(f.events.filter((e) => e === "reload")).toHaveLength(1);
  });

  test("stops listening once it has reloaded", () => {
    const f = fakeHandle();
    requestUpdate(f.handle);
    f.fireControllerChange();
    expect(f.unsubscribed).toBe(true);
  });
});
