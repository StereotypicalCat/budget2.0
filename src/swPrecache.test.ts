import { test, expect, describe } from "bun:test";
import { precacheUrls } from "./swPrecache.ts";

describe("the service worker's precache list", () => {
  /**
   * The bug this exists for: `cache.addAll()` rejects the WHOLE install with
   * InvalidStateError if the list contains the same request twice. The build's
   * precache list is derived from its own outputs, which already include
   * index.html, and the worker then appended the shell — index.html again. So
   * install failed every time, the worker went redundant, and no service
   * worker ever activated. Nothing reported it: registration itself succeeds,
   * and the failure is inside the install event.
   */
  test("the shell is not repeated when the build already emitted it", () => {
    expect(precacheUrls(["/index.html", "/index-abc.js"], "/index.html")).toEqual([
      "/index.html",
      "/index-abc.js",
    ]);
  });

  test("the shell is added when the build did not emit it", () => {
    expect(precacheUrls(["/index-abc.js"], "/index.html")).toEqual([
      "/index-abc.js",
      "/index.html",
    ]);
  });

  test("any duplicate is removed, not just the shell", () => {
    expect(precacheUrls(["/a.js", "/b.css", "/a.js"], "/index.html")).toEqual([
      "/a.js",
      "/b.css",
      "/index.html",
    ]);
  });

  test("order is preserved, so the shell is not fetched before the assets", () => {
    expect(precacheUrls(["/z.js", "/a.css"], "/index.html")).toEqual([
      "/z.js",
      "/a.css",
      "/index.html",
    ]);
  });

  test("a subpath deploy is not a special case", () => {
    expect(
      precacheUrls(["/budget2.0/index.html", "/budget2.0/x.js"], "/budget2.0/index.html"),
    ).toEqual(["/budget2.0/index.html", "/budget2.0/x.js"]);
  });

  test("an empty build still precaches the shell", () => {
    expect(precacheUrls([], "/index.html")).toEqual(["/index.html"]);
  });
});
