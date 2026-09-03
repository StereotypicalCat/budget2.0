# One decimal setting for the whole dataset

Replaces `CurrencyDef.digits` — decimal places defined per currency — with a
single `Settings.digits` that every rounding site uses, whatever the currency.

Requested directly by the owner, with the trade-off below stated and accepted
before the work started. This document is the record of what was given up, so
that a later reader does not mistake it for an oversight.

## What this costs

A dataset whose currencies have different minor units can no longer be
described. That is not a corner case; it is the case the current design exists
for:

| currencies held | `settings.digits` | result |
| --- | --- | --- |
| DKK (2), JPY (0) | `2` | ¥1234.56 — yen have no minor unit, so this is not an amount that can exist |
| DKK (2), JPY (0) | `0` | 49.95 DKK rounds to 50; the fold's carry drifts from the bank's |
| DKK (2), USD (2), EUR (2), GBP (2) | `2` | correct — every currency agrees |

The third row is the shipped dataset, which is why this is safe *today*. It
stops being safe the first time a zero- or three-decimal currency is added, and
nothing in the app will say so. Adding a per-currency override later is the
escape hatch, and §"If this needs undoing" says what that would take.

This directly supersedes the AGENTS.md §1 invariant "`roundMoney(amount,
digits)` takes a DIGIT COUNT... Decimal places live in `Dataset.currencies`".
That bullet gets rewritten, not left standing — three files disagreeing about
where digits live is worse than the change itself.

## The shape

### 1. Types

```ts
export interface Settings {
  baseCurrency: Currency;
  foldStartMonth: MonthId;
  schemaVersion: number;
  /** Decimal places for EVERY amount, whatever its currency. Integer 0-4. */
  digits: number;
  fxApiUrl?: string;
}

export interface CurrencyDef {
  code: Currency;
  symbol?: string;
  name?: string;
  // `digits` removed.
}
```

`digits` is required on `Settings`, not optional. An optional field would mean
every read needs a `?? 2` fallback, and a fallback of 2 is exactly the silent
wrongness the old required-argument rule was built to prevent.

`DEFAULT_CURRENCY_DIGITS` is renamed `DEFAULT_DIGITS` and keeps its one job:
the value a brand-new dataset seeds with.

### 2. `digitsFor` is deleted, not re-pointed

`digitsFor(currencies, code)` resolves a code against a table. With one global
value the code argument is meaningless, and a function that accepts an argument
it ignores invites call sites to believe it still matters.

So the sixteen call sites, spread over ten files, resolve
`dataset.settings.digits` directly, and the domain functions that took
`currencies: readonly CurrencyDef[]` *only* to resolve digits take
`digits: number` instead:

| file | today | after |
| --- | --- | --- |
| `domain/allocation.ts` | `resolveRule(..., currencies)` | `resolveRule(..., digits)` |
| `domain/fx.ts` | `toBase/fromBase(..., currencies)` | `..., digits` (rates still passed) |
| `domain/charges.ts` | three `digitsFor` calls: purchase currency, base, base again | one `digits` |
| `domain/fold.ts`, `domain/views.ts` | `digitsFor(dataset.currencies, base)` | `dataset.settings.digits` |
| `store/actions.ts` | `digitsFor(draft.currencies, money.currency)` | `draft.settings.digits` |
| `export/ods.ts` | `digitsFor(dataset.currencies, base)` | `dataset.settings.digits` |
| `ui/components/{PlanEditor,SplitEditor,BulkLines}.tsx` | `digitsFor(useDataset().currencies, draft.currency)` | `useDataset().settings.digits` |

If the recurring-costs change (`2026-09-03-recurring-costs-design.md`, schema
6) has landed first, `domain/occurrences.ts` and the expected-charge half of
`domain/charges.ts` are two more call sites resolving `settings.digits` the same
way. Neither changes the shape of this work.

This is a genuine simplification: those domain functions never wanted a
currency table, only a number, and the table was threaded through purely to
resolve one. `currencies` stays a parameter only where it is used for something
else — symbols, names, validation.

`currencyCodes`, `findCurrency`, `normalizeCurrencyCode` and `currencyUsage`
are untouched. Codes remain identity; nothing here changes that.

### 3. Migration to the next free schema version

This step takes **whichever version is next when it is built**: 6 if it lands
before the recurring-costs step, 7 if after. The two are independent and
compose in either order, so neither spec can name its number in advance without
presuming which is implemented first. Code is still at `SCHEMA_VERSION = 5`, so
nothing is committed to yet.

Call it N below. `SCHEMA_VERSION` becomes N, and one step is appended.

**Implemented as 6**: this landed before the recurring-costs step, which is
therefore reassigned to 7. The constant is `V6_FALLBACK_DIGITS`.

- sets `settings.digits` to the **maximum** of the per-currency `digits` it
  finds in `data.currencies`;
- strips `digits` from every currency entry;
- falls back to a frozen local `const VN_FALLBACK_DIGITS = 2` — named for the
  version it lands as — when the table is missing, empty, or carries no usable
  number.

Maximum rather than the base currency's value, because the migration must not
make an amount already stored less precise than it is. A dataset holding KWD at
3 has amounts with three decimals in it; migrating to the base's 2 would mean
the next edit of one of those amounts silently truncates it. Taking the maximum
can only ever keep more precision than before, never less.

Per AGENTS.md §2 the step reads no live default — that fallback is a
frozen local literal, and `data.currencies` is the user's own data, not a
default. Existing steps are not edited.

Behaviour on the shipped dataset is preserving by construction: every seeded
currency records 2, so the maximum is 2 and not one stored amount rounds
differently than it did before.

### 4. Import validation

In `export/json.ts`:

- `requireCurrencyTable` stops validating a per-entry `digits`, and stops
  copying it into the parsed entry. Duplicate-code and code-shape checks stay.
- a new `settings.digits` check: present, a number, an integer, `0 <= n <= 4`.
  Same bounds the per-currency check used, same error style.
- `parseDatasetJson` already calls `migrate` before validating, so a file
  exported at the previous version imports correctly through this step. One that still carries
  per-currency `digits` after migration has them ignored rather than rejected —
  an unknown field is not a reason to refuse the owner's only backup.

### 5. UI

`ui/routes/settings/CurrencySection.tsx`:

- the `Decimals` column leaves the table — header, cell, and the `w-16` input.
  The table loses ~80px, which is what prompted this;
- `AddCurrency` loses its decimals field and its `digits` state;
- one new control beside "Base currency", labelled `Decimals (all amounts)`:
  a `type="number"` `min=0 max=4 step=1` input writing through a new
  `setDigits(draft, n)` action, rejecting out-of-range input the way the old
  per-row input did;
- `setDigits` goes in `store/actions.ts` beside `setBaseCurrency`, and the call
  site captures `event.target.value` into a `const` before `mutate` — AGENTS.md
  §2, the deferred-write rule.

**Changing the setting does not rewrite stored amounts.** An amount stored as
49.95 stays 49.95 when the setting moves to 0; it displays as 50 and every
total recomputes at the new precision, but storage is left alone. Rewriting
every `Money` in the dataset is a destructive whole-dataset write, which
AGENTS.md §1 requires a backup export for, and it is lossy in one direction —
going 0 → 2 cannot bring back what 2 → 0 discarded. The setting is a rounding
rule going forward, not a data rewrite. The control gets a hint saying so.

### 6. Tests

- **`domain/currencyDigits.test.ts` is rewritten, not deleted.** Its teeth come
  from driving a non-2 digit count end-to-end, and that still works: the
  dataset gets `settings.digits: 0` globally and the same paths are exercised —
  `roundMoney`, both FX directions, both split modes, plan division, the fold,
  the month view. It can no longer prove digits flow *per currency*, because
  they no longer do; it still proves they flow *from the dataset* rather than
  being assumed to be 2, which is what the guard is for.
- **`domain/currencies.test.ts`** loses its `digitsFor` block.
- **`store/migrations.test.ts`** gains a case for this step: mixed per-currency digits
  collapse to the maximum, entries come out without `digits`, an absent table
  yields the frozen fallback. The existing no-live-default assertion covers the
  new step automatically.
- **`export/json.test.ts`** gains `settings.digits` acceptance and rejection
  cases (missing, `2.5`, `5`, `-1`), and loses per-currency `digits` rejection.
- 41 `digits:` literals across 15 test files construct `CurrencyDef`s or
  datasets and need mechanical updating. This is the bulk of the diff and the
  main risk of the change: a test left constructing a currency with `digits`
  will still typecheck as an excess property in some positions.

### 7. Documents

- **AGENTS.md §1** — the `roundMoney` bullet is rewritten around
  `settings.digits`; the `Dataset.currencies` bullet drops "how many decimals
  they round to" from what the table is authority for.
- **AGENTS.md §2** — the `currencyDigits.test.ts` guard bullet is rewritten to
  describe the global-zero-decimals drive, and to say plainly that a
  mixed-decimal dataset is no longer representable, so nobody re-adds the old
  guard as a "missing" check.
- **docs/DECISIONS.md** — a new entry under "Money and the data model" pointing
  here, and the schema line updated to N. That line reads "Now at version 5"
  today; if the recurring-costs step lands first it will already say 6, so
  match what is actually there rather than searching for the 5.
- **docs/ARCHITECTURE.md** — updated wherever it describes digits as living per
  currency.

## Alternatives considered

- **A default for new currencies, per-currency kept in the data.** One visible
  setting feeding `AddCurrency`, the column gone from the table, `digitsFor`
  untouched. Gets the table narrower with no migration and no invariant
  rewritten, and keeps a JPY expressible. Rejected by the owner in favour of
  the genuinely global setting; it remains the cheapest path back.
- **Display-only rounding.** A preference that rounds what the UI shows while
  storage keeps full precision. Rejected: displayed parts stop summing to
  displayed totals, which reads as a bug in a budgeting app.
- **Keeping the column.** The horizontal scrollbar that prompted this turned
  out to be an 8px negative margin on the row's remove button, fixed separately
  and already resolved, so nothing about the table's width requires this change.
  It proceeds on the owner's preference for a simpler model, not on necessity.

## If this needs undoing

Re-adding an optional `CurrencyDef.digits` that overrides `settings.digits`
when present is a later migration that needs no data change — absent means
"use the global". The domain functions would take `digits: number` still, with
resolution moving up to the call site. The expensive half of this change, the
41 test constructions, does not have to be undone to get there.

## Display, which this spec got wrong

An earlier draft put formatting out of scope, on the assumption that
`src/ui/format.ts` already read digits and would simply follow the new source.
It did not: it pinned `minimumFractionDigits: 2, maximumFractionDigits: 2` in a
module-level `Intl.NumberFormat`, so display never consulted the dataset at
all. That was equally broken before this change — a zero-decimal currency
rendered "3,333.00" under the per-currency table too — so it is a pre-existing
gap rather than a regression, but shipping a prominent Settings control that
display ignores would have made the setting look broken at 0 and been LOSSY at
3 and 4, hiding precision the dataset really holds.

So display is treated as the rounding boundary it is:

- the four functions in `format.ts` take `digits` explicitly, with no default,
  exactly as `roundMoney` does. `Intl.NumberFormat` instances are cached per
  digit count, since constructing one is the expensive part and a table of
  thirty money cells would otherwise build thirty per render;
- `src/ui/hooks/useMoneyFormat.ts` binds them to `settings.digits` and is what
  components call — 64 call sites across 10 files. A hook rather than threaded
  props because display is needed at every depth and the setting is one value
  for the whole dataset; the underlying functions stay pure and testable
  without a React tree;
- `postRowCells` in `PostTable.tsx` is a plain helper, not a component, so it
  takes a `MoneyFormat` argument instead of calling the hook.

Verified in Chrome: the same month reads `600` / `206` at zero decimals and
`600.000` / `205.561` at three — so the figures are recomputed, not merely
reformatted.

## Out of scope

Parsing (`ui/moneyInput.ts`, `ui/purchaseForm.ts`, `ui/bulkEntry.ts`) already
takes digits as an argument and needed no change beyond its new source.
Currency symbols, names, the FX table, the rate service and the fold's math are
all untouched.
