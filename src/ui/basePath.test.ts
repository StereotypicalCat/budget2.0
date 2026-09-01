import { test, expect } from "bun:test";
import { withBase, normalizeBase, readBasePathEnv } from "./basePath.ts";

test("normalizeBase defaults to root", () => {
  expect(normalizeBase(undefined)).toBe("/");
  expect(normalizeBase("")).toBe("/");
});

test("normalizeBase adds the leading and trailing slash", () => {
  expect(normalizeBase("budget2.0")).toBe("/budget2.0/");
  expect(normalizeBase("/budget2.0")).toBe("/budget2.0/");
  expect(normalizeBase("/budget2.0/")).toBe("/budget2.0/");
});

test("withBase joins without doubling slashes", () => {
  expect(withBase("/manifest.webmanifest", "/budget2.0/")).toBe(
    "/budget2.0/manifest.webmanifest",
  );
  expect(withBase("manifest.webmanifest", "/budget2.0/")).toBe(
    "/budget2.0/manifest.webmanifest",
  );
  expect(withBase("/sw.js", "/")).toBe("/sw.js");
});

// Regression: Bun only inlines `process.env.FOO` when the variable is SET. When
// it is unset (e.g. a bare `bun --hot src/index.ts`), the reference survives
// into the browser bundle and throws `ReferenceError: process is not defined`
// before the app can boot. Reading the value must therefore tolerate `process`
// not existing at all.
test("reading the base path env does not throw when process is undefined", () => {
  const saved = (globalThis as { process?: unknown }).process;
  try {
    delete (globalThis as { process?: unknown }).process;
    expect(readBasePathEnv()).toBeUndefined();
  } finally {
    (globalThis as { process?: unknown }).process = saved;
  }
});
