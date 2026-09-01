import { test, expect } from "bun:test";
import { withBase, normalizeBase } from "./basePath.ts";

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
