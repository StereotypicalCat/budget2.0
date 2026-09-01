import { test, expect, describe } from "bun:test";
import {
  emptyDraft,
  splitBalance,
  validatePurchase,
  toPurchase,
  fromPurchase,
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
