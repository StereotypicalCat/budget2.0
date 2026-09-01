import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { test, expect } from "bun:test";
import { registerServiceWorker } from "./registerSw.ts";

test("registration is a no-op when the browser has no service worker support", () => {
  // happy-dom's navigator has no serviceWorker, which is the case under test.
  // (happy-dom exposes `navigator` as a getter-only global, so there is
  // nothing to save/restore here — reassigning it would throw.)
  expect(() => registerServiceWorker(() => {})).not.toThrow();
});
