# Budget 2.0 — Design

**Date:** 2026-09-01
**Status:** Approved for planning

## Purpose

A personal budgeting app for a single user migrating off a spreadsheet. It
tracks variable monthly income, divides it into named envelopes ("posts"),
records purchases against them, and reports by month, by year, and in
aggregate. It must run offline, be self-hostable, and export to formats the
user can open in a spreadsheet.

## Non-goals

These are deliberately excluded. Adding any of them is a new design cycle.

- Multi-user accounts, authentication, or sharing
- Server-side storage or cross-device sync
- Merging two divergent datasets on import
- Bank/CSV transaction import
- Interest, fees, or APR on finance plans
- Live FX rates as a required dependency

## Constraints

| Constraint | Consequence |
|---|---|
| Deployable to GitHub Pages | No backend in the data path. The app is a static bundle. |
| Self-hostable via Docker | The same static bundle, served by a minimal Bun handler. |
| Must work on a subpath | Base path is configurable at build time, not hardcoded. |
| Offline-capable PWA | Service worker precaches the shell; all data is local. |
| Bun toolchain, no Vite | `Bun.build` provides `publicPath` and hashed `naming`. |
| No Electron | Installable PWA instead. |

## Architecture

**Pure derivation core over a fact store.**

IndexedDB stores only raw facts. A dependency-free TypeScript domain package
computes every derived figure — monthly views, running post balances, yearly
rollups, the summary — as pure functions with no React, no IndexedDB, and no
ambient clock access.

Rationale: envelope rollover makes every month depend on the entire chain
before it, so any materialised cache is invalidated by nearly every edit.
The dataset is a few thousand rows over a decade, making recomputation
effectively free. The pure core is also testable without a DOM, which is what
keeps the hard logic verifiable.

Rejected alternatives:

- **Materialised month snapshots.** Under rollover semantics every month is
  downstream of every edit, so invalidation degenerates to full
  recomputation while adding stale-cache failure modes.
- **SQLite-wasm in the browser.** Ships a multi-megabyte wasm blob into an
  offline-first PWA, brings OPFS persistence quirks, and still needs
  hand-written mapping for JSON and ODS export.

### Stack

- Scaffolded with `bun init --react=shadcn` (React 19, Tailwind 4, shadcn/ui)
- Bun as runtime, package manager, bundler, and test runner
- shadcn/ui components are vendored into the repo and owned by this project
- `fflate` for client-side zip generation (ODS export)

### Layers

```
src/domain/     pure functions + types. No React, no IndexedDB, no Date.now().
src/store/      IndexedDB persistence, migrations, in-memory snapshot.
src/ui/         React views and components.
build.ts        static build: publicPath, hashed names, SW manifest, 404.html.
```

The domain layer must remain importable by a test file with no browser
environment. That is an architectural invariant, not a style preference.

## Build and deploy

- **Dev:** `bun --hot src/index.ts` — the scaffolded `Bun.serve` with HMR and
  browser-console echo. Its `/api/*` routes and `APITester.tsx` are removed;
  there is no backend, so the dev server only serves the HTML entrypoint.
- **Build:** `bun run build.ts` emits a fully static `dist/`, with
  `publicPath` set from the base path and `naming: '[name]-[hash].[ext]'`
  for cache-busting. Minification in production builds only.
- **Deploy:** one artifact, two hosts. GitHub Actions publishes `dist/` to
  Pages. The Dockerfile copies the same `dist/` into an `oven/bun` image
  behind a minimal `Bun.serve` static handler.
- **Base path:** a single `BUN_PUBLIC_BASE_PATH` env var (the scaffolded
  `bunfig.toml` already exposes `BUN_PUBLIC_*` to client code) drives
  `publicPath`, the router basename, the manifest link, and the
  service-worker scope. Defaults to `/`; Pages builds use `/budget2.0/`.
- **GitHub Pages deep links:** Pages has no rewrite rules, so `build.ts`
  also writes `dist/404.html` as a copy of `index.html`. The service
  worker's navigation fallback covers this once installed.

## Data model

### Money

Money is a **float** paired with a currency code. Because binary floats
cannot represent decimal fractions exactly, two rules are mandatory
everywhere money is computed:

1. **Round at every boundary** — after each division, after each FX
   conversion, and before persisting. Rounding is to the currency's minor
   unit (2 decimal places for DKK, USD, EUR).
2. **Compute the last part as `total - sum(others)`** rather than rounding it
   independently, so distributed parts always sum exactly to the whole.

Tests compare rounded values, never raw floats.

### Entities

```ts
type Currency = "DKK" | "USD" | "EUR"
type Money    = { amount: number; currency: Currency }   // amount is a float
type MonthId  = string                                   // "2026-09"

Settings   { baseCurrency: Currency
             foldStartMonth: MonthId
             schemaVersion: number }

FxRate     { currency: Currency
             baseUnitsPerOne: number   // how many base units 1 of `currency` buys
             updatedAt: string
             source: "manual" | "api" }
           // one global table, not per-month

Post       { id, name, order: number, archived: boolean
             currency: Currency        // display currency for this post's own views
             standingRule: Rule }

Rule       = { kind: "fixed", amount: Money }        // any currency; converted to base
           | { kind: "percentOfIncome", percent: number }

Month      { id: MonthId
             income: Money             // always in Settings.baseCurrency
             ruleOverrides: Record<PostId, Rule> }

Purchase   { id, date: string, description: string
             total: Money              // the purchase's own currency
             splitMode: "percent" | "fixed"   // applies to all splits
             splits: Split[]
             schedule: Schedule | null }

Split      { postId
             value: number             // a percentage, or an amount in the
                                       // purchase's currency, per splitMode
             absorbsRemainder: boolean }

Schedule   { slices: { month: MonthId, amount: Money }[]
             cancelledFromMonth?: MonthId }
```

**Explicit rules, so none of the above can be read two ways:**

- `FxRate.baseUnitsPerOne` is *base units per one unit of the named currency*.
  With base DKK, `{ currency: "EUR", baseUnitsPerOne: 7.46 }` means 1 EUR is
  7.46 DKK. The base currency itself has no row.
- **`splitMode` is per purchase, not per split.** All splits on one purchase
  are either percentages or fixed amounts. Mixing the two within a purchase
  ("100 kr to Food, then split the rest") is not supported.
- Fixed split values are denominated in the **purchase's** currency, never the
  post's and never the base.
- Percentages in `splits` should total 100, and fixed values should total
  `Purchase.total`, but the remainder-absorbing split reconciles any shortfall
  or excess so the parts always sum exactly to the total. Exactly one split
  must have `absorbsRemainder: true`.
- `Month.income` is always in `Settings.baseCurrency`. Posts have no
  independent income.
- A `Rule` of kind `fixed` may name any currency; it is converted to base
  when the fold runs.
- `Schedule.cancelledFromMonth` means slices in that month **and every month
  after it** are ignored by the fold. Earlier slices remain as history.
- `Settings.foldStartMonth` is set once, on first run, to the month of the
  user's earliest data, and can be changed in settings. Months before it
  contribute nothing and every post's carried-in balance there is zero.
- `Post.currency` affects only how that post's own monthly and yearly views
  render figures. All cross-post arithmetic and every total happen in the base
  currency.

**One `Purchase` entity covers all three cases.** A simple expense has one
split and no schedule. A split purchase has several splits. A financed
purchase has a schedule. Splits and schedules therefore compose with no
special-casing: a financed, split purchase distributes each slice across its
splits by ratio.

### Derived values

- `allocation(post, month)` — `month.ruleOverrides[post.id] ?? post.standingRule`,
  resolved against that month's income. Percentages across posts **may sum
  past 100%**; the app does not prevent this.
- `charges(month)` — every purchase whose schedule (or, absent a schedule,
  whose `date`) touches that month; the slice amount is distributed across
  splits by ratio, converted to base currency via the global FX table, with
  the remainder assigned to the split flagged `absorbsRemainder`.
- `balance(post, month)` — `balance(post, previousMonth) + allocation − charges`,
  folded forward from `Settings.foldStartMonth`.
- Year view and Summary are aggregations over that same fold. The rollover
  math has exactly one implementation.

### Semantics

- **Rollover is envelope-style.** Unspent allocation carries into the next
  month; overspend carries forward as debt (a negative balance). Editing a
  past purchase recomputes every subsequent month.
- **Over-budget is always permitted.** Negative balances receive a warning
  treatment in the UI but never block saving.
- **Allocation rules are standing.** Each post carries a default rule that
  applies to every month automatically. Any single month may override it, and
  overrides are visibly marked in the UI.
- **Posts are user-managed**, seeded with *Video Games*, *Food*, and *Events
  and Social*. They can be created, renamed, reordered, and archived.
  Archiving removes a post from new-entry pickers while its history continues
  to fold. There is no hard delete, because purchases reference posts.
- **Finance plans are first-class.** A plan defaults to an equal split across
  N months, and each slice amount may be edited individually. A plan can be
  edited or cancelled as a unit; cancelling drops future slices and preserves
  past ones as history.
- **Income is per-month** and entered directly, because it varies. It is a
  single household figure; posts have allocations, not independent incomes.
- **FX is a single global table**, user-editable, with an optional on-demand
  "fetch rates" action from the client. The fetch is never required: it fails
  soft and retains the cached rates.

## UI

All routes sit under the configurable basename.

| Route | Purpose |
|---|---|
| `/month/:yyyy-mm` | Income input; table of posts with carried-in balance, allocation, spent, remaining. Unallocated income shown as its own figure. |
| `/year/:yyyy` | Posts × 12 months matrix, toggleable between *spend* and *closing balance*, with an income row and yearly totals. |
| `/post/:id/month/:yyyy-mm` | One envelope in detail: its purchases that month, plus incoming plan slices flagged as already-committed. |
| `/post/:id/year/:yyyy` | That post's 12-month trend and closing balance. |
| `/summary` | All expenditure across any range, grouped by post or month, filterable. |
| `/settings` | Base currency, FX table with fetch button, post management, export/import. |

**Purchase dialog** — a single form for all three shapes: date, description,
total plus currency, then two optional sections. The **split editor** offers a
percent/fixed toggle, a live remainder readout, and nominates one post to
absorb rounding. The **finance plan** toggle takes a month count to generate
equal slices, each individually editable against a running "allocated vs
total" indicator. Both sections, either, or neither.

**State** — the whole dataset fits in memory: one in-memory snapshot as the
single source of truth, write-through to IndexedDB on every mutation, and
memoized selectors over the pure core. There is no cache to invalidate.

## Export and import

**JSON** — the full dataset with its `schemaVersion`: settings, FX table,
posts, months, purchases. Import is **replace-all**. It first exports a
backup of current state, then shows what is about to be replaced (counts of
posts, months, purchases) and requires confirmation. Merge is out of scope:
reconciling two divergent histories has no correct answer without a sync
model.

**ODS** — generated entirely in-browser with `fflate`, so it works offline.
An ODS file is a zip of XML: `mimetype` first and uncompressed, then
`META-INF/manifest.xml`, `content.xml`, `styles.xml`. Sheets:

- **Summary** — posts × months, with totals
- **Months** — income, per-post allocation and spend
- **Purchases** — the raw ledger, one row per split-slice, so it pivots cleanly
- **One sheet per post**

Amounts are written as real numeric cells (`office:value`), not strings, so
the output can be pivoted and summed in a spreadsheet.

## Offline and updates

The app is fully functional offline by construction, since data never leaves
the browser. No PWA plugin exists for Bun, so the service worker and manifest
are hand-written and owned by this project; `build.ts` emits the precache
list from `Bun.build`'s `result.outputs`, keeping hashed filenames in sync
automatically.

- Cache-first for hashed assets; navigation fallback to `index.html`
- A new build prompts "update available" and calls `skipWaiting` on user
  action. Without this, a stale service worker can pin the user to an old
  version indefinitely.
- Manifest declares `display: standalone` and a `scope` matching the base path

**Schema migrations** — `schemaVersion` plus ordered migration functions
applied on load. IndexedDB holds the user's only copy of their data, so
migrations are mandatory rather than optional.

## Testing

`bun test`, weighted almost entirely toward the pure domain core.

- **Rollover fold** — unspent carries forward; overspend carries as debt;
  editing an old month recomputes every later month
- **Split reconciliation** — distributed parts sum exactly to the total across
  many randomised split configurations
- **Plan slicing** — equal default, custom per-slice amounts, cancellation
  preserving past slices and dropping future ones
- **Allocation** — percent-of-income across varying incomes, override
  precedence over standing rules, sums past 100% permitted
- **Archived posts** — excluded from pickers, still included in the fold
- **FX conversion** — rounding at boundaries, missing rate handled explicitly
- **Round-trip** — JSON export, then import, yields identical derived output
- **ODS** — the generated file is unzipped in-test and numeric cells asserted
- **Component tests** — limited to the purchase dialog's validation, under
  happy-dom
- **CI** — additionally builds the Docker image and curls the served page

## Agent support files

- `AGENTS.md` — the `bun init` scaffold provides Bun idioms ("use `bun test`",
  "don't use vite", HTML imports). This project extends it with its own
  invariants: the domain layer stays free of React and IndexedDB, money
  rounds at every boundary, the last distributed part is computed by
  subtraction, and the rollover fold has exactly one implementation.
- `docs/specs/` — this document
- `docs/plans/` — the implementation plan, written next
