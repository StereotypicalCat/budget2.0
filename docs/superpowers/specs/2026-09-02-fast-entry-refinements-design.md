# Fast entry refinements — Design

**Date:** 2026-09-02
**Status:** Awaiting review
**Supersedes nothing.** Extends `2026-09-01-budget-app-design.md`; every invariant
in that document still holds.

## Purpose

Three changes to how purchases are entered, driven by using the app:

1. Entering many lines should be keyboard-driven. Today the row list puts a
   *remove* button between every amount and the next description, so tabbing
   costs twice the stops it should, and adding a row needs a mouse.
2. The app should be about monthly spending, not a daily log. Today every
   purchase demands an exact date during entry.
3. A purchase should carry a note — longer context than its short label.

They are specified together because all three change the same two entry forms
and, in particular, the same tab order. Building them separately would mean
writing that tab order twice.

## Non-goals

Deliberately excluded. Each is a separate cycle.

- **Time-versioned allocation rules** (a rule effective from a month onward).
  Architectural: it changes `allocationFor`, which the whole rollover fold runs
  through, and needs the project's first schema migration. Specified separately.
- **Per-line splits and finance plans in fast entry.** A line needing either is
  saved plain and edited from the month view.
- **Any schema migration.** Both model changes here are backward compatible by
  construction; see "Data model".

## Decisions and why

### Dates: widen the field rather than restructure it

`Purchase.date` keeps the type `IsoDate`, but the string may now be either
`"YYYY-MM-DD"` or `"YYYY-MM"`. A purchase with no day belongs to its month.

Considered and rejected: splitting into `month: MonthId` plus `day?: number`.
That is the more honest model and would be the right call in a greenfield
design. It was rejected because it changes a type every layer depends on and
requires a migration executed in the browser against the user's only copy of
their financial data. The user-visible outcome is identical. If the model
becomes a problem, it is a safe refactor later, behind better coverage.

This works because `monthOf()` already parses both shapes: it matches the first
seven characters and validates the month is 01–12. Verified against the current
implementation before adopting this approach:

| input | result |
|---|---|
| `"2026-09-14"` | `"2026-09"` |
| `"2026-09"` | `"2026-09"` |
| `"2026-13"`, `"2026-00"`, `"2026-9"`, `"nonsense"` | throws |

The month-range guard added earlier therefore already protects the month-only
form. This behaviour is currently incidental and must be pinned by a test, since
the whole approach depends on it.

### Notes: an optional field, not a replacement

`description` stays the short scannable label the month list renders. `note` is
optional free text alongside it. Making it optional is what keeps this
migration-free: absent is a legal value for every existing purchase.

### A row holding only a note is not blank

Blank rows are ignored on save. A row with a note but no description or amount
is NOT blank: it surfaces a validation message asking for the missing fields.
Silently discarding something the user typed is worse than an error.

## Design

### Entry flow (fast entry)

- Row columns become **description → amount → note**. These are the only tab
  stops in a row.
- The list always ends in exactly one blank row. Filling the last row appends a
  fresh blank below it, so Tab flows into a new line with no special-casing —
  and new rows appear on touch devices, which have no Tab key. The **Add line**
  button is therefore removed.
- **Backspace** in an empty description field removes that row and moves focus
  to the previous row's **note** field, which is that row's last tab stop. The
  list never shrinks below one row: removing the only remaining row clears it
  instead of deleting it.
- A **×** control fades in on row hover or focus for pointer and touch users. It
  carries `tabIndex={-1}` so it is clickable but never a tab stop — restoring
  the tab order is the point of this change. It removes a row under the same
  rule as Backspace, including the never-below-one-row floor.
- The running line count and total stay.

### Dates

- Both entry forms default to the month being viewed, with **no day**.
- A specific day is set by a **"set exact date" link** beneath the month, which
  reveals a native `<input type="date">` when clicked. It is a link rather than
  an always-present field so the day is opt-in, and it is not in the row tab
  order. Once a day is set, the field stays visible for that purchase.
- Display shows the day only when the stored value has one; otherwise the month.
- Sorting and grouping are unaffected: everything already derives the month via
  `monthOf()`.

### Notes

- Present in the single purchase dialog and as the third bulk-row column.
- Rendered in the month view's purchase list when non-empty, subordinate to the
  description.
- Never required.

## Data model

```ts
// src/domain/types.ts
/** "YYYY-MM-DD", or "YYYY-MM" when the purchase has no specific day. */
type IsoDate = string;

interface Purchase {
  // ...unchanged...
  /** Optional longer context, alongside the short `description` label. */
  note?: string;
}
```

No `schemaVersion` bump. Both changes are supersets of what is already stored:
every existing purchase has a full date (still legal) and no note (legal).

## Validation

`parseDatasetJson` must accept a `Purchase.date` of either shape and continue to
reject anything else — including a month outside 01–12, which the existing
`MONTH_ID` tightening already guards for month ids and must now also guard for
the month-only date form.

Fast-entry validation mirrors `validatePurchase` in what it deliberately does
**not** reject: no rejection on magnitude, negative amounts (a refund is a
normal line), splits that do not sum, or going over budget.

## Testing

- `monthOf()` accepts `"2026-09"` as well as `"2026-09-14"`, and still throws on
  a malformed or out-of-range value. This is currently incidental behaviour that
  the date change depends on; the test makes it a guarantee.
- `note` round-trips through `toPurchase`/`fromPurchase` and through
  `toPurchases` for bulk lines.
- Blank-row logic accounts for the third column. A row is blank only when
  description, amount AND note are all empty. Each partially filled shape
  produces a specific, row-numbered message:
  - description, no amount -> `Line N: enter an amount other than zero.`
  - amount, no description -> `Line N: give it a description.`
  - note only -> both of the above, since it has neither.
- Appending behaviour: filling the last row yields exactly one new trailing
  blank, never two.
- JSON import accepts both date shapes and still rejects garbage.
- The existing suite stays green, and the `eventCapture` guard covers the new
  handlers.

Keyboard behaviour — Tab order, Backspace-to-remove, focus after append — cannot
be verified in this environment: there is no browser, and happy-dom does not
model focus and tab traversal faithfully. These require the user to confirm.

## Files

| File | Change |
|---|---|
| `src/domain/types.ts` | `note?`, `IsoDate` doc comment |
| `src/domain/months.test.ts` | pin month-only parsing |
| `src/ui/purchaseForm.ts` | `note` in the draft and both conversions |
| `src/ui/bulkEntry.ts` | `note` per line; blank-row rule; trailing-blank append |
| `src/ui/components/BulkLines.tsx` | third column, tab order, Backspace, hover × |
| `src/ui/components/PurchaseDialog.tsx` | note field; date de-emphasis |
| `src/export/json.ts` | accept both date shapes |
| `src/export/ods.ts` | date column renders either shape |
| `src/ui/routes/MonthRoute.tsx`, `PostMonthRoute.tsx` | show note; show day only when present |
