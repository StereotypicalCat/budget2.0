import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Bun can run several test files in one process and other files register
// happy-dom too — guard so they can all run together.
if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

import { test, expect, describe, beforeEach } from "bun:test";
import {
  THEME_KEY,
  applyResolvedTheme,
  isThemePreference,
  prefersDark,
  readThemePreference,
  resolveTheme,
  storeThemePreference,
} from "./theme.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  for (const meta of document.querySelectorAll('meta[name="color-scheme"]')) {
    meta.remove();
  }
});

function colorSchemeMeta(): string | null {
  return document.querySelector('meta[name="color-scheme"]')?.getAttribute("content") ?? null;
}

/**
 * Lifts the inline pre-paint script out of index.html and runs it for real,
 * rather than matching its text. The module script below it carries
 * attributes, so a bare `<script>` matches only the one we want.
 */
async function runPrePaintScript(): Promise<void> {
  const html = await Bun.file("src/index.html").text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!script) throw new Error("src/index.html has no inline pre-paint script");
  new Function(script[1]!)();
}

describe("resolving a preference to an actual theme", () => {
  test("an explicit choice ignores the system setting entirely", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("'system' follows the operating system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("reading the stored preference", () => {
  test("defaults to following the system when nothing is stored", () => {
    expect(readThemePreference()).toBe("system");
  });

  test("round-trips each preference", () => {
    for (const preference of ["light", "dark", "system"] as const) {
      storeThemePreference(preference);
      expect(readThemePreference()).toBe(preference);
    }
  });

  // A value can only be junk if something else wrote it, or the user edited
  // it. Following the system beats throwing during boot.
  test("junk in storage falls back to following the system", () => {
    localStorage.setItem(THEME_KEY, "solarized");
    expect(readThemePreference()).toBe("system");
  });

  test("only the three real preferences are accepted", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe("applying a theme", () => {
  test("dark adds the class shadcn's palette is keyed on, light removes it", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyResolvedTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("applying the same theme twice is not a toggle", () => {
    applyResolvedTheme("dark");
    applyResolvedTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

/**
 * Dark Reader looks for `<meta name="color-scheme">` first; without it, it
 * samples text and background colours once a stylesheet exists and applies its
 * own inversion on top of ours. Declaring "dark" is what tells it this app is
 * already dark and to leave the palette alone.
 */
describe("telling the browser, and Dark Reader, which scheme is live", () => {
  test("the meta content follows the resolved theme", () => {
    document.head.appendChild(document.createElement("meta")).setAttribute(
      "name",
      "color-scheme",
    );

    applyResolvedTheme("dark");
    expect(colorSchemeMeta()).toBe("dark");
    applyResolvedTheme("light");
    expect(colorSchemeMeta()).toBe("light");
  });

  // Silently doing nothing would leave Dark Reader guessing, which is the
  // whole bug — so this creates the tag rather than skipping the write.
  test("the tag is created when the document has none", () => {
    expect(colorSchemeMeta()).toBe(null);
    applyResolvedTheme("dark");
    expect(colorSchemeMeta()).toBe("dark");
    expect(document.querySelectorAll('meta[name="color-scheme"]')).toHaveLength(1);
  });

  test("re-applying does not add a second tag", () => {
    applyResolvedTheme("dark");
    applyResolvedTheme("light");
    expect(document.querySelectorAll('meta[name="color-scheme"]')).toHaveLength(1);
  });
});

/**
 * index.html carries a tiny inline script that applies the stored theme before
 * the stylesheet paints, so a dark-theme user never sees a white flash. It
 * cannot import this module, so it repeats the key and the logic — and this is
 * what stops the two drifting apart.
 */
describe("the no-flash script in index.html agrees with this module", () => {
  test("it reads the same key and the same system fallback", async () => {
    const html = await Bun.file("src/index.html").text();
    expect(html).toContain(THEME_KEY);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("dark");
  });

  // Declared in the markup as well, so the scheme is stated before any script
  // runs at all.
  test("the color-scheme meta ships in the markup", async () => {
    const html = await Bun.file("src/index.html").text();
    expect(html).toContain('name="color-scheme"');
  });

  test("a stored dark preference resolves to dark, both signals", async () => {
    storeThemePreference("dark");
    await runPrePaintScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(colorSchemeMeta()).toBe("dark");
  });

  test("a stored light preference resolves to light, both signals", async () => {
    storeThemePreference("light");
    await runPrePaintScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(colorSchemeMeta()).toBe("light");
  });

  // Nothing stored, and happy-dom reports a light system: the same answer
  // resolveTheme("system", false) gives.
  test("no stored preference follows the system", async () => {
    await runPrePaintScript();
    expect(colorSchemeMeta()).toBe(resolveTheme("system", prefersDark()));
  });
});
