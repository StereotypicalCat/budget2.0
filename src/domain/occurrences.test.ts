import { describe, expect, test } from "bun:test";
import { occurrencesByMonth, occurrencesOf, stepFrom } from "./occurrences.ts";
import type { Dataset, Purchase, RecurringCost } from "./types.ts";

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

function confirmation(occurrenceDate: string, paidOn: string, id = "p1"): Purchase {
  return {
    id,
    date: paidOn,
    description: "Rent",
    total: { amount: 8000, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    schedule: null,
    source: { recurringId: "r1", occurrenceDate },
  };
}

const none = new Map<string, Purchase>();

describe("stepFrom", () => {
  test("everyNMonths steps whole months and stays month-granular", () => {
    expect(stepFrom("2026-01", { kind: "everyNMonths", n: 1 })).toBe("2026-02");
    expect(stepFrom("2026-11", { kind: "everyNMonths", n: 3 })).toBe("2027-02");
  });

  test("everyNMonths from a day-granular date returns the month", () => {
    // Reachable under lastCharge anchoring, where the step runs from an actual
    // purchase date.
    expect(stepFrom("2026-01-17", { kind: "everyNMonths", n: 1 })).toBe("2026-02");
  });

  test("everyNDays steps days", () => {
    expect(stepFrom("2026-01-05", { kind: "everyNDays", n: 28 })).toBe("2026-02-02");
    expect(stepFrom("2026-01-31", { kind: "everyNDays", n: 30 })).toBe("2026-03-02");
  });

  test("everyNWeeks lands on the named weekday", () => {
    // 2026-09-03 is a Thursday (4). Two weeks on is 2026-09-17, also Thursday.
    expect(stepFrom("2026-09-03", { kind: "everyNWeeks", n: 2, weekday: 4 })).toBe("2026-09-17");
  });

  test("everyNWeeks snaps forward when the cursor is off-weekday", () => {
    // Reachable under lastCharge: paid on a Saturday, but the series is Thursdays.
    // 2026-09-05 is a Saturday; +1 week is 2026-09-12 (Saturday), snapping
    // forward to the next Thursday gives 2026-09-17.
    expect(stepFrom("2026-09-05", { kind: "everyNWeeks", n: 1, weekday: 4 })).toBe("2026-09-17");
  });
});

describe("occurrencesOf — calendar anchoring", () => {
  test("a monthly cost yields one occurrence per month", () => {
    const dates = occurrencesOf(cost(), none, "2026-04").map((o) => o.date);
    expect(dates).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  test("a 28-day cost puts two occurrences in some months", () => {
    const subscription = cost({
      startDate: "2026-01-05",
      recurrence: { kind: "everyNDays", n: 28 },
    });
    const dates = occurrencesOf(subscription, none, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-05", "2026-02-02", "2026-03-02", "2026-03-30"]);
  });

  test("nothing is produced before the start date", () => {
    const later = cost({ startDate: "2026-03" });
    expect(occurrencesOf(later, none, "2026-04").map((o) => o.date)).toEqual([
      "2026-03",
      "2026-04",
    ]);
  });

  test("endedFrom stops the series, and the boundary date itself is excluded", () => {
    const ended = cost({ endedFrom: "2026-03" });
    expect(occurrencesOf(ended, none, "2026-06").map((o) => o.date)).toEqual([
      "2026-01",
      "2026-02",
    ]);
  });

  test("a confirmation does NOT move a calendar-anchored series", () => {
    const paidLate = new Map([["2026-01", confirmation("2026-01", "2026-01-28")]]);
    const dates = occurrencesOf(cost(), paidLate, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  test("archived does not stop projection", () => {
    // Archiving is a UI flag. Stopping a bill is endedFrom, because archiving
    // must not retroactively remove a past expected charge.
    const dates = occurrencesOf(cost({ archived: true }), none, "2026-02").map((o) => o.date);
    expect(dates).toEqual(["2026-01", "2026-02"]);
  });
});

describe("occurrencesOf — confirmation", () => {
  test("a confirmed slot carries the purchase id", () => {
    const claimed = new Map([["2026-02", confirmation("2026-02", "2026-02", "pX")]]);
    const found = occurrencesOf(cost(), claimed, "2026-03");
    expect(found.map((o) => o.confirmedBy)).toEqual([null, "pX", null]);
  });

  test("a slot is claimed by occurrenceDate, not by the purchase's own date", () => {
    // Paid on the 28th for the slot dated 2026-01. The slot is claimed; a new
    // one does not appear.
    const claimed = new Map([["2026-01", confirmation("2026-01", "2026-01-28", "pY")]]);
    const found = occurrencesOf(cost(), claimed, "2026-02");
    expect(found[0]!.confirmedBy).toBe("pY");
    expect(found[1]!.confirmedBy).toBeNull();
  });
});

describe("occurrencesOf — lastCharge anchoring: the phone bill", () => {
  const phone = cost({
    id: "r1",
    name: "Phone",
    startDate: "2026-01-01",
    recurrence: { kind: "everyNDays", n: 30 },
    anchoring: "lastCharge",
  });

  test("unconfirmed, it behaves exactly like a calendar series", () => {
    // Each occurrence steps from its own projected date: the projection assumes
    // bills are paid on time.
    const dates = occurrencesOf(phone, none, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-01", "2026-01-31", "2026-03-02"]);
  });

  test("hitting the data cap early rebases the whole series", () => {
    // The slot sits at 2026-01-31. The cap is hit on the 12th, so the owner
    // confirms THAT slot with a purchase dated 2026-01-12. The next occurrence
    // is 30 days after the 12th, not after the 31st.
    const capHit = new Map([
      ["2026-01-01", confirmation("2026-01-01", "2026-01-01", "pA")],
      ["2026-01-31", confirmation("2026-01-31", "2026-01-12", "pB")],
    ]);
    const dates = occurrencesOf(phone, capHit, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-01", "2026-01-31", "2026-02-11", "2026-03-13"]);
  });

  test("the cap can be hit twice", () => {
    const twice = new Map([
      ["2026-01-01", confirmation("2026-01-01", "2026-01-01", "pA")],
      ["2026-01-31", confirmation("2026-01-31", "2026-01-12", "pB")],
      ["2026-02-11", confirmation("2026-02-11", "2026-01-20", "pC")],
    ]);
    const dates = occurrencesOf(phone, twice, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-01", "2026-01-31", "2026-02-11", "2026-02-19", "2026-03-21"]);
  });

  test("deleting the confirming purchase un-confirms the slot and restores the series", () => {
    // CONTROLLER RULING: the brief's original version of this test was
    // byte-identical to "unconfirmed, it behaves exactly like a calendar
    // series" above and asserted nothing new. Rewritten to actually contrast
    // the two states: walk WITH the capHit confirmations (rebased dates),
    // then walk the SAME cost with an empty map (as if the confirming
    // purchase had been deleted) and assert the dates differ and match the
    // plain unconfirmed series.
    const capHit = new Map([
      ["2026-01-01", confirmation("2026-01-01", "2026-01-01", "pA")],
      ["2026-01-31", confirmation("2026-01-31", "2026-01-12", "pB")],
    ]);
    const rebased = occurrencesOf(phone, capHit, "2026-03").map((o) => o.date);
    expect(rebased).toEqual(["2026-01-01", "2026-01-31", "2026-02-11", "2026-03-13"]);

    // Deleting the confirming purchase leaves no entry in the confirmations
    // map for that slot — this is what an empty map models here, since the
    // slot in question (2026-01-31) is the only one whose confirmation
    // affects downstream dates.
    const afterDelete = occurrencesOf(phone, none, "2026-03").map((o) => o.date);
    expect(afterDelete).not.toEqual(rebased);
    expect(afterDelete).toEqual(["2026-01-01", "2026-01-31", "2026-03-02"]);
  });
});

describe("occurrencesOf — termination", () => {
  test("a confirmation dated absurdly early throws rather than walking backwards", () => {
    // The ONLY way a valid recurrence fails to advance. Under lastCharge the
    // step runs from the confirmation's own date, so a payment recorded more
    // than n days before the slot it claims would move the cursor backwards.
    // A visible error beats a fold that silently emits duplicate months.
    const phone = cost({
      startDate: "2026-01-01",
      recurrence: { kind: "everyNDays", n: 30 },
      anchoring: "lastCharge",
    });
    const outOfOrder = new Map([
      ["2026-01-31", confirmation("2026-01-31", "2025-11-02", "pBad")],
    ]);
    expect(() => occurrencesOf(phone, outOfOrder, "2026-03")).toThrow(/did not advance/);
  });

  test("a recurrence that cannot advance throws rather than hanging", () => {
    const broken = cost({ recurrence: { kind: "everyNDays", n: 0 }, startDate: "2026-01-01" });
    expect(() => occurrencesOf(broken, none, "2026-02")).toThrow(/did not advance/);
  });

  test("a negative step throws too", () => {
    const backwards = cost({ recurrence: { kind: "everyNDays", n: -7 }, startDate: "2026-01-01" });
    expect(() => occurrencesOf(backwards, none, "2026-02")).toThrow(/did not advance/);
  });
});

describe("occurrencesByMonth", () => {
  function dataset(recurring: RecurringCost[], purchases: Purchase[] = []): Dataset {
    return {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 7, digits: 2 },
      currencies: [{ code: "DKK", symbol: "kr", name: "Danish krone" }],
      fxRates: [],
      posts: [],
      months: [],
      purchases,
      recurring,
    };
  }

  test("groups every cost's occurrences by the month they land in", () => {
    const byMonth = occurrencesByMonth(
      dataset([
        cost({ id: "rent", startDate: "2026-01" }),
        cost({ id: "wow", startDate: "2026-01-05", recurrence: { kind: "everyNDays", n: 28 } }),
      ]),
      "2026-02",
    );

    expect(byMonth.get("2026-01")!.map((o) => o.recurringId).sort()).toEqual(["rent", "wow"]);
    expect(byMonth.get("2026-02")!.map((o) => o.recurringId).sort()).toEqual(["rent", "wow"]);
  });

  test("a purchase confirming one cost does not claim another cost's slot", () => {
    const shared = confirmation("2026-01", "2026-01", "pZ");
    const byMonth = occurrencesByMonth(
      dataset([cost({ id: "r1" }), cost({ id: "r2" })], [shared]),
      "2026-01",
    );
    const january = byMonth.get("2026-01")!;
    expect(january.find((o) => o.recurringId === "r1")!.confirmedBy).toBe("pZ");
    expect(january.find((o) => o.recurringId === "r2")!.confirmedBy).toBeNull();
  });

  test("months with no occurrence have no entry at all", () => {
    const byMonth = occurrencesByMonth(dataset([cost({ endedFrom: "2026-02" })]), "2026-04");
    expect(byMonth.has("2026-01")).toBe(true);
    expect(byMonth.has("2026-02")).toBe(false);
  });
});
