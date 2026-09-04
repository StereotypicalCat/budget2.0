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

  test("rejects a non-array recurring field instead of silently importing it as empty (M7)", () => {
    // The other four sibling collections already go through requireArray;
    // recurring used to fall back to [] instead of being rejected here.
    const data = populated() as any;
    data.recurring = "not an array";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/recurring/);
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
    // CHF, not GBP: GBP is one of the currencies the app ships with now.
    data.settings.baseCurrency = "CHF";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/CHF/);
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

describe("the decimal-places setting on import", () => {
  test("a valid setting round-trips", () => {
    const data = populated();
    data.settings.digits = 0;
    expect(parseDatasetJson(exportDatasetJson(data)).settings.digits).toBe(0);
  });

  test.each([
    ["missing", undefined],
    ["fractional", 1.5],
    ["negative", -1],
    ["beyond four places", 5],
    ["a string", "2"],
  ])("a %s setting is refused", (_label, value) => {
    const data = populated() as any;
    if (value === undefined) delete data.settings.digits;
    else data.settings.digits = value;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(ImportValidationError);
  });

  test("a per-currency digits left over in a hand-edited file is ignored, not refused", () => {
    // An unknown field is not a reason to refuse the owner's only backup.
    const data = populated() as any;
    data.currencies[0].digits = 3;
    const out = parseDatasetJson(JSON.stringify(data));
    expect("digits" in out.currencies[0]!).toBe(false);
    expect(out.settings.digits).toBe(2);
  });
});

describe("recurring cost validation", () => {
  function withRecurring(recurring: unknown[]): string {
    const data: any = createSeedDataset("2026-01");
    data.posts[0].id = "housing";
    data.recurring = recurring;
    return JSON.stringify(data);
  }

  const valid = {
    id: "r1",
    name: "Rent",
    order: 0,
    archived: false,
    amount: { amount: 8000, currency: "DKK" },
    startDate: "2026-01",
    recurrence: { kind: "everyNMonths", n: 1 },
    anchoring: "calendar",
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
  };

  test("a well-formed cost is accepted", () => {
    expect(parseDatasetJson(withRecurring([valid])).recurring.length).toBe(1);
  });

  test("an undefined currency is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, amount: { amount: 1, currency: "XYZ" } }])))
      .toThrow(/Unsupported currency/);
  });

  test("a malformed start date is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, startDate: "2026-13" }])))
      .toThrow(/start date/);
  });

  test("a malformed endedFrom is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, endedFrom: "nope" }])))
      .toThrow(/ended-from date/);
  });

  // Same residual-C1 gap as startDate: PURCHASE_DATE checks shape and digit
  // range, not calendar validity, so "2026-02-30" passes it. §10: endedFrom
  // carries no granularity rule, but it must still be a real date.
  test("a calendar-impossible endedFrom is refused (day- or month-shaped)", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, endedFrom: "2026-02-30" }])))
      .toThrow(/calendar-impossible ended-from/);
    expect(() => parseDatasetJson(withRecurring([{ ...valid, endedFrom: "2026-02-29" }]))) // not a leap year
      .toThrow(/calendar-impossible ended-from/);
  });

  test("a valid endedFrom of either granularity is accepted, regardless of recurrence kind", () => {
    expect(
      parseDatasetJson(withRecurring([{ ...valid, endedFrom: "2026-06" }])).recurring.length,
    ).toBe(1);
    expect(
      parseDatasetJson(
        withRecurring([{ ...valid, endedFrom: "2026-06-17" }]), // month-only recurrence, day-granular end
      ).recurring.length,
    ).toBe(1);
  });

  test("an interval below 1 is refused, not clamped", () => {
    // Clamping would silently change the bill's schedule. The walk in
    // occurrences.ts cannot terminate without this.
    expect(() => parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyNDays", n: 0 } }])))
      .toThrow(/at least 1/);
  });

  test("a fractional interval is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyNDays", n: 1.5 } }])))
      .toThrow(/whole number/);
  });

  test("everyNMonths accepts either startDate granularity (C1)", () => {
    expect(parseDatasetJson(withRecurring([{ ...valid, startDate: "2026-01" }])).recurring.length).toBe(1);
    expect(parseDatasetJson(withRecurring([{ ...valid, startDate: "2026-01-15" }])).recurring.length).toBe(1);
  });

  test("everyNDays with a month-only startDate is refused (C1)", () => {
    // This is the exact reachable bug: occurrencesOf hands a month-only
    // startDate straight to addDays for a day-granular kind and throws deep
    // inside the fold. Reject it here instead, at the import boundary.
    expect(() =>
      parseDatasetJson(
        withRecurring([{ ...valid, startDate: "2026-01", recurrence: { kind: "everyNDays", n: 30 } }]),
      ),
    ).toThrow(/month-only start date/);
  });

  test("everyNWeeks with a month-only startDate is refused (C1)", () => {
    expect(() =>
      parseDatasetJson(
        withRecurring([
          { ...valid, startDate: "2026-01", recurrence: { kind: "everyNWeeks", n: 1, weekday: 2 } },
        ]),
      ),
    ).toThrow(/month-only start date/);
  });

  test("everyNDays with a day-granular startDate is accepted (C1)", () => {
    expect(
      parseDatasetJson(
        withRecurring([{ ...valid, startDate: "2026-01-05", recurrence: { kind: "everyNDays", n: 30 } }]),
      ).recurring.length,
    ).toBe(1);
  });

  // Residual C1: PURCHASE_DATE/DAY_GRANULAR_DATE check shape and range
  // ("31" is a valid day-of-month digit pair), not calendar validity.
  // September has 30 days, so "2026-09-31" passed both regexes and the
  // fold later threw "Invalid day in IsoDate" out of addDays/toDayOrdinal.
  test("an impossible day on a day-granular kind is refused, not just shape-checked (residual C1)", () => {
    expect(() =>
      parseDatasetJson(
        withRecurring([
          { ...valid, startDate: "2026-02-30", recurrence: { kind: "everyNDays", n: 1 } },
        ]),
      ),
    ).toThrow(/calendar-impossible/);
  });

  test("an impossible day is refused even under everyNMonths (residual C1)", () => {
    expect(() =>
      parseDatasetJson(withRecurring([{ ...valid, startDate: "2026-09-31" }])),
    ).toThrow(/calendar-impossible/);
  });

  test("leap-year and non-leap-year Februaries are accepted (residual C1)", () => {
    expect(
      parseDatasetJson(
        withRecurring([
          { ...valid, startDate: "2024-02-29", recurrence: { kind: "everyNDays", n: 1 } }, // 2024 is a leap year
        ]),
      ).recurring.length,
    ).toBe(1);
    expect(
      parseDatasetJson(
        withRecurring([
          { ...valid, startDate: "2026-02-28", recurrence: { kind: "everyNDays", n: 1 } }, // 2026 is not
        ]),
      ).recurring.length,
    ).toBe(1);
  });

  test("an unknown recurrence kind is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyFullMoon", n: 1 } }])))
      .toThrow(/unknown kind/);
  });

  test("a weekday outside 0-6 is refused", () => {
    expect(() =>
      parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyNWeeks", n: 1, weekday: 7 } }])),
    ).toThrow(/weekday/);
  });

  test("an unknown anchoring is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, anchoring: "whenever" }])))
      .toThrow(/anchoring/);
  });

  test("splits must have exactly one remainder absorber", () => {
    expect(() =>
      parseDatasetJson(withRecurring([{
        ...valid,
        splits: [
          { postId: "housing", value: 50, absorbsRemainder: true },
          { postId: "housing", value: 50, absorbsRemainder: true },
        ],
      }])),
    ).toThrow(/absorbsRemainder/);
  });

  test("a split naming an unknown post is refused", () => {
    expect(() =>
      parseDatasetJson(withRecurring([{
        ...valid,
        splits: [{ postId: "ghost", value: 100, absorbsRemainder: true }],
      }])),
    ).toThrow(/unknown post/);
  });

  test("no splits at all is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, splits: [] }])))
      .toThrow(/no splits/);
  });

  test("a null recurring cost entry is refused, not a raw TypeError", () => {
    // `recurring: [null]` used to reach `cost.id`/`cost.name` unguarded and
    // throw TypeError instead of the file's own ImportValidationError.
    expect(() => parseDatasetJson(withRecurring([null]))).toThrow(ImportValidationError);
  });

  test("an unknown splitMode is refused", () => {
    // charges.ts picks distributeByWeight/distributeByAmount on
    // `splitMode === "percent"`; any other string silently takes the "fixed"
    // branch and treats a percentage as an absolute amount.
    expect(() => parseDatasetJson(withRecurring([{ ...valid, splitMode: "ratio" }])))
      .toThrow(/splitMode/);
  });

  test("a non-numeric split value is refused", () => {
    // A non-finite value would otherwise propagate as NaN through the fold,
    // and roundMoney(NaN, digits) returns NaN rather than throwing.
    expect(() =>
      parseDatasetJson(withRecurring([{
        ...valid,
        splits: [{ postId: "housing", value: "oops", absorbsRemainder: true }],
      }])),
    ).toThrow(/finite number/);
  });

  test("a negative split value is still accepted", () => {
    // Deliberately unchecked per AGENTS.md §3: a refund is a normal line.
    // Only non-numbers are rejected, never a negative or over-100 value.
    expect(() =>
      parseDatasetJson(withRecurring([{
        ...valid,
        splits: [{ postId: "housing", value: -50, absorbsRemainder: true }],
      }])),
    ).not.toThrow();
  });
});

describe("Purchase.source validation", () => {
  function withSource(source: unknown): string {
    const data: any = createSeedDataset("2026-01");
    data.posts[0].id = "housing";
    data.recurring = [];
    data.purchases = [{
      id: "p1",
      date: "2026-01",
      description: "Rent",
      total: { amount: 8000, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null,
      source,
    }];
    return JSON.stringify(data);
  }

  test("a purchase with no source is fine", () => {
    const data: any = createSeedDataset("2026-01");
    data.recurring = [];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("a source naming an unknown cost is refused", () => {
    expect(() => parseDatasetJson(withSource({ recurringId: "ghost", occurrenceDate: "2026-01" })))
      .toThrow(/unknown recurring cost/);
  });

  test("a source with a malformed occurrence date is refused", () => {
    const data: any = JSON.parse(withSource({ recurringId: "r1", occurrenceDate: "nope" }));
    data.recurring = [{
      id: "r1", name: "Rent", order: 0, archived: false,
      amount: { amount: 8000, currency: "DKK" },
      startDate: "2026-01",
      recurrence: { kind: "everyNMonths", n: 1 },
      anchoring: "calendar",
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    }];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/occurrence date/);
  });

  test("a source of null is refused, not a raw TypeError", () => {
    // `source: null` used to reach `null.recurringId` unguarded — a plausible
    // hand-edit, since the sibling field on the same object literal IS
    // `schedule: null`. `source` is typed absent-or-object, never null, so
    // this must fail as ImportValidationError, not TypeError.
    expect(() => parseDatasetJson(withSource(null))).toThrow(ImportValidationError);
  });
});

describe("purchase splits validation", () => {
  // I1/I2 apply identically to purchases: the shared requireSplits() helper
  // must not check purchases to a lower standard than recurring costs.
  test("an unknown splitMode on a purchase is refused", () => {
    const data: any = populated();
    data.purchases[0].splitMode = "ratio";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/splitMode/);
  });

  test("a non-numeric split value on a purchase is refused", () => {
    const data: any = populated();
    data.purchases[0].splits[0].value = "oops";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/finite number/);
  });

  test("a negative split value on a purchase is still accepted", () => {
    const data: any = populated();
    data.purchases[0].splits[0].value = -70;
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("a well-formed purchase still round-trips through the shared helper", () => {
    const data = populated();
    expect(parseDatasetJson(exportDatasetJson(data)).purchases.length).toBe(1);
  });
});
