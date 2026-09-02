import { test, expect, describe } from "bun:test";
import { groupPurchasesByDate } from "./purchaseGroups.ts";
import type { Purchase } from "../domain/types.ts";

function purchase(id: string, date: string): Purchase {
  return {
    id,
    date,
    description: id,
    total: { amount: 100, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId: "p", value: 100, absorbsRemainder: true }],
    schedule: null,
  };
}

describe("grouping a month's purchases by day", () => {
  test("newest day first, and purchases keep their order within a day", () => {
    const groups = groupPurchasesByDate(
      [purchase("a", "2026-09-03"), purchase("b", "2026-09-12"), purchase("c", "2026-09-03")],
      "2026-09",
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-09-12", "2026-09-03"]);
    expect(groups[1]!.purchases.map((p) => p.id)).toEqual(["a", "c"]);
  });

  test("the heading names the weekday, which is what a person recognises", () => {
    const [group] = groupPurchasesByDate([purchase("a", "2026-09-12")], "2026-09");
    // 2026-09-12 is a Saturday.
    expect(group!.label).toBe("Sat 12 September");
  });

  /**
   * The weekday must not depend on where the machine is. Parsing
   * "2026-09-01" gives UTC midnight, so a getDay() in any negative-offset
   * zone reports the previous day — every heading would be wrong by one for
   * users west of Greenwich.
   */
  test("the weekday is timezone-independent", () => {
    const label = (tz: string) => {
      const original = process.env.TZ;
      process.env.TZ = tz;
      try {
        return groupPurchasesByDate([purchase("a", "2026-09-01")], "2026-09")[0]!.label;
      } finally {
        process.env.TZ = original;
      }
    };
    expect(label("UTC")).toBe("Tue 1 September");
    expect(label("America/Los_Angeles")).toBe("Tue 1 September");
    expect(label("Pacific/Kiritimati")).toBe("Tue 1 September");
  });

  /**
   * A finance plan's slices land in months after the purchase date, so in
   * those months the row's own date is not in view. Filing it under its real
   * date would put "14 August" inside the September list.
   */
  test("a slice from an earlier month is grouped apart, and last", () => {
    const groups = groupPurchasesByDate(
      [purchase("bike", "2026-08-14"), purchase("rent", "2026-09-01")],
      "2026-09",
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-09-01", "carried"]);
    expect(groups[1]!.label).toBe("Financed from earlier months");
    expect(groups[1]!.purchases.map((p) => p.id)).toEqual(["bike"]);
  });

  /** A purchase date may legally be "YYYY-MM" with no day at all. */
  test("a purchase with no day sits in its own group, after the dated ones", () => {
    const groups = groupPurchasesByDate(
      [purchase("vague", "2026-09"), purchase("rent", "2026-09-01")],
      "2026-09",
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-09-01", "undated"]);
    expect(groups[1]!.label).toBe("No day recorded");
  });

  test("an empty month is an empty list, not a group of nothing", () => {
    expect(groupPurchasesByDate([], "2026-09")).toEqual([]);
  });
});
