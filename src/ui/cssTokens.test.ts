import { test, expect } from "bun:test";
import { Glob } from "bun";

/**
 * Every custom property referenced from TypeScript through a CSS var()
 * expression must name a token that actually exists in src/index.css.
 *
 * This exists because renaming `--rule` to `--budget-rule` silently broke the
 * carry meter — the signature element of the month view. An undefined custom
 * property inside a `linear-gradient()` does not warn, does not throw and does
 * not fall back: the whole declaration is invalid, so the element simply
 * paints nothing. It looked like a missing feature, not a bug, and only pixel
 * sampling a screenshot found it.
 *
 * Tokens set by a third party at runtime are exempt — Radix writes
 * `--radix-*` onto its own elements, and they are never in our stylesheet.
 */
const RUNTIME_PROVIDED = /^--radix-/;

test("no TypeScript file references a CSS token that does not exist", async () => {
  const css = await Bun.file("src/index.css").text();
  const defined = new Set(
    [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]!),
  );

  const missing: string[] = [];
  for await (const file of new Glob("src/**/*.{ts,tsx}").scan(".")) {
    const source = await Bun.file(file).text();
    for (const match of source.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      const token = match[1]!;
      if (RUNTIME_PROVIDED.test(token) || defined.has(token)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      missing.push(`${file}:${line} references ${token}`);
    }
  }

  expect(missing).toEqual([]);
});
