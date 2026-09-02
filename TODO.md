# TODO

Work queued for whoever picks this up next, human or agent. Ordered. Each item
says enough to act on without re-deriving the reasoning.

**Current state:** branch `chore/todo-sweep`, not merged, not pushed. 344 tests
passing, `bunx tsc --noEmit` clean, `bun run build` succeeds. Sections 2 and 4
are DONE; section 3 is one of four sub-projects in. Every screen has now
actually been looked at — see section 5.

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

## 3. Visual redesign — sub-project 1 of 4 DONE

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
| 2 | Month view | date-grouped purchases DONE (`a159189`); income/totals block and the carry meter's presentation still open |
| 3 | Year, Summary, Post detail | on the new foundation but not rethought. The 12-month matrix only fits by scrolling — decide whether compact number formatting replaces that |
| 4 | Dialogs and fast entry | untouched. Native `<select>` elements are still browser-default, and `up`/`down`/`archive` are bare text buttons |

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
- **keyboard flow in fast entry** — Tab traversal, Backspace-to-remove, and
  focus placement after a row auto-appends. Drivable over CDP in principle;
  not yet done.
- **GitHub Actions** has never been executed.
