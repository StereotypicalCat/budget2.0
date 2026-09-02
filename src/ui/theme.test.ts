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
  readThemePreference,
  resolveTheme,
  storeThemePreference,
} from "./theme.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

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
 * index.html carries a tiny inline script that applies the stored theme before
 * the stylesheet paints, so a dark-theme user never sees a white flash. It
 * cannot import this module, so it repeats the key and the logic — and this is
 * what stops the two drifting apart.
 */
test("the no-flash script in index.html agrees with this module", async () => {
  const html = await Bun.file("src/index.html").text();
  expect(html).toContain(THEME_KEY);
  expect(html).toContain("prefers-color-scheme: dark");
  expect(html).toContain("dark");
});
