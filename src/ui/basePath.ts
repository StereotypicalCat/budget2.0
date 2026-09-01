/** Always "/" or "/segment/". Never empty, never without a trailing slash. */
export function normalizeBase(raw: string | undefined): string {
  if (!raw || raw === "/") return "/";
  const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * Bun substitutes process.env.BUN_PUBLIC_* into client code at build time, so
 * this becomes a literal string in the bundle.
 */
export const BASE_PATH = normalizeBase(process.env.BUN_PUBLIC_BASE_PATH);

/** react-router wants the basename without a trailing slash ("" for root). */
export const ROUTER_BASENAME = BASE_PATH === "/" ? "" : BASE_PATH.slice(0, -1);

export function withBase(path: string, base: string = BASE_PATH): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}
