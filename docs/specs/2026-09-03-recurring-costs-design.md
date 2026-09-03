# Recurring costs

Bills that repeat: rent every month, a subscription every 28 days, a phone bill
every 30 days whose clock restarts whenever the data cap is hit early.

A recurring cost projects *expected* charges forward, and each occurrence is
confirmed into a real `Purchase` when the money actually moves. The fold
therefore carries two balances per post per month: what is actually left, and
what is left after commitments.

## What this is not

It is not a new way to spend money. `Purchase` remains the only record of money
that moved, and `chargesForMonth` is untouched — a confirmed occurrence flows
through it as an ordinary purchase. What is new is a second, parallel track of
money that is *expected* to move, which never touches `remaining`.

It is also not a materialised schedule. Occurrences are computed on every fold
and never persisted, because the original design rejected materialised month
snapshots and because an unbounded recurrence would otherwise need an arbitrary
horizon. The fold's `upToMonth` is the bound, and it comes from the caller — so
`src/domain/` stays clock-free.

## The three cases, and why there are only two mechanisms

| case | recurrence | anchoring |
| --- | --- | --- |
| Rent | `everyNMonths(1)` | `calendar` |
| World of Warcraft | `everyNDays(28)` | `calendar` |
| Phone bill with a data cap | `everyNDays(30)` | `lastCharge` |

The phone bill reads like a third kind of recurrence and is not one. Restated:
it charges 30 days after the *previous charge*, and hitting the data cap simply
causes a charge to happen early. Under two-stage confirmation the date a charge
actually happened is already recorded — it is `Purchase.date` on the
confirmation. So "every 30 days from the last actual charge" is the whole
behaviour, and `anchoring` is one field rather than a subsystem.

Nothing in the domain knows what a data cap is, and nothing needs to. The owner
hits the cap, confirms that occurrence dated the day it charged, and the series
rebases itself.

## The shape

### 1. Types

```ts
/** How occurrence dates are generated. Extensible: a new variant here plus one
 *  case in `stepFrom` — nothing else in the app switches on this. */
export type Recurrence =
  | { kind: "everyNMonths"; n: number }
  | { kind: "everyNDays"; n: number }
  | { kind: "everyNWeeks"; n: number; weekday: number };

/** Where the NEXT occurrence is measured from. */
export type Anchoring = "calendar" | "lastCharge";

export type RecurringCostId = string;

export interface RecurringCost {
  id: RecurringCostId;
  name: string;
  order: number;
  /** Archived, never deleted — confirmed purchases reference it. */
  archived: boolean;
  /** Expected amount, in its own currency. Converted to base at fold time. */
  amount: Money;
  /** The first occurrence. "YYYY-MM" for everyNMonths, "YYYY-MM-DD" otherwise. */
  startDate: IsoDate;
  /** Occurrences on or after this are not projected. This is cancellation. */
  endedFrom?: IsoDate;
  recurrence: Recurrence;
  anchoring: Anchoring;
  /** Same shape and same invariant as Purchase: exactly one absorbsRemainder. */
  splitMode: "percent" | "fixed";
  splits: Split[];
}
```

`Dataset` gains `recurring: RecurringCost[]`. `Purchase` gains one optional
field:

```ts
export interface Purchase {
  // ...unchanged...
  /** Present when this purchase confirms a projected occurrence. */
  source?: { recurringId: RecurringCostId; occurrenceDate: IsoDate };
}
```

**`everyNMonths` carries no day.** Rent occurs *in* September, not on the 3rd
of it. `IsoDate` already permits a bare `"YYYY-MM"` — "the app is about monthly
spending, so a day is optional" (`types.ts`) — so a monthly cost produces
month-granular occurrences, needs no day arithmetic, and no clamping rule for
February ever has to exist. Only `everyNDays` and `everyNWeeks` are
day-granular.

**`source.occurrenceDate` and `Purchase.date` are different facts**, and the
pair is what makes the phone bill work:

- `source.occurrenceDate` is **identity** — the slot the projector generated.
  Projection suppresses a slot that a confirmed purchase already claims.
- `Purchase.date` is **truth** — when the money moved. The fold uses it, and
  under `lastCharge` the next occurrence is measured from it.

They are equal when a bill is paid on schedule and diverge when it is not.

### 2. No dated amount series, and why that is safe

`amount` is a single mutable `Money`. A rent increase edits the number.

This would be wrong for `Post.rules`, where changing an allocation must never
destroy history (PRODUCT principle 2) and a `RuleVersion[]` series is what
guarantees it. Recurring costs need no equivalent, because every past
occurrence is already a confirmed `Purchase` holding the amount actually paid.
The rule describes what is expected next; the ledger holds what happened. Only
unconfirmed future occurrences move when the amount is edited, which is exactly
what editing it means.

This is a direct consequence of two-stage confirmation. Under projection-only
it would not hold, and a dated series would be required.

### 3. `src/domain/days.ts`

The first day-level arithmetic in the domain, and deliberately in the same
character as `months.ts`: integer math on a day ordinal, no `Date`, no
timezones anywhere.

`toDayOrdinal` / `fromDayOrdinal` (civil-date conversion), `addDays`, and
`weekdayOf` = `(ordinal + 4) % 7`, since day 0 is a Thursday.

Date **comparison stays lexicographic**. ISO strings already sort correctly,
and it gives mixed granularity the right meaning for free:
`"2026-09" < "2026-09-17" < "2026-10"`, so a month-only date reads as the start
of that month — which is what `endedFrom` needs when a monthly cost is
cancelled.

### 4. `src/domain/occurrences.ts` — the walk

Occurrences cannot be queried one month at a time. Under `lastCharge`, where
the series sits in month M depends on every confirmation before it. So the
projector walks from `startDate`, and the fold calls it once per fold.

```
cursor = cost.startDate
while monthOf(cursor) <= upToMonth:
    if cost.endedFrom and cursor >= cost.endedFrom: break
    confirmation = confirmations.get(cursor)      // keyed by source.occurrenceDate
    emit { date: cursor, amount, confirmedBy: confirmation?.id ?? null }
    next = stepFrom(cost.anchoring === "lastCharge" && confirmation
                      ? confirmation.date          // actual — rebases the series
                      : cursor)                    // projected — assume paid on time
    if next <= cursor: throw
    cursor = next
```

`stepFrom` per kind:

| kind | step |
| --- | --- |
| `everyNMonths(n)` | `addMonths(monthOf(d), n)` — result stays month-granular |
| `everyNDays(n)` | `addDays(d, n)` |
| `everyNWeeks(n, weekday)` | `addDays(d, 7n)`, then snap forward to `weekday` |

The weekly snap is identity when the cursor is already on the named weekday, and
does the right thing when a `lastCharge` rebase lands off it.

An unconfirmed occurrence advances from its own projected date — the projection
assumes bills are paid on time — so the series is deterministic however far
ahead it runs, and self-corrects as occurrences are confirmed.

**Termination.** The walk is safe only if `stepFrom` strictly increases. `n` is
validated as an integer `>= 1` at both write boundaries (§8, §9), and the loop
additionally throws if the cursor fails to advance. A throw rather than a break,
per AGENTS.md: a hang is the one failure mode worse than a visible error, and
silently dropping a bill would be worse still.

**Phase.** The walk always starts at `startDate` even when that precedes
`foldStartMonth`, because under `lastCharge` the phase depends on the whole
history. The fold reads only the months it folds. The cost is bounded and
trivial — thirty-five years of a 28-day cycle is about thirteen thousand
integer additions.

### 5. Confirmation, and the occurrence nobody confirms

Suppression is by `source.occurrenceDate`, which means there is no
reconciliation pass and no stored link to keep consistent:

- Delete the confirming purchase and the slot un-confirms itself, reappearing
  as expected.
- Edit its amount and only the actual figure moves; the expectation is
  unchanged.
- If a `lastCharge` rebase shifts the series so a confirmed slot is no longer
  generated, the purchase stands — real money moved — and simply suppresses
  nothing. There is nothing to reconcile, because the ledger is not wrong.

**A slot may be confirmed with a date earlier than the slot itself**, and this
is the normal path for the phone bill rather than an edge case. The pending
occurrence sits 30 days out; the cap is hit on day 12; the owner confirms that
pending slot with a purchase dated day 12. The slot is *which* charge this is,
not *when* it was due, so confirming one early is meaningful and is what rebases
the series. The month view therefore offers confirmation on the next pending
occurrence, not only on ones whose date has passed.

An occurrence in a **past** month that is never confirmed stays expected
forever, holding the `projected` track permanently below `remaining`. That is
the correct reading: an unreconciled commitment. But it is silent drift, so the
overdue count in §10 is a required part of this change, not a nicety.

### 6. Fold integration

`chargesForMonth` is untouched. Confirmations are ordinary purchases and
already flow through it.

One extraction pays for itself: the split-distribution half of
`chargesForPurchaseInMonth` becomes a shared helper taking
`(amount, splits, splitMode, index, baseCurrency, rates, digits)`, called by
both real charges and expected ones. Without it the two paths could round
differently or absorb the remainder differently, and the difference would show
up as a penny of phantom drift between the tracks.

The decimals change (`8d2b2ca`) made this smaller than it would have been:
`chargesForPurchaseInMonth` already takes `digits: number` rather than a
currency table, so the helper needs no currency plumbing at all.

`PostMonthFigures` gains three fields, and `foldBalances` runs two accumulators
over its existing loop:

```
remaining = carriedIn          + allocation - charges
projected = projectedCarriedIn + allocation - charges - expected
```

Both are rounded to `dataset.settings.digits`, in the same place, as
`remaining` is today.

Two invariants keep this honest, and both are tests:

- **With no recurring costs, `projected === remaining` and
  `projectedCarriedIn === carriedIn` in every month.** Nothing existing moves.
- **Once every occurrence in a month is confirmed, the two tracks reconverge
  there.** The past settles; only the future is a forecast.

### 7. Migration 6 -> 7

One appended step: `recurring: []` on the dataset. Nothing else —
`Purchase.source` is optional, so no purchase is rewritten.

Behaviour-preserving by construction: an empty array projects no occurrences,
so every existing dataset folds to the same `remaining` it did before, and
`projected` equals it everywhere.

The step writes a literal `[]` and reads no live default, so the
no-live-default guard is satisfied with nothing to freeze.

> **Ordering, resolved by what shipped.** Both this spec and
> `2026-09-02-global-decimals-design.md` were drafted claiming schema 6. The
> decimals change landed first (`8d2b2ca`) and took 6, so this one takes 7.
> The two steps were always independent — that one moved where digits live,
> this one writes `recurring: []` — and nothing about their content had to
> change, only the number.

### 8. Validation — `export/json.ts`

Per `recurring` entry: `amount` through the existing `requireCurrency` against
the currency table; `startDate` and optional `endedFrom` parse as `IsoDate`;
the `recurrence` discriminant is one of the three kinds with **`n` an integer
`>= 1`**; `weekday` is 0-6 for `everyNWeeks`; `anchoring` is one of the two
literals; `splits` is non-empty with exactly one `absorbsRemainder` and every
`postId` resolving to a post.

`n >= 1` is a hard reject rather than a clamp because it is what makes §4
terminate. A clamped zero would silently change the bill's schedule; a rejected
one tells the owner their file is wrong.

`Purchase.source`, when present: `recurringId` resolves and `occurrenceDate`
parses.

### 9. Store actions

`addRecurringCost`, `updateRecurringCost`, `archiveRecurringCost`,
`reorderRecurringCost`, and:

```ts
confirmOccurrence(draft, recurringId, occurrenceDate, overrides?: {
  date?: IsoDate;
  amount?: Money;
}): PurchaseId
```

which builds an ordinary `Purchase` carrying `source`, copying the cost's
`splits` and `splitMode`, and ensuring the target month exists the way
`addPurchase` already does — so income can be entered for a month a
confirmation was the first thing to touch.

`addRecurringCost` and `updateRecurringCost` apply the same `recurrence`
checks as §8 — integer `n >= 1`, `weekday` in range, a known `kind` — because
§4 terminates only if every write path enforces them, and the JSON importer is
not the only write path.

Archived, never deleted, for the same reason posts are: confirmed purchases
reference the cost.

### 10. UI

**`RecurringSection` in Settings**, alongside `PostsSection` — the same CRUD,
reorder and archive idiom, because a recurring cost is defined once and then
left alone. Definition is not the repeated act.

**An "Expected" band in the month view**, which is where the repeated act
happens. Each unconfirmed occurrence for the month is one row with a one-click
confirm that writes the purchase at the expected date and amount. The amount is
editable inline before confirming, because paying a different figure is the
common case rather than the exception; anything more unusual is edited
afterwards like any other purchase. Entry speed is a product principle, and a
dialog per bill would defeat it.

**The overdue count** — unconfirmed occurrences from earlier months — appears in
that band. §5 is otherwise silent drift.

Three existing rules apply directly to the inline amount field: capture
`event.target.value` into a `const` before `mutate` (AGENTS.md §2, the
deferred-write rule); route every `store.*` call through `useMutate`; and get
formatters from `useMoneyFormat()` rather than calling `format.ts` directly,
since display is a rounding boundary and a pinned 2 there is the bug `8d2b2ca`
fixed. The field itself stays `type="text"` and parses through
`parseMoneyInput`, so "30$" works the way it does everywhere else.

### 11. Tests

- **`domain/days.test.ts`** — ordinal round-trip across leap years and century
  boundaries, weekday against known dates.
- **`domain/occurrences.test.ts`** — all three kinds; `calendar` against
  `lastCharge`; the phone bill end to end (30-day cycle, cap hit on day 12,
  series rebases to day 42, cap hit again); `endedFrom`; suppression;
  un-confirming by deleting the purchase; and the strictly-increasing throw.
- **`domain/fold.test.ts`** — the two convergence invariants from §6.
- **`store/migrations.test.ts`** — 6 -> 7 adds the empty array and moves no
  figure.
- **`export/json.test.ts`** — acceptance and rejection, including `n: 0`,
  `n: 1.5`, a `weekday` of 7, and an unknown `kind`.
- **`domain/currencyDigits.test.ts`** — the file now drives the whole dataset
  at zero decimals and asserts that raising the setting to 2 changes what the
  fold produces. The `expected` track joins that sweep, so it cannot be the one
  path that quietly assumes 2.

`scripts/demo-data.ts` seeds a monthly rent and a 28-day subscription, so the
band is screenshot-verifiable.

## Alternatives considered

- **Projection only, with no confirmation.** Recurring costs charge
  automatically and are never reconciled. Much smaller: no `source`, no
  suppression, no second balance, no overdue count. Rejected by the owner in
  favour of keeping expected and actual distinguishable. It would also have
  forced a dated amount series (§2), since nothing else would hold the history
  of what was actually paid.
- **Generation only: materialise real purchases from a template.** The fold,
  splits, FX and ODS export need no changes at all. Rejected because it needs a
  horizon and a notion of "today" to know how far to generate, both of which
  the domain is built to avoid, and because editing the template raises an
  unanswerable question about already-generated future rows.
- **Extending `Purchase.schedule` with a generative variant**, preserving the
  original design's "one `Purchase` entity covers all three cases". Rejected:
  under two-stage confirmation that purchase's job is to spawn purchases, so
  every consumer of `Purchase` — the month list, ODS export, the split editor,
  JSON validation — would have to learn to skip templates. The one-entity rule
  was about splits and finance plans composing; a template is not a third case
  of a purchase.
- **Recurrence as a property of a `Post`.** Rejected: a post is a budget
  envelope, and a bill can split across several of them.
- **A `dataCap` concept for the phone bill.** Rejected once it became clear
  that `lastCharge` anchoring plus the confirmation date reproduces the
  behaviour exactly, with no usage tracking and no third recurrence kind.
- **`monthlyOnDay(day)` for rent**, with clamping for short months. Rejected in
  favour of day-less `everyNMonths`: the owner does not think about rent as
  landing on a date, `IsoDate` already supports month-only values, and it keeps
  day arithmetic out of the most common case entirely.

## If this needs undoing

Deleting `Dataset.recurring` and the `expected` / `projected` fields is a 7 -> 8
migration that loses no ledger data — every confirmed occurrence is already an
ordinary `Purchase` and stays one, with a dangling `source` that validation
would then ignore. The reverse of §7, plus dropping two modules.

Narrowing rather than reverting is cheaper still: keeping the projector but
dropping the second balance means deleting three fields from
`PostMonthFigures` and leaving §6's first invariant as the only behaviour.

## Out of scope

- **ODS export keeps exporting actual figures only.** The spreadsheet is a
  record of what happened, not a forecast.
- **Year and summary views show the actual track only.** They are queued for
  redesign in `docs/TODO.md` §1; a second track there is that sub-project's
  call.
- **The carry meter is unchanged.** `meterSegments.ts` takes
  `PostMonthFigures` and keeps compiling; painting expected onto the meter is a
  design question, not a data one.
- **No usage tracking, no data caps, no notifications, no reminders.** The
  phone bill works through confirmation dates alone.
- **No bulk confirmation.** One click per occurrence until there is evidence
  that is too slow.

## Documents to update

- **AGENTS.md §1** — two invariants: occurrences are computed and never stored;
  a confirmation's `Purchase.date` is truth while `source.occurrenceDate` is
  identity.
- **AGENTS.md §2** — the termination guard, and why `n >= 1` is rejected rather
  than clamped.
- **docs/DECISIONS.md** — a new "Recurring costs" heading pointing here, and
  "Now at version 6" becomes 7.
- **docs/PRODUCT.md** — the capability list and the terminology section gain
  the concept.
- **docs/ARCHITECTURE.md** — the layer diagram and the derived-values list gain
  `occurrences.ts` and the second balance.
