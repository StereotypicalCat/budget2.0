# Recurring costs, round 2: the anchored model

Three problems the owner hit within a day of the first version shipping:

1. A recurring cost's post is fixed at creation and cannot be changed.
2. There is no way to create a recurring cost while entering a purchase.
3. Confirming twice in one month pushes the next due date two cycles out.

The third is the one that reshapes the design. The first two are additive.

## What the phone bill actually is

The original spec collapsed the data-cap case into "confirm a projected slot
early", and that was wrong at the root. Restated by the owner:

> a phone bill, that refreshes either every month, or everytime the user runs
> out of data. Meaning it can theoretically refresh an infinite number of times
> a month, and the cost should be associated with it — however the next
> [due date] will always be the time its active — be that monthly, quarterly,
> etc.

So a charge is not a slot being claimed ahead of schedule. A charge is an event
that can happen at any moment, any number of times per cycle, and **each one
restarts the clock**. There is no grid to claim against; there is a moving
anchor.

Confirmed by probe against the shipped code — an `everyNMonths` cost with both
September's and October's slots confirmed, both paid in September:

```
series:   2026-09*  2026-10*  2026-11 ...
next due: 2026-11          <- should be 2026-10
```

Note this reproduces under BOTH anchorings, which is what proves the defect is
in the slot model rather than in the rebase rule.

## The split: only `lastCharge` is wrong

Paying September and October's rent really does mean nothing is due until
November. For a `calendar` bill, consuming two slots is CORRECT. The bug exists
only where a second payment is this cycle restarting rather than next month's
bill arriving early.

So the two anchorings get two projection models, and that asymmetry is the
design rather than a compromise:

| | `calendar` (rent) | `lastCharge` (phone) |
| --- | --- | --- |
| Occurrences | fixed grid from `startDate` | next due = last charge + cycle |
| A purchase | settles the slot it names | is a dated charge, names no slot |
| Charges per cycle | one | any number |
| Two payments in September | Sept and Oct settled | next due = Oct, from the later |
| Granularity of `everyNMonths` | month (`"2026-09"`) | day (`"2026-09-20"`) |

## The shape

### 1. Types

`Purchase.source.occurrenceDate` becomes OPTIONAL:

```ts
  /**
   * Present when this purchase is a charge for a recurring cost.
   *
   * `occurrenceDate` is the slot this purchase settles, and exists ONLY for a
   * `calendar` cost, where a fixed grid of slots is what a payment settles.
   * A `lastCharge` cost has no grid — its next due date is derived from the
   * purchase's own `date` — so the field is absent, and its presence there
   * would be a lie about how the schedule is computed.
   */
  source?: { recurringId: RecurringCostId; occurrenceDate?: IsoDate };
```

`RecurringCost` is unchanged. `Recurrence` and `Anchoring` are unchanged.

### 2. The two projections

`occurrencesOf` splits on `cost.anchoring` at the top and runs one of two
loops. They share `stepFrom` and nothing else.

**`calendar` — unchanged from what shipped.** A grid from `startDate`, stepped
by the recurrence, each slot confirmed or not by the purchase whose
`source.occurrenceDate` names it. `everyNMonths` stays month-granular. This
path keeps every test it already has.

**`lastCharge` — new.**

```
charges  = purchases whose source.recurringId is this cost, sorted by date
latest   = the LATEST charge's date, or null when there are none
anchor   = latest === null ? null : max(latest, cost.startDate)
cursor   = anchor === null ? cost.startDate : stepFrom(anchor, recurrence)
while monthOf(cursor) <= upToMonth:
    if endedFrom and cursor >= endedFrom: break
    emit { date: cursor, amount, confirmedBy: null }
    cursor = stepFrom(cursor, recurrence)
```

Three things follow, and they are the argument for this shape:

- **Every `lastCharge` occurrence is unconfirmed by definition.** A charge that
  happened is a `Purchase`; it is not an occurrence at all. So there is no
  suppression logic, no `confirmationsFor` lookup, and `confirmedBy` is always
  null on this path.
- **The walk cannot fail to advance.** It steps forward from a real date with
  `n >= 1`. The entire class of "confirmation dated behind its slot" defects —
  which produced three Criticals in the first version — becomes unreachable.
- **Unlimited refreshes need no mechanism.** Three charges in September? The
  anchor is the third. Nothing has to fit anywhere.

The `max` in the anchor line is why a charge back-dated before the cost
existed cannot pull the series backwards: the anchor never precedes
`startDate`.

Per the owner's decision, the projection keeps cycling to the fold horizon
rather than stopping after the next charge: the forward picture stays full, and
every month past the first is understood to be a guess the data cap can revise.

### 3. Day-precise month stepping

A monthly phone plan that refreshes on 20 September is next due 20 October, not
"October". So `everyNMonths` under `lastCharge` is day-granular, and month
arithmetic needs a clamp rule for the first time in this codebase:

```ts
/**
 * `date` plus `n` months, staying day-granular, clamping to the last day of
 * the target month. 31 Jan + 1 month is 28 Feb (29 in a leap year), which is
 * how a billing cycle behaves and what every calendar library settles on.
 *
 * Only `lastCharge` needs this. A `calendar` monthly cost is month-granular
 * and steps with `addMonths` on a MonthId, where the question cannot arise.
 */
export function addMonthsToDate(date: IsoDate, n: number): IsoDate
```

It goes in `src/domain/days.ts`, which already has the private `daysInMonth`
the clamp needs, and stays `Date`-free like everything else there.

`stepFrom` therefore needs the cost's anchoring, not just its recurrence:
`stepFrom(date, recurrence, anchoring)`. For `everyNMonths` it picks
`addMonths(monthOf(date), n)` under `calendar` and `addMonthsToDate(date, n)`
under `lastCharge`. The other two kinds ignore the argument.

### 4. What gets DELETED

This change removes more code than it adds. All three of these exist to stop a
confirmation landing behind the slot it claims, and with no slots on the
anchored path the situation cannot arise:

- `wouldAdvancePast` in `src/domain/occurrences.ts`, and `rebasedFrom`, which
  only serves it and the old inline rebase.
- The "Coming up" offerability guard in `src/ui/components/ExpectedBand.tsx`.
- `requireConfirmationAdvances` in `src/store/actions.ts` — the guard added for
  PATH A, where editing a confirmed purchase's date through the ordinary
  purchase dialog could brick every money route. Under the anchored model,
  editing that date simply moves the anchor, which is correct behaviour and
  needs no permission.

The walk's termination throw STAYS, as a defensive assert. It should now be
unreachable on both paths; if it ever fires again, something upstream is wrong
and a visible error is still better than a hang.

The `useMutate` change that PATH A's fix brought with it — `mutate` returning
`Promise<boolean>` so `PurchaseDialog` can stay open on a rejected write — is
KEPT. It fixed a real defect (a save that silently did nothing) that has
nothing to do with recurring costs.

### 5. The "Coming up" group

For a `calendar` cost it stays exactly as it is: paying rent early is real, and
settling a future slot is what it means.

For a `lastCharge` cost the two rows split by what they mean:

- **This month's pending row keeps its one-click Confirm.** It records a charge
  dated the occurrence's own date — "paid on time" — which re-anchors from
  there. Entry speed is a product principle, and paying a bill on schedule is
  the common case; routing it through the full purchase dialog would make the
  ordinary act slower to serve the exceptional one.
- **A "Coming up" row becomes INFORMATIONAL** — it names the next due date with
  no Confirm button. Confirming a future anchored charge IS the refresh case,
  and the refresh needs a real date and possibly a different amount, which is
  the purchase dialog's job (§6). A one-click button there would have to invent
  a date, and inventing it is what produced the round-1 Critical.

For `calendar` costs both rows keep their Confirm exactly as shipped. Deleting
the offerability guard (§4) is safe there precisely because a calendar grid
never rebases: confirming a future slot at today's date cannot move anything.

### 6. The purchase dialog

One new control, which serves both the owner's second request and the data-cap
refresh:

```
Recurring cost   [ None | <each active cost> | + New recurring cost... ]
```

- **Tagging an existing cost** is the refresh. Data runs out on the 20th; the
  owner enters the purchase and picks *Phone plan*. The money is booked and the
  cycle restarts from that date, because the anchor is the latest charge. For a
  `calendar` cost, tagging settles the occurrence in the purchase's own month,
  and a cost whose grid has no slot in that month is not offered for that date.
- **"+ New recurring cost..."** reveals the cycle and anchoring fields and
  seeds the cost from the purchase being typed: its amount, its splits, its
  currency, its date as `startDate`. The purchase becomes the cost's first
  charge, so a `lastCharge` cost created this way is anchored from the moment
  it is created.

The dialog's existing rules bind here unchanged: capture `event.target.value`
into a `const` before `mutate`, route writes through `useMutate`, keep the
amount field `type="text"`.

### 7. `RecurringSection` gets the real split editor

The owner's first problem. `RecurringCost` has carried `splits` and `splitMode`
with the same shape as `Purchase` since the first version, so this is wiring up
a capability the data model already has rather than adding one.

`SplitEditor` is currently typed to `PurchaseDraft`. It reads only `amount`,
`currency`, `splitMode` and `splits`, so it gets narrowed to what it uses:

```ts
export interface SplitTarget {
  amount: number;
  currency: Currency;
  splitMode: "percent" | "fixed";
  splits: SplitDraft[];
}

export function SplitEditor<T extends SplitTarget>(props: {
  draft: T;
  posts: Post[];
  onChange: (next: T) => void;
}): JSX.Element
```

`PurchaseDraft` satisfies `SplitTarget` structurally, so `PurchaseDialog`'s
call site does not change at all. `RecurringSection` passes a cost-shaped
object. `splitBalance` narrows the same way.

The per-row post picker, the percent/fixed toggle and the remainder absorber
all come along for free — which means a bill can span envelopes, and the
absorber rule stays identical to a purchase's.

### 8. Migration 7 -> 8

Two data changes, both narrow:

- **Strip `occurrenceDate`** from any purchase whose `source.recurringId`
  names a cost with `anchoring: "lastCharge"`. The field is meaningless on that
  path and leaving it would invite a future reader to trust it.
- **Expand a month-only `startDate` to the 1st of that month** for any cost
  that is `everyNMonths` AND `lastCharge`, because day precision now requires a
  real day.

Not behaviour-preserving, and it must not claim to be: a `lastCharge` cost's
projected dates deliberately change, which is the entire point of the change.
What IS preserved is every recorded figure — no `Money` is touched, no purchase
is added or removed, and `calendar` costs are not touched at all.

Per AGENTS.md, the step reads no live default. The two literals it needs
(`"lastCharge"`, `"everyNMonths"`) are inline strings, not imported constants.

### 9. Validation

`src/export/json.ts` and `src/store/actions.ts` both change, and must keep
agreeing with each other:

- `occurrenceDate` is REQUIRED when the named cost is `calendar`, and
  FORBIDDEN when it is `lastCharge`. Both boundaries enforce both directions —
  a file that carries one on an anchored cost is describing a schedule the app
  will not compute.
- `startDate` granularity: day-granular for `everyNDays` and `everyNWeeks` as
  now; ALSO day-granular for `everyNMonths` + `lastCharge`; month-or-day for
  `everyNMonths` + `calendar`, as now. Calendar-impossible dates stay rejected
  through `toDayOrdinal`, per the round-1 residual fix.
- Because a cost's anchoring now determines what a purchase's `source` may
  contain, **`updateRecurringCost` refuses to change `anchoring` on a cost that
  already has charges.** Switching `calendar` -> `lastCharge` could strip the
  now-forbidden `occurrenceDate`s mechanically, but the reverse cannot: there
  is no honest way to invent which slot each existing charge settled, and
  guessing would leave purchases claiming slots that are not on the new grid —
  real money settling nothing. Ending the cost and creating a new one preserves
  the history and states the change plainly. The UI disables the control with
  that reason rather than failing on save.

AGENTS.md §3 is untouched: over-budget, percentages past 100, splits that do
not sum, and negative amounts all stay deliberately unvalidated.

### 10. Store actions

- `confirmOccurrence` keeps its shape for `calendar`. For `lastCharge` it
  writes `source` without `occurrenceDate`, and `overrides.date` is simply the
  charge's date.
- A new `chargeRecurringCost(draft, recurringId, purchase)` is NOT added.
  Tagging a purchase in the dialog goes through `addPurchase` with a `source`,
  which is the same write path an ordinary purchase takes. One less action to
  keep in step.
- `updatePurchase` loses `requireConfirmationAdvances` (§4) and gains nothing.

### 11. Tests

- **`domain/days.test.ts`** — `addMonthsToDate` clamping: 31 Jan -> 28 Feb, and
  29 Feb in a leap year; 31 Mar -> 30 Apr; a 12-month step landing on the same
  day; a step across a year boundary.
- **`domain/occurrences.test.ts`** — the owner's exact case: two charges in one
  September, next due October and NOT November. Three charges in one month.
  A charge back-dated before `startDate` clamping to `startDate`. The full
  phone-bill flow: monthly cycle, refresh on the 20th, next due the 20th of the
  following month. And that `calendar` behaviour is byte-identical to what
  shipped — its existing tests must pass unmodified.
- **`domain/fold.test.ts`** — `expected` and `projected` under the anchored
  model, including that a month containing three charges shows three actual
  charges and no expectation.
- **`store/migrations.test.ts`** — 7 -> 8 strips `occurrenceDate` only from
  anchored costs' purchases, expands only anchored monthly `startDate`s, and
  moves no recorded figure.
- **`export/json.test.ts`** — the required/forbidden `occurrenceDate` pairing
  in both directions, and the widened `startDate` granularity rule.
- **`ui/components/PurchaseDialog`** — the new control's pure helpers: which
  costs are offerable for a given date, and the cost seeded by "+ New".
- **`ui/routes/settings/RecurringSection`** — splits editable, absorber rule
  holds.

Each Critical from round 1 that this change makes structurally impossible keeps
its regression test where the test still describes reachable behaviour, and
loses it where the behaviour no longer exists. A test asserting a guard that
has been deleted is noise, not coverage — but the deletion must be argued in
the commit, not done quietly.

## Alternatives considered

- **One model for both anchorings**, with payments never claiming slots and a
  `calendar` occurrence counted as settled if any payment falls in its period.
  Rejected: two rent payments in one month would settle one slot and leave a
  charge floating with nothing to attach to, and "settled by period" is fuzzier
  than "settled by identity" for a bill that genuinely has a fixed grid.
- **Keep slots, let a slot hold several payments, re-anchor from the latest.**
  The smallest possible change. Rejected because it does not deliver the
  requirement: it handles one extra payment per cycle, not "an infinite number
  of times a month" — the second refresh has no slot left to attach to, and
  attaching it to the NEXT slot is exactly the bug being fixed.
- **Only the current month is confirmable** — drop "Coming up" entirely.
  Rejected: it removes paying rent early, which is legitimate under `calendar`,
  and it solves the anchored case only by forbidding the flow rather than
  modelling it.
- **Track data usage in the app.** Never considered seriously; the app cannot
  know, and the owner recording a charge is the signal.

## If this needs undoing

The `calendar` path is untouched, so a revert is confined to the anchored one:
restore the slot walk, make `occurrenceDate` required again, and reinstate the
three deleted guards. The 8 -> 9 migration would need to invent an
`occurrenceDate` for each anchored charge, which is lossy — the honest reverse
is to migrate anchored costs to `calendar` and accept that their schedules
shift. Which is a reason to be confident about this change before taking it,
not a reason to avoid it.

## Out of scope

- **Year and summary views** still show the actual track only. Unchanged from
  round 1 and still that sub-project's call.
- **ODS export** still exports actual figures only.
- **No data-cap or usage concept.** The owner recording a charge is the whole
  mechanism, exactly as in round 1.
- **No bulk charge entry.** One purchase per refresh until there is evidence
  that is too slow.
- **The deferred minors from round 1** that this change does not touch stay
  deferred: the demo dataset's Rent double-charge is fixed, but the inline
  "doesn't look like an amount" message still flashes on intermediate typing,
  and settings sections other than the purchase dialog still swallow write
  errors.

## Documents to update

- **AGENTS.md §1** — the invariant "a confirmation's `Purchase.date` is truth
  while `source.occurrenceDate` is identity" is now HALF wrong and must be
  rewritten: identity applies to `calendar` only, and on the anchored path the
  purchase's date is the whole story.
- **AGENTS.md §2** — the `n >= 1` termination guard bullet stays, but its
  reasoning changes: the throw is now a defensive assert rather than a live
  guard, and the bullet should say so rather than describing a condition the
  code can no longer reach.
- **docs/DECISIONS.md** — a new entry under "Recurring costs": two projection
  models over one, and what that was chosen over.
- **docs/PRODUCT.md** — a recurring cost can charge more than once per cycle,
  and can be created while entering a purchase.
- **docs/ARCHITECTURE.md** — the anchored walk beside the grid walk.
- **docs/specs/2026-09-03-recurring-costs-design.md** — a header note pointing
  here, since its §4 and §5 now describe a model that only half survives. The
  old spec is not edited beyond that pointer: it is an accurate record of what
  was decided then, and rewriting history to match the present is how a
  decisions log stops being worth reading.
