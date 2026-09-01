import { CURRENCIES, type Currency, type FxRate } from "../domain/types.ts";

/** Frankfurter needs no API key. The URL is user-editable in settings. */
export const DEFAULT_FX_API_URL = "https://api.frankfurter.app/latest?from={base}&to={targets}";

export function buildFxUrl(
  template: string,
  base: Currency,
  targets: Currency[],
): string {
  return template
    .replace("{base}", base)
    .replace("{targets}", targets.join(","));
}

export function parseFxResponse(body: unknown, base: Currency): FxRate[] {
  const rates =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).rates
      : undefined;
  if (typeof rates !== "object" || rates === null) {
    throw new Error("Exchange rate response has no `rates` object");
  }

  const updatedAt = new Date().toISOString();
  const out: FxRate[] = [];

  for (const [currency, value] of Object.entries(rates as Record<string, unknown>)) {
    if (currency === base) continue;
    if (!CURRENCIES.includes(currency as Currency)) continue;
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
  return parseFxResponse(await response.json(), base);
}
