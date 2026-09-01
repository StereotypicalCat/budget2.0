import { roundMoney } from "../domain/money.ts";
import type {
  Currency,
  IsoDate,
  MonthId,
  Purchase,
  ScheduleSlice,
} from "../domain/types.ts";

export interface SplitDraft {
  postId: string;
  value: number;
  absorbsRemainder: boolean;
}

export interface PlanDraft {
  startMonth: MonthId;
  slices: ScheduleSlice[];
  cancelledFromMonth?: MonthId;
}

export interface PurchaseDraft {
  date: IsoDate;
  description: string;
  amount: number;
  currency: Currency;
  splitMode: "percent" | "fixed";
  splits: SplitDraft[];
  plan: PlanDraft | null;
}

export function emptyDraft(monthId: MonthId, postId: string): PurchaseDraft {
  return {
    date: `${monthId}-01`,
    description: "",
    amount: 0,
    currency: "DKK",
    splitMode: "percent",
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    plan: null,
  };
}

/** What the split editor must show: how far the parts are from the whole. */
export function splitBalance(draft: PurchaseDraft): number {
  const target = draft.splitMode === "percent" ? 100 : draft.amount;
  const sum = draft.splits.reduce((total, split) => total + split.value, 0);
  return roundMoney(target - sum, draft.currency);
}

export function validatePurchase(draft: PurchaseDraft): string[] {
  const errors: string[] = [];

  if (draft.description.trim() === "") {
    errors.push("Give the purchase a description.");
  }
  if (draft.amount === 0) {
    errors.push("Enter an amount other than zero.");
  }
  if (draft.splits.length === 0) {
    errors.push("Add at least one post to split across.");
  }
  if (draft.splits.filter((s) => s.absorbsRemainder).length !== 1) {
    errors.push("Choose exactly one post to absorb rounding.");
  }
  const postIds = draft.splits.map((s) => s.postId);
  if (new Set(postIds).size !== postIds.length) {
    errors.push("Each post can only appear once.");
  }
  if (postIds.some((id) => id === "")) {
    errors.push("Choose a post for every split.");
  }

  // Deliberately absent: any check on whether splits balance, or whether the
  // purchase pushes a post over budget. Both are permitted by design.
  return errors;
}

export function toPurchase(draft: PurchaseDraft): Omit<Purchase, "id"> {
  return {
    date: draft.date,
    description: draft.description.trim(),
    total: { amount: draft.amount, currency: draft.currency },
    splitMode: draft.splitMode,
    splits: draft.splits.map((s) => ({ ...s })),
    schedule: draft.plan
      ? {
          slices: draft.plan.slices.map((s) => ({ ...s, amount: { ...s.amount } })),
          ...(draft.plan.cancelledFromMonth
            ? { cancelledFromMonth: draft.plan.cancelledFromMonth }
            : {}),
        }
      : null,
  };
}

export function fromPurchase(purchase: Purchase): PurchaseDraft {
  return {
    date: purchase.date,
    description: purchase.description,
    amount: purchase.total.amount,
    currency: purchase.total.currency,
    splitMode: purchase.splitMode,
    splits: purchase.splits.map((s) => ({ ...s })),
    plan: purchase.schedule
      ? {
          startMonth: purchase.schedule.slices[0]?.month ?? "",
          slices: purchase.schedule.slices.map((s) => ({ ...s, amount: { ...s.amount } })),
          ...(purchase.schedule.cancelledFromMonth
            ? { cancelledFromMonth: purchase.schedule.cancelledFromMonth }
            : {}),
        }
      : null,
  };
}
