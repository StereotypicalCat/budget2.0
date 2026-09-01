import { test, expect } from "bun:test";
import { DOMAIN_READY } from "./index.ts";

test("domain layer is importable without a DOM", () => {
  expect(DOMAIN_READY).toBe(true);
});
