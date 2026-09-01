import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "../format.ts";
import { bulkTotal, isBlankLine, type BulkDraft } from "../bulkEntry.ts";

interface Props {
  draft: BulkDraft;
  onChange: (next: BulkDraft) => void;
}

/**
 * The row list for fast entry. Two fields per line is the whole point — Enter
 * in the amount field commits the row and focuses a fresh one, so a grocery
 * receipt can be typed without ever leaving the keyboard.
 */
export function BulkLines({ draft, onChange }: Props) {
  const amountRefs = useRef<Array<HTMLInputElement | null>>([]);

  function updateLine(index: number, changes: Partial<BulkDraft["lines"][number]>) {
    onChange({
      ...draft,
      lines: draft.lines.map((line, i) => (i === index ? { ...line, ...changes } : line)),
    });
  }

  function addLine(focusIndex?: number) {
    onChange({ ...draft, lines: [...draft.lines, { description: "", amount: 0 }] });
    if (focusIndex !== undefined) {
      // Focus after React has rendered the new row.
      requestAnimationFrame(() => amountRefs.current[focusIndex]?.focus());
    }
  }

  function removeLine(index: number) {
    const lines = draft.lines.filter((_, i) => i !== index);
    onChange({ ...draft, lines: lines.length > 0 ? lines : [{ description: "", amount: 0 }] });
  }

  const filledCount = draft.lines.filter((line) => !isBlankLine(line)).length;

  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Lines</Label>
        <span className="text-xs text-muted-foreground">
          Enter on an amount starts the next line
        </span>
      </div>

      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {draft.lines.map((line, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">
              {index + 1}
            </span>
            <Input
              className="h-8 flex-1"
              placeholder="What was it?"
              value={line.description}
              onChange={(event) => {
                const description = event.target.value;
                updateLine(index, { description });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  amountRefs.current[index]?.focus();
                }
              }}
            />
            <Input
              ref={(el) => {
                amountRefs.current[index] = el;
              }}
              className="font-money h-8 w-28"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={line.amount === 0 ? "" : line.amount}
              onChange={(event) => {
                const amount = Number(event.target.value) || 0;
                updateLine(index, { amount });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (index === draft.lines.length - 1) addLine(index + 1);
                  else amountRefs.current[index + 1]?.focus();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove line ${index + 1}`}
              onClick={() => removeLine(index)}
            >
              remove
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs">
        <Button type="button" size="sm" variant="outline" onClick={() => addLine(draft.lines.length)}>
          Add line
        </Button>
        <span className="text-muted-foreground">
          {filledCount} line{filledCount === 1 ? "" : "s"} &middot;{" "}
          <span className="font-money">{formatMoney(bulkTotal(draft), draft.currency)}</span>
        </span>
      </div>
    </fieldset>
  );
}
