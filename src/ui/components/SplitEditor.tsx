import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { digitsFor } from "../../domain/currencies.ts";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Segmented } from "./Segmented.tsx";
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
        <Segmented
          label="Split by"
          value={draft.splitMode}
          onChange={(splitMode) => onChange({ ...draft, splitMode })}
          options={[
            { value: "percent", label: "Percentages" },
            { value: "fixed", label: "Amounts" },
          ]}
        />
      </div>

      {draft.splits.map((split, index) => (
        <div key={index} className="flex items-center gap-2">
          {/* `min-w-0` comes from NativeSelect. Without it `flex-1` could not
              shrink below the widest option, and this row's min-content width
              was what pushed the whole dialog past its own padding. */}
          <NativeSelect
            className="flex-1"
            value={split.postId}
            onChange={(event) => updateSplit(index, { postId: event.target.value })}
          >
            <option value="">Choose a post…</option>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.name}
              </option>
            ))}
          </NativeSelect>

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

          <label
            className="flex shrink-0 items-center gap-1.5 rounded-md py-1.5 text-xs"
            title="This post absorbs rounding"
          >
            <input
              type="radio"
              name="absorber"
              className="size-3.5"
              checked={split.absorbsRemainder}
              onChange={() => setAbsorber(index)}
            />
            rounding
          </label>

          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="-mr-2 shrink-0"
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
