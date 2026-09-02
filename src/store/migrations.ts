import { SCHEMA_VERSION } from "../domain/seed.ts";
import { SEED_CURRENCIES } from "../domain/types.ts";
import { STALE_FX_API_URL } from "./fxApi.ts";
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
      : SEED_CURRENCIES.map((currency) => ({ ...currency })),
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
