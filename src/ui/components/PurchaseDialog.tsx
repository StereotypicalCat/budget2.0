import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SplitEditor } from "./SplitEditor.tsx";
import { PlanEditor } from "./PlanEditor.tsx";
import {
  emptyDraft,
  fromPurchase,
  toPurchase,
  validatePurchase,
  type PurchaseDraft,
} from "../purchaseForm.ts";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { addPurchase, cancelScheduleFrom, updatePurchase } from "../../store/actions.ts";
import { CURRENCIES, type MonthId, type Purchase } from "../../domain/types.ts";

interface Props {
  monthId: MonthId;
  /** Provide to edit an existing purchase; omit to add a new one. */
  purchase?: Purchase;
  trigger: React.ReactNode;
}

export function PurchaseDialog({ monthId, purchase, trigger }: Props) {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const activePosts = dataset.posts
    .filter((p) => !p.archived)
    .sort((a, b) => a.order - b.order);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PurchaseDraft>(() =>
    purchase ? fromPurchase(purchase) : emptyDraft(monthId, activePosts[0]?.id ?? ""),
  );
  const errors = validatePurchase(draft);

  function reset() {
    setDraft(
      purchase ? fromPurchase(purchase) : emptyDraft(monthId, activePosts[0]?.id ?? ""),
    );
  }

  function save() {
    if (errors.length > 0) return;
    mutate((data) => {
      if (purchase) updatePurchase(data, purchase.id, toPurchase(draft));
      else addPurchase(data, toPurchase(draft));
    });
    setOpen(false);
    if (!purchase) reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{purchase ? "Edit purchase" : "Add purchase"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="purchase-date">Date</Label>
              <Input
                id="purchase-date"
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-description">Description</Label>
              <Input
                id="purchase-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-amount">Total</Label>
              <Input
                id="purchase-amount"
                type="number"
                step="0.01"
                className="font-money"
                value={draft.amount}
                onChange={(event) =>
                  setDraft({ ...draft, amount: Number(event.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-currency">Currency</Label>
              <select
                id="purchase-currency"
                className="h-9 w-full rounded border bg-background px-2 text-sm"
                value={draft.currency}
                onChange={(event) =>
                  setDraft({ ...draft, currency: event.target.value as typeof draft.currency })
                }
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SplitEditor draft={draft} posts={activePosts} onChange={setDraft} />

          <PlanEditor draft={draft} onChange={setDraft} />

          {purchase?.schedule && !purchase.schedule.cancelledFromMonth && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                mutate((data) => cancelScheduleFrom(data, purchase.id, monthId));
                setOpen(false);
              }}
            >
              Cancel remaining slices from {monthId}
            </Button>
          )}

          {errors.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={errors.length > 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
