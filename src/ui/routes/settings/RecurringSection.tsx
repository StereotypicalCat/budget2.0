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
  setRecurringCostEndedFrom,
  updateRecurringCost,
} from "../../../store/actions.ts";
import { parseMoneyInput } from "../../moneyInput.ts";
import { currentMonth } from "../../../store/index.ts";
import { Section } from "../../components/Section.tsx";
import { monthOf } from "../../../domain/months.ts";
import { toDayOrdinal } from "../../../domain/days.ts";
import type { IsoDate, Recurrence, RecurringCost } from "../../../domain/types.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "YYYY-MM" is 7 characters; "YYYY-MM-DD" is 10. Same idiom PurchaseDialog uses. */
export function isDayGranular(date: IsoDate): boolean {
  return date.length > 7;
}

/**
 * True only for a string this cost's recurrence kind could actually walk:
 * `everyNMonths` tolerates either granularity (the walk normalises through
 * `monthOf`), the other two require a day-granular date because they reach
 * `addDays` directly. Reuses the domain's own parsers rather than a second,
 * possibly-diverging regex.
 *
 * A day-SHAPED value is routed through `toDayOrdinal` even under
 * `everyNMonths`: `monthOf` only extracts the month and never checks the day,
 * so without this a calendar-impossible date like "2026-09-31" (September has
 * 30 days) would pass here and could still be stored, only to throw three
 * months later out of the fold.
 *
 * Exported for `RecurringSection.test.ts` — this is the one thing standing
 * between the "Starts" field and C2 (an empty or malformed value bricking
 * every route the fold touches), so it is tested directly rather than only
 * through a DOM interaction.
 */
export function isValidStartDate(value: string, kind: Recurrence["kind"]): boolean {
  try {
    if (kind === "everyNMonths" && !isDayGranular(value)) monthOf(value);
    else toDayOrdinal(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the "Ends" column. Unlike `startDate`, `endedFrom` carries NO
 * granularity rule (§10 of the design) — it is only ever compared
 * lexicographically via `isBefore` in `domain/occurrences.ts` and never
 * reaches `addDays`, so a month-only cancellation is exactly as valid as a
 * day-granular one regardless of the cost's recurrence kind. It still has to
 * be a real calendar date: "2026-02-30" is refused the same way an
 * impossible `startDate` already is.
 *
 * An empty string is valid — it means "clear the cancellation" — and is what
 * lets the field double as the un-end control.
 *
 * Exported for `RecurringSection.test.ts`.
 */
export function isValidEndedFrom(value: string): boolean {
  if (value === "") return true;
  try {
    if (isDayGranular(value)) toDayOrdinal(value);
    else monthOf(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the "Starts" value becomes when the owner switches to a day-granular
 * unit: a month-only value expands to the first of that month, in the SAME
 * mutate call that changes the kind (C1) — the walk must never see the old
 * pairing even for one render. `everyNMonths` and an already day-granular
 * value pass through untouched.
 *
 * Exported for `RecurringSection.test.ts`.
 */
export function normalizedStartDateFor(kind: Recurrence["kind"], startDate: IsoDate): IsoDate {
  if (kind === "everyNMonths" || isDayGranular(startDate)) return startDate;
  return `${startDate}-01`;
}

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
          className="h-8 w-20"
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
            // Switching to a day-granular kind against a month-only
            // startDate is exactly how C1 bricked the app: the walk hands
            // "2026-09" to addDays and throws. Expand it to the first of
            // that month IN THIS SAME mutate call, so the pairing the store
            // now validates never has a chance to go wrong.
            const startDate = normalizedStartDateFor(kind, cost.startDate);
            mutate((draft) =>
              updateRecurringCost(draft, cost.id, { recurrence, startDate }),
            );
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
                <th className="py-2 font-medium">Ends</th>
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
                    {/* Uncontrolled: committing only happens on blur, and only
                        when the text parses as an IsoDate of the granularity
                        this cost's recurrence kind requires. Keyed on the
                        stored value so an external change (kind flip
                        auto-expanding it, or a rejected edit) is reflected
                        rather than left showing stale typed text. */}
                    <Input
                      key={`${cost.id}-${cost.startDate}`}
                      className="h-8 w-32"
                      type="text"
                      aria-label={`Start date for ${cost.name}`}
                      defaultValue={cost.startDate}
                      onBlur={(event) => {
                        const typed = event.target.value;
                        if (!isValidStartDate(typed, cost.recurrence.kind)) {
                          event.target.value = cost.startDate;
                          return;
                        }
                        mutate((draft) =>
                          updateRecurringCost(draft, cost.id, { startDate: typed }),
                        );
                      }}
                    />
                  </td>
                  <td className="py-2">
                    {/* Same idiom as "Starts": uncontrolled, committed on
                        blur, keyed on the stored value so an external change
                        (the end/restart button, or a rejected edit) shows up
                        rather than leaving stale typed text. Empty means "not
                        ended" and is itself a valid value — clearing it here
                        does the same thing as the "restart" button. */}
                    <Input
                      key={`${cost.id}-ends-${cost.endedFrom ?? ""}`}
                      className="h-8 w-32"
                      type="text"
                      placeholder="—"
                      aria-label={`Ends date for ${cost.name}`}
                      defaultValue={cost.endedFrom ?? ""}
                      onBlur={(event) => {
                        const typed = event.target.value.trim();
                        if (!isValidEndedFrom(typed)) {
                          event.target.value = cost.endedFrom ?? "";
                          return;
                        }
                        mutate((draft) =>
                          setRecurringCostEndedFrom(
                            draft,
                            cost.id,
                            typed === "" ? undefined : typed,
                          ),
                        );
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
        Ending a cost — from the "end" button, or by typing a date into
        "Ends" directly — stops it from that date onward and leaves every past
        occurrence exactly as it was; clearing the date restarts it. Changing
        the amount only moves occurrences that have not been confirmed yet —
        what you already paid is recorded on the purchases themselves, so a
        price rise never rewrites history.
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
