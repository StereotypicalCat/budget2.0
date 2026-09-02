import { SEED_CURRENCIES, type Currency, type FxRate } from "../domain/types.ts";

/**
 * Exchange rates baked in at build time so a fresh install can convert a EUR
 * purchase on day one instead of erroring.
 *
 * They seed a NEW dataset and nothing else. They deliberately do NOT act as a
 * fallback whenever a rate is missing: clearing a rate removes its row so
 * `MissingRateError` surfaces, rather than silently converting money at a
 * number the user never chose. `src/store/bakedRates.test.ts` pins that.
 *
 * This lives in the store layer, not the domain, because reading the ambient
 * environment is exactly what `src/domain/` may not do. `createSeedDataset`
 * takes the rates as an argument instead.
 */

/**
 * The last-resort rates, committed so a build with no network still produces a
 * working app. DKK per one unit, six decimals, never rounded to money.
 *
 * Labelled "manual" rather than "api" on purpose: Settings shows this field,
 * and a hardcoded constant must not claim it came from a rate service. The
 * values are real (frankfurter.app, DKK base, 2026-09-01); EUR barely moves
 * because DKK is pegged to it, so it ages well. USD does move — a stale USD
 * number here is the reason the user can always edit or re-fetch a rate.
 */
export const FALLBACK_FX_RATES: readonly FxRate[] = Object.freeze([
  Object.freeze({
    currency: "USD" as Currency,
    baseUnitsPerOne: 6.449532,
    updatedAt: "2026-09-01",
    source: "manual" as const,
  }),
  Object.freeze({
    currency: "EUR" as Currency,
    baseUnitsPerOne: 7.474959,
    updatedAt: "2026-09-01",
    source: "manual" as const,
  }),
]);

/**
 * The currencies a baked payload must cover: the seed table minus the base.
 * Only the SEED currencies — a dataset that already exists is never seeded, so
 * currencies the owner added later are irrelevant here.
 */
const REQUIRED: Currency[] = SEED_CURRENCIES.map((c) => c.code).filter((c) => c !== "DKK");
const SEED_CODES: Currency[] = SEED_CURRENCIES.map((c) => c.code);

function isUsableRate(value: unknown): value is FxRate {
  if (typeof value !== "object" || value === null) return false;
  const rate = value as Record<string, unknown>;
  return (
    SEED_CODES.includes(rate.currency as Currency) &&
    typeof rate.baseUnitsPerOne === "number" &&
    Number.isFinite(rate.baseUnitsPerOne) &&
    rate.baseUnitsPerOne > 0 &&
    typeof rate.updatedAt === "string" &&
    (rate.source === "api" || rate.source === "manual")
  );
}

/**
 * Parses what `build.ts` embedded, falling back to the committed constants on
 * anything unusable — an unset variable (a plain `bun --hot`), a build whose
 * fetch failed, or a malformed payload. Falling back beats throwing: this runs
 * during first-run seeding, and an app that will not boot is worse than an app
 * with a slightly stale USD rate the user can edit.
 */
export function parseBakedRates(raw: string | undefined): readonly FxRate[] {
  if (!raw) return FALLBACK_FX_RATES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FALLBACK_FX_RATES;
  }

  if (!Array.isArray(parsed) || !parsed.every(isUsableRate)) return FALLBACK_FX_RATES;

  // A partial payload would leave one currency unconvertible on a fresh
  // install, which is the whole problem this feature exists to solve.
  const covered = new Set(parsed.map((rate) => rate.currency));
  if (!REQUIRED.every((currency) => covered.has(currency))) return FALLBACK_FX_RATES;

  return parsed;
}

/**
 * try/catch, not a `typeof process` guard. Bun inlines the literal only when
 * the variable is set; unset, the bare reference reaches the browser and
 * throws before the app boots. A `typeof` test survives inlining and discards
 * the inlined value. See `readBasePathEnv` in src/ui/basePath.ts.
 */
export function readBakedRatesEnv(): string | undefined {
  try {
    return process.env.BUN_PUBLIC_BAKED_FX_RATES;
  } catch {
    return undefined;
  }
}

export const BAKED_FX_RATES = parseBakedRates(readBakedRatesEnv());
