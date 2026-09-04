import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { today } from "../../store/index.ts";
import { confirmOccurrence } from "../../store/actions.ts";
import {
  occurrencesByMonth,
  wouldAdvancePast,
  type Occurrence,
} from "../../domain/occurrences.ts";
import { addMonths, compareMonths } from "../../domain/months.ts";
import { parseMoneyInput, type CurrencyOption, type ParsedMoney } from "../moneyInput.ts";
import { Section } from "./Section.tsx";
import type { Currency, Dataset, IsoDate, MonthId } from "../../domain/types.ts";

/**
 * `typed` is `undefined` when the field has never been edited — that always
 * confirms at the cost's own amount, the designed one-click fast path.
 * Once edited, though, text that does not parse (an unrecognised currency
 * like "30 GBP" in a DKK/USD dataset, or anything else `parseMoneyInput`
 * rejects) must NOT be conflated with "untouched" and silently fall back to
 * the cost's amount — that would write a figure the owner never typed.
 * `invalid` is what tells the two apart; the caller must refuse to confirm
 * while it is true.
 *
 * Exported for `ExpectedBand.test.ts` (I5).
 */
export function resolveExpectedAmount(
  typed: string | undefined,
  currencies: readonly CurrencyOption[],
  fallbackCurrency: Currency,
): { parsed: ParsedMoney | null; invalid: boolean } {
  if (typed === undefined) return { parsed: null, invalid: false };
  const parsed = parseMoneyInput(typed, currencies, fallbackCurrency);
  return { parsed, invalid: parsed === null };
}

export type ExpectedRowGroup = "pending" | "comingUp";

/**
 * What a Confirm click should record, given which group the row is in. A
 * this-month row confirms at the slot's own date — `null`, `confirmOccurrence`'s
 * default — and a coming-up row confirms at `today` instead, because it is
 * being paid early on purpose (see `ExpectedBand`'s doc comment).
 *
 * This one branch (previously inlined as `row(occurrence, null)` versus
 * `row(occurrence, today)`) is the whole of the phone-bill behaviour, and
 * nothing else in the suite would catch the two being swapped — a DOM test
 * isn't needed for that, a direct one is. Exported for `ExpectedBand.test.ts`
 * (X2).
 */
export function recordedDateFor(group: ExpectedRowGroup, today: IsoDate): IsoDate | null {
  return group === "comingUp" ? today : null;
}

export interface ExpectedGroups {
  /** This month's unconfirmed occurrences. */
  pending: Occurrence[];
  /** Count of unconfirmed occurrences from earlier, foldable months. */
  overdue: number;
  /**
   * At most ONE row per recurring cost: its next unconfirmed occurrence
   * strictly after `monthId`, out to `horizonMonths` ahead. Never a list of
   * everything the future holds.
   */
  comingUp: Occurrence[];
}

/**
 * Everything the band has to show, in three groups. §5 offers confirmation on
 * "the next pending occurrence, not only on ones whose date has passed" — the
 * flagship case is a `lastCharge` bill whose pending slot sits next month, and
 * `occurrencesByMonth` only walks TO the month it is given, so this walks past
 * the displayed month on purpose.
 *
 * The walk stays bounded — `horizonMonths` ahead, twelve by default, which is
 * enough to catch an annual `everyNMonths` cost — and is a band-local concern.
 * `foldBalances`'s own `upToMonth` bound is untouched.
 *
 * `today` is what a "Coming up" row would record if confirmed (see `row` in
 * `ExpectedBand` below) — passed in rather than read from a clock, because
 * this function is exercised directly by tests with no DOM.
 *
 * Two rules keep a "coming up" row from ever being offered when confirming it
 * cannot go well (X1, X3):
 *
 *   - A cost with an unresolved occurrence in `monthId` or any earlier
 *     FOLDABLE month (same bound `overdue` uses) is skipped entirely. Settle
 *     the earlier bill first — offering a later one while an earlier sits
 *     outstanding would let confirming the later one leave the earlier
 *     projection standing, double-counting the bill.
 *   - Otherwise, the row is offered only if recording it at `today` would
 *     leave `occurrencesOf`'s walk able to advance past that slot
 *     (`wouldAdvancePast`). A bill confirmed today for a slot far enough in
 *     the future can rebase the series backwards, which is exactly what
 *     `occurrencesOf` throws on — so a row that would do that must never be
 *     offered in the first place, not offered-and-disabled.
 *
 * Exported for `ExpectedBand.test.ts`.
 */
export function expectedGroups(
  dataset: Dataset,
  monthId: MonthId,
  today: IsoDate,
  horizonMonths = 12,
): ExpectedGroups {
  const byMonth = occurrencesByMonth(dataset, addMonths(monthId, horizonMonths));
  const pending = (byMonth.get(monthId) ?? []).filter((o) => !o.confirmedBy);

  let overdue = 0;
  const seen = new Set<string>();
  // Costs with an outstanding slot at or before `monthId` — X3: none of
  // these may get a "coming up" row until that slot is settled.
  const unresolved = new Set<string>(pending.map((o) => o.recurringId));
  const comingUp: Occurrence[] = [];

  for (const month of [...byMonth.keys()].sort(compareMonths)) {
    const cmp = compareMonths(month, monthId);
    if (cmp === 0) continue; // already `pending`, above.

    const occurrences = byMonth.get(month)!;
    if (cmp < 0) {
      // Everything unconfirmed in an EARLIER month, but not before
      // foldStartMonth: foldBalances never folds those, so an occurrence out
      // there never held the projected balance down in the first place, and
      // counting it here would make the sentence below claim a gap that isn't
      // in the number the owner is looking at. The same bound applies to X3's
      // suppression, for the same reason — a slot the fold never tracked was
      // never "outstanding" in any number the owner can see.
      if (compareMonths(month, dataset.settings.foldStartMonth) < 0) continue;
      for (const o of occurrences) {
        if (o.confirmedBy) continue;
        overdue += 1;
        unresolved.add(o.recurringId);
      }
      continue;
    }

    // A future month within the horizon. Months are visited in ascending
    // order, and a single cost's own occurrences are already emitted in date
    // order, so the first unconfirmed one seen for a given recurringId is
    // that cost's soonest pending occurrence beyond the displayed month.
    for (const occurrence of occurrences) {
      if (occurrence.confirmedBy) continue;
      if (seen.has(occurrence.recurringId)) continue;
      seen.add(occurrence.recurringId);
      if (unresolved.has(occurrence.recurringId)) continue; // X3
      const cost = dataset.recurring.find((c) => c.id === occurrence.recurringId);
      if (!cost || !wouldAdvancePast(cost, occurrence.date, today)) continue; // X1
      comingUp.push(occurrence);
    }
  }

  return { pending, overdue, comingUp };
}

/**
 * The month's expected charges, and the one click that turns each into a real
 * purchase.
 *
 * Confirmation is offered on any unconfirmed occurrence in this month,
 * INCLUDING one whose date has not arrived yet. That is not an oversight: a
 * bill anchored to its last charge can charge early — a phone plan whose data
 * cap is hit on the 12th when the slot sat on the 30th — and confirming the
 * pending slot with the real date is exactly how the series rebases.
 *
 * The same is true one month further out: "Coming up" offers the next
 * pending occurrence even when it lands after the displayed month, because
 * confirming it EARLY — dated today rather than the future slot — is what
 * rebases a `lastCharge` series. A this-month row still confirms at the
 * slot's own date; only a coming-up row records today instead.
 */
export function ExpectedBand({ monthId }: { monthId: MonthId }) {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const { pending, overdue, comingUp } = useMemo(
    () => expectedGroups(dataset, monthId, today),
    [dataset, monthId, today],
  );

  if (pending.length === 0 && overdue === 0 && comingUp.length === 0) return null;

  const nameOf = (recurringId: string) =>
    dataset.recurring.find((c) => c.id === recurringId)?.name ?? "Unknown";

  /**
   * One row, shared by "Expected" and "Coming up" — they differ only in the
   * subtitle and in what date confirming records, per `recordedDateFor`.
   */
  function row(occurrence: Occurrence, recordedDate: IsoDate | null) {
    const key = `${occurrence.recurringId}:${occurrence.date}`;
    const typed = amounts[key];
    const { parsed, invalid } = resolveExpectedAmount(
      typed,
      dataset.currencies,
      occurrence.amount.currency,
    );
    return (
      <li key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm">{nameOf(occurrence.recurringId)}</div>
          <div className="text-xs text-budget-ink-muted">
            {recordedDate ? (
              <>
                Due {occurrence.date} — confirming now records it {recordedDate}
              </>
            ) : (
              occurrence.date
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div>
            <Input
              className="h-8 w-28"
              // text, not number: a number input discards the "$" before
              // parseMoneyInput can read it.
              type="text"
              aria-label={`Amount for ${nameOf(occurrence.recurringId)} on ${occurrence.date}`}
              aria-invalid={invalid}
              value={typed ?? String(occurrence.amount.amount)}
              onChange={(event) => {
                const next = event.target.value;
                setAmounts((current) => ({ ...current, [key]: next }));
              }}
            />
            {invalid && (
              <div className="mt-1 text-xs text-destructive">
                Doesn't look like an amount — Confirm is disabled.
              </div>
            )}
          </div>
          <span className="text-xs text-budget-ink-muted">{occurrence.amount.currency}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={invalid}
            onClick={() => {
              // Captured before mutate, per AGENTS.md: mutate defers behind
              // the write queue and React resets the input first, so reading
              // in the callback commits stale text. `invalid` already guards
              // this (and disables the button), so reaching here means
              // `parsed` is either a real amount or the field was never
              // touched.
              if (invalid) return;
              mutate((draft) =>
                confirmOccurrence(draft, occurrence.recurringId, occurrence.date, {
                  date: recordedDate ?? undefined,
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
  }

  return (
    <Section
      title="Expected"
      hint="Committed but not yet spent. These do not touch a post's balance until you confirm one, which records it as an ordinary purchase you can edit or delete afterwards."
    >
      {pending.length > 0 && (
        <ul className="divide-y divide-budget-rule">
          {pending.map((occurrence) => row(occurrence, recordedDateFor("pending", today)))}
        </ul>
      )}

      {comingUp.length > 0 && (
        <div className={pending.length > 0 ? "mt-4" : ""}>
          <h3 className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted">
            Coming up
          </h3>
          <ul className="divide-y divide-budget-rule">
            {comingUp.map((occurrence) => row(occurrence, recordedDateFor("comingUp", today)))}
          </ul>
        </div>
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
