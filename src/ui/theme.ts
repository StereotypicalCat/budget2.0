/**
 * Theme preference: light, dark, or follow the system.
 *
 * Stored in localStorage rather than in the dataset, deliberately. The dataset
 * is the owner's budget — it is exported, imported and versioned, and a
 * per-device display choice does not belong in it. Importing a backup taken on
 * a desktop should not flip a phone to dark.
 *
 * Every storage access is wrapped: localStorage THROWS on access in some
 * configurations (a browser set to block site data, some private modes), not
 * merely returning null, and a theme preference must never be the reason the
 * app fails to boot.
 */

export const THEME_KEY = "budget2:theme";

/** What the user chose. */
export type ThemePreference = "light" | "dark" | "system";

/** What that resolves to right now. Only these two reach the DOM. */
export type ResolvedTheme = "light" | "dark";

const PREFERENCES: readonly string[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && PREFERENCES.includes(value);
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // A preference that cannot be remembered is a small loss; a crash is not.
  }
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * shadcn's dark palette is keyed on a `.dark` class rather than a media query
 * (`@custom-variant dark (&:is(.dark *))` in styles/globals.css), so this
 * class is the single switch for both shadcn's variables and the app's own
 * `--budget-*` tokens.
 */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}
