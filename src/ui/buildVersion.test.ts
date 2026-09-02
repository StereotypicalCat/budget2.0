import { test, expect } from "bun:test";
import { describeBuild, readBuildVersionEnv } from "./buildVersion.ts";

test("an absent stamp reads as development, not as a blank or a lie", () => {
  expect(describeBuild(undefined)).toBe("development");
  expect(describeBuild("")).toBe("development");
});

test("build.ts's default timestamp becomes a date", () => {
  // String(Date.now()) for 2026-09-02T00:00:00Z.
  expect(describeBuild("1788307200000")).toBe("2026-09-02");
});

test("a commit sha is shortened the way git shortens one", () => {
  // pages.yml passes BUILD_VERSION: ${{ github.sha }}, so the deployed
  // colophon was printing all forty characters of
  // 61e7093c36f9a0111a5f1c8776aba4894c88ebc4.
  expect(describeBuild("61e7093c36f9a0111a5f1c8776aba4894c88ebc4")).toBe("61e7093");
  // An already-short sha is left as it is.
  expect(describeBuild("61e7093")).toBe("61e7093");
});

test("a version someone chose is printed as given", () => {
  // A sha, a tag and a release number must survive untouched: guessing at a
  // format the builder did not ask for is worse than showing their string.
  expect(describeBuild("bd5a01e")).toBe("bd5a01e");
  expect(describeBuild("v1.4.0")).toBe("v1.4.0");
  expect(describeBuild("2026.09.02-nightly")).toBe("2026.09.02-nightly");
});

test("digits that are not a real date fall back to the raw string", () => {
  // 21 digits is past the range Date accepts, so this must not become
  // "Invalid Date" or throw.
  expect(describeBuild("999999999999999999999")).toBe("999999999999999999999");
});

// Regression, same mechanism as basePath.test.ts: Bun only inlines
// `process.env.FOO` when FOO is SET. Unset, the reference survives into the
// browser bundle and throws `ReferenceError: process is not defined` before the
// app can boot, so reading it must tolerate `process` not existing at all.
test("reading the build version does not throw when process is undefined", () => {
  const saved = (globalThis as { process?: unknown }).process;
  try {
    delete (globalThis as { process?: unknown }).process;
    expect(readBuildVersionEnv()).toBeUndefined();
  } finally {
    (globalThis as { process?: unknown }).process = saved;
  }
});
