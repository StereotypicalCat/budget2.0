# TODO

Work still queued, for whoever picks it up next, human or agent. Ordered. Each
item says enough to act on without re-deriving the reasoning.

Finished work is not listed here. It is in the commit messages, and the
decisions behind it are in `docs/specs/` — one spec per sub-project,
each recording the alternatives that were rejected. Rules that outlived their
task moved to `AGENTS.md`.

**Current state:** merged to `main`. 583 tests passing,
`bunx tsc --noEmit` clean, `bun run build` succeeds on both the live-fetch and
offline paths.

**Schema is at version 7.** v1 -> v2 made allocation rules a dated series;
v2 -> v3 moved currencies into the dataset; v3 -> v4 drops a stored rate-service
URL that can no longer work; v4 -> v5 adds sterling to an existing dataset;
v5 -> v6 collapses per-currency decimals into one dataset-wide setting; v6 -> v7
adds `Dataset.recurring`. All six are behaviour-preserving by construction —
not one changes a stored figure — and are tested as such.

A migration applies **on load, in memory**; it is written back on the next
mutation, not by `load()` itself. So a freshly migrated dataset shows the new
shape immediately while IndexedDB still holds the old version for a while. That
is not a bug, but it will mislead you if you verify a migration by reading
IndexedDB instead of the app.

---

## 1. Visual redesign, sub-project 3 — Year, Summary, Post detail

The owner's brief for the whole redesign: *"right now it looks a bit boring,
simple and ugly. We want sleek, modern, and nice to use."* On scoping: both
themes with a toggle, a full rethink of every screen, purchases compact and
grouped by date, ship a webfont — and *"override everything you want for this
step."*

Sub-projects 1 (design foundation, `bb3c661`) and 2 (month view, `7b71811`) are
done, each with a spec in `docs/specs/`. These three screens are on
the new foundation but have not been rethought. The open question is the
12-month matrix: it only fits by scrolling, and compact number formatting may be
what replaces that rather than a scroll container.

**The diagnosis that shaped the decomposition, which still applies:** a design
system already existed and was never wired up. `src/index.css` defined the
paper/ink/teal palette with a contract document behind it, while the app painted
shadcn's default white and near-black; the tokens reached the screen in two
places only. Doing the foundation last is how that happened. Do not repeat it —
extend the foundation rather than styling a screen locally.

**Three things sub-project 2 settled that these screens should inherit rather
than re-decide** (spec: `2026-09-02-month-view-design.md`):

- **Meter geometry lives in `src/ui/meterSegments.ts`**, pure and tested, with
  `<Meter>` as the only thing that paints it. A third meter belongs there too,
  not inline in a component. Negatives clamp rather than invert, because a
  segment of negative width puts the gradient's stops out of order and paints
  something arbitrary instead of failing.
- **Two markups, not one reflowing grid.** The post table is a real `<table>`
  from `sm:` up and a list of two-line blocks below it. At 390px the layout
  genuinely stops being a table, and `role="table"` on it would describe rows
  and columns that no longer exist on screen. The year matrix faces the same
  question with more columns to lose.
- **State the currency once per table, not per cell.** Every figure in the post
  table is base currency, so `formatSignedAmount` prints bare numbers and the
  legend names DKK once. This is what stopped "+4,219.61 DKK" wrapping on a
  phone. `formatMoney` is still right wherever an amount can be in some other
  currency — every purchase row, for one.

## 2. Visual redesign, sub-project 4 — dialogs and fast entry

Untouched. Native `<select>` elements are still browser-default, and
`up` / `down` / `archive` in Settings are bare text buttons. Covers the purchase
dialog, the split editor, the plan editor and bulk entry.

There is already a spec for fast-entry *behaviour* —
`2026-09-02-fast-entry-refinements-design.md`. Read it before restyling, so the
visual work does not fight it.

## 3. Currency work deliberately left undone

All three were decided against at the time, not forgotten. Reopen only with a
reason.

- **The income field and the split editor's fixed-amount fields do not parse a
  currency** — only the purchase total does. Same helper (`parseMoneyInput`),
  same three-line pattern. The income field is arguably wrong to make
  multi-currency at all, since a month has one income.
- **No currency picker convenience.** Adding a currency means typing the code,
  name, symbol and decimals by hand. A bundled ISO 4217 list would be nicer, and
  is pure data.
- **Symbol collisions resolve to the first currency defined with that symbol.**
  Fine for one "$" currency; if the owner adds two, typing the code
  disambiguates and nothing warns them. Tested, documented, not solved.

## 4. Nobody has independently reviewed the rule-history editing surfaces

Tasks 3-6 of the versioned-allocation-rules work — `setRuleFrom` /
`removeRuleFrom`, the JSON import validation, the Settings rule-history editor,
and the month view's "change from here" — were executed by hand rather than
dispatched, and no second pair of eyes has been over the diff.

Worth reading first: the four commit messages, `de128e3`, `1cb91d3`, `e3023d0`
and `f94e458`. They record why each surface works the way it does, including
three of the four places the original briefs were wrong — a number field that
could not be cleared, a component that kept the previous post's rule because it
was not keyed, and missing validation that let a NaN allocation into the fold.

(The fuller task log lived in a tool-managed ledger under `.superpowers/`, which
ignores its own contents and was never part of the repository. This file used to
send readers there, which worked only on the machine that wrote it.)

Both surfaces have since been seen working in a browser. What is missing is
review, not verification.

## 5. Still needs a human

`scripts/screenshot.ts` drives headless Chrome, so this list is much shorter
than it was. Already seen and confirmed working: the carry meter (including red
where a post is overspent), the rule-history editor, "change from here", the
baked FX rates arriving in a fresh dataset, the reset writing a fresh dataset to
IndexedDB, and every route at desktop and mobile widths in both themes.

Genuinely outstanding:

- **How it looks and feels.** A screenshot proves a layout is not broken. It
  cannot tell you the design is good, and the container's fonts are not the
  owner's fonts.
- **Offline behaviour** and the **install prompt**. The service worker itself is
  no longer unverified: it demonstrably installs, activates, claims the page,
  precaches all 11 assets, and applies an update cleanly (`e6da85e`). What is
  still unverified is a real offline load with the network actually cut, and
  Chrome's install prompt appearing.
- **The pre-destructive backup actually landing as a file.** Import and reset
  both download a JSON backup before replacing the dataset, and only proceed
  when that reports success — but headless Chrome's download is not observable
  here, so the backup is *issued*, never confirmed openable.
- **The generated `.ods` opening in a real spreadsheet.** Validated
  structurally: mimetype first and stored, well-formed XML, numeric cells.
- **Keyboard flow in fast entry** — Tab traversal, Backspace-to-remove, and
  focus placement after a row auto-appends. Drivable over CDP in principle; not
  yet done.
- **GitHub Actions** has never been executed.
- **Whether two-stage confirmation matches how the owner actually reconciles a
  bank statement.** Recurring costs (`docs/specs/2026-09-03-recurring-costs-design.md`)
  project expected occurrences and require a click to turn one into a real
  purchase, rather than charging automatically. That is a product bet a week of
  real use answers and no test can.
- **The overdue count against a large, real backlog.** `ExpectedBand` counts
  unconfirmed occurrences from earlier months, and demo data does now
  accumulate a modest one (a few months of an unconfirmed monthly bill plus a
  biweekly one, ~14 occurrences by September) that renders without incident.
  Nobody has seen the count or the layout against years of neglect or dozens of
  distinct bills.
