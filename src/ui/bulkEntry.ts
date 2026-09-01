import { roundMoney } from "../domain/money.ts";
import type { Currency, IsoDate, MonthId, Purchase } from "../domain/types.ts";
import { toPurchase, type PurchaseDraft } from "./purchaseForm.ts";

/**
 * Fast entry for many purchases at once — a grocery trip is twenty lines, and
 * opening the full dialog twenty times is the thing this exists to avoid.
 *
 * Date, post and currency are shared across the batch and set once; a line is
 * just a description and an amount. Each line becomes its own Purchase landing
 * wholly in the shared post, built through the SAME `toPurchase` the single
 * form uses, so there is one definition of what a purchase is.
 */

export interface BulkLine {
  description: string;
  amount: number;
}

export interface BulkDraft {
  date: IsoDate;
  postId: string;
  currency: Currency;
  lines: BulkLine[];
}

export function emptyBulkDraft(monthId: MonthId, postId: string): BulkDraft {
  return {
    date: `${monthId}-01`,
    postId,
    currency: "DKK",
    lines: [{ description: "", amount: 0 }],
  };
}

/** A row the user has not touched. Trailing blanks are ignored, never errors. */
export function isBlankLine(line: BulkLine): boolean {
  return line.description.trim() === "" && line.amount === 0;
}

export function filledLines(draft: BulkDraft): BulkLine[] {
  return draft.lines.filter((line) => !isBlankLine(line));
}

export function bulkTotal(draft: BulkDraft): number {
  return roundMoney(
    filledLines(draft).reduce((sum, line) => sum + line.amount, 0),
    draft.currency,
  );
}

/** One line, expressed as the same draft shape the single-purchase form uses. */
export function lineToDraft(draft: BulkDraft, line: BulkLine): PurchaseDraft {
  return {
    date: draft.date,
    description: line.description,
    amount: line.amount,
    currency: draft.currency,
    splitMode: "percent",
    splits: [{ postId: draft.postId, value: 100, absorbsRemainder: true }],
    plan: null,
  };
}

/**
 * Deliberately absent, mirroring `validatePurchase`: no rejection of a negative
 * amount, of going over budget, or of any magnitude. A refund line is a normal
 * thing to record.
 */
export function validateBulk(draft: BulkDraft): string[] {
  const errors: string[] = [];
  const filled = filledLines(draft);

  if (draft.postId === "") {
    errors.push("Choose a post for these lines.");
  }
  if (filled.length === 0) {
    errors.push("Add at least one line.");
  }

  draft.lines.forEach((line, index) => {
    if (isBlankLine(line)) return;
    const row = index + 1;
    if (line.description.trim() === "") {
      errors.push(`Line ${row}: give it a description.`);
    }
    if (line.amount === 0) {
      errors.push(`Line ${row}: enter an amount other than zero.`);
    }
  });

  return errors;
}

export function toPurchases(draft: BulkDraft): Omit<Purchase, "id">[] {
  return filledLines(draft).map((line) => toPurchase(lineToDraft(draft, line)));
}
