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

describe("rule versions on import", () => {
  const pct = (percent: number) => ({ kind: "percentOfIncome" as const, percent });

  test("accepts a well-formed series", () => {
    const data = populated();
    data.posts[0]!.rules = [
      { from: "2026-01", rule: pct(10) },
      { from: "2026-07", rule: pct(15) },
    ];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("accepts an empty series — an unbudgeted post is legal", () => {
    const data = populated();
    data.posts[0]!.rules = [];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("rejects a post whose rules is missing or not an array", () => {
    const data = populated() as any;
    delete data.posts[0].rules;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/rules/);
  });

  test("rejects a malformed from month", () => {
    const data = populated();
    data.posts[0]!.rules = [{ from: "2026-1", rule: pct(10) }];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-1/);
  });

  test("rejects an out-of-range from month", () => {
    const data = populated();
    data.posts[0]!.rules = [{ from: "2026-13", rule: pct(10) }];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-13/);
  });

  test("rejects two versions sharing a month, which would be ambiguous", () => {
    const data = populated();
    data.posts[0]!.rules = [
      { from: "2026-04", rule: pct(10) },
      { from: "2026-04", rule: pct(15) },
    ];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-04/);
  });

  test("does NOT reject a percentage above 100", () => {
    const data = populated();
    data.posts[0]!.rules = [{ from: "2026-01", rule: pct(150) }];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("does NOT reject a negative fixed amount", () => {
    const data = populated();
    data.posts[0]!.rules = [
      { from: "2026-01", rule: { kind: "fixed", amount: { amount: -500, currency: "DKK" } } },
    ];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  // Without this, toBase() throws MissingRateError deep inside the balance
  // fold instead of at the import boundary.
  test("rejects a fixed rule in an unsupported currency", () => {
    const data = populated() as any;
    data.posts[0].rules = [
      { from: "2026-01", rule: { kind: "fixed", amount: { amount: 500, currency: "XYZ" } } },
    ];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/XYZ/);
  });

  // Without this, resolveRule() falls through to the percentage branch and
  // every figure downstream of it becomes NaN, silently.
  test("rejects a rule of an unrecognized kind", () => {
    const data = populated() as any;
    data.posts[0].rules = [{ from: "2026-01", rule: { kind: "everySecondTuesday" } }];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/everySecondTuesday/);
  });
});
