import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { digitsFor } from "../../domain/currencies.ts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount } from "../format.ts";
import type { PurchaseDraft, SplitDraft } from "../purchaseForm.ts";
import { splitBalance } from "../purchaseForm.ts";
import type { Post } from "../../domain/types.ts";

interface Props {
  draft: PurchaseDraft;
  posts: Post[];
  onChange: (next: PurchaseDraft) => void;
}

export function SplitEditor({ draft, posts, onChange }: Props) {
  const balance = splitBalance(draft, digitsFor(useDataset().currencies, draft.currency));
  const unit = draft.splitMode === "percent" ? "%" : draft.currency;

  function updateSplit(index: number, changes: Partial<SplitDraft>) {
    const splits = draft.splits.map((split, i) =>
      i === index ? { ...split, ...changes } : split,
    );
    onChange({ ...draft, splits });
  }

  function setAbsorber(index: number) {
    onChange({
      ...draft,
      splits: draft.splits.map((split, i) => ({
        ...split,
        absorbsRemainder: i === index,
      })),
    });
  }

  return (
    <fieldset className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Split across posts</Label>
        <div className="flex gap-1 text-xs">
          {(["percent", "fixed"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={draft.splitMode === mode ? "default" : "outline"}
              onClick={() => onChange({ ...draft, splitMode: mode })}
            >
              {mode === "percent" ? "Percentages" : "Amounts"}
            </Button>
          ))}
        </div>
      </div>

      {draft.splits.map((split, index) => (
        <div key={index} className="flex items-center gap-2">
          <select
            className="h-9 flex-1 rounded border bg-background px-2 text-sm"
            value={split.postId}
            onChange={(event) => updateSplit(index, { postId: event.target.value })}
          >
            <option value="">Choose a post…</option>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.name}
              </option>
            ))}
          </select>

          <Input
            type="number"
            step="0.01"
            className="font-money w-28"
            value={split.value}
            onChange={(event) =>
              updateSplit(index, { value: Number(event.target.value) || 0 })
            }
          />
          <span className="w-10 text-xs text-muted-foreground">{unit}</span>

          <label className="flex items-center gap-1 text-xs" title="This post absorbs rounding">
            <input
              type="radio"
              name="absorber"
              checked={split.absorbsRemainder}
              onChange={() => setAbsorber(index)}
            />
            rounding
          </label>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={draft.splits.length === 1}
            onClick={() =>
              onChange({
                ...draft,
                splits: draft.splits.filter((_, i) => i !== index),
              })
            }
          >
            remove
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between text-xs">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange({
              ...draft,
              splits: [
                ...draft.splits,
                { postId: "", value: 0, absorbsRemainder: false },
              ],
            })
          }
        >
          Add a post
        </Button>
        <span className={balance === 0 ? "text-muted-foreground" : ""}>
          {balance === 0
            ? "Splits balance exactly."
            : `${formatAmount(balance)} ${unit} unassigned — the rounding post absorbs it.`}
        </span>
      </div>
    </fieldset>
  );
}
