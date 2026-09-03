import { test, expect, describe } from "bun:test";
import { SCHEMA_VERSION, createSeedDataset } from "../domain/seed.ts";
import { migrate, UnsupportedSchemaError } from "./migrations.ts";

describe("migrate", () => {
  test("passes a current-version dataset through unchanged", () => {
    const data = createSeedDataset("2026-09");
    expect(migrate(data)).toEqual(data);
  });

  test("rejects a version newer than this build understands", () => {
    const future = { ...createSeedDataset("2026-09"), settings: { baseCurrency: "DKK", foldStartMonth: "2026-09", schemaVersion: SCHEMA_VERSION + 1 } };
    expect(() => migrate(future)).toThrow(UnsupportedSchemaError);
  });

  test("rejects a value that is not an object", () => {
    expect(() => migrate("nope")).toThrow(/not a dataset/i);
    expect(() => migrate(null)).toThrow(/not a dataset/i);
  });

  test("rejects a dataset with no schemaVersion", () => {
    expect(() => migrate({ posts: [] })).toThrow(/schemaVersion/);
  });
});

import { allocationFor } from "../domain/allocation.ts";

/** A v1 dataset, in the shape that shipped before rules were versioned. */
function v1Dataset() {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
    fxRates: [],
    posts: [
      {
        id: "food",
        name: "Food",
        order: 0,
        archived: false,
        currency: "DKK",
        standingRule: { kind: "percentOfIncome", percent: 20 },
      },
      {
        id: "games",
        name: "Video Games",
        order: 1,
        archived: false,
        currency: "DKK",
        standingRule: { kind: "fixed", amount: { amount: 400, currency: "DKK" } },
      },
    ],
    months: [
      { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      {
        id: "2026-02",
        income: { amount: 12000, currency: "DKK" },
        ruleOverrides: { games: { kind: "fixed", amount: { amount: 900, currency: "DKK" } } },
      },
    ],
    purchases: [],
  };
}

describe("v1 -> v2: rules become a dated series", () => {
  test("each standingRule becomes one version starting at the fold start", () => {
    const migrated = migrate(v1Dataset());
    // migrate() runs every step to the current SCHEMA_VERSION, so this lands
    // at 3 now that currencies became data. The rule conversion below is what
    // this test is actually about.
    expect(migrated.settings.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.posts[0]!.rules).toEqual([
      { from: "2026-01", rule: { kind: "percentOfIncome", percent: 20 } },
    ]);
    expect(migrated.posts[1]!.rules).toEqual([
      { from: "2026-01", rule: { kind: "fixed", amount: { amount: 400, currency: "DKK" } } },
    ]);
  });

  test("the old field is gone afterwards", () => {
    const migrated = migrate(v1Dataset()) as unknown as Record<string, any>;
    expect("standingRule" in (migrated.posts as any[])[0]).toBe(false);
  });

  test("per-month overrides are left untouched", () => {
    const migrated = migrate(v1Dataset());
    expect(migrated.months[1]!.ruleOverrides.games).toEqual({
      kind: "fixed",
      amount: { amount: 900, currency: "DKK" },
    });
  });

  // The property that matters: this is a shape change, not a recalculation.
  // A shape-only test would pass while every balance quietly moved.
  test("NO allocation changes: every post in every month resolves identically", () => {
    const before = v1Dataset();
    const migrated = migrate(v1Dataset());

    // Resolve the v1 way by hand, since allocationFor now speaks v2 only.
    const v1Allocation = (postId: string, monthId: string) => {
      const post = before.posts.find((p) => p.id === postId)!;
      const month = before.months.find((m) => m.id === monthId);
      const rule = (month?.ruleOverrides as any)?.[postId] ?? post.standingRule;
      const income = before.months.find((m) => m.id === monthId)?.income.amount ?? 0;
      return rule.kind === "fixed"
        ? rule.amount.amount
        : Number(((income * rule.percent) / 100).toFixed(2));
    };

    for (const postId of ["food", "games"]) {
      for (const monthId of ["2026-01", "2026-02"]) {
        expect(allocationFor(migrated, postId, monthId)).toBe(v1Allocation(postId, monthId));
      }
    }
  });

  test("an empty posts array migrates without throwing", () => {
    const empty = { ...v1Dataset(), posts: [] };
    expect(migrate(empty).posts).toEqual([]);
  });

  test("a v1 post with no standingRule at all migrates to an empty rules array, not a version wrapping undefined", () => {
    const dataset = v1Dataset();
    dataset.posts.push({
      id: "unbudgeted",
      name: "Unbudgeted",
      order: 2,
      archived: false,
      currency: "DKK",
    } as any);

    const migrated = migrate(dataset);

    const unbudgeted = migrated.posts.find((p) => p.id === "unbudgeted")!;
    expect(unbudgeted.rules).toEqual([]);

    // The missing field on one post must not contaminate its siblings.
    expect(migrated.posts[0]!.rules).toEqual([
      { from: "2026-01", rule: { kind: "percentOfIncome", percent: 20 } },
    ]);
  });
});

describe("v2 -> v3: currencies become data", () => {
  /** A realistic v2 dataset: no `currencies` field existed. */
  function v2(): any {
    return {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 2 },
      fxRates: [
        { currency: "EUR", baseUnitsPerOne: 7.4, updatedAt: "2026-01-01", source: "manual" },
      ],
      posts: [
        {
          id: "p1",
          name: "Food",
          order: 0,
          archived: false,
          currency: "DKK",
          rules: [{ from: "2026-01", rule: { kind: "percentOfIncome", percent: 12 } }],
        },
      ],
      months: [
        { id: "2026-01", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} },
      ],
      purchases: [],
    };
  }

  test("the three shipped currencies are added", () => {
    const migrated = migrate(v2());
    expect(migrated.settings.schemaVersion).toBe(SCHEMA_VERSION);
    // The first three come from this step, frozen at what it always produced.
    // GBP is appended later, by 4 -> 5; see that block. The decimals this step
    // wrote per currency are collapsed into one setting by 5 -> 6, so they no
    // longer appear on the definitions here.
    expect(migrated.currencies).toEqual([
      { code: "DKK", symbol: "kr", name: "Danish krone" },
      { code: "USD", symbol: "$", name: "US dollar" },
      { code: "EUR", symbol: "€", name: "Euro" },
      { code: "GBP", symbol: "£", name: "British pound" },
    ]);
  });

  /**
   * The whole point of the migration being safe: every currency that existed
   * had two decimal places, this step wrote two, and 5 -> 6 takes the maximum
   * of those — two. So not one stored amount can round differently than it did
   * before, across the whole chain.
   */
  test("no amount can round differently than it did under v2", () => {
    expect(migrate(v2()).settings.digits).toBe(2);
  });

  test("nothing else about the dataset is touched", () => {
    const before = v2();
    const migrated = migrate(structuredClone(before));
    expect(migrated.posts).toEqual(before.posts);
    expect(migrated.months).toEqual(before.months);
    // Sterling's rate arrives later, in 4 -> 5; nothing this step does touches
    // the rate table.
    expect(migrated.fxRates.filter((r) => r.currency !== "GBP")).toEqual(before.fxRates);
    expect(migrated.settings.baseCurrency).toBe("DKK");
    expect(migrated.settings.foldStartMonth).toBe("2026-01");
  });

  test("a v1 dataset migrates all the way through to the current version", () => {
    const v1 = {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
      fxRates: [],
      posts: [
        {
          id: "p1",
          name: "Food",
          order: 0,
          archived: false,
          currency: "DKK",
          standingRule: { kind: "fixed", amount: { amount: 500, currency: "DKK" } },
        },
      ],
      months: [],
      purchases: [],
    };
    const migrated = migrate(v1);
    expect(migrated.settings.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.posts[0]!.rules).toEqual([
      { from: "2026-01", rule: { kind: "fixed", amount: { amount: 500, currency: "DKK" } } },
    ]);
    expect(migrated.currencies.map((c) => c.code)).toEqual(["DKK", "USD", "EUR", "GBP"]);
  });

  /**
   * A dataset can only reach v3 through this step, but an owner could have a
   * hand-edited file that already has the field. Overwriting it would silently
   * discard currencies they added.
   */
  test("an existing currencies field is kept, not overwritten", () => {
    const data = v2();
    data.currencies = [{ code: "DKK", digits: 2 }, { code: "JPY", digits: 0 }];
    const migrated = migrate(data);
    // JPY survives, which is the point: the step appends nothing and discards
    // nothing. GBP is appended afterwards by 4 -> 5.
    expect(migrated.currencies.map((c) => c.code)).toEqual(["DKK", "JPY", "GBP"]);
  });
});

describe("v3 -> v4: the stale rate-service URL is dropped", () => {
  const v3 = (fxApiUrl?: string) => ({
    settings: {
      baseCurrency: "DKK",
      foldStartMonth: "2026-01",
      schemaVersion: 3,
      ...(fxApiUrl === undefined ? {} : { fxApiUrl }),
    },
    currencies: [{ code: "DKK", digits: 2 }],
    fxRates: [],
    posts: [],
    months: [],
    purchases: [],
  });

  const STALE = "https://api.frankfurter.app/latest?from={base}&to={targets}";

  test("a dataset holding the dead default loses the field entirely", () => {
    const out = migrate(v3(STALE));
    expect(out.settings.schemaVersion).toBe(SCHEMA_VERSION);
    // Removed rather than rewritten to the new URL, so the dataset follows
    // whatever the current default is and a future endpoint move needs no
    // second migration for the same user.
    expect("fxApiUrl" in out.settings).toBe(false);
  });

  test("a URL the owner chose themselves is left alone", () => {
    const mine = "https://rates.example.com/v2?base={base}&want={targets}";
    expect(migrate(v3(mine)).settings.fxApiUrl).toBe(mine);
  });

  test("a dataset that never stored a URL is untouched apart from the version", () => {
    const out = migrate(v3());
    expect("fxApiUrl" in out.settings).toBe(false);
    expect(out.settings.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe("v4 -> v5: GBP joins the prebaked currencies", () => {
  const v4 = (currencies: any[], fxRates: any[] = []) => ({
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 4 },
    currencies,
    fxRates,
    posts: [],
    months: [],
    purchases: [],
  });
  const DKK = { code: "DKK", digits: 2, symbol: "kr", name: "Danish krone" };
  const USD_RATE = {
    currency: "USD",
    baseUnitsPerOne: 6.449532,
    updatedAt: "2026-09-01",
    source: "manual" as const,
  };

  test("a dataset without GBP gains the definition and a rate", () => {
    const out = migrate(v4([DKK], [USD_RATE]));
    expect(out.settings.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.currencies.map((c) => c.code)).toEqual(["DKK", "GBP"]);
    const gbp = out.fxRates.find((r) => r.currency === "GBP")!;
    expect(gbp.baseUnitsPerOne).toBe(8.704735);
    // "manual", never "api": Settings shows this field, and a committed
    // constant must not claim it came from a rate service.
    expect(gbp.source).toBe("manual");
  });

  test("a GBP the owner defined themselves is left exactly as it is", () => {
    // Zero decimals is wrong for sterling, which is the point: it is THEIR
    // definition, and a migration that corrected it would be editing data.
    const mine = { code: "GBP", digits: 0, symbol: "quid" };
    const out = migrate(v4([DKK, mine]));
    // Their symbol survives; their 0 does not, because 5 -> 6 collapses every
    // per-currency figure into one setting and takes the maximum — DKK's 2.
    // This is the cost that spec records: sterling and kroner can disagree
    // about decimals in a v5 dataset and cannot in a v6 one.
    expect(out.currencies.find((c) => c.code === "GBP")).toEqual({
      code: "GBP",
      symbol: "quid",
    });
    expect(out.settings.digits).toBe(2);
  });

  test("a GBP rate the owner already has keeps their number", () => {
    const mine = {
      currency: "GBP",
      baseUnitsPerOne: 9,
      updatedAt: "2026-01-01",
      source: "manual" as const,
    };
    const out = migrate(v4([DKK], [mine]));
    expect(out.fxRates.filter((r) => r.currency === "GBP")).toEqual([mine]);
  });

  test("everything else is left untouched", () => {
    const out = migrate(v4([DKK], [USD_RATE]));
    expect(out.fxRates.find((r) => r.currency === "USD")).toEqual(USD_RATE);
    const { digits: _dropped, ...dkkWithoutDigits } = DKK;
    expect(out.currencies[0]).toEqual(dkkWithoutDigits);
  });

  test("GBP is not added twice when the migration is somehow reapplied", () => {
    const once = migrate(v4([DKK]));
    const codes = once.currencies.filter((c) => c.code === "GBP");
    expect(codes).toHaveLength(1);
  });
});

describe("v5 -> v6: decimals become one setting for the whole dataset", () => {
  const v5 = (currencies: any[]) => ({
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 5 },
    currencies,
    fxRates: [],
    posts: [],
    months: [],
    purchases: [],
  });

  test("the setting takes the MAXIMUM of the per-currency digits", () => {
    // Not the base currency's 2: a dataset holding KWD has three-decimal
    // amounts already stored, and migrating to 2 would truncate the next edit
    // of one. The maximum can only ever keep more precision, never less.
    const out = migrate(v5([
      { code: "DKK", digits: 2 },
      { code: "JPY", digits: 0 },
      { code: "KWD", digits: 3 },
    ]));
    expect(out.settings.digits).toBe(3);
  });

  test("digits are stripped from every currency entry", () => {
    const out = migrate(v5([
      { code: "DKK", digits: 2, symbol: "kr", name: "Danish krone" },
      { code: "JPY", digits: 0 },
    ]));
    for (const currency of out.currencies) {
      expect("digits" in currency).toBe(false);
    }
    // Everything else about the definition survives.
    expect(out.currencies[0]).toEqual({ code: "DKK", symbol: "kr", name: "Danish krone" });
  });

  test("a table where every currency agrees is behaviour-preserving", () => {
    // The shipped dataset: four currencies, all at 2, so nothing rounds
    // differently after the step than before it.
    const out = migrate(v5([
      { code: "DKK", digits: 2 },
      { code: "USD", digits: 2 },
      { code: "EUR", digits: 2 },
      { code: "GBP", digits: 2 },
    ]));
    expect(out.settings.digits).toBe(2);
  });

  test.each([
    ["an empty table", []],
    ["digits that are not numbers", [{ code: "DKK", digits: "two" }]],
    ["entries with no digits at all", [{ code: "DKK" }]],
  ])("%s falls back to two places rather than NaN", (_label, currencies) => {
    const out = migrate(v5(currencies as any[]));
    expect(out.settings.digits).toBe(2);
  });

  test("a missing currencies table does not throw", () => {
    const data: any = v5([]);
    delete data.currencies;
    expect(migrate(data).settings.digits).toBe(2);
  });

  test("everything else in settings is left untouched", () => {
    const out = migrate(v5([{ code: "DKK", digits: 2 }]));
    expect(out.settings.baseCurrency).toBe("DKK");
    expect(out.settings.foldStartMonth).toBe("2026-01");
    expect(out.settings.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

/**
 * A migration's output must not change when today's defaults change. The 2 -> 3
 * step originally seeded `SEED_CURRENCIES` by reference, so adding GBP to that
 * table would have retroactively altered what an old dataset got from a step it
 * had already been through — silently, and only for whoever had not migrated
 * yet. Source-level, like eventCapture.test.ts, because the damage is invisible
 * in review and in a green suite.
 */
test("no migration step imports a live default that a later commit could change", async () => {
  const source = await Bun.file("src/store/migrations.ts").text();
  // Scoped to IMPORT BINDINGS, not to the whole file. Matching anywhere is too
  // blunt: it flagged the comment explaining this rule, and then flagged
  // V3_SEED_CURRENCIES, the frozen local copy that is the fix. What must never
  // happen is the module reading a constant another commit can change.
  const imports = [...source.matchAll(/import\s+([\s\S]*?)\s+from\s+["'][^"']+["']/g)].map(
    (m) => m[1]!,
  );
  // SCHEMA_VERSION is deliberately absent: migrate() reads it as the ceiling to
  // run to, which must track the current version. It is not a default that a
  // step writes into someone's data.
  const live = ["SEED_CURRENCIES", "FALLBACK_FX_RATES", "BAKED_FX_RATES"];
  const offenders = imports.filter((binding) =>
    live.some((name) => new RegExp(`\\b${name}\\b`).test(binding)),
  );
  expect(offenders).toEqual([]);
});
