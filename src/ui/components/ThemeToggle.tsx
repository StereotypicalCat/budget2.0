import { useEffect, useState } from "react";
import {
  applyResolvedTheme,
  prefersDark,
  readThemePreference,
  resolveTheme,
  storeThemePreference,
  type ThemePreference,
} from "../theme.ts";

const ORDER: ThemePreference[] = ["system", "light", "dark"];

const LABEL: Record<ThemePreference, string> = {
  system: "Theme: follows your system",
  light: "Theme: light",
  dark: "Theme: dark",
};

/**
 * Cycles system -> light -> dark. Three states rather than a two-way switch
 * because "follow the system" is a real answer and the only way to get back to
 * it, once you have chosen, is to have somewhere to choose it.
 *
 * While the preference is "system" this keeps listening, so the app follows
 * the OS switching to dark at sunset without a reload.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    applyResolvedTheme(resolveTheme(preference, prefersDark()));
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyResolvedTheme(resolveTheme("system", media.matches));
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [preference]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]!;
    setPreference(next);
    storeThemePreference(next);
  }

  const resolved = resolveTheme(preference, prefersDark());

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${LABEL[preference]}. Click to change.`}
      aria-label={`${LABEL[preference]}. Click to change.`}
      className="grid size-8 place-items-center rounded-md text-budget-ink-muted transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {preference === "system" ? (
        <MonitorGlyph />
      ) : resolved === "dark" ? (
        <MoonGlyph />
      ) : (
        <SunGlyph />
      )}
    </button>
  );
}

/* Inline so the app ships no icon library for three glyphs. currentColor
   throughout, so they follow the theme without a second set of tokens. */

function SunGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.5M8 13.1v1.5M1.4 8h1.5M13.1 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3Z" />
    </svg>
  );
}

function MonitorGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="1.6" y="2.6" width="12.8" height="8.4" rx="1.3" />
      <path d="M5.6 13.4h4.8" />
    </svg>
  );
}
