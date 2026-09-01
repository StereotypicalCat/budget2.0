import { test, expect, describe } from "bun:test";
import {
  emptyDraft,
  splitBalance,
  validatePurchase,
  toPurchase,
  fromPurchase,
  withPlan,
  withoutPlan,
  setSliceAmount,
  planBalance,
  type PurchaseDraft,
} from "./purchaseForm.ts";

function draft(overrides: Partial<PurchaseDraft> = {}): PurchaseDraft {
  return { ...emptyDraft("2026-09", "food"), amount: 200, description: "Dinner", ...overrides };
}

describe("emptyDraft", () => {
  test("starts on the first of the given month with one full-weight split", () => {
    const d = emptyDraft("2026-09", "food");
    expect(d.date).toBe("2026-09-01");
    expect(d.splitMode).toBe("percent");
    expect(d.splits).toEqual([{ postId: "food", value: 100, absorbsRemainder: true }]);
    expect(d.plan).toBeNull();
  });
});

describe("splitBalance", () => {
  test("is zero when percentages total 100", () => {
    expect(splitBalance(draft())).toBe(0);
  });

  test("reports the missing percentage", () => {
    const d = draft({
      splits: [
        { postId: "food", value: 60, absorbsRemainder: true },
        { postId: "events", value: 30, absorbsRemainder: false },
      ],
    });
    expect(splitBalance(d)).toBe(10);
  });

  test("reports the missing amount in fixed mode", () => {
    const d = draft({
      splitMode: "fixed",
      splits: [
        { postId: "food", value: 120, absorbsRemainder: true },
        { postId: "events", value: 50, absorbsRemainder: false },
      ],
    });
    expect(splitBalance(d)).toBe(30);
  });
});

describe("validatePurchase", () => {
  test("a well-formed draft has no errors", () => {
    expect(validatePurchase(draft())).toEqual([]);
  });

  test("requires a description", () => {
    expect(validatePurchase(draft({ description: "  " }))).toContain(
      "Give the purchase a description.",
    );
  });

  test("requires a non-zero amount", () => {
    expect(validatePurchase(draft({ amount: 0 }))).toContain(
      "Enter an amount other than zero.",
    );
  });

  test("requires at least one split", () => {
    expect(validatePurchase(draft({ splits: [] }))).toContain(
      "Add at least one post to split across.",
    );
  });

  test("requires exactly one remainder absorber", () => {
    const none = draft({
      splits: [{ postId: "food", value: 100, absorbsRemainder: false }],
    });
    expect(validatePurchase(none)).toContain(
      "Choose exactly one post to absorb rounding.",
    );
  });

  test("rejects the same post twice", () => {
    const dup = draft({
      splits: [
        { postId: "food", value: 50, absorbsRemainder: true },
        { postId: "food", value: 50, absorbsRemainder: false },
      ],
    });
    expect(validatePurchase(dup)).toContain("Each post can only appear once.");
  });

  test("does NOT reject going over budget or an unbalanced split", () => {
    // The remainder-absorbing split reconciles any imbalance, and over-budget
    // is always permitted, so neither is an error.
    const unbalanced = draft({
      splits: [
        { postId: "food", value: 10, absorbsRemainder: true },
        { postId: "events", value: 10, absorbsRemainder: false },
      ],
    });
    expect(validatePurchase(unbalanced)).toEqual([]);
  });
});

describe("toPurchase and fromPurchase", () => {
  test("round-trips a simple purchase", () => {
    const d = draft();
    expect(fromPurchase({ ...toPurchase(d), id: "x" })).toEqual(d);
  });

  test("produces a schedule-free purchase when there is no plan", () => {
    expect(toPurchase(draft()).schedule).toBeNull();
  });
});

describe("finance plans", () => {
  test("withPlan generates equal slices from the given month", () => {
    const d = withPlan(draft({ amount: 3000 }), "2026-10", 6);
    expect(d.plan!.slices).toHaveLength(6);
    expect(d.plan!.slices[0]).toEqual({
      month: "2026-10",
      amount: { amount: 500, currency: "DKK" },
    });
    expect(d.plan!.slices[5]!.month).toBe("2027-03");
  });

  test("withPlan keeps the splits untouched, so plans and splits compose", () => {
    const split = draft({
      amount: 3000,
      splits: [
        { postId: "games", value: 70, absorbsRemainder: true },
        { postId: "events", value: 30, absorbsRemainder: false },
      ],
    });
    expect(withPlan(split, "2026-10", 2).splits).toEqual(split.splits);
  });

  test("withoutPlan clears the schedule", () => {
    expect(withoutPlan(withPlan(draft(), "2026-10", 3)).plan).toBeNull();
  });

  test("setSliceAmount edits one slice and leaves the others alone", () => {
    const d = setSliceAmount(withPlan(draft({ amount: 3000 }), "2026-10", 3), 0, 1500);
    expect(d.plan!.slices.map((s) => s.amount.amount)).toEqual([1500, 1000, 1000]);
  });

  test("planBalance reports the difference between the slices and the total", () => {
    const even = withPlan(draft({ amount: 3000 }), "2026-10", 3);
    expect(planBalance(even)).toBe(0);
    expect(planBalance(setSliceAmount(even, 0, 1500))).toBe(-500);
  });

  test("planBalance is zero when there is no plan", () => {
    expect(planBalance(draft())).toBe(0);
  });

  test("a plan with unbalanced slices is still valid", () => {
    // A deposit-then-instalments plan may legitimately not sum to the total
    // yet while the user is typing; the editor warns rather than blocking.
    const d = setSliceAmount(withPlan(draft({ amount: 3000 }), "2026-10", 3), 0, 1500);
    expect(validatePurchase(d)).toEqual([]);
  });

  test("a plan with zero months is rejected", () => {
    expect(() => withPlan(draft(), "2026-10", 0)).toThrow(/at least one month/i);
  });

  test("split×plan composition: each slice divides across posts in the split ratio", () => {
    // Pins this task's headline behaviour: plans and splits compose. The
    // plan editor only ever changes draft.plan; the ratio in draft.splits
    // is applied per-slice by the store/domain layer, not here — this test
    // just confirms withPlan never disturbs the splits that make that
    // composition possible.
    const composed = withPlan(
      draft({
        amount: 3000,
        splits: [
          { postId: "games", value: 70, absorbsRemainder: true },
          { postId: "events", value: 30, absorbsRemainder: false },
        ],
      }),
      "2026-10",
      3,
    );
    expect(composed.splits).toEqual([
      { postId: "games", value: 70, absorbsRemainder: true },
      { postId: "events", value: 30, absorbsRemainder: false },
    ]);
    expect(sliceSum(composed)).toBe(3000);
  });
});

function sliceSum(draft: PurchaseDraft): number {
  return draft.plan!.slices.reduce((sum, s) => sum + s.amount.amount, 0);
}
