import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount } from "../format.ts";
import {
  planBalance,
  setSliceAmount,
  withPlan,
  withoutPlan,
  type PurchaseDraft,
} from "../purchaseForm.ts";
import { monthOf } from "../../domain/months.ts";

interface Props {
  draft: PurchaseDraft;
  onChange: (next: PurchaseDraft) => void;
}

// A native <input type="date"> reports "" until the user has filled in every
// field, and monthOf() throws on anything that isn't a well-formed
// YYYY-MM-DD. This is UI-level input validation, not a domain concern — the
// domain is right to throw on malformed input; the caller just must not call
// it with malformed input.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function hasValidDate(draft: PurchaseDraft): boolean {
  return ISO_DATE_PATTERN.test(draft.date);
}

export function PlanEditor({ draft, onChange }: Props) {
  const balance = planBalance(draft);

  if (!draft.plan) {
    const dateReady = hasValidDate(draft);
    return (
      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dateReady}
          onClick={() => {
            if (!dateReady) return;
            onChange(withPlan(draft, monthOf(draft.date), 3));
          }}
        >
          Spread this over several months
        </Button>
        {!dateReady && (
          <p className="text-xs text-muted-foreground">
            Pick a date for this purchase first.
          </p>
        )}
      </div>
    );
  }

  return (
    <fieldset className="space-y-3 rounded border p-3">
      <div className="flex items-center justify-between">
        <Label>Finance plan</Label>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">months</span>
          <Input
            type="number"
            min={1}
            step={1}
            className="h-8 w-16 tabular-nums"
            value={draft.plan.slices.length}
            onChange={(event) => {
              const months = Number(event.target.value);
              if (Number.isInteger(months) && months >= 1) {
                onChange(withPlan(draft, draft.plan!.startMonth, months));
              }
            }}
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(withoutPlan(draft))}>
            remove plan
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        {draft.plan.slices.map((slice, index) => (
          <div key={slice.month} className="flex items-center gap-2 text-sm">
            <span className="w-20 text-muted-foreground">{slice.month}</span>
            <Input
              type="number"
              step="0.01"
              className="h-8 w-32 font-money"
              value={slice.amount.amount}
              onChange={(event) =>
                onChange(setSliceAmount(draft, index, Number(event.target.value) || 0))
              }
            />
            <span className="text-xs text-muted-foreground">{draft.currency}</span>
          </div>
        ))}
      </div>

      <p className={`text-xs ${balance === 0 ? "text-muted-foreground" : ""}`}>
        {balance === 0
          ? `Slices total ${formatAmount(draft.amount)} ${draft.currency}, matching the purchase.`
          : `Slices are ${formatAmount(Math.abs(balance))} ${draft.currency} ${
              balance > 0 ? "short of" : "over"
            } the purchase total.`}
      </p>
    </fieldset>
  );
}
