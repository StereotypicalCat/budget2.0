import { test, expect } from "bun:test";
import { buildManifest } from "./manifest.ts";

test("scope, start_url and the icon all follow the base path", () => {
  const manifest = JSON.parse(buildManifest("/budget2.0/"));
  expect(manifest.scope).toBe("/budget2.0/");
  expect(manifest.start_url).toBe("/budget2.0/");
  expect(manifest.icons[0].src).toBe("/budget2.0/icon.svg");
});

test("a root deploy is the same shape, not a special case", () => {
  const manifest = JSON.parse(buildManifest("/"));
  expect(manifest.scope).toBe("/");
  expect(manifest.icons[0].src).toBe("/icon.svg");
});

/**
 * `src/manifest.webmanifest` exists only so Bun's dev-server HTML bundler can
 * resolve the `<link rel="manifest">` href in src/index.html — Bun.serve has
 * no `external` option, unlike Bun.build. Nothing ever serves its contents:
 * the dev server answers that path from `buildManifest`, and build.ts writes
 * dist/manifest.webmanifest from it too.
 *
 * So the file must stay valueless. Real values here are unreachable, and a
 * hardcoded "scope": "/" in this file is exactly what made a subpath dev
 * deploy misleading.
 */
test("the dev resolution stub holds no manifest values that could go stale", async () => {
  const stub = await Bun.file("src/manifest.webmanifest").json();
  expect(Object.keys(stub)).toEqual(["$comment"]);
});
