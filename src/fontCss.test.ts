import { test, expect, describe } from "bun:test";
import { FONT_FILES, buildFontCss } from "./fontCss.ts";

describe("the font stylesheet", () => {
  test("every url is absolute from the deploy base", () => {
    const css = buildFontCss("/budget2.0/");
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls).toEqual(FONT_FILES.map((f) => `/budget2.0/fonts/${f}`));
  });

  test("a root deploy is not a special case", () => {
    const urls = [...buildFontCss("/").matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls).toEqual(FONT_FILES.map((f) => `/fonts/${f}`));
  });

  /**
   * Relative urls are what this must never emit. The stylesheet is served from
   * the deploy root but the DOCUMENT can be several segments deep
   * (/budget2.0/month/2026-09), and a relative font url resolves against
   * whichever of the two the browser used — silently 404ing on deep routes.
   */
  test("no url is relative", () => {
    const css = buildFontCss("/budget2.0/");
    expect(css).not.toContain('url("./');
    expect(css).not.toContain('url("fonts/');
  });

  test("each face declares a weight range, not a single weight", () => {
    // Both faces are variable; one file must cover the whole scale.
    const css = buildFontCss("/");
    expect(css).toContain("font-weight: 100 900");
    expect(css).toContain("font-weight: 400 700");
    expect(css.match(/@font-face/g)).toHaveLength(FONT_FILES.length);
  });

  test("every declared file is actually committed", async () => {
    for (const file of FONT_FILES) {
      expect(await Bun.file(`src/fonts/${file}`).exists()).toBe(true);
    }
  });

  test("the licences travel with the fonts, as the OFL requires", async () => {
    for (const licence of ["OFL-Inter.txt", "OFL-JetBrainsMono.txt"]) {
      const text = await Bun.file(`src/fonts/${licence}`).text();
      expect(text).toContain("SIL Open Font License");
    }
  });
});
