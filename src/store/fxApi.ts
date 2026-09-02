import type { Currency, FxRate } from "../domain/types.ts";

/**
 * Frankfurter needs no API key. The URL is user-editable in settings.
 *
 * Must be the `.dev/v1` host. `api.frankfurter.app` answers every request with
 * a 301 here, and a redirect response has to carry Access-Control-Allow-Origin
 * itself for a browser to follow it cross-origin — that 301 carries no CORS
 * headers, so the request dies before the redirect is taken.
 */
export const DEFAULT_FX_API_URL =
  "https://api.frankfurter.dev/v1/latest?from={base}&to={targets}";

/** The URL above until 2026-09; see the 3 -> 4 migration, which drops it. */
export const STALE_FX_API_URL = "https://api.frankfurter.app/latest?from={base}&to={targets}";

export function buildFxUrl(
  template: string,
  base: Currency,
  targets: Currency[],
): string {
  return template
    .replace("{base}", base)
    .replace("{targets}", targets.join(","));
}

export function parseFxResponse(
  body: unknown,
  base: Currency,
  /**
   * The currencies this dataset knows. Anything else in the response is
   * skipped: a rate service returns dozens, and storing one for a currency the
   * owner has not defined would put an unreachable row in their table.
   */
  allowed: readonly Currency[],
  /** Defaults to now. The build passes its own date when baking rates in. */
  updatedAt: string = new Date().toISOString(),
): FxRate[] {
  const rates =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).rates
      : undefined;
  if (typeof rates !== "object" || rates === null) {
    throw new Error("Exchange rate response has no `rates` object");
  }

  const out: FxRate[] = [];

  for (const [currency, value] of Object.entries(rates as Record<string, unknown>)) {
    if (currency === base) continue;
    if (!allowed.includes(currency)) continue;
    if (typeof value !== "number" || !(value > 0)) {
      throw new Error(`Exchange rate for ${currency} is not a positive number`);
    }
    // The API gives target-per-base; we store base-per-target.
    out.push({
      currency: currency as Currency,
      baseUnitsPerOne: Number((1 / value).toFixed(6)),
      updatedAt,
      source: "api",
    });
  }
  return out;
}

/** Fails soft at the call site: callers keep the cached rates on error. */
export async function fetchFxRates(
  template: string,
  base: Currency,
  targets: Currency[],
): Promise<FxRate[]> {
  const response = await fetch(buildFxUrl(template, base, targets));
  if (!response.ok) {
    throw new Error(`Rate service returned ${response.status}`);
  }
  // The targets we asked for are exactly the ones we will accept back.
  return parseFxResponse(await response.json(), base, targets);
}
