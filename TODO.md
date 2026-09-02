# TODO

Work queued for whoever picks this up next, human or agent. Ordered. Each item
says enough to act on without re-deriving the reasoning.

**Current state:** branch `feature/versioned-rules`, 9 commits ahead of `main`,
not merged, not pushed. 288 tests passing, `bunx tsc --noEmit` clean,
`bun run build` succeeds. Versioned allocation rules are COMPLETE, all six
tasks. Neither new editing surface has been seen in a browser — see section 5.

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

## 2. Baked FX rates — designed and approved, not built

So a fresh install can convert a EUR purchase on day one instead of erroring.

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

## 3. Visual redesign

The owner's words: *"right now it looks a bit boring, simple and ugly. We want
sleek, modern, and nice to use."* Sequencing was their explicit choice: finish
all six rules tasks first, then redesign everything.

`PRODUCT.md` exists and holds product truth. There is no `DESIGN.md`; the
incumbent visual world is the `--budget-*` tokens in `src/index.css` plus the
design contract summarised in ARCHITECTURE.md. A redesign should treat that as
evidence and anti-reference, not as something to preserve.

## 4. Smaller items, in no particular order

- **`confirmImport` has no `.catch`** (`src/ui/routes/settings/DataSection.tsx`).
  A failed import write is an unhandled rejection with no error shown. One line.
- **PNG icons 192/512 are not shipped**, so Chrome's install prompt is
  incomplete. Binary assets cannot be generated in the agent environment; a
  human needs to add them.
- **`round2` in `src/store/actions.ts` hardcodes 2 decimals** rather than
  reading `CURRENCY_DIGITS`. Correct for DKK/USD/EUR; silently wrong the day a
  non-2dp currency is added. Same latent issue in `sliceTotal`
  (`src/domain/plans.ts`).
- **`EMPTY_FIGURES` (`src/domain/fold.ts`) is exported non-frozen** and returned
  by shared reference from `figuresFor`. No consumer mutates it today;
  `Object.freeze` is a one-line hardening.
- **`buildWorkbook` calls `monthView` per (post, month)**, making a full ODS
  export O(posts x months^2). Fine at personal-budget scale.
- **The dev-only `src/manifest.webmanifest` placeholder hardcodes `scope: "/"`.**
  Harmless in production, misleading if you dev-serve under a subpath.

## 5. Needs a human with a browser

Nothing in the agent environment can run a browser, so these have never been
seen by anyone:

- the **carry meter** under each post row in the month view — the signature
  design element, verified only as a CSS gradient expression;
- the **rule-history editor** in Settings and the **"change from here"** control
  in the month view. Their arithmetic is verified through the real fold, and
  both badge predicates were driven as pure functions, but nobody has seen the
  expand/collapse, the layout, the disabled states, or the focus order;
- **offline behaviour**, the **install prompt**, and the **update prompt**;
- the generated **`.ods` opening in a real spreadsheet** (validated
  structurally: mimetype first and stored, well-formed XML, numeric cells);
- **keyboard flow in fast entry** — Tab traversal, Backspace-to-remove, and
  focus placement after a row auto-appends;
- **GitHub Actions** has never been executed.
