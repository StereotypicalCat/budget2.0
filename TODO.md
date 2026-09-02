# TODO

Work queued for whoever picks this up next, human or agent. Ordered. Each item
says enough to act on without re-deriving the reasoning.

**Current state:** merged to `main`. 443 tests passing, `bunx tsc --noEmit`
clean, `bun run build` succeeds on both the live-fetch and offline paths.
Sections 2, 4 and 7 are DONE. Section 3 (redesign) is 2 of 4 sub-projects in.
Section 6 (currencies) is DONE. Every screen has now actually been looked at —
see section 5.

**Schema is at version 3.** v1 -> v2 made allocation rules a dated series;
v2 -> v3 moved currencies into the dataset. Both migrations are
behaviour-preserving by construction and tested as such.

---

## 1. ~~Time-versioned allocation rules~~ — DONE, all six tasks

**Spec:** `docs/superpowers/specs/2026-09-02-versioned-allocation-rules-design.md`
**Plan:** `docs/superpowers/plans/2026-09-02-versioned-allocation-rules.md`
**Ledger + extracted briefs:** `.superpowers/sdd/2026-09-02-versioned-allocation-rules/`

| Task | What | Commit |
|---|---|---|
| 1 | `Post.rules: RuleVersion[]` replaces `standingRule` | `68712e7` |
| 2 | v1 -> v2 migration | `15dcf93`, `1214d2b` |
| 3 | `setRuleFrom` / `removeRuleFrom` actions | `de128e3` |
| 4 | JSON import validation for the rule series | `1cb91d3` |
| 5 | Rule-history editor in Settings | `e3023d0` |
| 6 | "Change from here" control in the month view | `f94e458` |

Tasks 3-6 were executed by hand rather than dispatched. Every deviation from
the briefs is recorded in the ledger's task log with its reasoning; four of
them fixed real defects in the brief code (JSX that would not compile, a
component that pre-filled the previous post's rule, a number field that could
not be cleared, and missing validation that let a NaN allocation into the
fold). Worth a read before reviewing the diff.

Not yet done for this feature: nobody has independently reviewed tasks 3-6, and
no browser has seen the two new editing surfaces.

## 2. ~~Baked FX rates~~ — DONE (`b4e1933`)

So a fresh install can convert a EUR purchase on day one instead of erroring.
Built as designed, all three build paths verified (live fetch, unreachable
endpoint, `SKIP_FX_FETCH=1`), and confirmed in the real UI: Settings shows
USD 6.449532 / EUR 7.474959 as `manual · 2026-09-01` on a fresh dataset.
The reasoning below is kept because it is the reasoning, not a plan.

- `build.ts` fetches DKK/USD/EUR at build time and embeds them via `define`;
  on any network failure it falls back to **committed constants** rather than
  failing the build. Fetched rates get `source: "api"` with the build date;
  the fallback constants get `source: "manual"`, so Settings never claims a
  hardcoded number came from an API.
- They **seed a new dataset only**. They must NOT act as a fallback whenever a
  rate is missing — that would undo a deliberate decision: clearing a rate
  removes the row so `MissingRateError` surfaces, instead of silently
  converting money at a number the user never chose.
- Domain purity forces the shape: `createSeedDataset` takes the rates as an
  **argument**; the env read lives in a new `src/store/bakedRates.ts`, in the
  store layer, using the `try/catch` accessor pattern (see CLAUDE.md gotchas).

## 3. Visual redesign — sub-projects 1 and 2 of 4 DONE

The owner's words: *"right now it looks a bit boring, simple and ugly. We want
sleek, modern, and nice to use."* Then, on scoping: both themes with a toggle,
a full rethink of every screen, purchases compact and grouped by date, ship a
webfont — and *"override everything you want for this step."*

**Spec:** `docs/superpowers/specs/2026-09-02-design-foundation-design.md`

**The diagnosis, which should shape the rest:** a design system already existed
and was never wired up. `src/index.css` defined the paper/ink/teal palette with
a contract document behind it, while the app painted shadcn's default white and
near-black. The tokens reached the screen in two places only. Doing the
foundation last is how that happened; do not repeat it.

| # | Sub-project | State |
|---|---|---|
| 1 | Design foundation — two-theme tokens, theme toggle, self-hosted Inter + JetBrains Mono, one Section/Stat card, table furniture | DONE (`bb3c661`) |
| 2 | Month view | DONE. Date-grouped purchases (`a159189`), then the header, the post rows and the carry meter |
| 3 | Year, Summary, Post detail | on the new foundation but not rethought. The 12-month matrix only fits by scrolling — decide whether compact number formatting replaces that |
| 4 | Dialogs and fast entry | untouched. Native `<select>` elements are still browser-default, and `up`/`down`/`archive` are bare text buttons |

**Sub-project 2, for whoever does 3 and 4.** Spec:
`docs/superpowers/specs/2026-09-02-month-view-design.md`. Three things it
settled that the reporting screens should follow rather than re-decide:

- **Meter geometry is `src/ui/meterSegments.ts`**, pure and tested, with
  `<Meter>` as the only thing that paints it. A third meter belongs there too,
  not inline in a component. Negatives clamp rather than invert, because a
  segment of negative width puts the gradient's stops out of order and paints
  something arbitrary instead of failing.
- **Two markups, not one reflowing grid.** The post table is a real `<table>`
  from `sm:` up and a list of two-line blocks below it. At 390px the layout
  genuinely stops being a table, and `role="table"` on it would describe rows
  and columns that no longer exist on screen. The year matrix faces the same
  question and has more columns to lose.
- **State the currency once per table, not per cell.** Every figure in the post
  table is base currency, so `formatSignedAmount` prints bare numbers and the
  legend names DKK once. This is what stopped "+4,219.61 DKK" wrapping on a
  phone. `formatMoney` is still right wherever an amount can be in some other
  currency — every purchase row, for one.

Also worth knowing: `src/ui/cssTokens.test.ts` matches source *text*, so it
flags a token named in a code comment as readily as one in a `style` — which is
exactly what it did to the comment explaining it.

**Watch for:** the brand teal is `--primary`, never `--accent` — shadcn's
`--accent` is a hover *background* whose paired foreground must move with it.
`src/cssPairs.test.ts` enforces the pairing, and `src/ui/cssTokens.test.ts`
fails if a component names a token `index.css` does not define. That second
guard exists because renaming `--rule` silently made the carry meter paint
nothing: an undefined custom property inside `linear-gradient()` invalidates
the whole declaration without warning.

## 4. ~~Smaller items~~ — ALL DONE

All six, `b9be882` / `71e8fc9` / `f50c65b`. Three were worse than recorded:

- `confirmImport` now guards its write, and a source-level check covers the
  whole UI (`b9be882`).
- The PNG icons **were** generatable here — Chrome is on PATH and rasterizes
  the SVG exactly. `scripts/make-icons.ts` produces them; they are committed,
  precached, and pixel-verified against the source (`f50c65b`).
- Split values now round by what they MEAN — money in "fixed" mode, a
  percentage in "percent" mode. Narrower than the note claimed: `round2` was
  always right for `Rule.percent`, which is not money (`b9be882`).
- `EMPTY_FIGURES` is frozen (`b9be882`).
- The ODS export was **not** "fine at personal-budget scale": 30 posts over 10
  years took 7983 ms synchronously on the main thread. Now 135 ms, with
  byte-identical output (`71e8fc9`).
- The dev manifest did not merely hardcode `scope: "/"` — it was never served
  at all; the catch-all answered with the HTML shell. One definition now feeds
  the build and the dev server (`b9be882`).

## 6. ~~User-defined currencies, and amounts that carry their currency~~ — DONE

Both `cdece63`. `Currency` is an open string code and `Dataset.currencies` is
the authority on validity, symbols and decimal places; the purchase total
field reads "30$" as USD 30.

**The part worth knowing before touching money again:** `roundMoney(amount,
digits)` takes a digit count, and its ~29 call sites each resolve digits from
the dataset with `digitsFor`. The argument is required deliberately — every
currency the app shipped with uses two decimals, so a default of 2 would leave
a missed call site passing every test and silently wrong for the first
zero-decimal currency added. `src/domain/currencyDigits.test.ts` is the only
test that can tell a real implementation from one that assumes 2: it drives a
JPY-style currency through rounding, both FX directions, both split modes,
plan division, the fold and the month view.

Left undone, deliberately:

- **The income field and the split editor's fixed-amount fields do not parse a
  currency yet** — only the purchase total does. Same helper
  (`parseMoneyInput`), same three-line pattern; the income field is arguably
  wrong to make multi-currency at all, since a month has one income.
- **No currency picker convenience.** Adding one means typing the code, name,
  symbol and decimals by hand. A bundled ISO 4217 list would be nicer, and is
  pure data.
- **Symbol collisions resolve to the first currency defined with that symbol.**
  Fine for one "$" currency; if the owner adds two, typing the code
  disambiguates and nothing warns them. Tested, documented, not solved.

## 7. ~~Reset to a fresh install~~ — DONE

Settings > Your data > "Reset everything…". The owner asked for a reset that
includes the currencies and the seed categories, and chose fresh-install state
over an empty dataset: the three starter posts, the DKK/USD/EUR table, the
baked rates, this month at zero income, no purchases.

- `store.reset()` calls the same `createSeedDataset(currentMonth, seedRates)`
  that `load()` uses on a first run, through the same write queue. Seeding
  lives in the store, not the UI, so "reset" and "a brand-new browser" cannot
  drift apart.
- The confirm panel reuses the import flow's shape and its **order of
  operations**: the JSON backup downloads BEFORE the destructive write, and a
  backup that fails aborts the reset. This is the user's only copy.
- Verified in Chrome by clicking through and reading IndexedDB back: 3 seed
  posts, DKK/USD/EUR, both baked manual rates, 0 purchases, one month at zero
  income.

## 5. Still needs a human

`scripts/screenshot.ts` drives headless Chrome, so the list here is much
shorter than it was. **Seen and confirmed working:** the carry meter (it
renders, and shows red where a post is overspent), the rule-history editor in
Settings, the "change from here" control, the baked FX rates arriving in a
fresh dataset, and every route at desktop and mobile widths.

Genuinely outstanding:

- **How it looks and feels.** A screenshot proves a layout is not broken. It
  cannot tell you the design is good, and the container's fonts are not the
  owner's fonts.
- **Offline behaviour** and the **install prompt**. The service worker itself
  is no longer unverified: it demonstrably installs, activates, claims the
  page, precaches all 11 assets, and applies an update cleanly (`e6da85e`) —
  before that fix it had never installed once, in any environment, because
  `cache.addAll` rejects on a duplicate request. What is still unverified is
  a real offline load with the network actually cut, and Chrome's install
  prompt appearing.
- the generated **`.ods` opening in a real spreadsheet** (validated
  structurally: mimetype first and stored, well-formed XML, numeric cells).
- **the pre-destructive backup actually landing as a file.** Both the import
  and the reset flow download a JSON backup before replacing the dataset, and
  the code path demonstrably runs (the reset proceeds only when it returns
  success). Whether headless Chrome wrote the file is not observable here, so
  nobody has yet confirmed the backup is openable — only that it was issued.
- **keyboard flow in fast entry** — Tab traversal, Backspace-to-remove, and
  focus placement after a row auto-appends. Drivable over CDP in principle;
  not yet done.
- **GitHub Actions** has never been executed.
