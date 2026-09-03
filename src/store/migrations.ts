import { SCHEMA_VERSION } from "../domain/seed.ts";
import { STALE_FX_API_URL } from "./fxApi.ts";

/**
 * What the 2 -> 3 step has always produced, frozen HERE rather than imported
 * from the live seed table.
 *
 * This module must not read today's defaults. It originally seeded the live
 * seed-currency table by reference, so adding a currency there would have
 * retroactively changed what an old dataset received from a step it had already
 * been through — silently, and only for whoever had not migrated yet.
 * `src/store/migrations.test.ts` fails if a live default is referenced again;
 * it matches source text, so do not name those constants even in a comment.
 */
const V3_SEED_CURRENCIES = [
  { code: "DKK", digits: 2, symbol: "kr", name: "Danish krone" },
  { code: "USD", digits: 2, symbol: "$", name: "US dollar" },
  { code: "EUR", digits: 2, symbol: "\u20ac", name: "Euro" },
];

/**
 * What 5 -> 6 falls back to when a dataset carries no usable per-currency
 * digits. Frozen for the same reason as the tables above: a step's output must
 * not move when today's defaults do.
 */
const V6_FALLBACK_DIGITS = 2;

/** Sterling as 4 -> 5 adds it. Frozen for the same reason as the list above. */
const V5_GBP = { code: "GBP", digits: 2, symbol: "\u00a3", name: "British pound" };
const V5_GBP_RATE = {
  currency: "GBP",
  baseUnitsPerOne: 8.704735,
  updatedAt: "2026-09-02",
  source: "manual" as const,
};
import type { Dataset } from "../domain/types.ts";

export class UnsupportedSchemaError extends Error {
  constructor(public readonly found: number) {
    super(
      `Data was written by a newer version of the app (schema ${found}, this build understands ${SCHEMA_VERSION}). Update the app before opening it.`,
    );
    this.name = "UnsupportedSchemaError";
  }
}

/**
 * Ordered migration steps. Each entry upgrades from its index version to the
 * next. Add one whenever SCHEMA_VERSION increases; never edit an existing one,
 * because users' stored data has already been through it.
 */
const MIGRATIONS: Array<(data: any) => any> = [
  // index 0: there is no version 0 in the wild.
  undefined as unknown as (data: any) => any,

  // 1 -> 2: a post's single `standingRule` becomes a one-entry dated series,
  // effective from the fold start. Behaviour-preserving by construction: the
  // standing rule already applied from the fold start onward, so every month
  // resolves to exactly the allocation it did before.
  (data: any) => ({
    ...data,
    settings: { ...data.settings, schemaVersion: 2 },
    posts: (data.posts ?? []).map((post: any) => {
      const { standingRule, ...rest } = post;
      return {
        ...rest,
        rules:
          standingRule === undefined
            ? []
            : [{ from: data.settings.foldStartMonth, rule: standingRule }],
      };
    }),
  }),

  // 2 -> 3: currencies become data. Until now the three supported currencies
  // and their decimal places were compile-time constants, so adding one meant
  // changing code; they now live in the dataset, which is also what lets the
  // owner define their own.
  //
  // Behaviour-preserving by construction: every currency that existed had two
  // decimal places, and the seeded table records two, so not one stored amount
  // can round differently than it did before. An existing `currencies` field
  // is left alone rather than overwritten — a hand-edited file could already
  // carry currencies the owner added, and discarding them would be data loss.
  (data: any) => ({
    ...data,
    settings: { ...data.settings, schemaVersion: 3 },
    currencies: Array.isArray(data.currencies)
      ? data.currencies
      : V3_SEED_CURRENCIES.map((currency) => ({ ...currency })),
  }),

  // 3 -> 4: drop a stored rate-service URL that can no longer work.
  // api.frankfurter.app now answers every request with a 301 to
  // api.frankfurter.dev/v1, and because that redirect carries no CORS headers
  // a browser refuses to follow it — so "Fetch rates now" failed with nothing
  // but a CORS error to go on. Changing the default fixes a dataset that never
  // stored the URL; this fixes one that did.
  //
  // The field is REMOVED rather than rewritten to the new endpoint, so the
  // dataset follows whatever the current default is and a future move of the
  // service needs no second migration for the same user. A URL the owner chose
  // themselves is left strictly alone: only the exact dead default is dropped.
  //
  // No stored figure changes, so this cannot alter a single number in the
  // budget.
  (data: any) => {
    const { fxApiUrl, ...settings } = data.settings ?? {};
    return {
      ...data,
      settings:
        fxApiUrl === STALE_FX_API_URL
          ? { ...settings, schemaVersion: 4 }
          : { ...data.settings, schemaVersion: 4 },
    };
  },

  // 4 -> 5: sterling joins the currencies the app ships with, and an existing
  // dataset gets it too. Baked currencies and rates seed a NEW dataset and
  // nothing else, so without this step the owner would have to type the code,
  // name, symbol and decimals by hand to spend in a currency the app now
  // claims to ship.
  //
  // The rate is supplied because there is no prior choice to overwrite: GBP has
  // never existed in this dataset, so nothing is being silently replaced. That
  // is the line the "rates never backstop a cleared rate" rule draws — it
  // forbids re-supplying a number the owner removed, not introducing one for a
  // currency they have never had. A GBP the owner already defined, or a GBP
  // rate they already hold, is left exactly as it is.
  //
  // No stored figure changes: adding a currency definition and a rate for a
  // currency nothing yet references cannot alter an amount already recorded.
  (data: any) => {
    const currencies = Array.isArray(data.currencies) ? data.currencies : [];
    const fxRates = Array.isArray(data.fxRates) ? data.fxRates : [];
    const hasGbp = currencies.some((c: any) => c?.code === "GBP");
    const hasGbpRate = fxRates.some((r: any) => r?.currency === "GBP");
    return {
      ...data,
      settings: { ...data.settings, schemaVersion: 5 },
      currencies: hasGbp ? currencies : [...currencies, { ...V5_GBP }],
      fxRates: hasGbpRate || hasGbp ? fxRates : [...fxRates, { ...V5_GBP_RATE }],
    };
  },

  // 5 -> 6: decimal places stop being per-currency and become one setting for
  // the whole dataset. See docs/specs/2026-09-02-global-decimals-design.md,
  // which records what that gives up: a dataset mixing minor units — yen at 0
  // beside kroner at 2 — can no longer be described.
  //
  // The setting takes the MAXIMUM of what the currencies declared, not the base
  // currency's value. A dataset holding a three-decimal currency already has
  // three-decimal amounts stored in it, and adopting the base's 2 would mean
  // the next edit of one silently truncated it. The maximum can only ever keep
  // more precision than before, never less.
  //
  // Behaviour-preserving on every dataset this app has written: all four seeded
  // currencies record 2, so the maximum is 2 and not one stored amount rounds
  // differently than it did before.
  (data: any) => {
    const currencies = Array.isArray(data.currencies) ? data.currencies : [];
    const declared = currencies
      .map((currency: any) => currency?.digits)
      .filter((digits: unknown): digits is number => Number.isInteger(digits));
    return {
      ...data,
      settings: {
        ...data.settings,
        schemaVersion: 6,
        digits: declared.length > 0 ? Math.max(...declared) : V6_FALLBACK_DIGITS,
      },
      // `digits` dropped from each entry; everything else about a definition
      // the owner wrote is theirs and survives untouched.
      currencies: currencies.map(({ digits, ...rest }: any) => rest),
    };
  },
];

export function migrate(raw: unknown): Dataset {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Stored value is not a dataset");
  }
  const data = raw as Record<string, any>;
  const version = data.settings?.schemaVersion;
  if (typeof version !== "number") {
    throw new Error("Stored dataset has no settings.schemaVersion");
  }
  if (version > SCHEMA_VERSION) throw new UnsupportedSchemaError(version);

  let current = data;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema ${v} to ${v + 1}`);
    current = step(current);
  }
  return current as Dataset;
}
