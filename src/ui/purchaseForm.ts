import { roundMoney } from "../domain/money.ts";
import { equalSlices, slicesBalance } from "../domain/plans.ts";
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
  note: string;
  amount: number;
  currency: Currency;
  splitMode: "percent" | "fixed";
  splits: SplitDraft[];
  plan: PlanDraft | null;
}

export function emptyDraft(monthId: MonthId, postId: string): PurchaseDraft {
  return {
    date: monthId,
    description: "",
    note: "",
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
  const note = draft.note.trim();
  return {
    date: draft.date,
    description: draft.description.trim(),
    // Omitted rather than stored as "" so an absent note stays absent.
    ...(note === "" ? {} : { note }),
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

export function withPlan(
  draft: PurchaseDraft,
  startMonth: MonthId,
  months: number,
): PurchaseDraft {
  return {
    ...draft,
    plan: {
      startMonth,
      slices: equalSlices({ amount: draft.amount, currency: draft.currency }, startMonth, months),
    },
  };
}

export function withoutPlan(draft: PurchaseDraft): PurchaseDraft {
  return { ...draft, plan: null };
}

export function setSliceAmount(
  draft: PurchaseDraft,
  index: number,
  amount: number,
): PurchaseDraft {
  if (!draft.plan) return draft;
  return {
    ...draft,
    plan: {
      ...draft.plan,
      slices: draft.plan.slices.map((slice, i) =>
        i === index ? { ...slice, amount: { ...slice.amount, amount } } : slice,
      ),
    },
  };
}

/**
 * slices - total, delegated to the domain's slicesBalance so the "sum the
 * slices and compare to the total" arithmetic has exactly one implementation.
 * Positive means the slices fall short of the purchase total.
 */
export function planBalance(draft: PurchaseDraft): number {
  if (!draft.plan) return 0;
  return slicesBalance({ amount: draft.amount, currency: draft.currency }, draft.plan.slices);
}

export function fromPurchase(purchase: Purchase): PurchaseDraft {
  return {
    date: purchase.date,
    description: purchase.description,
    note: purchase.note ?? "",
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
