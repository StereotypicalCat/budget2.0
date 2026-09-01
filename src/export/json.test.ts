import { test, expect, describe } from "bun:test";
import {
  exportDatasetJson,
  parseDatasetJson,
  describeDataset,
  ImportValidationError,
  exportFilename,
} from "./json.ts";
import { createSeedDataset } from "../domain/seed.ts";
import { monthView, yearView } from "../domain/views.ts";
import type { Dataset } from "../domain/types.ts";

function populated(): Dataset {
  const data = createSeedDataset("2026-01");
  data.months[0]!.income = { amount: 20000, currency: "DKK" };
  data.purchases.push({
    id: "p1",
    date: "2026-01-15",
    description: "Console",
    total: { amount: 3000, currency: "DKK" },
    splitMode: "percent",
    splits: [
      { postId: data.posts[0]!.id, value: 70, absorbsRemainder: true },
      { postId: data.posts[2]!.id, value: 30, absorbsRemainder: false },
    ],
    schedule: {
      slices: [
        { month: "2026-01", amount: { amount: 1000, currency: "DKK" } },
        { month: "2026-02", amount: { amount: 2000, currency: "DKK" } },
      ],
    },
  });
  return data;
}

describe("round trip", () => {
  test("export then import yields an equal dataset", () => {
    const data = populated();
    expect(parseDatasetJson(exportDatasetJson(data))).toEqual(data);
  });

  test("derived output is identical after a round trip", () => {
    const data = populated();
    const restored = parseDatasetJson(exportDatasetJson(data));
    expect(monthView(restored, "2026-01")).toEqual(monthView(data, "2026-01"));
    expect(yearView(restored, 2026)).toEqual(yearView(data, 2026));
  });

  test("export is human-readable, indented JSON", () => {
    expect(exportDatasetJson(createSeedDataset("2026-01"))).toContain("\n  ");
  });
});

describe("validation", () => {
  test("rejects malformed JSON", () => {
    expect(() => parseDatasetJson("{not json")).toThrow(ImportValidationError);
  });

  test("rejects a dataset missing a required collection", () => {
    const data = populated() as any;
    delete data.purchases;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/purchases/);
  });

  test("rejects a purchase whose splits reference an unknown post", () => {
    const data = populated();
    data.purchases[0]!.splits[0]!.postId = "ghost";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/ghost/);
  });

  test("rejects a purchase with no remainder-absorbing split", () => {
    const data = populated();
    data.purchases[0]!.splits[0]!.absorbsRemainder = false;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/absorbsRemainder/);
  });

  test("rejects a purchase with two remainder-absorbing splits", () => {
    const data = populated();
    data.purchases[0]!.splits[1]!.absorbsRemainder = true;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/exactly one/i);
  });

  test("rejects a purchase with no splits", () => {
    const data = populated();
    data.purchases[0]!.splits = [];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/at least one split/i);
  });

  test("rejects an unsupported currency", () => {
    const data = populated() as any;
    data.settings.baseCurrency = "GBP";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/GBP/);
  });

  test("rejects a malformed MonthId", () => {
    const data = populated();
    data.months[0]!.id = "2026-1";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-1/);
  });

  test("rejects a MonthId with an out-of-range month", () => {
    const data = populated();
    data.months[0]!.id = "2026-13";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-13/);
  });
});

test("describeDataset counts what an import would replace", () => {
  expect(describeDataset(populated())).toEqual({
    posts: 3,
    months: 1,
    purchases: 1,
  });
});

test("exportFilename is stable and sortable", () => {
  expect(exportFilename("2026-09")).toBe("budget-2026-09.json");
});

describe("purchase dates", () => {
  test("accepts a full date and a month-only date", () => {
    const data = populated();
    data.purchases[0]!.date = "2026-01-15";
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
    data.purchases[0]!.date = "2026-01";
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("rejects a malformed date instead of letting the fold throw later", () => {
    const data = populated();
    data.purchases[0]!.date = "not-a-date";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/not-a-date/);
  });

  test("rejects an out-of-range month in a purchase date", () => {
    const data = populated();
    data.purchases[0]!.date = "2026-13-01";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-13-01/);
  });

  test("rejects an out-of-range day", () => {
    const data = populated();
    data.purchases[0]!.date = "2026-01-32";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-01-32/);
  });
});
