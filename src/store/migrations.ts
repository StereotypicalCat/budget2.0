import { SCHEMA_VERSION } from "../domain/seed.ts";
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
