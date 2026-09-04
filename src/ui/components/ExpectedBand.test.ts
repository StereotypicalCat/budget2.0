import { describe, expect, test } from "bun:test";
import { expectedGroups, recordedDateFor, resolveExpectedAmount } from "./ExpectedBand.tsx";
import { occurrencesByMonth, wouldAdvancePast } from "../../domain/occurrences.ts";
import { confirmOccurrence } from "../../store/actions.ts";
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

// X2: the load-bearing decision behind the phone-bill behaviour is which date
// a Confirm click records. Nothing else in the suite would catch the two
// cases being swapped — this test must FAIL if `recordedDateFor`'s two arms
// are exchanged (verified by hand: swapping them and re-running does fail).
describe("recordedDateFor", () => {
  test("a this-month ('pending') row records at the slot's own date — null, confirmOccurrence's default", () => {
    expect(recordedDateFor("pending", "2026-09-04")).toBeNull();
  });

  test("a 'coming up' row records at today — paying early is the whole point", () => {
    expect(recordedDateFor("comingUp", "2026-09-04")).toBe("2026-09-04");
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

// A fixed "today" for tests where its exact value doesn't matter (any
// calendar-anchored cost advances regardless of it).
const TODAY = "2026-02-15";

// Gap 1 (spec §5): the band offers confirmation on the next pending
// occurrence, not only ones landing in the displayed month.
describe("expectedGroups (Coming up)", () => {
  test("a dataset with no recurring costs shows nothing — the component must return null", () => {
    const data = baseDataset();
    const groups = expectedGroups(data, "2026-02", TODAY);
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

    const groups = expectedGroups(data, "2026-02", TODAY);
    expect(groups.pending).toEqual([]);
    expect(groups.comingUp.length).toBe(1);
    expect(groups.comingUp[0]!.recurringId).toBe("phone");
    expect(groups.comingUp[0]!.date).toBe("2026-03");
  });

  test("at most one row per cost, even when several future occurrences fall within the horizon", () => {
    // A weekly cost produces many unconfirmed occurrences across the next
    // several months. Only the soonest one past the displayed month may
    // appear — never a list of everything the future holds. February's own
    // occurrences are confirmed first so X3 doesn't suppress the row this
    // test exists to check (a cost with an outstanding slot this month must
    // settle it before "coming up" offers a later one — covered separately
    // below).
    const data = baseDataset();
    data.recurring = [
      cost({
        id: "gym",
        startDate: "2026-02-02",
        recurrence: { kind: "everyNDays", n: 7 },
      }),
    ];
    data.purchases = [
      confirmed("gym", "2026-02-02", "p1"),
      confirmed("gym", "2026-02-09", "p2"),
      confirmed("gym", "2026-02-16", "p3"),
      confirmed("gym", "2026-02-23", "p4"),
    ];

    const groups = expectedGroups(data, "2026-02", TODAY);
    expect(groups.pending).toEqual([]);
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

    expect(expectedGroups(data, "2026-02", TODAY).comingUp).toEqual([]); // default (12) horizon
    // Raising the horizon far enough reveals the same occurrence, proving the
    // emptiness above is the bound, not a bug elsewhere.
    const wider = expectedGroups(data, "2026-02", TODAY, 16).comingUp;
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

    const groups = expectedGroups(data, "2026-02", TODAY);
    expect(groups.pending).toEqual([]);
    expect(groups.comingUp).toEqual([]);
  });

  test("overdue counts only earlier, foldable months and is unaffected by extending the walk for comingUp", () => {
    const data = baseDataset();
    data.settings.foldStartMonth = "2026-01";
    data.recurring = [cost({ id: "rent", startDate: "2026-01" })]; // Jan unconfirmed

    const groups = expectedGroups(data, "2026-02", TODAY);
    expect(groups.overdue).toBe(1);
  });
});

// X3: a cost must never appear in both "Expected" and "Coming up" at once —
// that is the path into X1 (confirming the later row while the earlier one
// is still outstanding writes a real purchase AND leaves the earlier
// projection standing, double-counting the bill).
describe("expectedGroups — X3 (a cost with an outstanding slot never also shows a coming-up row)", () => {
  test("this month's slot still pending suppresses the coming-up row for the SAME cost", () => {
    const data = baseDataset();
    data.recurring = [
      cost({
        id: "car",
        name: "Car insurance",
        amount: { amount: 349, currency: "DKK" },
        startDate: "2026-08-14",
        recurrence: { kind: "everyNDays", n: 30 },
        anchoring: "lastCharge",
      }),
    ];
    // Matches the reported demo shape exactly: no purchases at all, viewed
    // 2026-09. 2026-09-13 is pending; 2026-10-13 would otherwise be the
    // soonest future occurrence.
    data.settings.foldStartMonth = "2026-01";

    const groups = expectedGroups(data, "2026-09", "2026-09-04");
    expect(groups.pending.map((o) => o.date)).toEqual(["2026-09-13"]);
    expect(groups.comingUp).toEqual([]); // suppressed — settle September first
  });

  test("once the pending slot is settled, a coming-up row reappears — for a pairing that is itself safe", () => {
    // A monthly lastCharge cost, unlike the 30-day Car insurance above, is
    // always safe to confirm early (X1 never suppresses `everyNMonths`), so
    // this isolates X3's own effect: suppressed while this month is
    // outstanding, offered again once it is settled.
    const data = baseDataset();
    data.recurring = [cost({ id: "phone", anchoring: "lastCharge" })];

    let groups = expectedGroups(data, "2026-02", TODAY);
    expect(groups.pending.map((o) => o.date)).toEqual(["2026-02"]);
    expect(groups.comingUp).toEqual([]);

    confirmOccurrence(data, "phone", "2026-02", { date: "2026-02" });
    groups = expectedGroups(data, "2026-02", TODAY);
    expect(groups.pending).toEqual([]);
    expect(groups.comingUp.map((o) => o.date)).toEqual(["2026-03"]);
  });

  test("an outstanding occurrence in an earlier FOLDABLE month also suppresses the row", () => {
    const data = baseDataset();
    data.settings.foldStartMonth = "2026-01";
    data.recurring = [
      cost({ id: "rent", startDate: "2026-01", endedFrom: "2026-04" }),
    ];
    // January is unconfirmed; February (displayed month) and March are
    // confirmed, so nothing is `pending` and the only reason a coming-up row
    // would be suppressed is the outstanding January slot.
    data.purchases = [confirmed("rent", "2026-02", "p1"), confirmed("rent", "2026-03", "p2")];

    const groups = expectedGroups(data, "2026-02", TODAY);
    expect(groups.pending).toEqual([]);
    expect(groups.comingUp).toEqual([]); // January is still outstanding
  });
});

// X1: a coming-up row confirms at today's date rather than its own slot, and
// `occurrencesOf` throws — permanently, since the purchase persists — if that
// pairing cannot advance the series. The band must never OFFER such a row.
describe("expectedGroups — X1 (a coming-up row that cannot be confirmed coherently is never offered)", () => {
  test("wouldAdvancePast identifies the exact reported pairing as unsafe", () => {
    const car = cost({
      id: "car",
      name: "Car insurance",
      recurrence: { kind: "everyNDays", n: 30 },
      anchoring: "lastCharge",
    });
    // 39 days between "today" and the slot — more than one 30-day cycle.
    expect(wouldAdvancePast(car, "2026-10-13", "2026-09-04")).toBe(false);
    // A slot close enough to today (a few days, the "paid early" case) is fine.
    expect(wouldAdvancePast(car, "2026-09-13", "2026-09-04")).toBe(true);
  });

  test("stays suppressed even once X3 no longer applies — settling this month doesn't make a too-early payment safe", () => {
    // Same Car insurance shape, but September's slot is settled ON TIME
    // first, so X3 no longer has anything to suppress. The October row is
    // still 39 days from `today` — more than one 30-day cycle — so X1 alone
    // must keep it off the list.
    const data = baseDataset();
    data.recurring = [
      cost({
        id: "car",
        name: "Car insurance",
        amount: { amount: 349, currency: "DKK" },
        startDate: "2026-08-14",
        recurrence: { kind: "everyNDays", n: 30 },
        anchoring: "lastCharge",
      }),
    ];
    confirmOccurrence(data, "car", "2026-09-13", { date: "2026-09-13" });

    const groups = expectedGroups(data, "2026-09", "2026-09-04");
    expect(groups.pending).toEqual([]);
    expect(groups.comingUp).toEqual([]);
  });

  test("confirming an unsafe pairing directly still throws — the domain guard is untouched", () => {
    const data = baseDataset();
    data.recurring = [
      cost({
        id: "car",
        name: "Car insurance",
        amount: { amount: 349, currency: "DKK" },
        startDate: "2026-08-14",
        recurrence: { kind: "everyNDays", n: 30 },
        anchoring: "lastCharge",
      }),
    ];
    confirmOccurrence(data, "car", "2026-10-13", { date: "2026-09-04" });
    expect(() => occurrencesByMonth(data, "2026-10")).toThrow(
      /did not advance past 2026-10-13 \(produced 2026-10-04\)/,
    );
  });

  test("regression: whatever expectedGroups offers as 'coming up', confirming it all today and folding never throws (demo Car insurance shape)", () => {
    const data = baseDataset();
    data.recurring = [
      cost({
        id: "car",
        name: "Car insurance",
        amount: { amount: 349, currency: "DKK" },
        startDate: "2026-08-14",
        recurrence: { kind: "everyNDays", n: 30 },
        anchoring: "lastCharge",
      }),
      cost({
        id: "phone",
        name: "Phone",
        startDate: "2026-01",
        recurrence: { kind: "everyNMonths", n: 1 },
        anchoring: "lastCharge",
      }),
    ];
    data.purchases = [confirmed("phone", "2026-02", "p0")]; // settled through Feb, unlike Car
    const today = "2026-09-04";

    const groups = expectedGroups(data, "2026-09", today);
    // Car insurance is suppressed entirely (X3: 2026-09-13 is still pending),
    // and even confirming everything else offered must never break the fold.
    expect(groups.comingUp.some((o) => o.recurringId === "car")).toBe(false);

    for (const occurrence of groups.comingUp) {
      confirmOccurrence(data, occurrence.recurringId, occurrence.date, { date: today });
    }

    expect(() => occurrencesByMonth(data, "2026-10")).not.toThrow();
  });
});
