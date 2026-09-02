/**
 * The build stamp shown in the colophon.
 *
 * `build.ts` already computes a version for the service worker; this exposes
 * the same value to the app bundle. It is genuinely absent in development,
 * which is the normal case rather than an error.
 */

/**
 * try/catch, NOT a `typeof process` guard — see AGENTS.md §2. Bun inlines the
 * literal only when the variable is set; unset, the bare reference reaches the
 * browser and throws before the app boots, and a `typeof` guard would survive
 * inlining and discard the inlined value.
 */
export function readBuildVersionEnv(): string | undefined {
  try {
    return process.env.BUN_PUBLIC_BUILD_VERSION;
  } catch {
    return undefined;
  }
}

/** A millisecond epoch, which is what build.ts falls back to. */
const EPOCH_MS = /^\d{10,}$/;

/**
 * A full commit sha. `pages.yml` passes `github.sha`, so the deployed colophon
 * was printing all forty characters. Requires at least one a-f so a long run of
 * digits that is not a valid date is never mistaken for one.
 */
const LONG_SHA = /^(?=.*[a-f])[0-9a-f]{12,}$/i;

/**
 * `BUILD_VERSION` may be anything the person building chose — a git sha, a tag,
 * a release number — so an unrecognised value is printed as given rather than
 * reformatted into something it is not. The one shape worth translating is
 * build.ts's own default, a `Date.now()` timestamp, because "1756809600000"
 * tells a reader nothing and "2026-09-02" tells them what they wanted to know.
 *
 * ISO rather than a locale format: this string appears in bug reports against
 * the linked repository, and it should not vary by who is reading it.
 */
export function describeBuild(raw: string | undefined): string {
  if (!raw) return "development";
  if (EPOCH_MS.test(raw)) {
    const at = new Date(Number(raw));
    if (!Number.isNaN(at.getTime())) return at.toISOString().slice(0, 10);
  }
  if (LONG_SHA.test(raw)) return raw.slice(0, 7);
  return raw;
}

export const BUILD_VERSION = describeBuild(readBuildVersionEnv());
