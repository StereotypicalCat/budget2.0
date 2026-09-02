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

  test("the three shipped currencies are added, with their decimals", () => {
    const migrated = migrate(v2());
    expect(migrated.settings.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.currencies).toEqual([
      { code: "DKK", digits: 2, symbol: "kr", name: "Danish krone" },
      { code: "USD", digits: 2, symbol: "$", name: "US dollar" },
      { code: "EUR", digits: 2, symbol: "€", name: "Euro" },
    ]);
  });

  /**
   * The whole point of the migration being safe: every currency that existed
   * had two decimal places, and the seeded table says two, so not one stored
   * amount can round differently than it did before.
   */
  test("no amount can round differently than it did under v2", () => {
    const migrated = migrate(v2());
    for (const currency of migrated.currencies) {
      expect(currency.digits).toBe(2);
    }
  });

  test("nothing else about the dataset is touched", () => {
    const before = v2();
    const migrated = migrate(structuredClone(before));
    expect(migrated.posts).toEqual(before.posts);
    expect(migrated.months).toEqual(before.months);
    expect(migrated.fxRates).toEqual(before.fxRates);
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
    expect(migrated.currencies.map((c) => c.code)).toEqual(["DKK", "USD", "EUR"]);
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
    expect(migrated.currencies.map((c) => c.code)).toEqual(["DKK", "JPY"]);
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
    expect(out.settings.schemaVersion).toBe(4);
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
    expect(out.settings.schemaVersion).toBe(4);
  });
});
