import { test, expect, describe } from "bun:test";
import {
  withTrailingBlank,
  emptyBulkDraft,
  isBlankLine,
  filledLines,
  bulkTotal,
  lineToDraft,
  validateBulk,
  toPurchases,
  type BulkDraft,
} from "./bulkEntry.ts";

function draft(overrides: Partial<BulkDraft> = {}): BulkDraft {
  return { ...emptyBulkDraft("2026-09", "food"), ...overrides };
}
const line = (description: string, amount: number, note = "") => ({ description, amount, note });

describe("emptyBulkDraft", () => {
  test("starts on the first of the month with one blank line", () => {
    const d = emptyBulkDraft("2026-09", "food");
    expect(d.date).toBe("2026-09");
    expect(d.postId).toBe("food");
    expect(d.currency).toBe("DKK");
    expect(d.lines).toEqual([{ description: "", amount: 0, note: "" }]);
  });
});

describe("blank lines", () => {
  test("a line with no description and no amount is blank", () => {
    expect(isBlankLine(line("", 0))).toBe(true);
    expect(isBlankLine(line("  ", 0))).toBe(true);
  });

  test("a line with either field filled is not blank", () => {
    expect(isBlankLine(line("Milk", 0))).toBe(false);
    expect(isBlankLine(line("", 25))).toBe(false);
  });

  test("filledLines drops blanks so trailing empty rows are ignored", () => {
    const d = draft({ lines: [line("Milk", 25), line("", 0), line("Bread", 30), line("", 0)] });
    expect(filledLines(d).map((l) => l.description)).toEqual(["Milk", "Bread"]);
  });
});

describe("bulkTotal", () => {
  test("sums the filled lines", () => {
    expect(bulkTotal(draft({ lines: [line("Milk", 25), line("Bread", 30.5), line("", 0)] }))).toBe(55.5);
  });

  test("is zero when there is nothing filled in", () => {
    expect(bulkTotal(draft())).toBe(0);
  });

  test("rounds the sum, so float tails never surface", () => {
    expect(bulkTotal(draft({ lines: [line("a", 0.1), line("b", 0.2)] }))).toBe(0.3);
  });
});

describe("lineToDraft", () => {
  test("builds a single-split purchase landing wholly in the shared post", () => {
    const d = draft({ date: "2026-09-14", currency: "EUR" });
    const p = lineToDraft(d, line("Milk", 25));
    expect(p.date).toBe("2026-09-14");
    expect(p.description).toBe("Milk");
    expect(p.amount).toBe(25);
    expect(p.currency).toBe("EUR");
    expect(p.splitMode).toBe("percent");
    expect(p.splits).toEqual([{ postId: "food", value: 100, absorbsRemainder: true }]);
    expect(p.plan).toBeNull();
  });

  test("trims the description, matching what the single-purchase form stores", () => {
    expect(lineToDraft(draft(), line("  Milk  ", 25)).description).toBe("  Milk  ");
  });
});

describe("validateBulk", () => {
  test("a well-formed batch has no errors", () => {
    expect(validateBulk(draft({ lines: [line("Milk", 25), line("Bread", 30)] }))).toEqual([]);
  });

  test("blank trailing lines are ignored, not errors", () => {
    expect(validateBulk(draft({ lines: [line("Milk", 25), line("", 0), line("", 0)] }))).toEqual([]);
  });

  test("requires at least one filled line", () => {
    expect(validateBulk(draft())).toContain("Add at least one line.");
  });

  test("flags a description with no amount, naming the row", () => {
    const errors = validateBulk(draft({ lines: [line("Milk", 25), line("Bread", 0)] }));
    expect(errors.some((e) => e.includes("2") && /amount/i.test(e))).toBe(true);
  });

  test("flags an amount with no description, naming the row", () => {
    const errors = validateBulk(draft({ lines: [line("", 30)] }));
    expect(errors.some((e) => e.includes("1") && /description/i.test(e))).toBe(true);
  });

  test("requires a post", () => {
    expect(validateBulk(draft({ postId: "", lines: [line("Milk", 25)] }))).toContain(
      "Choose a post for these lines.",
    );
  });

  test("does NOT reject a negative amount — over-budget and refunds are allowed", () => {
    expect(validateBulk(draft({ lines: [line("Refund", -25)] }))).toEqual([]);
  });
});

describe("toPurchases", () => {
  test("produces one purchase per filled line", () => {
    const ps = toPurchases(draft({ lines: [line("Milk", 25), line("", 0), line("Bread", 30)] }));
    expect(ps).toHaveLength(2);
    expect(ps.map((p) => p.description)).toEqual(["Milk", "Bread"]);
  });

  test("every purchase carries the shared date, currency and post", () => {
    const ps = toPurchases(draft({ date: "2026-09-14", currency: "EUR", lines: [line("Milk", 25), line("Bread", 30)] }));
    for (const p of ps) {
      expect(p.date).toBe("2026-09-14");
      expect(p.total.currency).toBe("EUR");
      expect(p.splits).toEqual([{ postId: "food", value: 100, absorbsRemainder: true }]);
      expect(p.schedule).toBeNull();
    }
  });

  test("amounts survive intact", () => {
    const ps = toPurchases(draft({ lines: [line("Milk", 25), line("Bread", 30.5)] }));
    expect(ps.map((p) => p.total.amount)).toEqual([25, 30.5]);
  });

  test("an empty batch produces nothing rather than a blank purchase", () => {
    expect(toPurchases(draft())).toEqual([]);
  });
});

describe("notes and blank rows across three columns", () => {
  const l = (description: string, amount: number, note = "") => ({ description, amount, note });

  test("a row is blank only when description, amount AND note are all empty", () => {
    expect(isBlankLine(l("", 0, ""))).toBe(true);
    expect(isBlankLine(l("", 0, "  "))).toBe(true);
    expect(isBlankLine(l("Milk", 0))).toBe(false);
    expect(isBlankLine(l("", 25))).toBe(false);
    expect(isBlankLine(l("", 0, "for the party"))).toBe(false);
  });

  test("a note-only row is not silently dropped — it asks for both missing fields", () => {
    const errors = validateBulk(draft({ lines: [l("", 0, "for the party")] }));
    expect(errors.some((e) => e.includes("1") && /description/i.test(e))).toBe(true);
    expect(errors.some((e) => e.includes("1") && /amount/i.test(e))).toBe(true);
  });

  test("notes reach the stored purchases, and empty ones are omitted", () => {
    const ps = toPurchases(draft({ lines: [l("Milk", 25, "oat"), l("Bread", 30)] }));
    expect(ps[0]!.note).toBe("oat");
    expect("note" in ps[1]!).toBe(false);
  });
});

describe("withTrailingBlank", () => {
  const l = (description: string, amount: number, note = "") => ({ description, amount, note });

  test("appends a blank row when the last row has been filled in", () => {
    const d = withTrailingBlank(draft({ lines: [l("Milk", 25)] }));
    expect(d.lines).toHaveLength(2);
    expect(isBlankLine(d.lines[1]!)).toBe(true);
  });

  test("leaves a list that already ends blank alone — never two trailing blanks", () => {
    const d = withTrailingBlank(draft({ lines: [l("Milk", 25), l("", 0)] }));
    expect(d.lines).toHaveLength(2);
  });

  test("an all-blank list keeps exactly one row", () => {
    expect(withTrailingBlank(draft()).lines).toHaveLength(1);
  });

  test("trailing blanks beyond the first are trimmed", () => {
    const d = withTrailingBlank(draft({ lines: [l("Milk", 25), l("", 0), l("", 0), l("", 0)] }));
    expect(d.lines).toHaveLength(2);
  });
});
