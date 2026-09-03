import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { confirmOccurrence } from "../../store/actions.ts";
import { occurrencesByMonth } from "../../domain/occurrences.ts";
import { compareMonths } from "../../domain/months.ts";
import { parseMoneyInput } from "../moneyInput.ts";
import { Section } from "./Section.tsx";
import type { MonthId } from "../../domain/types.ts";

/**
 * The month's expected charges, and the one click that turns each into a real
 * purchase.
 *
 * Confirmation is offered on any unconfirmed occurrence in this month,
 * INCLUDING one whose date has not arrived yet. That is not an oversight: a
 * bill anchored to its last charge can charge early — a phone plan whose data
 * cap is hit on the 12th when the slot sat on the 30th — and confirming the
 * pending slot with the real date is exactly how the series rebases.
 */
export function ExpectedBand({ monthId }: { monthId: MonthId }) {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const { pending, overdue } = useMemo(() => {
    const byMonth = occurrencesByMonth(dataset, monthId);
    const thisMonth = (byMonth.get(monthId) ?? []).filter((o) => !o.confirmedBy);

    // Everything unconfirmed in an EARLIER month. An occurrence nobody ever
    // confirms holds the projected balance down forever, which is the honest
    // reading of an unreconciled commitment — but it is silent unless counted.
    let earlier = 0;
    for (const [month, occurrences] of byMonth) {
      if (compareMonths(month, monthId) >= 0) continue;
      earlier += occurrences.filter((o) => !o.confirmedBy).length;
    }

    return { pending: thisMonth, overdue: earlier };
  }, [dataset, monthId]);

  if (pending.length === 0 && overdue === 0) return null;

  const nameOf = (recurringId: string) =>
    dataset.recurring.find((c) => c.id === recurringId)?.name ?? "Unknown";

  return (
    <Section
      title="Expected"
      hint="Committed but not yet spent. These do not touch a post's balance until you confirm one, which records it as an ordinary purchase you can edit or delete afterwards."
    >
      {pending.length > 0 && (
        <ul className="divide-y divide-budget-rule">
          {pending.map((occurrence) => {
            const key = `${occurrence.recurringId}:${occurrence.date}`;
            const typed = amounts[key];
            return (
              <li
                key={key}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm">{nameOf(occurrence.recurringId)}</div>
                  <div className="text-xs text-budget-ink-muted">{occurrence.date}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 w-28"
                    // text, not number: a number input discards the "$" before
                    // parseMoneyInput can read it.
                    type="text"
                    aria-label={`Amount for ${nameOf(occurrence.recurringId)} on ${occurrence.date}`}
                    value={typed ?? String(occurrence.amount.amount)}
                    onChange={(event) => {
                      const next = event.target.value;
                      setAmounts((current) => ({ ...current, [key]: next }));
                    }}
                  />
                  <span className="text-xs text-budget-ink-muted">
                    {occurrence.amount.currency}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // Captured before mutate, per AGENTS.md: mutate defers
                      // behind the write queue and React resets the input
                      // first, so reading in the callback commits stale text.
                      const parsed =
                        typed === undefined
                          ? null
                          : parseMoneyInput(typed, dataset.currencies, occurrence.amount.currency);
                      mutate((draft) =>
                        confirmOccurrence(draft, occurrence.recurringId, occurrence.date, {
                          amount: parsed ?? undefined,
                        }),
                      );
                      setAmounts((current) => {
                        const next = { ...current };
                        delete next[key];
                        return next;
                      });
                    }}
                  >
                    Confirm
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {overdue > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-budget-ink-muted">
          {overdue} earlier {overdue === 1 ? "occurrence has" : "occurrences have"} never
          been confirmed. Until {overdue === 1 ? "it is" : "they are"}, the projected
          balance stays lower than the real one by that amount.
        </p>
      )}
    </Section>
  );
}
