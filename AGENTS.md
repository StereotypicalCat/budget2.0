# Budget 2.0 — agent guide

The instructions for changing this codebase, for any agent or any human. This
is the only copy: `CLAUDE.md` and `GEMINI.md` are pointers to this file, so it
cannot drift into three disagreeing versions.

Most of the rules below are here because breaking one cost real time. This file
is the short, actionable form; the *reasoning* lives in `docs/ARCHITECTURE.md`
and `docs/specs/`, and is not repeated here.

## 1. Invariants

- **`src/domain/` is pure.** No React, no IndexedDB, no `Date.now()`, no
  `new Date()` without an explicit argument. It must be testable with no DOM
  (`src/domain/smoke.test.ts` imports it without one).
- **Money is a float, rounded at every boundary.** Use `roundMoney` from
  `src/domain/money.ts` after any division, after any FX conversion, and before
  persisting.
- **`roundMoney(amount, digits)` takes a DIGIT COUNT, not a currency code.**
  Decimal places live in `Dataset.currencies`, because the owner defines
  currencies; resolve them with `digitsFor(dataset.currencies, code)`. The
  argument is required on purpose — a default of 2 is right for every currency
  the app shipped with, so a missed call site would pass every test and be
  silently wrong for the first zero-decimal currency added.
- **When splitting an amount, never round the last part independently.** Compute
  it as `total - sum(others)` so the parts sum exactly to the whole.
- **`Currency` is an open string code; `Dataset.currencies` is the authority.**
  There is no global list of valid currencies. A code is IDENTITY — it keys the
  FX table and every stored `Money` — so codes are normalised uppercase, are
  never editable, and a currency still referenced cannot be removed
  (`currencyUsage` names what refers to it). `parseDatasetJson` validates the
  table and every `Money` against it; that boundary check is what replaced the
  compile-time safety of the old closed union.
- **The baked FX rates seed a new dataset only.** They must NOT act as a
  fallback when a rate is missing: clearing a rate removes the row so
  `MissingRateError` surfaces, instead of silently converting money at a number
  the owner never chose.
- **`MonthId` is the string `"YYYY-MM"`.** Stored data never contains `Date`
  objects.
- **The envelope rollover fold has exactly one implementation**, in
  `src/domain/fold.ts`. Year and summary views aggregate over it — they never
  reimplement the math.
- **A post's allocation is a dated series**, `Post.rules: RuleVersion[]`,
  resolved by `ruleAt(post, monthId)`. `Post.standingRule` no longer exists. A
  post with no applicable version allocates zero; a per-month override still
  wins outright.
- **Posts are archived, never deleted**, because purchases reference them.
  Archived posts still fold.
- **An amount field parses its own currency:** "30$" is thirty dollars. Use
  `parseMoneyInput` (`src/ui/moneyInput.ts`) and keep the input `type="text"` —
  a number input discards the "$" before the parser ever sees it.
- **`sw.js` must stay unhashed and be served `no-cache`.** A cached or hashed
  service worker can never be replaced, which pins users to an old build
  forever.
- **A destructive whole-dataset write downloads a backup first.** Both JSON
  import and "Reset everything" export the current dataset *before* replacing
  it, and abort if that export fails. This is the owner's only copy.

## 2. Guards that fail the build

Each of these shipped as a bug once. The test named beside it is why it cannot
ship twice — re-introducing one is a regression, not a style choice.

- **Never read `event.target.value` inside a `mutate()` callback.** Capture it
  into a `const` in the handler. `mutate` defers behind the write queue, and
  React resets the input's DOM value first, so you commit the old value.
  → `src/ui/eventCapture.test.ts`, source-level because reproducing it needs
  real browser render timing that happy-dom does not have.
- **Never define a bare `--accent`.** shadcn owns it as a hover BACKGROUND
  paired with `--accent-foreground`; setting one without the other drops hover
  contrast below WCAG AA app-wide. Redefine shadcn tokens only in pairs, and put
  brand colour on `--primary`, never `--accent`. The app's own tokens are
  `--budget-*`. → `src/cssPairs.test.ts`
- **A `var()` naming a token `src/index.css` does not define paints NOTHING,
  silently.** An undefined custom property invalidates the whole declaration:
  no warning, no throw, no fallback. Renaming `--rule` this way killed the carry
  meter and no test noticed. → `src/ui/cssTokens.test.ts`, which matches source
  *text* — so it flags a token named in a comment just as readily.
- **Every awaited `store.*` call in `src/ui/` must be guarded** by a `try/catch`
  or a `.catch`. IndexedDB fails for reasons no code can prevent (full disk,
  evicted storage, private-mode quota), and unguarded it is an unhandled
  rejection: the button appears to do nothing and the user is told nothing.
  `useMutate` is the guard for most call sites.
  → `src/ui/storeWriteErrors.test.ts`
- **`roundMoney` call sites must resolve real digits**, per §1.
  → `src/domain/currencyDigits.test.ts` is the only test that can tell a real
  implementation from one that assumes 2: it drives a JPY-style zero-decimal
  currency through rounding, both FX directions, both split modes, plan
  division, the fold and the month view.
- **`process.env.BUN_PUBLIC_*` must be read via `try/catch`** — see
  `readBasePathEnv`. Bun inlines the literal only when the variable is set;
  unset, the bare reference reaches the browser and throws before the app boots.
  A `typeof process` guard does *not* work: it survives inlining and discards
  the inlined value, silently breaking subpath deploys.
  → `src/ui/basePath.test.ts` covers that accessor. Nothing stops a *new* bare
  reference elsewhere, so this one still needs your attention.
- **The pre-paint theme script in `index.html` and `src/ui/theme.ts` must
  agree.** The script cannot import the module — it has to run before any module
  loads — so it repeats the storage key and the fallback logic.
  → `src/ui/theme.test.ts`
- **Anything derived from the base path is asserted for both a root and a
  subpath deploy:** the manifest (`src/manifest.test.ts`), the font URLs
  (`src/fontCss.test.ts`), the icons (`src/icons.test.ts`), and the service
  worker's precache list (`src/swPrecache.test.ts`) — which must contain no
  duplicate, because `cache.addAll` rejects on one, which is why the service
  worker had never once installed in any environment.
- **A migration step must not import a live default** — no seed table, no baked
  rates. Each step carries its own frozen copy of whatever it writes, because a
  step's output must not change when today's defaults do: it would silently
  rewrite what an old dataset receives, and only for whoever had not migrated
  yet. → `src/store/migrations.test.ts`, scoped to import bindings (matching the
  whole file flagged both the comment explaining the rule and the frozen local
  copy that is the fix).
- **Every repository path named in a navigable document must be git-TRACKED** —
  this file, `README.md`, and `docs/*.md`. → `src/docsLinks.test.ts`, added when
  the docs moved into `docs/`: a restructure that quietly leaves thirty
  references pointing at nothing is the failure mode, and nothing else would
  catch it. Tracked rather than merely present, because the first version
  checked the disk, passed locally and failed CI — it was pointing readers at a
  tool ledger that had never been committed. A path only you can follow is the
  reference a reader cannot. It excludes `docs/specs/` and `docs/plans/` on
  purpose: those are dated records of a moment, and a plan naming scaffolding it
  later deleted is accurate history, not a broken link.

Two rules with no test behind them. Only review catches these:

- **A React error boundary does not catch event-handler throws.** Domain
  functions that throw must be guarded at the call site when called from one.
- **Do not "fix" a domain throw by making it return a fallback.** Silently wrong
  numbers are worse than a visible error in a budgeting app.

## 3. Deliberately absent validation

Adding a "missing" guard here is a regression:

- going over budget, anywhere;
- allocation percentages summing past 100%;
- splits that do not sum to the total (the remainder-absorbing split reconciles
  them by design);
- negative amounts — a refund is a normal line.

## 4. Environment

**Bun only.** `bun <file>` (never `node` or `ts-node`), `bun test` (never jest
or vitest), `bun install` (never npm/yarn/pnpm), `bun run <script>`, `bunx`,
`bun build <file.html|file.ts|file.css>` (never webpack, esbuild or vite). Bun
loads `.env` by itself — do not add dotenv.

**Serving and bundling.** `Bun.serve()` with HTML imports — `import index from
"./index.html"` in the `routes` map — plus WebSockets, HTTPS and
`development: { hmr: true, console: true }` if needed. No express. An HTML file
imports `.tsx`/`.jsx`/`.js` and `<link>`s stylesheets directly; Bun's bundler
transpiles and bundles both, Tailwind included. Dev server: `bun run dev`.

If a dependency ever calls for one: `bun:sqlite` not better-sqlite3,
`Bun.redis` not ioredis, `Bun.sql` not pg or postgres.js, the built-in
`WebSocket` not ws, `Bun.file` over `node:fs`'s readFile/writeFile, and
``Bun.$`ls` `` not execa. Full API docs are in
`node_modules/bun-types/docs/**.mdx`.

**Base path** comes from `BUN_PUBLIC_BASE_PATH`. Never hardcode a subpath, and
read the variable only through the `try/catch` accessor (§2).

**Where new documents go.** Design documents in `docs/specs/`, implementation
plans in `docs/plans/`, both named `YYYY-MM-DD-<topic>.md`. Note for tooling:
the brainstorming skill defaults to `docs/superpowers/specs/` — override it.
That directory was removed deliberately, because "superpowers" names the tool
that wrote the documents, not a kind of document.

**There IS a browser here.** `google-chrome` is on PATH, and
`scripts/screenshot.ts` drives it over CDP — it waits past the async IndexedDB
read (which Chrome's own `--screenshot` does not, which is why the docs used to
claim no browser existed), and it reports console errors and uncaught
exceptions. Read the PNG it writes. Use it before claiming anything about
layout.

The whole recipe, from a running `bun run dev`:

```sh
bun scripts/demo-data.ts /tmp/seed.js
bun scripts/screenshot.ts http://localhost:3000/month/2026-09 /tmp/shot.png \
  --eval-file=/tmp/seed.js --reload
```

Then read `/tmp/shot.png`. Other flags: `--dark`, `--full`, `--w/--h`,
`--click=<selector>`, `--profile=<dir>` (keeps a service worker and IndexedDB
across runs — required for anything stateful), `--eval-after-file` (observe a
flow that ends in a navigation from the far side of it; it awaits a promise, so
it can click through a confirm and read IndexedDB back).

Two things that would otherwise waste your time:

- **`--reload` is not optional.** Chrome starts from a fresh profile each run,
  so the app re-seeds itself empty; seeding IndexedDB only takes effect on the
  next boot. Without it every screenshot shows an app full of zeros.
- **This container's fontconfig resolves every generic family to Fira Code, a
  monospace font.** The UI then renders monospaced in a way no real user sees,
  and one agent nearly "fixed" a font bug that did not exist.
  `scripts/screenshot-fonts.conf` corrects it and the script applies it
  automatically — do not undo that, and do not trust a screenshot taken with
  `FONTCONFIG_FILE` set to something else.

Still **not** verifiable here, so do not claim it: real offline behaviour, the
install and update prompts, whether a downloaded file actually landed on disk,
opening the generated `.ods` in a spreadsheet, and anything about how the design
*feels*. A screenshot proves a layout exists and is not broken; it does not
prove it is good. Substitute a real check where one exists — structural
validation of the `.ods`, curl against the dev server, pure-function tests — and
state plainly what still needs a human.

## 5. Then, depending on what you are doing

- **Changing anything structural** → `docs/ARCHITECTURE.md`: layers, data flow,
  and why the non-obvious choices are what they are. This file holds the rules;
  that one holds the reasoning behind them.
- **Picking up queued work** → `docs/TODO.md`, ordered, each item carrying the
  reasoning already settled. It lists only what is still outstanding — finished
  work lives in the commit messages and in `docs/specs/`.
- **Making a product decision** → `docs/PRODUCT.md`: who this is for, what must
  never break, and what must not be invented.
- **Wondering why something is the way it is** → `docs/DECISIONS.md`, an index
  of every significant choice and what it was chosen *over*, each entry pointing
  into `docs/specs/` for the argument in full. `docs/plans/` has the
  task-by-task implementation plans.
