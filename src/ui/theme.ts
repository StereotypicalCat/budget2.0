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
  applyColorScheme(theme);
}

/**
 * States the live scheme in `<meta name="color-scheme">`, kept in step with the
 * `color-scheme` declarations in index.css.
 *
 * The meta tag rather than the stylesheet alone, because of Dark Reader: it
 * reads this tag first, and failing to find one it samples text and background
 * colours off the painted page and applies its own inversion. On our dark
 * palette that is a second darkening of an already dark app. Declaring "dark"
 * is what tells it the app is already there.
 *
 * index.html ships the tag and the pre-paint script sets it, so this is
 * normally an update; it creates the tag if it is missing rather than silently
 * doing nothing, which would leave Dark Reader guessing again.
 */
function applyColorScheme(theme: ResolvedTheme): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "color-scheme";
    document.head.appendChild(meta);
  }
  meta.content = theme;
}
