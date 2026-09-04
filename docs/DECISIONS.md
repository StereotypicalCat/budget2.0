 # Decisions

An index of the choices that shaped this codebase, and what each one was chosen
*over*. One or two lines each — enough to know whether a decision is the one you
are looking for.

This file does not argue them. The spec named beside each entry does, including
the alternatives in full; where an entry has no spec, the commit message is the
record.

## Product and storage

- **IndexedDB is the only store. No server, no account, no sync.** A deliberate
  product position, not a missing backend: the data never leaves the browser.
  → [`specs/2026-09-01-budget-app-design.md`](specs/2026-09-01-budget-app-design.md),
  [`PRODUCT.md`](PRODUCT.md)
- **Single user, permanently.** One person, one browser, one dataset. No roles,
  no household mode. → [`PRODUCT.md`](PRODUCT.md)
- **Schema migrations are mandatory, not optional.** `schemaVersion` plus
  ordered migration functions applied on load, because IndexedDB holds the
  user's only copy of their financial data. Now at version 7.
  → [`specs/2026-09-01-budget-app-design.md`](specs/2026-09-01-budget-app-design.md)
- **A destructive write downloads a backup first.** Import and reset both export
  before replacing, and abort if the export fails. → commit `ac3d18a`
- **Reset restores first-run state, not an empty dataset.** The seed posts, the
  seed currency table and the baked rates come back, because "reset" and "a
  brand-new browser" should be the same call. → commit `ac3d18a`

## Money and the data model

- **Money is a float, not an integer of minor units.** Made safe by two rules
  rather than by the type: round at every boundary, and compute a distributed
  last part as `total - sum(others)`.
  → [`specs/2026-09-01-budget-app-design.md`](specs/2026-09-01-budget-app-design.md)
- **`roundMoney` takes a digit count, and the argument is required.** Rejected a
  default of 2: it is correct while the decimals setting is 2, so a missed call
  site would pass every test and fail the moment it moves.
  → [`AGENTS.md`](../AGENTS.md) §1, commit `cdece63`
- **Decimal places are ONE dataset-wide setting, not per currency.**
  `Settings.digits`; `CurrencyDef.digits` is gone. Chosen over a per-currency
  default and over display-only rounding, and knowingly over correctness for
  mixed minor units: a dataset holding both yen and kroner can no longer be
  described, and the app does not warn. The owner asked for the simpler model
  with that trade-off in front of them.
  → [`specs/2026-09-02-global-decimals-design.md`](specs/2026-09-02-global-decimals-design.md)
- **`Currency` is an open string code; `Dataset.currencies` is the authority**
  on which codes exist, their names and their symbols — but no longer on their
  decimals. Rejected a closed union, which would have made "add a currency" a
  code change. The compile-time safety is replaced by validation at the
  boundaries — `parseDatasetJson` rejects a code no currency defines.
  → `src/domain/types.ts`, commit `cdece63`
- **Every derived number comes from one left fold.** `src/domain/fold.ts` is the
  only implementation; year and summary views aggregate over it rather than
  recomputing. Two screens disagreeing about someone's money is the worst
  failure this app has. → [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Dates widened rather than restructured.** `Purchase.date` may be
  `"YYYY-MM-DD"` or `"YYYY-MM"`. Rejected splitting it into `month` plus
  optional `day` — the more honest model, and the right call greenfield, but it
  changes a type every layer depends on and needs a migration run in the browser
  against the user's only copy, for an identical user-visible outcome.
  → [`specs/2026-09-02-fast-entry-refinements-design.md`](specs/2026-09-02-fast-entry-refinements-design.md)

## Allocation rules

- **A post's allocation is a dated series, and per-month overrides still
  exist.** Both survive because they answer different questions: "from now on"
  versus "just this month". A month override wins outright.
  → [`specs/2026-09-02-versioned-allocation-rules-design.md`](specs/2026-09-02-versioned-allocation-rules-design.md)
- **No rule yet means an allocation of zero.** Rejected applying the earliest
  rule backwards, which invents budget for months the user never budgeted.
  → [`specs/2026-09-02-versioned-allocation-rules-design.md`](specs/2026-09-02-versioned-allocation-rules-design.md)
- **The series lives on the post.** Rejected keeping `standingRule` alongside a
  map of later changes — it cannot express the history.
  → [`specs/2026-09-02-versioned-allocation-rules-design.md`](specs/2026-09-02-versioned-allocation-rules-design.md)
- **Posts are archived, never deleted**, because purchases reference them.
  Archived posts still fold. → [`ARCHITECTURE.md`](ARCHITECTURE.md)

## Recurring costs

- **Two-stage confirmation, over projection-only or generation-only.** A
  recurring cost projects expected occurrences that stay expected until the
  owner confirms one into an ordinary `Purchase`. Projection-only would charge
  automatically with no reconciliation and would also force a dated amount
  series, since nothing else would hold what was actually paid; generation-only
  needs a horizon and a notion of "today" the domain is built to avoid.
  → [`specs/2026-09-03-recurring-costs-design.md`](specs/2026-09-03-recurring-costs-design.md)
- **A new `RecurringCost` entity, over extending `Purchase.schedule` with a
  generative variant.** Under two-stage confirmation a template's only job is
  to spawn purchases, so every consumer of `Purchase` would have to learn to
  skip templates — a different case from splits and finance plans composing on
  one entity.
  → [`specs/2026-09-03-recurring-costs-design.md`](specs/2026-09-03-recurring-costs-design.md)
- **`lastCharge` anchoring, over a `dataCap` concept for the phone-bill case.**
  Rebasing the series on the confirmation date reproduces the behaviour exactly,
  with no usage tracking and no third recurrence kind.
  → [`specs/2026-09-03-recurring-costs-design.md`](specs/2026-09-03-recurring-costs-design.md)
- **Day-less `everyNMonths`, over `monthlyOnDay(day)` with short-month
  clamping.** The owner does not think of rent as landing on a date, `IsoDate`
  already supports month-only values, and it keeps day arithmetic out of the
  most common case entirely.
  → [`specs/2026-09-03-recurring-costs-design.md`](specs/2026-09-03-recurring-costs-design.md)
- **A mutable `amount`, over a dated series like `Post.rules`.** Safe only
  because two-stage confirmation already holds every past amount in a confirmed
  `Purchase`; the rule describes what is expected next, the ledger holds what
  happened. Under projection-only this would not have held, and a dated series
  would have been required.
  → [`specs/2026-09-03-recurring-costs-design.md`](specs/2026-09-03-recurring-costs-design.md)
- **`archived` MIRRORS "`endedFrom` is set"**, maintained in one place
  (`setRecurringCostEndedFrom`) rather than two independent fields a caller
  could desynchronise. `endedFrom` stops the projection; `archived` only dims
  the row, the same way an archived post stays listed rather than
  disappearing. Neither touches a past occurrence. One consequence is visible
  and undocumented until now: dating a cancellation in the future sets
  `archived` immediately, so a bill still live for months still renders
  dimmed with a "restart" button while it keeps projecting rows right up to
  `endedFrom`. Defensible under the rule as chosen, not a bug.
  → [`specs/2026-09-03-recurring-costs-design.md`](specs/2026-09-03-recurring-costs-design.md),
  `src/store/actions.ts`

## Design system

- **Two token layers.** `--budget-*` is the app's own vocabulary; shadcn's
  entire variable set points at it, so every primitive inherits both themes.
  → [`specs/2026-09-02-design-foundation-design.md`](specs/2026-09-02-design-foundation-design.md)
- **The brand teal is `--primary`, never `--accent`.** shadcn's `--accent` is a
  hover *background* whose paired foreground must move with it; a saturated
  colour there turns every hover into a slab with the wrong text on it.
  → [`specs/2026-09-02-design-foundation-design.md`](specs/2026-09-02-design-foundation-design.md)
- **Contrast was computed and read back out of the browser**, not chosen by eye.
  Two candidate field borders were rejected at 2.17:1 and 2.55:1.
  → [`specs/2026-09-02-design-foundation-design.md`](specs/2026-09-02-design-foundation-design.md)
- **Fonts are self-hosted and injected at boot from `src/fontCss.ts`.** Rejected
  `@font-face` in the bundled stylesheet (Bun inlines woff2 as base64 either
  way: 70 KB became 303 KB of render-blocking bytes and defeated the subsetting)
  and rejected a separate `<link>`ed stylesheet (works in a build, but the dev
  server has no `external` option, so dev would lie about typography). A CDN was
  rejected on product grounds: a font request to another origin contradicts
  "the data never leaves the browser".
  → [`specs/2026-09-02-design-foundation-design.md`](specs/2026-09-02-design-foundation-design.md)
- **Theme preference lives in `localStorage`, not in the dataset.** The dataset
  is exported and imported, and restoring a desktop backup must not flip a phone
  to dark. Cycles system → light → dark, because "follow the system" is a real
  answer and there must be a way back to it.
  → [`specs/2026-09-02-design-foundation-design.md`](specs/2026-09-02-design-foundation-design.md)
- **Two markups per responsive table, not one reflowing grid.** A real `<table>`
  where it is a table, a real list where it is not. Rejected one CSS grid
  carrying `role="table"`: it deduplicates the markup but describes rows and
  columns to a screen reader that no longer exist on screen.
  → [`specs/2026-09-02-month-view-design.md`](specs/2026-09-02-month-view-design.md)
- **A table states its currency once, not per cell.** Every figure in the post
  table is base currency; repeating the code only wrapped figures onto two lines
  on a phone. `formatMoney` still applies wherever the currency can vary.
  → [`specs/2026-09-02-month-view-design.md`](specs/2026-09-02-month-view-design.md)
- **Meter geometry is pure and clamped.** All meter arithmetic lives in
  `src/ui/meterSegments.ts`; negatives clamp rather than invert, because a
  segment of negative width puts a gradient's stops out of order and paints
  something arbitrary instead of failing.
  → [`specs/2026-09-02-month-view-design.md`](specs/2026-09-02-month-view-design.md)
- **The allocation meter scales to `max(income, allocated)`.** Over-budget is
  always allowed, so over-allocation has to be drawable; capping at a full bar
  would make it look identical to allocating income exactly.
  → [`specs/2026-09-02-month-view-design.md`](specs/2026-09-02-month-view-design.md)

## Build, offline and deploy

- **Bun is the runtime, package manager, bundler and test runner.** shadcn/ui
  components are vendored into the repo and owned by this project.
  → [`specs/2026-09-01-budget-app-design.md`](specs/2026-09-01-budget-app-design.md)
- **The service worker and manifest are hand-written.** No PWA plugin exists for
  Bun, so `build.ts` emits the precache list from `Bun.build`'s outputs, keeping
  hashed filenames in sync automatically.
  → [`specs/2026-09-01-budget-app-design.md`](specs/2026-09-01-budget-app-design.md)
- **A new build prompts, and calls `skipWaiting` only on user action.** Without
  it a stale service worker pins the user to an old version indefinitely.
  → [`specs/2026-09-01-budget-app-design.md`](specs/2026-09-01-budget-app-design.md)
- **FX rates are baked at build time, and seed a new dataset only.** They are
  never a fallback for a missing rate: clearing a rate must surface
  `MissingRateError` rather than silently converting at a number the owner never
  chose. On a network failure the build falls back to committed constants marked
  `source: "manual"`, so Settings never claims a hardcoded number came from an
  API. → commit `b4e1933`
- **The rate service must be a host that answers directly, not one that
  redirects.** `api.frankfurter.app` began 301-ing to `api.frankfurter.dev/v1`,
  and a redirect response has to carry `Access-Control-Allow-Origin` itself for
  a browser to follow it cross-origin — that 301 carries none, so "Fetch rates
  now" died with only a CORS error to go on. The build-time fetch never noticed,
  because a server-side fetch follows redirects freely. → commit history, and
  `src/store/fxApi.ts`
- **A migration must never read today's defaults.** The 2 -> 3 step seeded the
  live seed-currency table by reference, so adding sterling to that table would
  have retroactively changed what an old dataset got from a step it had already
  been through — silently, and only for whoever had not migrated yet. Each step
  now carries its own frozen copy, and a source-level guard fails the build if a
  live default is imported again. → `src/store/migrations.ts`
- **Sterling ships with the app, and is migrated into datasets that already
  exist.** Baked currencies and rates seed a NEW dataset and nothing else, so
  the seed table alone would have left every existing user typing the code, name
  symbol and decimals by hand. The 4 -> 5 step supplies the rate as well, which
  is the one thing the "rates never backstop a cleared rate" rule permits here:
  it forbids re-supplying a number the owner deleted, not introducing one for a
  currency they have never had. A GBP the owner already defined is left exactly
  as it is. → `src/store/migrations.ts`
- **The v3 -> v4 migration DROPS the stale URL rather than rewriting it** to the
  new endpoint, so a dataset that stored it follows whatever the current default
  is and the next move of the service needs no second migration for the same
  user. A URL the owner chose themselves is left strictly alone.
  → `src/store/migrations.ts`
- **ODS export is generated client-side with `fflate`.** No server exists to
  generate it. → [`specs/2026-09-01-budget-app-design.md`](specs/2026-09-01-budget-app-design.md)
- **Base path is a build-time variable, read through a `try/catch` accessor.**
  Rejected a `typeof process` guard: it survives Bun's inlining and discards the
  inlined value, silently breaking every subpath deploy.
  → [`AGENTS.md`](../AGENTS.md) §2, `src/ui/basePath.ts`

## Things deliberately left undone

Not oversights. Each was decided against, and reopening one needs a reason.

- Over-budget, percentages past 100%, splits that do not sum, and negative
  amounts are all **allowed**. Adding validation is a regression.
  → [`AGENTS.md`](../AGENTS.md) §3
- The income field and the split editor's fixed-amount fields **do not parse a
  currency**; only the purchase total does. → [`TODO.md`](TODO.md) §3
- **No currency picker.** Adding a currency means typing code, name, symbol and
  decimals by hand. → [`TODO.md`](TODO.md) §3
- **Symbol collisions resolve to the first currency defined with that symbol.**
  Tested and documented rather than solved. → [`TODO.md`](TODO.md) §3
