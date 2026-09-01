/** Always "/" or "/segment/". Never empty, never without a trailing slash. */
export function normalizeBase(raw: string | undefined): string {
  if (!raw || raw === "/") return "/";
  const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * Reads the build-time base path.
 *
 * Bun inlines a literal `process.env.FOO` reference ONLY when FOO is actually
 * set. When it is unset — a bare `bun --hot src/index.ts`, say — the reference
 * survives into the browser bundle, where `process` does not exist, and the app
 * dies with `ReferenceError: process is not defined` before it can boot.
 *
 * try/catch rather than a `typeof process` guard, deliberately: after inlining
 * the literal becomes a string, but a `typeof process === "undefined"` test
 * would still run in the browser and discard that inlined value, silently
 * breaking every subpath deploy. Catching leaves the inlined value untouched
 * and only absorbs the unset case.
 */
export function readBasePathEnv(): string | undefined {
  try {
    return process.env.BUN_PUBLIC_BASE_PATH;
  } catch {
    return undefined;
  }
}

export const BASE_PATH = normalizeBase(readBasePathEnv());

/** react-router wants the basename without a trailing slash ("" for root). */
export const ROUTER_BASENAME = BASE_PATH === "/" ? "" : BASE_PATH.slice(0, -1);

export function withBase(path: string, base: string = BASE_PATH): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}
