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
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Segmented } from "./Segmented.tsx";
import { SplitEditor } from "./SplitEditor.tsx";
import { PlanEditor } from "./PlanEditor.tsx";
import { BulkLines } from "./BulkLines.tsx";
import {
  emptyDraft,
  fromPurchase,
  toPurchase,
  validatePurchase,
  type PurchaseDraft,
} from "../purchaseForm.ts";
import {
  emptyBulkDraft,
  toPurchases,
  validateBulk,
  type BulkDraft,
} from "../bulkEntry.ts";
import { useDataset } from "../hooks/useDataset.ts";
import { parseMoneyInput } from "../moneyInput.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { addPurchase, cancelScheduleFrom, updatePurchase } from "../../store/actions.ts";
import type { MonthId, Purchase } from "../../domain/types.ts";

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
  // The amount field keeps its own text so a half-typed "30." or "30 " stays
  // exactly as typed; `draft.amount` only moves when the text parses.
  const [amountText, setAmountText] = useState(() =>
    purchase ? String(purchase.total.amount) : "",
  );
  // "many" is only meaningful when adding — editing an existing purchase edits
  // exactly one, so the toggle is hidden in that case.
  const [mode, setMode] = useState<"one" | "many">("one");
  const [bulk, setBulk] = useState<BulkDraft>(() =>
    emptyBulkDraft(monthId, activePosts[0]?.id ?? ""),
  );
  const bulkMode = !purchase && mode === "many";

  const errors = bulkMode ? validateBulk(bulk) : validatePurchase(draft);

  function reset() {
    setDraft(
      purchase ? fromPurchase(purchase) : emptyDraft(monthId, activePosts[0]?.id ?? ""),
    );
    setBulk(emptyBulkDraft(monthId, activePosts[0]?.id ?? ""));
  }

  function save() {
    if (errors.length > 0) return;
    if (bulkMode) {
      // One mutate for the whole batch: a single write, one queue entry, and no
      // way to half-commit a shopping trip.
      const created = toPurchases(bulk);
      mutate((data) => {
        for (const p of created) addPurchase(data, p);
      });
    } else {
      mutate((data) => {
        if (purchase) updatePurchase(data, purchase.id, toPurchase(draft));
        else addPurchase(data, toPurchase(draft));
      });
    }
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
          <DialogTitle>
            {purchase ? "Edit purchase" : bulkMode ? "Add many purchases" : "Add purchase"}
          </DialogTitle>
        </DialogHeader>

        {!purchase && (
          <Segmented
            label="How many purchases to add"
            value={mode}
            onChange={setMode}
            options={[
              { value: "one", label: "One purchase" },
              { value: "many", label: "Many lines" },
            ]}
          />
        )}

        <div className="space-y-4">
          {bulkMode ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bulk-date">
                    {bulk.date.length > 7 ? "Date" : "Month"}
                  </Label>
                  <Input
                    id="bulk-date"
                    type={bulk.date.length > 7 ? "date" : "text"}
                    readOnly={bulk.date.length <= 7}
                    className={bulk.date.length > 7 ? undefined : "font-money"}
                    value={bulk.date}
                    onChange={(event) => {
                      const date = event.target.value;
                      setBulk((b) => ({ ...b, date }));
                    }}
                  />
                  <DateModeToggle
                    onClick={() =>
                      setBulk((b) => ({
                        ...b,
                        date: b.date.length > 7 ? b.date.slice(0, 7) : `${b.date}-01`,
                      }))
                    }
                  >
                    {bulk.date.length > 7 ? "use the month only" : "set exact date"}
                  </DateModeToggle>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bulk-post">Post</Label>
                  <NativeSelect
                    id="bulk-post"
                    value={bulk.postId}
                    onChange={(event) => {
                      const postId = event.target.value;
                      setBulk((b) => ({ ...b, postId }));
                    }}
                  >
                    <option value="">Choose a post…</option>
                    {activePosts.map((post) => (
                      <option key={post.id} value={post.id}>
                        {post.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bulk-currency">Currency</Label>
                  <NativeSelect
                    id="bulk-currency"
                    value={bulk.currency}
                    onChange={(event) => {
                      const currency = event.target.value as typeof bulk.currency;
                      setBulk((b) => ({ ...b, currency }));
                    }}
                  >
                    {dataset.currencies.map(({ code: currency }) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <BulkLines draft={bulk} onChange={setBulk} />

              <p className="text-xs text-muted-foreground">
                Each line is saved as its own purchase in the post above. Need a
                split or a payment plan on one of them? Save it here, then open
                it from the month view.
              </p>
            </>
          ) : (
            <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="purchase-date">
                {draft.date.length > 7 ? "Date" : "Month"}
              </Label>
              {draft.date.length > 7 ? (
                <>
                  <Input
                    id="purchase-date"
                    type="date"
                    value={draft.date}
                    onChange={(event) => {
                      const date = event.target.value;
                      setDraft((d) => ({ ...d, date }));
                    }}
                  />
                  <DateModeToggle
                    onClick={() => setDraft((d) => ({ ...d, date: d.date.slice(0, 7) }))}
                  >
                    use the month only
                  </DateModeToggle>
                </>
              ) : (
                <>
                  <Input id="purchase-date" value={draft.date} readOnly className="font-money" />
                  <DateModeToggle
                    onClick={() => setDraft((d) => ({ ...d, date: `${d.date}-01` }))}
                  >
                    set exact date
                  </DateModeToggle>
                </>
              )}
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
              {/* type="text", not "number": a number input silently discards
                  anything non-numeric, so "30$" would never reach the parser.
                  Entry speed is the point — the currency is set from what was
                  typed rather than from a second control. */}
              <Input
                id="purchase-amount"
                inputMode="decimal"
                className="font-money"
                placeholder="30$"
                value={amountText}
                onChange={(event) => {
                  const typed = event.target.value;
                  setAmountText(typed);
                  const parsed = parseMoneyInput(typed, dataset.currencies, draft.currency);
                  if (parsed) {
                    setDraft({ ...draft, amount: parsed.amount, currency: parsed.currency });
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-currency">Currency</Label>
              <NativeSelect
                id="purchase-currency"
                value={draft.currency}
                onChange={(event) =>
                  setDraft({ ...draft, currency: event.target.value as typeof draft.currency })
                }
              >
                {dataset.currencies.map(({ code: currency }) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="purchase-note">Note (optional)</Label>
            <Input
              id="purchase-note"
              placeholder="Anything worth remembering about this one"
              value={draft.note}
              onChange={(event) => {
                const note = event.target.value;
                setDraft((d) => ({ ...d, note }));
              }}
            />
          </div>

          <SplitEditor draft={draft} posts={activePosts} onChange={setDraft} />

          <PlanEditor draft={draft} onChange={setDraft} />
            </>
          )}

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

/**
 * "set exact date" / "use the month only", under the date field.
 *
 * Was a bare `<button>` with no padding at all: a 15px-tall hit target under a
 * 36px field, which is under the 24px minimum and impossible to hit on a
 * phone. `size="xs"` gives it a real 24px box, and the negative left margin
 * cancels the button's own padding so the text still lines up with the field's
 * left edge rather than sitting 8px in from it.
 */
function DateModeToggle({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="-ml-2 font-normal text-muted-foreground underline decoration-dotted underline-offset-2"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
