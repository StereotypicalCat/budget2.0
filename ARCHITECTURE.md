# Architecture

Orientation for anyone — human or agent — changing this codebase. It explains
where things live and, more usefully, *why* several non-obvious choices are the
way they are. Most of them were paid for with a bug.

## Shape

A personal budgeting PWA. No backend. IndexedDB in the owner's browser is the
only copy of their data. One static artifact deploys to both GitHub Pages (under
a subpath) and a self-hosted Docker image.

Bun is the runtime, package manager, bundler and test runner. React 19,
Tailwind 4, shadcn/ui. No Vite, no npm, no jest.

## Layers

```
src/domain/   pure. no React, no IndexedDB, no clock. testable with no DOM.
src/store/    persistence, mutations, and the ONLY place a clock is read.
src/export/   JSON and ODS generation. pure.
src/ui/       React. reads through hooks, writes through store actions.
build.ts      static build: publicPath, hashed names, SW precache, 404.html.
server.ts     the Docker image's static file server.
```

The dependency rule is one-directional: `ui -> store -> domain`. `domain` imports
nothing from the others; `store` never imports from `ui`.

`src/domain/smoke.test.ts` asserts the domain is importable with no DOM. That is
why happy-dom is registered **per test file** rather than as a global bunfig
preload — a global DOM would make that assertion vacuously true and silently
retire the check.

## The fold is the single source of every number

`src/domain/fold.ts` holds the one implementation of envelope rollover:

```
remaining = carriedIn + allocation − charges     (carried forward, monthly)
```

Unspent carries; overspend carries as debt. **Nothing else may recompute this.**
The month view, year matrix, summary, per-post views and the ODS export all
aggregate over `foldBalances` / `figuresFor`. A closing balance is read from
`byMonth[11].remaining`, never re-summed.

If you find yourself writing `carriedIn + allocation - charges` outside
`fold.ts`, that is the invariant breaking. It matters because two screens
silently disagreeing about someone's money is the worst failure this app has.

Editing any past month recomputes everything after it. That is correct: the fold
is a left fold, and history is causal.

## Data flow for a single edit

```
onChange
  └─ capture event.target.value into a const   ← synchronously, see Gotchas
      └─ store.mutate(draft => action(draft))
          └─ serialization queue (one mutation at a time)
              └─ structuredClone(snapshot) → apply → await persistence.write()
                  └─ snapshot = next; notify()
                      └─ useSyncExternalStore re-renders
```

Three deliberate properties in that chain:

- **Write before the snapshot moves.** If the write fails, the UI keeps showing
  the last *saved* state, and `useMutate` surfaces the rejection. The user is
  never shown data that was not persisted.
- **Serialized.** Two edits inside one write window would otherwise both clone
  the same base and the later commit would silently drop the earlier one.
- **Cloned.** `useSyncExternalStore` detects change by reference identity;
  mutating in place makes the UI silently stop re-rendering.

## Money

A float, deliberately, with two rules that make it safe:

1. **Round at every boundary** via `roundMoney` — after any division, after any
   FX conversion, and at the `src/store/actions.ts` mutation boundary. The UI
   adds no rounding of its own.
2. **Never round the last distributed part independently.** Compute it as
   `total − sum(others)` so the parts sum exactly to the whole. `withRemainder`
   in `money.ts` is the only place that logic lives.

**`FxRate.baseUnitsPerOne` is never rounded.** Rates are stored at six decimals
and are not money; quantizing one to cents is wrong in kind.

## Splits and finance plans compose

A purchase can be split across posts *and* spread over months at once. The trick
is in `charges.ts`: first compute how the **whole** purchase divides across posts
(`splitPartsOfTotal`), then distribute each month's slice proportionally *to
those parts*. Both split modes collapse to one code path per slice.

Applying a split's raw value per-slice looks simpler and passes every percentage
test — and charges a fixed "2000 to Video Games" in full on every slice.

## Things the app deliberately does NOT validate

Adding a "missing" guard here is a regression, not a fix:

- going over budget, ever, anywhere;
- allocation percentages summing past 100%;
- splits that do not sum to the total (the remainder-absorbing split reconciles
  them by design);
- negative amounts (a refund is a normal line).

## Gotchas paid for with real bugs

- **Never read `event.target.value` inside a `mutate()` callback.** `mutate`
  defers behind the queue and a write; React resets a controlled input's DOM
  value long before the callback runs, so you read the *old* value and commit
  it. This froze the income field at 0. `src/ui/eventCapture.test.ts` fails the
  build if it reappears.
- **Read `process.env.BUN_PUBLIC_*` through a `try/catch` accessor.** Bun only
  inlines the literal when the variable is *set*; unset, the reference survives
  into the browser bundle and throws `ReferenceError: process is not defined`
  before the app boots. A `typeof process` guard does NOT work — after inlining
  it still runs in the browser and discards the inlined value, silently breaking
  subpath deploys. See `readBasePathEnv` in `src/ui/basePath.ts`.
- **Do not define a bare `--accent` CSS variable.** shadcn owns it as a
  near-white hover *background* paired with near-black text; overriding it drops
  hover contrast below WCAG AA app-wide. Project tokens are namespaced
  `--budget-*`.
- **`sw.js` must stay unhashed and be served `no-cache`.** A cached or hashed
  service worker can never be replaced, pinning users to an old build forever.
- **A React error boundary does not catch throws from event handlers.** Domain
  functions that throw (`MissingRateError`, `remainderIndexOf`, `monthOf`,
  `equalSlices`) must be guarded at the call site when called from a handler.

## Testing, and its limits

Most logic is pure and tested directly with `bun test`. The domain carries the
bulk of the coverage; the UI is thin by design.

**There is no browser in the agent environment.** Nothing has ever verified
visual appearance, real offline behaviour, the install or update prompts,
keyboard focus traversal, or the `.ods` opening in a spreadsheet. Where a check
could not be run, the honest substitute was used and recorded — for example the
`.ods` is validated structurally by unzipping it and asserting `mimetype` is
first and stored, every XML part parses, and numeric cells carry `office:value`.

`src/ui/eventCapture.test.ts` is a *source-level* guard rather than a
behavioural one, because the bug it prevents depends on real browser render
timing that happy-dom does not reproduce.

## Where the reasoning lives

- `PRODUCT.md` — durable product truth: who it is for, what must never break.
- `TODO.md` — queued work, with the reasoning behind each decision already made.
- `docs/superpowers/specs/` — design decisions and the alternatives rejected.
- `docs/superpowers/plans/` — task-by-task implementation plans.
