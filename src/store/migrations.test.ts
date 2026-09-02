import { test, expect, describe } from "bun:test";
import { migrate, UnsupportedSchemaError } from "./migrations.ts";
import { createSeedDataset, SCHEMA_VERSION } from "../domain/seed.ts";

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
    expect(migrated.settings.schemaVersion).toBe(2);
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

  test("a v1 post with no posts at all migrates without throwing", () => {
    const empty = { ...v1Dataset(), posts: [] };
    expect(migrate(empty).posts).toEqual([]);
  });
});
