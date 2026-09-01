import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "../format.ts";
import {
  bulkTotal,
  isBlankLine,
  withTrailingBlank,
  type BulkDraft,
  type BulkLine,
} from "../bulkEntry.ts";

interface Props {
  draft: BulkDraft;
  onChange: (next: BulkDraft) => void;
}

/**
 * The row list for fast entry: description, amount, note — and nothing else in
 * the tab order, so Tab walks the fields and only the fields.
 *
 * The list always ends in one blank row, appended as soon as the last row is
 * filled, so Tab flows into a new line with no special case and new rows appear
 * on touch devices too. That is why there is no "Add line" button.
 */
export function BulkLines({ draft, onChange }: Props) {
  const descriptionRefs = useRef<Array<HTMLInputElement | null>>([]);
  const noteRefs = useRef<Array<HTMLInputElement | null>>([]);

  function update(index: number, changes: Partial<BulkLine>) {
    onChange(
      withTrailingBlank({
        ...draft,
        lines: draft.lines.map((line, i) => (i === index ? { ...line, ...changes } : line)),
      }),
    );
  }

  function removeLine(index: number) {
    const remaining = draft.lines.filter((_, i) => i !== index);
    onChange(withTrailingBlank({ ...draft, lines: remaining }));
    // Land on the previous row's last field, which is where the user came from.
    if (index > 0) requestAnimationFrame(() => noteRefs.current[index - 1]?.focus());
  }

  const filledCount = draft.lines.filter((line) => !isBlankLine(line)).length;

  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Lines</Label>
        <span className="text-xs text-muted-foreground">
          Tab through the fields; a new line opens as you fill the last one
        </span>
      </div>

      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {draft.lines.map((line, index) => (
          <div key={index} className="group flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">
              {index + 1}
            </span>

            <Input
              ref={(el) => {
                descriptionRefs.current[index] = el;
              }}
              className="h-8 flex-1"
              placeholder="What was it?"
              value={line.description}
              onChange={(event) => {
                const description = event.target.value;
                update(index, { description });
              }}
              onKeyDown={(event) => {
                // Backspace in an already-empty description removes the row.
                if (
                  event.key === "Backspace" &&
                  line.description === "" &&
                  draft.lines.length > 1
                ) {
                  event.preventDefault();
                  removeLine(index);
                }
              }}
            />

            <Input
              className="font-money h-8 w-24"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={line.amount === 0 ? "" : line.amount}
              onChange={(event) => {
                const amount = Number(event.target.value) || 0;
                update(index, { amount });
              }}
            />

            <Input
              ref={(el) => {
                noteRefs.current[index] = el;
              }}
              className="h-8 w-40"
              placeholder="Note (optional)"
              value={line.note}
              onChange={(event) => {
                const note = event.target.value;
                update(index, { note });
              }}
            />

            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove line ${index + 1}`}
              className="w-5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-[var(--overspend)]"
              onClick={() => removeLine(index)}
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <p className="text-right text-xs text-muted-foreground">
        {filledCount} line{filledCount === 1 ? "" : "s"} &middot;{" "}
        <span className="font-money">{formatMoney(bulkTotal(draft), draft.currency)}</span>
      </p>
    </fieldset>
  );
}
