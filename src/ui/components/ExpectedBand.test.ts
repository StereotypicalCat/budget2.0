import { describe, expect, test } from "bun:test";
import { expectedGroups, resolveExpectedAmount } from "./ExpectedBand.tsx";
import { createSeedDataset } from "../../domain/seed.ts";
import type { Dataset, Purchase, RecurringCost } from "../../domain/types.ts";

const DKK_USD = [
  { code: "DKK", symbol: "kr" },
  { code: "USD", symbol: "$" },
];

// I5: an unrecognised currency must not silently confirm at the cost's own
// amount. `resolveExpectedAmount` is the logic ExpectedBand's Confirm button
// uses to decide whether to write a purchase at all.
describe("resolveExpectedAmount", () => {
  test("untouched (typed undefined) is not invalid, and parses to nothing — the fast path", () => {
    const result = resolveExpectedAmount(undefined, DKK_USD, "DKK");
    expect(result.invalid).toBe(false);
    expect(result.parsed).toBeNull();
  });

  test("edited text that parses is not invalid", () => {
    const result = resolveExpectedAmount("450", DKK_USD, "DKK");
    expect(result.invalid).toBe(false);
    expect(result.parsed).toEqual({ amount: 450, currency: "DKK" });
  });

  test("edited text naming a currency the dataset doesn't have is invalid, not a silent fallback", () => {
    // This is the exact bug: "30 GBP" in a DKK/USD dataset used to fall back
    // to the cost's own amount via `parsed ?? undefined`.
    const result = resolveExpectedAmount("30 GBP", DKK_USD, "DKK");
    expect(result.invalid).toBe(true);
    expect(result.parsed).toBeNull();
  });

  test("edited text that is empty or otherwise unparseable is invalid", () => {
    expect(resolveExpectedAmount("", DKK_USD, "DKK").invalid).toBe(true);
    expect(resolveExpectedAmount("thirty", DKK_USD, "DKK").invalid).toBe(true);
  });
});

function baseDataset(): Dataset {
  const data = createSeedDataset("2026-02");
  data.posts[0]!.id = "housing";
  return data;
}

function cost(overrides: Partial<RecurringCost> = {}): RecurringCost {
  return {
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
    ...overrides,
  };
}

function confirmed(recurringId: string, occurrenceDate: string, id: string): Purchase {
  return {
    id,
    date: occurrenceDate,
    description: "x",
    total: { amount: 8000, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    schedule: null,
    source: { recurringId, occurrenceDate },
  };
}

// Gap 1 (spec §5): the band offers confirmation on the next pending
// occurrence, not only ones landing in the displayed month.
describe("expectedGroups (Coming up)", () => {
  test("a dataset with no recurring costs shows nothing — the component must return null", () => {
    const data = baseDataset();
    const groups = expectedGroups(data, "2026-02");
    expect(groups.pending).toEqual([]);
    expect(groups.overdue).toBe(0);
    expect(groups.comingUp).toEqual([]);
  });

  test("a lastCharge bill's next occurrence next month is offered as 'coming up', not hidden until you navigate", () => {
    // The flagship scenario: displayed month is February, the pending slot
    // sits in March because rent-like accounting isn't in play here — a
    // monthly cost's only occurrence for a month IS next month once this
    // month's is confirmed.
    const data = baseDataset();
    data.recurring = [cost({ id: "phone", anchoring: "lastCharge" })];
    data.purchases = [confirmed("phone", "2026-02", "p1")]; // this month's is done

    const groups = expectedGroups(data, "2026-02");
    expect(groups.pending).toEqual([]);
    expect(groups.comingUp.length).toBe(1);
    expect(groups.comingUp[0]!.recurringId).toBe("phone");
    expect(groups.comingUp[0]!.date).toBe("2026-03");
  });

  test("at most one row per cost, even when several future occurrences fall within the horizon", () => {
    // A weekly cost produces many unconfirmed occurrences across the next
    // several months. Only the soonest one past the displayed month may
    // appear — never a list of everything the future holds.
    const data = baseDataset();
    data.recurring = [
      cost({
        id: "gym",
        startDate: "2026-02-02",
        recurrence: { kind: "everyNDays", n: 7 },
      }),
    ];

    const groups = expectedGroups(data, "2026-02");
    // Four Monday-ish occurrences fall in February itself.
    expect(groups.pending.length).toBe(4);
    // Many more unconfirmed occurrences exist in March, April, ... within the
    // horizon — but comingUp holds exactly one.
    const forThisCost = groups.comingUp.filter((o) => o.recurringId === "gym");
    expect(forThisCost.length).toBe(1);
    expect(forThisCost[0]!.date).toBe("2026-03-02"); // the soonest one past February
  });

  test("the horizon is bounded: a cost whose next occurrence lands beyond it does not appear", () => {
    const data = baseDataset();
    // Interval bigger than the default horizon: confirmed this month, the
    // next occurrence is 15 months out — past the 12-month default.
    data.recurring = [
      cost({
        id: "insurance",
        startDate: "2026-02",
        recurrence: { kind: "everyNMonths", n: 15 },
      }),
    ];
    data.purchases = [confirmed("insurance", "2026-02", "p1")];

    expect(expectedGroups(data, "2026-02").comingUp).toEqual([]); // default (12) horizon
    // Raising the horizon far enough reveals the same occurrence, proving the
    // emptiness above is the bound, not a bug elsewhere.
    const wider = expectedGroups(data, "2026-02", 16).comingUp;
    expect(wider.length).toBe(1);
    expect(wider[0]!.date).toBe("2027-05");
  });

  test("a confirmed future occurrence never appears in comingUp", () => {
    const data = baseDataset();
    // Ends right after March, so April onward is never generated at all —
    // isolating the point of the test (a confirmed slot is excluded) from an
    // unrelated, genuinely-unconfirmed one the walk would otherwise reach.
    data.recurring = [cost({ id: "rent", endedFrom: "2026-04" })];
    data.purchases = [confirmed("rent", "2026-02", "p1"), confirmed("rent", "2026-03", "p2")];

    const groups = expectedGroups(data, "2026-02");
    expect(groups.pending).toEqual([]);
    expect(groups.comingUp).toEqual([]);
  });

  test("overdue counts only earlier, foldable months and is unaffected by extending the walk for comingUp", () => {
    const data = baseDataset();
    data.settings.foldStartMonth = "2026-01";
    data.recurring = [cost({ id: "rent", startDate: "2026-01" })]; // Jan unconfirmed

    const groups = expectedGroups(data, "2026-02");
    expect(groups.overdue).toBe(1);
  });
});
