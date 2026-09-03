import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import {
  addRecurringCost,
  endRecurringCost,
  moveRecurringCost,
  restoreRecurringCost,
  updateRecurringCost,
} from "../../../store/actions.ts";
import { parseMoneyInput } from "../../moneyInput.ts";
import { currentMonth } from "../../../store/index.ts";
import { Section } from "../../components/Section.tsx";
import type { Recurrence, RecurringCost } from "../../../domain/types.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RecurringSection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const [newName, setNewName] = useState("");
  const ordered = [...dataset.recurring].sort((a, b) => a.order - b.order);
  const base = dataset.settings.baseCurrency;
  const firstPost = [...dataset.posts].sort((a, b) => a.order - b.order)[0];

  function amountCell(cost: RecurringCost) {
    return (
      <Input
        className="h-8 w-28"
        // text, not number: a number input strips the "$" before
        // parseMoneyInput ever sees it, so "30$" would lose its currency.
        type="text"
        aria-label={`Amount for ${cost.name}`}
        defaultValue={`${cost.amount.amount} ${cost.amount.currency}`}
        onBlur={(event) => {
          // Captured before mutate: mutate defers behind the write queue and
          // React resets the DOM value first, so reading event.target.value
          // inside the callback would commit the previous keystroke.
          const typed = event.target.value;
          // (text, currency options, fallback) — the same three arguments
          // PurchaseDialog passes. The options list is what lets "30$" resolve
          // to USD; the fallback is used when no symbol or code is typed.
          const parsed = parseMoneyInput(typed, dataset.currencies, cost.amount.currency);
          if (!parsed) return;
          mutate((draft) => updateRecurringCost(draft, cost.id, { amount: parsed }));
        }}
      />
    );
  }

  function intervalCell(cost: RecurringCost) {
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-8 w-14"
          type="number"
          min={1}
          step={1}
          aria-label={`Interval for ${cost.name}`}
          value={cost.recurrence.n}
          onChange={(event) => {
            // Captured BEFORE mutate: mutate defers behind the write queue and
            // React resets the DOM value first, so reading it inside the
            // callback commits the previous keystroke.
            const n = Number(event.target.value);
            if (!Number.isInteger(n) || n < 1) return;
            mutate((draft) =>
              updateRecurringCost(draft, cost.id, { recurrence: { ...cost.recurrence, n } }),
            );
          }}
        />
        <NativeSelect
          className="h-8 w-auto text-xs md:text-xs"
          aria-label={`Unit for ${cost.name}`}
          value={cost.recurrence.kind}
          onChange={(event) => {
            const kind = event.target.value as Recurrence["kind"];
            const recurrence: Recurrence =
              kind === "everyNWeeks"
                ? { kind, n: cost.recurrence.n, weekday: 1 }
                : { kind, n: cost.recurrence.n };
            mutate((draft) => updateRecurringCost(draft, cost.id, { recurrence }));
          }}
        >
          <option value="everyNDays">days</option>
          <option value="everyNWeeks">weeks</option>
          <option value="everyNMonths">months</option>
        </NativeSelect>
        {cost.recurrence.kind === "everyNWeeks" && (
          <NativeSelect
            className="h-8 w-auto text-xs md:text-xs"
            aria-label={`Weekday for ${cost.name}`}
            value={cost.recurrence.weekday}
            onChange={(event) => {
              const weekday = Number(event.target.value);
              mutate((draft) =>
                updateRecurringCost(draft, cost.id, {
                  recurrence: { kind: "everyNWeeks", n: cost.recurrence.n, weekday },
                }),
              );
            }}
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
    );
  }

  return (
    <Section
      title="Recurring costs"
      hint="Bills that repeat. Each one projects forward as EXPECTED spending and is confirmed from the month view when the money actually moves — expected never touches a post's real balance. Anchoring decides where the next charge is measured from: the calendar, or the date the last one actually charged. Use the second for a bill that can charge early, like a phone plan that recharges when its data runs out."
    >
      {ordered.length === 0 ? (
        <p className="text-sm text-budget-ink-muted">
          No recurring costs yet. Add rent, a subscription, or a phone bill below.
        </p>
      ) : (
        <div className="-mr-2 overflow-x-auto pr-2">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left">
              <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Every</th>
                <th className="py-2 font-medium">Measured from</th>
                <th className="py-2 font-medium">Starts</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((cost, index) => (
                <tr
                  key={cost.id}
                  className={`border-b last:border-0 ${cost.archived ? "opacity-50" : ""}`}
                >
                  <td className="py-2">
                    <Input
                      className="h-8 w-40"
                      value={cost.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        mutate((draft) => updateRecurringCost(draft, cost.id, { name }));
                      }}
                    />
                  </td>
                  <td className="py-2">{amountCell(cost)}</td>
                  <td className="py-2">{intervalCell(cost)}</td>
                  <td className="py-2">
                    <NativeSelect
                      className="h-8 w-auto text-xs md:text-xs"
                      aria-label={`Anchoring for ${cost.name}`}
                      value={cost.anchoring}
                      onChange={(event) => {
                        const anchoring = event.target.value as RecurringCost["anchoring"];
                        mutate((draft) => updateRecurringCost(draft, cost.id, { anchoring }));
                      }}
                    >
                      <option value="calendar">the calendar</option>
                      <option value="lastCharge">the last charge</option>
                    </NativeSelect>
                  </td>
                  <td className="py-2">
                    <Input
                      className="h-8 w-32"
                      type="text"
                      aria-label={`Start date for ${cost.name}`}
                      value={cost.startDate}
                      onChange={(event) => {
                        const startDate = event.target.value;
                        mutate((draft) => updateRecurringCost(draft, cost.id, { startDate }));
                      }}
                    />
                  </td>
                  <td className="py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => mutate((draft) => moveRecurringCost(draft, cost.id, -1))}
                      >
                        up
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={index === ordered.length - 1}
                        onClick={() => mutate((draft) => moveRecurringCost(draft, cost.id, 1))}
                      >
                        down
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="-mr-2"
                        onClick={() =>
                          mutate((draft) =>
                            cost.archived
                              ? restoreRecurringCost(draft, cost.id)
                              : endRecurringCost(draft, cost.id, currentMonth),
                          )
                        }
                      >
                        {cost.archived ? "restart" : "end"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-budget-ink-muted">
        Ending a cost stops it from this month onward and leaves every past
        occurrence exactly as it was. Changing the amount only moves occurrences
        that have not been confirmed yet — what you already paid is recorded on
        the purchases themselves, so a price rise never rewrites history.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-budget-rule pt-5">
        <Input
          className="w-48"
          placeholder="New cost name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={newName.trim() === "" || !firstPost}
          onClick={() => {
            const name = newName.trim();
            mutate((draft) =>
              addRecurringCost(draft, {
                name,
                archived: false,
                amount: { amount: 0, currency: base },
                startDate: currentMonth,
                recurrence: { kind: "everyNMonths", n: 1 },
                anchoring: "calendar",
                splitMode: "percent",
                splits: [{ postId: firstPost!.id, value: 100, absorbsRemainder: true }],
              }),
            );
            setNewName("");
          }}
        >
          Add recurring cost
        </Button>
        {!firstPost && (
          <span className="text-xs text-budget-ink-muted">Create a post first.</span>
        )}
      </div>
    </Section>
  );
}
