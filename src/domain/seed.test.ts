import { test, expect } from "bun:test";
import { createSeedDataset, SCHEMA_VERSION, newId } from "./seed.ts";
import { monthView } from "./views.ts";

test("seeds exactly the three named posts, in order", () => {
  const data = createSeedDataset("2026-09");
  expect(data.posts.map((p) => p.name)).toEqual([
    "Video Games",
    "Food",
    "Events and Social",
  ]);
  expect(data.posts.map((p) => p.order)).toEqual([0, 1, 2]);
});

test("seeded posts are active with a zero fixed standing rule", () => {
  const data = createSeedDataset("2026-09");
  for (const post of data.posts) {
    expect(post.archived).toBe(false);
    expect(post.standingRule).toEqual({
      kind: "fixed",
      amount: { amount: 0, currency: "DKK" },
    });
  }
});

test("the fold starts at the given month and DKK is the base currency", () => {
  const data = createSeedDataset("2026-09");
  expect(data.settings.foldStartMonth).toBe("2026-09");
  expect(data.settings.baseCurrency).toBe("DKK");
  expect(data.settings.schemaVersion).toBe(SCHEMA_VERSION);
});

test("seeds a month record with zero income and no purchases", () => {
  const data = createSeedDataset("2026-09");
  expect(data.months.map((m) => m.id)).toEqual(["2026-09"]);
  expect(data.purchases).toEqual([]);
});

test("the seed dataset renders a valid month view", () => {
  const view = monthView(createSeedDataset("2026-09"), "2026-09");
  expect(view.rows).toHaveLength(3);
  expect(view.income).toBe(0);
  expect(view.unallocated).toBe(0);
});

test("newId returns distinct ids", () => {
  expect(newId()).not.toBe(newId());
});
