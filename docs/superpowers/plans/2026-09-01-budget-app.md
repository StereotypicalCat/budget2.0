# Budget 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal budgeting PWA that replaces a spreadsheet — envelope-style monthly budgets with rollover, split purchases, finance plans, multi-currency, and JSON/ODS export — deployable to both GitHub Pages and self-hosted Docker.

**Architecture:** A pure derivation core over an IndexedDB fact store. IndexedDB holds only raw facts; a dependency-free TypeScript domain package folds them into every derived figure. There is no backend in the data path, so the same static bundle serves Pages and Docker.

**Tech Stack:** Bun 1.3+ (runtime, package manager, bundler, test runner), React 19, Tailwind 4, shadcn/ui, `fflate` for ODS zip generation, hand-written service worker. No Vite. No Electron.

**Spec:** `docs/superpowers/specs/2026-09-01-budget-app-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Bun only.** `bun <file>`, `bun test`, `bun install`, `bunx`. Never node, npm, jest, vitest, or vite.
- **The domain layer (`src/domain/`) must never import React, IndexedDB, or read the ambient clock.** It must be importable by a test file with no browser environment. This is an architectural invariant, not a style preference.
- **Money is a float.** Round at every boundary via `roundMoney` — after each division, after each FX conversion, and before persisting. Never round the last distributed part independently; compute it as `total − sum(others)`.
- **Currencies:** `"DKK" | "USD" | "EUR"`, all with 2 decimal places.
- **`MonthId` is the string `"YYYY-MM"`.** Never a `Date` object in stored data.
- **Over-budget is always permitted.** Negative balances get a warning treatment; they never block saving. Allocation percentages may sum past 100%.
- **`splitMode` is per purchase, not per split.** All splits on one purchase are percentages, or all are fixed amounts.
- **Exactly one split per purchase has `absorbsRemainder: true`.**
- **`FxRate.baseUnitsPerOne`** is base units per one unit of the named currency. The base currency has no row.
- **Base path** comes from `BUN_PUBLIC_BASE_PATH` (default `/`). Never hardcode `/budget2.0/`.
- **Tests compare rounded values, never raw floats.**
- Seed posts are exactly: `Video Games`, `Food`, `Events and Social`.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/types.ts` | All domain types. No logic. |
| `src/domain/money.ts` | `roundMoney`, `distributeByWeight`, `distributeByAmount` |
| `src/domain/months.ts` | `MonthId` arithmetic and ranges |
| `src/domain/fx.ts` | Currency conversion against the global rate table |
| `src/domain/allocation.ts` | Resolve a `Rule` to a base-currency allocation |
| `src/domain/charges.ts` | Which purchase slices hit a month, distributed across posts |
| `src/domain/fold.ts` | Envelope rollover fold across months |
| `src/domain/views.ts` | `monthView`, `yearView`, `summaryView` |
| `src/domain/seed.ts` | Default dataset for first run |
| `src/store/db.ts` | IndexedDB open + object stores |
| `src/store/migrations.ts` | `schemaVersion` + ordered migrations |
| `src/store/snapshot.ts` | In-memory snapshot, write-through mutations |
| `src/export/json.ts` | Dataset export/import |
| `src/export/odsXml.ts` | ODS XML document builders |
| `src/export/ods.ts` | ODS zip packaging |
| `src/ui/App.tsx` | Routes and app shell |
| `src/ui/routes/*.tsx` | One file per route |
| `src/ui/components/*.tsx` | Purchase dialog, split editor, plan editor, tables |
| `src/ui/hooks/useDataset.ts` | Snapshot subscription |
| `src/sw.ts` | Service worker source |
| `build.ts` | Static build: `publicPath`, hashed names, SW precache list, `404.html` |
| `Dockerfile` | Static server for `dist/` |
| `.github/workflows/` | CI and Pages deploy |

Tests are co-located: `src/domain/money.test.ts` beside `src/domain/money.ts`.

---

## Phase 0 — Foundation

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `bunfig.toml`, `build.ts`, `src/index.ts`, `src/index.html`, `src/frontend.tsx`, `src/index.css` (all via `bun init`)
- Modify: `CLAUDE.md` (append project invariants), `.gitignore`
- Delete: `src/APITester.tsx`, `src/logo.svg`, `src/react.svg`
- Test: `src/domain/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `bun --hot src/index.ts` dev server and a passing `bun test`.

- [ ] **Step 1: Scaffold with Bun**

Run in the repo root. It will not overwrite the existing `README.md` or `.gitignore`.

```bash
bun init --react=shadcn .
```

- [ ] **Step 2: Verify the scaffold and remove the API demo**

There is no backend in this app, so the scaffolded `/api/*` routes and their demo component must go.

```bash
rm -f src/APITester.tsx src/logo.svg src/react.svg
```

Then edit `src/index.ts` so `routes` contains only the HTML entrypoint:

```ts
import { serve } from "bun";
import index from "./index.html";

const server = serve({
  routes: {
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Dev server running at ${server.url}`);
```

Remove the `<APITester />` usage and the logo imports from `src/App.tsx`, leaving a placeholder heading:

```tsx
export function App() {
  return <h1 className="p-8 text-2xl font-semibold">Budget 2.0</h1>;
}
export default App;
```

- [ ] **Step 3: Write the failing smoke test**

This test exists to prove `bun test` works and that the domain directory is importable with no browser environment.

```ts
// src/domain/smoke.test.ts
import { test, expect } from "bun:test";
import { DOMAIN_READY } from "./index.ts";

test("domain layer is importable without a DOM", () => {
  expect(DOMAIN_READY).toBe(true);
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `bun test src/domain/smoke.test.ts`
Expected: FAIL — cannot resolve `./index.ts`.

- [ ] **Step 5: Create the domain barrel to make it pass**

```ts
// src/domain/index.ts
export const DOMAIN_READY = true;
```

- [ ] **Step 6: Run the test and the dev server**

Run: `bun test`
Expected: PASS, 1 test.

Run: `bun --hot src/index.ts`
Expected: server starts, and the printed URL shows "Budget 2.0". Stop it with Ctrl-C.

- [ ] **Step 7: Append project invariants to CLAUDE.md**

The scaffolded `CLAUDE.md` documents Bun idioms. Append the rules specific to this project:

```markdown
## Project invariants (Budget 2.0)

- `src/domain/` is pure: no React, no IndexedDB, no `Date.now()`, no `new Date()`
  without an explicit argument. It must be testable with no DOM.
- Money is a float. Always round with `roundMoney` from `src/domain/money.ts`
  after any division, after any FX conversion, and before persisting.
- When splitting an amount, never round the last part independently. Compute it
  as `total - sum(others)` so the parts sum exactly to the whole.
- `MonthId` is the string `"YYYY-MM"`. Stored data never contains `Date` objects.
- The envelope rollover fold has exactly one implementation, in
  `src/domain/fold.ts`. Year and summary views aggregate over it — they never
  reimplement the math.
- Over-budget is always allowed. Never add validation that blocks it.
- Base path comes from `BUN_PUBLIC_BASE_PATH`; never hardcode a subpath.
- Read the spec at `docs/superpowers/specs/2026-09-01-budget-app-design.md`.
```

- [ ] **Step 8: Ignore the IDE directory**

The repo has an untracked `.idea/` from a JetBrains IDE. Append to `.gitignore`:

```
# JetBrains
.idea/
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Bun + React + shadcn project

bun init --react=shadcn, with the demo API routes removed since this app
has no backend. Adds project invariants to CLAUDE.md and a smoke test
proving the domain layer imports with no DOM."
```

---

## Phase 1 — Domain core

### Task 2: Domain types

**Files:**
- Create: `src/domain/types.ts`
- Test: `src/domain/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Currency`, `Money`, `MonthId`, `PostId`, `Rule`, `Post`, `Month`, `Split`, `Schedule`, `Purchase`, `FxRate`, `Settings`, `Dataset`, `CURRENCIES`, `CURRENCY_DIGITS`. Every later task imports from here.

- [ ] **Step 1: Write the failing test**

Types alone are not testable, so this test pins the runtime constants that accompany them.

```ts
// src/domain/types.test.ts
import { test, expect } from "bun:test";
import { CURRENCIES, CURRENCY_DIGITS } from "./types.ts";

test("supported currencies are exactly DKK, USD, EUR", () => {
  expect(CURRENCIES).toEqual(["DKK", "USD", "EUR"]);
});

test("every supported currency has 2 decimal digits", () => {
  for (const c of CURRENCIES) {
    expect(CURRENCY_DIGITS[c]).toBe(2);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/domain/types.test.ts`
Expected: FAIL — cannot resolve `./types.ts`.

- [ ] **Step 3: Write the types**

```ts
// src/domain/types.ts

export const CURRENCIES = ["DKK", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_DIGITS: Record<Currency, number> = {
  DKK: 2,
  USD: 2,
  EUR: 2,
};

/** A float amount paired with its currency. See CLAUDE.md for rounding rules. */
export interface Money {
  amount: number;
  currency: Currency;
}

/** "YYYY-MM". Never a Date. */
export type MonthId = string;
/** "YYYY-MM-DD". Never a Date. */
export type IsoDate = string;
export type PostId = string;
export type PurchaseId = string;

export type Rule =
  | { kind: "fixed"; amount: Money }
  | { kind: "percentOfIncome"; percent: number };

export interface Post {
  id: PostId;
  name: string;
  order: number;
  archived: boolean;
  /** Display currency for this post's own views only. All totals use base. */
  currency: Currency;
  standingRule: Rule;
}

export interface Month {
  id: MonthId;
  /** Always in Settings.baseCurrency. */
  income: Money;
  ruleOverrides: Record<PostId, Rule>;
}

export interface Split {
  postId: PostId;
  /** A percentage, or an amount in the purchase's currency, per Purchase.splitMode. */
  value: number;
  absorbsRemainder: boolean;
}

export interface ScheduleSlice {
  month: MonthId;
  amount: Money;
}

export interface Schedule {
  slices: ScheduleSlice[];
  /** Slices in this month AND every month after it are ignored by the fold. */
  cancelledFromMonth?: MonthId;
}

export interface Purchase {
  id: PurchaseId;
  date: IsoDate;
  description: string;
  /** In the purchase's own currency. */
  total: Money;
  splitMode: "percent" | "fixed";
  splits: Split[];
  /** null means the whole total is charged in the month of `date`. */
  schedule: Schedule | null;
}

export interface FxRate {
  currency: Currency;
  /** How many base units one unit of `currency` buys. Base has no row. */
  baseUnitsPerOne: number;
  updatedAt: string;
  source: "manual" | "api";
}

export interface Settings {
  baseCurrency: Currency;
  foldStartMonth: MonthId;
  schemaVersion: number;
}

export interface Dataset {
  settings: Settings;
  fxRates: FxRate[];
  posts: Post[];
  months: Month[];
  purchases: Purchase[];
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/domain/types.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/types.test.ts
git commit -m "feat(domain): add domain types"
```

---

### Task 3: Money arithmetic

**Files:**
- Create: `src/domain/money.ts`
- Test: `src/domain/money.test.ts`

**Interfaces:**
- Consumes: `Currency`, `Money`, `CURRENCY_DIGITS` from `./types.ts`.
- Produces:
  - `roundMoney(amount: number, currency?: Currency): number`
  - `money(amount: number, currency: Currency): Money`
  - `addAmounts(...amounts: number[]): number`
  - `distributeByWeight(total: number, weights: number[], remainderIndex: number): number[]`
  - `distributeByAmount(total: number, amounts: number[], remainderIndex: number): number[]`

- [ ] **Step 1: Write the failing tests**

The third and fourth tests are the important ones: they encode the "last part by subtraction" rule that keeps float splits exact.

```ts
// src/domain/money.test.ts
import { test, expect, describe } from "bun:test";
import {
  roundMoney,
  distributeByWeight,
  distributeByAmount,
} from "./money.ts";

describe("roundMoney", () => {
  test("rounds to 2 decimal places", () => {
    expect(roundMoney(1.234)).toBe(1.23);
    expect(roundMoney(1.235)).toBe(1.24);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  test("handles negatives symmetrically", () => {
    expect(roundMoney(-1.235)).toBe(-1.24);
  });
});

describe("distributeByWeight", () => {
  test("splits proportionally", () => {
    expect(distributeByWeight(200, [60, 40], 0)).toEqual([120, 80]);
  });

  test("thirds sum exactly to the total", () => {
    const parts = distributeByWeight(100, [1, 1, 1], 2);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    expect(roundMoney(parts[0]! + parts[1]! + parts[2]!)).toBe(100);
  });

  test("the remainder index absorbs the rounding drift", () => {
    const parts = distributeByWeight(100, [1, 1, 1], 0);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  test("a single split takes the whole total", () => {
    expect(distributeByWeight(99.99, [100], 0)).toEqual([99.99]);
  });

  test("weights that do not sum to 100 are still proportional", () => {
    expect(distributeByWeight(100, [1, 3], 1)).toEqual([25, 75]);
  });

  test("all-zero weights put everything on the remainder rather than throwing", () => {
    // Reachable from a zero-value purchase; must not divide by zero.
    expect(distributeByWeight(100, [0, 0], 1)).toEqual([0, 100]);
    expect(distributeByWeight(0, [0, 0], 0)).toEqual([0, 0]);
  });
});

describe("distributeByAmount", () => {
  test("uses the given amounts as-is", () => {
    expect(distributeByAmount(200, [120, 80], 1)).toEqual([120, 80]);
  });

  test("the remainder index absorbs a shortfall", () => {
    expect(distributeByAmount(200, [120, 50], 1)).toEqual([120, 80]);
  });

  test("the remainder index absorbs an excess, even going negative", () => {
    expect(distributeByAmount(100, [120, 50], 1)).toEqual([120, -20]);
  });

  test("parts always sum exactly to the total", () => {
    const parts = distributeByAmount(10, [3.33, 3.33, 0], 2);
    expect(roundMoney(parts.reduce((a, b) => a + b, 0))).toBe(10);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/money.test.ts`
Expected: FAIL — cannot resolve `./money.ts`.

- [ ] **Step 3: Implement**

```ts
// src/domain/money.ts
import { CURRENCY_DIGITS, type Currency, type Money } from "./types.ts";

/**
 * Rounds a float to its currency's minor unit. `toFixed` rounds the double's
 * actual decimal value, which is the most predictable option available for
 * binary floats. Call this after every division and FX conversion, and before
 * persisting.
 */
export function roundMoney(amount: number, currency: Currency = "DKK"): number {
  const digits = CURRENCY_DIGITS[currency];
  return Number(amount.toFixed(digits));
}

export function money(amount: number, currency: Currency): Money {
  return { amount: roundMoney(amount, currency), currency };
}

export function addAmounts(...amounts: number[]): number {
  return roundMoney(amounts.reduce((sum, a) => sum + a, 0));
}

function withRemainder(
  total: number,
  parts: number[],
  remainderIndex: number,
  currency: Currency,
): number[] {
  const result = [...parts];
  let othersSum = 0;
  for (let i = 0; i < result.length; i++) {
    if (i !== remainderIndex) othersSum += result[i]!;
  }
  // Never round this independently — subtraction is what makes the parts sum
  // exactly to the total.
  result[remainderIndex] = roundMoney(total - othersSum, currency);
  return result;
}

/** Splits `total` proportionally to `weights`. Weights need not sum to 100. */
export function distributeByWeight(
  total: number,
  weights: number[],
  remainderIndex: number,
  currency: Currency = "DKK",
): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  // All-zero weights would divide by zero. A zero-total purchase is legal (and
  // reachable via import), so the whole amount goes to the remainder instead of
  // throwing and taking the whole fold down with it.
  const parts = weights.map((w, i) =>
    i === remainderIndex || weightSum === 0
      ? 0
      : roundMoney((total * w) / weightSum, currency),
  );
  return withRemainder(total, parts, remainderIndex, currency);
}

/** Uses `amounts` as-is; `remainderIndex` absorbs any shortfall or excess. */
export function distributeByAmount(
  total: number,
  amounts: number[],
  remainderIndex: number,
  currency: Currency = "DKK",
): number[] {
  const parts = amounts.map((a, i) =>
    i === remainderIndex ? 0 : roundMoney(a, currency),
  );
  return withRemainder(total, parts, remainderIndex, currency);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/money.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/money.ts src/domain/money.test.ts
git commit -m "feat(domain): add money arithmetic with exact distribution

Distribution computes the remainder part by subtraction so float splits
always sum exactly to the total."
```

---

### Task 4: Month arithmetic

**Files:**
- Create: `src/domain/months.ts`
- Test: `src/domain/months.test.ts`

**Interfaces:**
- Consumes: `MonthId`, `IsoDate` from `./types.ts`.
- Produces:
  - `monthOf(date: IsoDate): MonthId`
  - `nextMonth(id: MonthId): MonthId`
  - `prevMonth(id: MonthId): MonthId`
  - `compareMonths(a: MonthId, b: MonthId): number`
  - `monthRange(from: MonthId, to: MonthId): MonthId[]`
  - `monthsOfYear(year: number): MonthId[]`
  - `addMonths(id: MonthId, count: number): MonthId`
  - `yearOf(id: MonthId): number`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/months.test.ts
import { test, expect, describe } from "bun:test";
import {
  monthOf,
  nextMonth,
  prevMonth,
  compareMonths,
  monthRange,
  monthsOfYear,
  addMonths,
  yearOf,
} from "./months.ts";

test("monthOf extracts the month from an ISO date", () => {
  expect(monthOf("2026-09-14")).toBe("2026-09");
});

describe("month stepping", () => {
  test("nextMonth crosses the year boundary", () => {
    expect(nextMonth("2026-11")).toBe("2026-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  test("prevMonth crosses the year boundary", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
  });

  test("addMonths handles multi-year spans in both directions", () => {
    expect(addMonths("2026-09", 6)).toBe("2027-03");
    expect(addMonths("2026-09", -12)).toBe("2025-09");
    expect(addMonths("2026-09", 0)).toBe("2026-09");
  });
});

test("compareMonths orders chronologically", () => {
  expect(compareMonths("2026-01", "2026-02")).toBeLessThan(0);
  expect(compareMonths("2027-01", "2026-12")).toBeGreaterThan(0);
  expect(compareMonths("2026-05", "2026-05")).toBe(0);
});

describe("monthRange", () => {
  test("is inclusive of both ends", () => {
    expect(monthRange("2026-11", "2027-01")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  test("returns a single month when both ends match", () => {
    expect(monthRange("2026-03", "2026-03")).toEqual(["2026-03"]);
  });

  test("returns empty when `to` precedes `from`", () => {
    expect(monthRange("2026-05", "2026-04")).toEqual([]);
  });
});

test("monthsOfYear returns twelve padded months", () => {
  const months = monthsOfYear(2026);
  expect(months).toHaveLength(12);
  expect(months[0]).toBe("2026-01");
  expect(months[11]).toBe("2026-12");
});

test("yearOf parses the year", () => {
  expect(yearOf("2026-09")).toBe(2026);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/months.test.ts`
Expected: FAIL — cannot resolve `./months.ts`.

- [ ] **Step 3: Implement**

Arithmetic is done on a month ordinal rather than with `Date`, which keeps it timezone-proof.

```ts
// src/domain/months.ts
import type { IsoDate, MonthId } from "./types.ts";

function parse(id: MonthId): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(id);
  if (!match) throw new Error(`Invalid MonthId: ${id}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function format(year: number, month: number): MonthId {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Months since year 0. Avoids Date and therefore avoids timezones entirely. */
function toOrdinal(id: MonthId): number {
  const { year, month } = parse(id);
  return year * 12 + (month - 1);
}

function fromOrdinal(ordinal: number): MonthId {
  return format(Math.floor(ordinal / 12), (ordinal % 12) + 1);
}

export function monthOf(date: IsoDate): MonthId {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) throw new Error(`Invalid IsoDate: ${date}`);
  return `${match[1]}-${match[2]}`;
}

export function yearOf(id: MonthId): number {
  return parse(id).year;
}

export function addMonths(id: MonthId, count: number): MonthId {
  return fromOrdinal(toOrdinal(id) + count);
}

export function nextMonth(id: MonthId): MonthId {
  return addMonths(id, 1);
}

export function prevMonth(id: MonthId): MonthId {
  return addMonths(id, -1);
}

export function compareMonths(a: MonthId, b: MonthId): number {
  return toOrdinal(a) - toOrdinal(b);
}

export function monthRange(from: MonthId, to: MonthId): MonthId[] {
  const start = toOrdinal(from);
  const end = toOrdinal(to);
  const out: MonthId[] = [];
  for (let i = start; i <= end; i++) out.push(fromOrdinal(i));
  return out;
}

export function monthsOfYear(year: number): MonthId[] {
  return monthRange(format(year, 1), format(year, 12));
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/months.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/months.ts src/domain/months.test.ts
git commit -m "feat(domain): add MonthId arithmetic

Uses a month ordinal rather than Date, so month stepping is timezone-proof."
```

---

### Task 5: Currency conversion

**Files:**
- Create: `src/domain/fx.ts`
- Test: `src/domain/fx.test.ts`

**Interfaces:**
- Consumes: `Currency`, `Money`, `FxRate` from `./types.ts`; `roundMoney` from `./money.ts`.
- Produces:
  - `toBase(value: Money, baseCurrency: Currency, rates: FxRate[]): number`
  - `fromBase(amount: number, target: Currency, baseCurrency: Currency, rates: FxRate[]): number`
  - `MissingRateError` (an `Error` subclass with a `currency` property)

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/fx.test.ts
import { test, expect, describe } from "bun:test";
import { toBase, fromBase, MissingRateError } from "./fx.ts";
import type { FxRate } from "./types.ts";

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

describe("toBase", () => {
  test("passes base-currency values through untouched", () => {
    expect(toBase({ amount: 100, currency: "DKK" }, "DKK", rates)).toBe(100);
  });

  test("converts using baseUnitsPerOne", () => {
    expect(toBase({ amount: 10, currency: "EUR" }, "DKK", rates)).toBe(74.6);
  });

  test("rounds the conversion result", () => {
    expect(toBase({ amount: 3.33, currency: "USD" }, "DKK", rates)).toBe(22.98);
  });

  test("throws MissingRateError naming the currency", () => {
    expect(() => toBase({ amount: 1, currency: "USD" }, "DKK", [])).toThrow(
      MissingRateError,
    );
    try {
      toBase({ amount: 1, currency: "USD" }, "DKK", []);
    } catch (error) {
      expect((error as MissingRateError).currency).toBe("USD");
    }
  });
});

describe("fromBase", () => {
  test("passes base through untouched", () => {
    expect(fromBase(100, "DKK", "DKK", rates)).toBe(100);
  });

  test("inverts the conversion", () => {
    expect(fromBase(74.6, "EUR", "DKK", rates)).toBe(10);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/fx.test.ts`
Expected: FAIL — cannot resolve `./fx.ts`.

- [ ] **Step 3: Implement**

```ts
// src/domain/fx.ts
import { roundMoney } from "./money.ts";
import type { Currency, FxRate, Money } from "./types.ts";

export class MissingRateError extends Error {
  constructor(public readonly currency: Currency) {
    super(`No exchange rate configured for ${currency}`);
    this.name = "MissingRateError";
  }
}

function rateFor(currency: Currency, rates: FxRate[]): number {
  const found = rates.find((r) => r.currency === currency);
  if (!found) throw new MissingRateError(currency);
  return found.baseUnitsPerOne;
}

/** Converts a Money value into the base currency, rounded. */
export function toBase(
  value: Money,
  baseCurrency: Currency,
  rates: FxRate[],
): number {
  if (value.currency === baseCurrency) {
    return roundMoney(value.amount, baseCurrency);
  }
  return roundMoney(value.amount * rateFor(value.currency, rates), baseCurrency);
}

/** Converts a base-currency amount into `target`, rounded. */
export function fromBase(
  amount: number,
  target: Currency,
  baseCurrency: Currency,
  rates: FxRate[],
): number {
  if (target === baseCurrency) return roundMoney(amount, target);
  return roundMoney(amount / rateFor(target, rates), target);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/fx.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/fx.ts src/domain/fx.test.ts
git commit -m "feat(domain): add currency conversion

Missing rates throw MissingRateError rather than silently treating the
value as base currency."
```

---

### Task 6: Allocation resolution

**Files:**
- Create: `src/domain/allocation.ts`
- Test: `src/domain/allocation.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `Month`, `MonthId`, `Post`, `PostId`, `Rule`, `Settings`, `FxRate` from `./types.ts`; `toBase` from `./fx.ts`; `roundMoney` from `./money.ts`.
- Produces:
  - `resolveRule(rule: Rule, income: number, baseCurrency: Currency, rates: FxRate[]): number`
  - `ruleForPost(month: Month | undefined, post: Post): Rule`
  - `isOverridden(month: Month | undefined, postId: PostId): boolean`
  - `allocationFor(dataset: Dataset, postId: PostId, monthId: MonthId): number`
  - `incomeFor(dataset: Dataset, monthId: MonthId): number`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/allocation.test.ts
import { test, expect, describe } from "bun:test";
import {
  resolveRule,
  ruleForPost,
  isOverridden,
  allocationFor,
  incomeFor,
} from "./allocation.ts";
import type { Dataset, FxRate, Post } from "./types.ts";

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    name: "Food",
    order: 0,
    archived: false,
    currency: "DKK",
    standingRule: { kind: "fixed", amount: { amount: 400, currency: "DKK" } },
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
    fxRates: rates,
    posts: [post()],
    months: [
      { id: "2026-09", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases: [],
    ...overrides,
  };
}

describe("resolveRule", () => {
  test("a fixed rule in base currency is its amount", () => {
    expect(
      resolveRule({ kind: "fixed", amount: { amount: 400, currency: "DKK" } }, 20000, "DKK", rates),
    ).toBe(400);
  });

  test("a fixed rule in a foreign currency converts to base", () => {
    expect(
      resolveRule({ kind: "fixed", amount: { amount: 50, currency: "EUR" } }, 20000, "DKK", rates),
    ).toBe(373);
  });

  test("a percentage rule resolves against income", () => {
    expect(resolveRule({ kind: "percentOfIncome", percent: 25 }, 20000, "DKK", rates)).toBe(5000);
  });

  test("a percentage rule rounds", () => {
    expect(resolveRule({ kind: "percentOfIncome", percent: 33 }, 1000.5, "DKK", rates)).toBe(330.17);
  });

  test("a percentage above 100 is permitted", () => {
    expect(resolveRule({ kind: "percentOfIncome", percent: 150 }, 1000, "DKK", rates)).toBe(1500);
  });
});

describe("override precedence", () => {
  test("a month override wins over the standing rule", () => {
    const data = dataset({
      months: [
        {
          id: "2026-09",
          income: { amount: 20000, currency: "DKK" },
          ruleOverrides: { p1: { kind: "fixed", amount: { amount: 999, currency: "DKK" } } },
        },
      ],
    });
    expect(allocationFor(data, "p1", "2026-09")).toBe(999);
    expect(isOverridden(data.months[0], "p1")).toBe(true);
  });

  test("without an override the standing rule applies", () => {
    const data = dataset();
    expect(allocationFor(data, "p1", "2026-09")).toBe(400);
    expect(isOverridden(data.months[0], "p1")).toBe(false);
  });

  test("ruleForPost falls back to the standing rule when the month is unknown", () => {
    expect(ruleForPost(undefined, post())).toEqual({
      kind: "fixed",
      amount: { amount: 400, currency: "DKK" },
    });
  });
});

describe("incomeFor", () => {
  test("returns the month's income", () => {
    expect(incomeFor(dataset(), "2026-09")).toBe(20000);
  });

  test("a month with no record has zero income", () => {
    expect(incomeFor(dataset(), "2026-10")).toBe(0);
  });
});

test("a percentage allocation in a month with no record is zero", () => {
  const data = dataset({
    posts: [post({ standingRule: { kind: "percentOfIncome", percent: 25 } })],
  });
  expect(allocationFor(data, "p1", "2026-10")).toBe(0);
});

test("an unknown post id throws", () => {
  expect(() => allocationFor(dataset(), "nope", "2026-09")).toThrow(/nope/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/allocation.test.ts`
Expected: FAIL — cannot resolve `./allocation.ts`.

- [ ] **Step 3: Implement**

```ts
// src/domain/allocation.ts
import { toBase } from "./fx.ts";
import { roundMoney } from "./money.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Month,
  MonthId,
  Post,
  PostId,
  Rule,
} from "./types.ts";

/** Resolves a rule to a base-currency amount. Percentages may exceed 100. */
export function resolveRule(
  rule: Rule,
  income: number,
  baseCurrency: Currency,
  rates: FxRate[],
): number {
  if (rule.kind === "fixed") {
    return toBase(rule.amount, baseCurrency, rates);
  }
  return roundMoney((income * rule.percent) / 100, baseCurrency);
}

export function ruleForPost(month: Month | undefined, post: Post): Rule {
  return month?.ruleOverrides[post.id] ?? post.standingRule;
}

export function isOverridden(month: Month | undefined, postId: PostId): boolean {
  return month?.ruleOverrides[postId] !== undefined;
}

export function incomeFor(dataset: Dataset, monthId: MonthId): number {
  const month = dataset.months.find((m) => m.id === monthId);
  if (!month) return 0;
  return toBase(month.income, dataset.settings.baseCurrency, dataset.fxRates);
}

export function allocationFor(
  dataset: Dataset,
  postId: PostId,
  monthId: MonthId,
): number {
  const post = dataset.posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Unknown post: ${postId}`);
  const month = dataset.months.find((m) => m.id === monthId);
  return resolveRule(
    ruleForPost(month, post),
    incomeFor(dataset, monthId),
    dataset.settings.baseCurrency,
    dataset.fxRates,
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/allocation.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/allocation.ts src/domain/allocation.test.ts
git commit -m "feat(domain): resolve allocation rules

Month overrides win over standing rules; percentages above 100 are allowed."
```

---

### Task 7: Charges — slices distributed across posts

This is the task where splits and finance plans compose. The key idea: first
work out how the **whole** purchase divides across posts, then distribute each
slice proportionally to that division. Both `splitMode` values therefore
collapse to one code path per slice, and a financed split purchase needs no
special case.

**Files:**
- Create: `src/domain/charges.ts`
- Test: `src/domain/charges.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `Purchase`, `MonthId`, `PostId`, `Currency`, `FxRate`, `Money` from `./types.ts`; `distributeByWeight`, `distributeByAmount`, `roundMoney` from `./money.ts`; `toBase` from `./fx.ts`; `monthOf`, `compareMonths` from `./months.ts`.
- Produces:
  - `type Charge = { postId: PostId; amount: number }` (amount in base currency)
  - `splitPartsOfTotal(purchase: Purchase): number[]` (purchase currency, sums exactly to total)
  - `sliceAmountForMonth(purchase: Purchase, monthId: MonthId): Money | null`
  - `chargesForPurchaseInMonth(purchase, monthId, baseCurrency, rates): Charge[]`
  - `chargesForMonth(dataset: Dataset, monthId: MonthId): Map<PostId, number>`
  - `remainderIndexOf(purchase: Purchase): number`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/charges.test.ts
import { test, expect, describe } from "bun:test";
import {
  splitPartsOfTotal,
  sliceAmountForMonth,
  chargesForPurchaseInMonth,
  chargesForMonth,
} from "./charges.ts";
import { roundMoney } from "./money.ts";
import type { Dataset, FxRate, Purchase } from "./types.ts";

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "x1",
    date: "2026-09-14",
    description: "Groceries",
    total: { amount: 200, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId: "food", value: 100, absorbsRemainder: true }],
    schedule: null,
    ...overrides,
  };
}

describe("splitPartsOfTotal", () => {
  test("a single split takes the whole total", () => {
    expect(splitPartsOfTotal(purchase())).toEqual([200]);
  });

  test("percent mode divides proportionally", () => {
    const parts = splitPartsOfTotal(
      purchase({
        splits: [
          { postId: "food", value: 60, absorbsRemainder: true },
          { postId: "events", value: 40, absorbsRemainder: false },
        ],
      }),
    );
    expect(parts).toEqual([120, 80]);
  });

  test("fixed mode uses the given amounts, remainder absorbing the shortfall", () => {
    const parts = splitPartsOfTotal(
      purchase({
        splitMode: "fixed",
        splits: [
          { postId: "food", value: 120, absorbsRemainder: false },
          { postId: "events", value: 50, absorbsRemainder: true },
        ],
      }),
    );
    expect(parts).toEqual([120, 80]);
  });

  test("three-way percent splits sum exactly to the total", () => {
    const parts = splitPartsOfTotal(
      purchase({
        total: { amount: 100, currency: "DKK" },
        splits: [
          { postId: "a", value: 33.33, absorbsRemainder: false },
          { postId: "b", value: 33.33, absorbsRemainder: false },
          { postId: "c", value: 33.34, absorbsRemainder: true },
        ],
      }),
    );
    expect(roundMoney(parts.reduce((a, b) => a + b, 0))).toBe(100);
  });
});

describe("sliceAmountForMonth", () => {
  test("an unscheduled purchase charges its whole total in the month of its date", () => {
    expect(sliceAmountForMonth(purchase(), "2026-09")).toEqual({
      amount: 200,
      currency: "DKK",
    });
  });

  test("an unscheduled purchase charges nothing in other months", () => {
    expect(sliceAmountForMonth(purchase(), "2026-10")).toBeNull();
  });

  test("a scheduled purchase charges only its slice for that month", () => {
    const financed = purchase({
      total: { amount: 3000, currency: "DKK" },
      schedule: {
        slices: [
          { month: "2026-10", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-11", amount: { amount: 500, currency: "DKK" } },
          { month: "2026-12", amount: { amount: 1500, currency: "DKK" } },
        ],
      },
    });
    expect(sliceAmountForMonth(financed, "2026-11")).toEqual({
      amount: 500,
      currency: "DKK",
    });
    expect(sliceAmountForMonth(financed, "2026-09")).toBeNull();
  });

  test("cancellation drops the cancelled month and every later one", () => {
    const cancelled = purchase({
      total: { amount: 3000, currency: "DKK" },
      schedule: {
        slices: [
          { month: "2026-10", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-11", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-12", amount: { amount: 1000, currency: "DKK" } },
        ],
        cancelledFromMonth: "2026-11",
      },
    });
    expect(sliceAmountForMonth(cancelled, "2026-10")).not.toBeNull();
    expect(sliceAmountForMonth(cancelled, "2026-11")).toBeNull();
    expect(sliceAmountForMonth(cancelled, "2026-12")).toBeNull();
  });
});

describe("chargesForPurchaseInMonth", () => {
  test("a simple purchase charges one post", () => {
    expect(chargesForPurchaseInMonth(purchase(), "2026-09", "DKK", rates)).toEqual([
      { postId: "food", amount: 200 },
    ]);
  });

  test("converts a foreign-currency purchase into base", () => {
    const eur = purchase({ total: { amount: 10, currency: "EUR" } });
    expect(chargesForPurchaseInMonth(eur, "2026-09", "DKK", rates)).toEqual([
      { postId: "food", amount: 74.6 },
    ]);
  });

  test("a financed split purchase divides each slice by the split ratio", () => {
    const financedSplit = purchase({
      total: { amount: 3000, currency: "DKK" },
      splits: [
        { postId: "games", value: 70, absorbsRemainder: true },
        { postId: "events", value: 30, absorbsRemainder: false },
      ],
      schedule: {
        slices: [
          { month: "2026-10", amount: { amount: 1000, currency: "DKK" } },
          { month: "2026-11", amount: { amount: 2000, currency: "DKK" } },
        ],
      },
    });
    expect(chargesForPurchaseInMonth(financedSplit, "2026-10", "DKK", rates)).toEqual([
      { postId: "games", amount: 700 },
      { postId: "events", amount: 300 },
    ]);
    expect(chargesForPurchaseInMonth(financedSplit, "2026-11", "DKK", rates)).toEqual([
      { postId: "games", amount: 1400 },
      { postId: "events", amount: 600 },
    ]);
  });

  test("a financed fixed-mode split scales the fixed amounts down per slice", () => {
    const financed = purchase({
      total: { amount: 3000, currency: "DKK" },
      splitMode: "fixed",
      splits: [
        { postId: "games", value: 2000, absorbsRemainder: true },
        { postId: "events", value: 1000, absorbsRemainder: false },
      ],
      schedule: {
        slices: [{ month: "2026-10", amount: { amount: 600, currency: "DKK" } }],
      },
    });
    expect(chargesForPurchaseInMonth(financed, "2026-10", "DKK", rates)).toEqual([
      { postId: "games", amount: 400 },
      { postId: "events", amount: 200 },
    ]);
  });

  test("charges in a month the purchase does not touch are empty", () => {
    expect(chargesForPurchaseInMonth(purchase(), "2026-01", "DKK", rates)).toEqual([]);
  });

  test("slice charges always sum to the slice total", () => {
    const odd = purchase({
      total: { amount: 100, currency: "DKK" },
      splits: [
        { postId: "a", value: 1, absorbsRemainder: false },
        { postId: "b", value: 1, absorbsRemainder: false },
        { postId: "c", value: 1, absorbsRemainder: true },
      ],
    });
    const charges = chargesForPurchaseInMonth(odd, "2026-09", "DKK", rates);
    expect(roundMoney(charges.reduce((sum, c) => sum + c.amount, 0))).toBe(100);
  });
});

describe("chargesForMonth", () => {
  test("sums charges per post across all purchases", () => {
    const data: Dataset = {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
      fxRates: rates,
      posts: [],
      months: [],
      purchases: [
        purchase({ id: "a" }),
        purchase({ id: "b", total: { amount: 50, currency: "DKK" } }),
        purchase({ id: "c", date: "2026-10-01" }),
      ],
    };
    const charges = chargesForMonth(data, "2026-09");
    expect(charges.get("food")).toBe(250);
    expect(charges.size).toBe(1);
  });

  test("a month with no purchases yields an empty map", () => {
    const data: Dataset = {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
      fxRates: rates,
      posts: [],
      months: [],
      purchases: [],
    };
    expect(chargesForMonth(data, "2026-09").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/charges.test.ts`
Expected: FAIL — cannot resolve `./charges.ts`.

- [ ] **Step 3: Implement**

```ts
// src/domain/charges.ts
import { toBase } from "./fx.ts";
import { distributeByAmount, distributeByWeight, roundMoney } from "./money.ts";
import { compareMonths, monthOf } from "./months.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Money,
  MonthId,
  PostId,
  Purchase,
} from "./types.ts";

export interface Charge {
  postId: PostId;
  /** Base currency. */
  amount: number;
}

export function remainderIndexOf(purchase: Purchase): number {
  const index = purchase.splits.findIndex((s) => s.absorbsRemainder);
  if (index === -1) {
    throw new Error(
      `Purchase ${purchase.id} has no split flagged absorbsRemainder`,
    );
  }
  return index;
}

/**
 * How the whole purchase divides across its posts, in the purchase's own
 * currency. Parts sum exactly to the total.
 */
export function splitPartsOfTotal(purchase: Purchase): number[] {
  const index = remainderIndexOf(purchase);
  const values = purchase.splits.map((s) => s.value);
  const total = purchase.total.amount;
  const currency = purchase.total.currency;
  return purchase.splitMode === "percent"
    ? distributeByWeight(total, values, index, currency)
    : distributeByAmount(total, values, index, currency);
}

/**
 * The amount charged in `monthId`, in the purchase's currency, or null if the
 * purchase does not touch that month.
 */
export function sliceAmountForMonth(
  purchase: Purchase,
  monthId: MonthId,
): Money | null {
  if (!purchase.schedule) {
    return monthOf(purchase.date) === monthId ? purchase.total : null;
  }
  const { slices, cancelledFromMonth } = purchase.schedule;
  if (cancelledFromMonth && compareMonths(monthId, cancelledFromMonth) >= 0) {
    return null;
  }
  const slice = slices.find((s) => s.month === monthId);
  return slice ? slice.amount : null;
}

/**
 * Distributes this month's slice across the purchase's posts, in base currency.
 *
 * Weights are the whole-purchase split parts, so a financed purchase divides
 * each slice in the same proportion as the purchase as a whole — which is what
 * makes splits and finance plans compose without a special case.
 */
export function chargesForPurchaseInMonth(
  purchase: Purchase,
  monthId: MonthId,
  baseCurrency: Currency,
  rates: FxRate[],
): Charge[] {
  const slice = sliceAmountForMonth(purchase, monthId);
  if (!slice) return [];

  const sliceBase = toBase(slice, baseCurrency, rates);
  const index = remainderIndexOf(purchase);
  const weights = splitPartsOfTotal(purchase);
  const parts = distributeByWeight(sliceBase, weights, index, baseCurrency);

  return purchase.splits.map((split, i) => ({
    postId: split.postId,
    amount: parts[i]!,
  }));
}

/** Total charged per post in `monthId`, in base currency. */
export function chargesForMonth(
  dataset: Dataset,
  monthId: MonthId,
): Map<PostId, number> {
  const totals = new Map<PostId, number>();
  for (const purchase of dataset.purchases) {
    const charges = chargesForPurchaseInMonth(
      purchase,
      monthId,
      dataset.settings.baseCurrency,
      dataset.fxRates,
    );
    for (const charge of charges) {
      const previous = totals.get(charge.postId) ?? 0;
      totals.set(
        charge.postId,
        roundMoney(previous + charge.amount, dataset.settings.baseCurrency),
      );
    }
  }
  return totals;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/charges.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/charges.ts src/domain/charges.test.ts
git commit -m "feat(domain): distribute purchase slices across posts

Slices are weighted by the whole-purchase split parts, so financed split
purchases need no special case and parts always sum to the slice total."
```

---

### Task 8: The rollover fold

**Files:**
- Create: `src/domain/fold.ts`
- Test: `src/domain/fold.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `MonthId`, `PostId` from `./types.ts`; `allocationFor` from `./allocation.ts`; `chargesForMonth` from `./charges.ts`; `monthRange`, `compareMonths` from `./months.ts`; `roundMoney` from `./money.ts`.
- Produces:
  - `interface PostMonthFigures { carriedIn: number; allocation: number; charges: number; remaining: number }`
  - `type Fold = Map<MonthId, Map<PostId, PostMonthFigures>>`
  - `foldBalances(dataset: Dataset, upToMonth: MonthId): Fold`
  - `figuresFor(fold: Fold, postId: PostId, monthId: MonthId): PostMonthFigures`
  - `EMPTY_FIGURES: PostMonthFigures`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/fold.test.ts
import { test, expect, describe } from "bun:test";
import { foldBalances, figuresFor } from "./fold.ts";
import type { Dataset, Post, Purchase } from "./types.ts";

function post(id: string, fixed: number, archived = false): Post {
  return {
    id,
    name: id,
    order: 0,
    archived,
    currency: "DKK",
    standingRule: { kind: "fixed", amount: { amount: fixed, currency: "DKK" } },
  };
}

function spend(id: string, postId: string, amount: number, date: string): Purchase {
  return {
    id,
    date,
    description: id,
    total: { amount, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    schedule: null,
  };
}

function dataset(posts: Post[], purchases: Purchase[]): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
    fxRates: [],
    posts,
    months: [
      { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-02", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-03", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases,
  };
}

describe("envelope rollover", () => {
  test("the first month carries in zero", () => {
    const fold = foldBalances(dataset([post("food", 500)], []), "2026-01");
    expect(figuresFor(fold, "food", "2026-01")).toEqual({
      carriedIn: 0,
      allocation: 500,
      charges: 0,
      remaining: 500,
    });
  });

  test("unspent allocation carries into the next month", () => {
    const data = dataset([post("food", 500)], [spend("a", "food", 300, "2026-01-05")]);
    const fold = foldBalances(data, "2026-02");
    expect(figuresFor(fold, "food", "2026-01").remaining).toBe(200);
    expect(figuresFor(fold, "food", "2026-02")).toEqual({
      carriedIn: 200,
      allocation: 500,
      charges: 0,
      remaining: 700,
    });
  });

  test("overspend carries forward as debt", () => {
    const data = dataset([post("food", 500)], [spend("a", "food", 700, "2026-01-05")]);
    const fold = foldBalances(data, "2026-02");
    expect(figuresFor(fold, "food", "2026-01").remaining).toBe(-200);
    expect(figuresFor(fold, "food", "2026-02").carriedIn).toBe(-200);
    expect(figuresFor(fold, "food", "2026-02").remaining).toBe(300);
  });

  test("the chain accumulates across three months", () => {
    const data = dataset(
      [post("food", 500)],
      [spend("a", "food", 100, "2026-01-05"), spend("b", "food", 900, "2026-02-05")],
    );
    const fold = foldBalances(data, "2026-03");
    expect(figuresFor(fold, "food", "2026-01").remaining).toBe(400);
    expect(figuresFor(fold, "food", "2026-02").remaining).toBe(0);
    expect(figuresFor(fold, "food", "2026-03").remaining).toBe(500);
  });

  test("editing an early purchase changes every later month", () => {
    const before = foldBalances(
      dataset([post("food", 500)], [spend("a", "food", 100, "2026-01-05")]),
      "2026-03",
    );
    const after = foldBalances(
      dataset([post("food", 500)], [spend("a", "food", 200, "2026-01-05")]),
      "2026-03",
    );
    expect(figuresFor(before, "food", "2026-03").remaining).toBe(1400);
    expect(figuresFor(after, "food", "2026-03").remaining).toBe(1300);
  });
});

test("archived posts are still folded", () => {
  const data = dataset(
    [post("food", 500), post("old", 100, true)],
    [spend("a", "old", 40, "2026-01-05")],
  );
  const fold = foldBalances(data, "2026-02");
  expect(figuresFor(fold, "old", "2026-02").carriedIn).toBe(60);
});

test("percentage allocations follow the month's income", () => {
  const data: Dataset = {
    ...dataset([], []),
    posts: [
      {
        id: "food",
        name: "Food",
        order: 0,
        archived: false,
        currency: "DKK",
        standingRule: { kind: "percentOfIncome", percent: 10 },
      },
    ],
    months: [
      { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      { id: "2026-02", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} },
    ],
  };
  const fold = foldBalances(data, "2026-02");
  expect(figuresFor(fold, "food", "2026-01").allocation).toBe(1000);
  expect(figuresFor(fold, "food", "2026-02").allocation).toBe(2000);
  expect(figuresFor(fold, "food", "2026-02").remaining).toBe(3000);
});

test("months before foldStartMonth contribute nothing", () => {
  const data: Dataset = {
    ...dataset([post("food", 500)], [spend("a", "food", 5000, "2025-06-01")]),
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
  };
  const fold = foldBalances(data, "2026-01");
  expect(fold.has("2025-06")).toBe(false);
  expect(figuresFor(fold, "food", "2026-01").carriedIn).toBe(0);
});

test("figuresFor returns zeroes for a month outside the fold", () => {
  const fold = foldBalances(dataset([post("food", 500)], []), "2026-01");
  expect(figuresFor(fold, "food", "2030-01")).toEqual({
    carriedIn: 0,
    allocation: 0,
    charges: 0,
    remaining: 0,
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/fold.test.ts`
Expected: FAIL — cannot resolve `./fold.ts`.

- [ ] **Step 3: Implement**

```ts
// src/domain/fold.ts
import { allocationFor } from "./allocation.ts";
import { chargesForMonth } from "./charges.ts";
import { roundMoney } from "./money.ts";
import { compareMonths, monthRange } from "./months.ts";
import type { Dataset, MonthId, PostId } from "./types.ts";

export interface PostMonthFigures {
  carriedIn: number;
  allocation: number;
  charges: number;
  /** carriedIn + allocation - charges. Negative means overspent. */
  remaining: number;
}

export const EMPTY_FIGURES: PostMonthFigures = {
  carriedIn: 0,
  allocation: 0,
  charges: 0,
  remaining: 0,
};

export type Fold = Map<MonthId, Map<PostId, PostMonthFigures>>;

/**
 * The single implementation of envelope rollover. Year and summary views
 * aggregate over this — they never recompute the math.
 *
 * Unspent allocation carries into the next month; overspend carries forward as
 * a negative balance. Archived posts are included, since their history still
 * has to fold.
 */
export function foldBalances(dataset: Dataset, upToMonth: MonthId): Fold {
  const { foldStartMonth, baseCurrency } = dataset.settings;
  const fold: Fold = new Map();

  if (compareMonths(upToMonth, foldStartMonth) < 0) return fold;

  const carried = new Map<PostId, number>();

  for (const monthId of monthRange(foldStartMonth, upToMonth)) {
    const charges = chargesForMonth(dataset, monthId);
    const monthFigures = new Map<PostId, PostMonthFigures>();

    for (const post of dataset.posts) {
      const carriedIn = carried.get(post.id) ?? 0;
      const allocation = allocationFor(dataset, post.id, monthId);
      const spent = charges.get(post.id) ?? 0;
      const remaining = roundMoney(carriedIn + allocation - spent, baseCurrency);

      monthFigures.set(post.id, {
        carriedIn,
        allocation,
        charges: spent,
        remaining,
      });
      carried.set(post.id, remaining);
    }

    fold.set(monthId, monthFigures);
  }

  return fold;
}

export function figuresFor(
  fold: Fold,
  postId: PostId,
  monthId: MonthId,
): PostMonthFigures {
  return fold.get(monthId)?.get(postId) ?? EMPTY_FIGURES;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/fold.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/fold.ts src/domain/fold.test.ts
git commit -m "feat(domain): add the envelope rollover fold

Unspent carries forward, overspend carries as debt. This is the single
implementation of the rollover math."
```

---

### Task 9: View models

**Files:**
- Create: `src/domain/views.ts`
- Test: `src/domain/views.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `MonthId`, `Post` from `./types.ts`; `foldBalances`, `figuresFor`, `EMPTY_FIGURES`, `PostMonthFigures`, `Fold` from `./fold.ts`; `incomeFor`, `isOverridden` from `./allocation.ts`; `monthsOfYear`, `monthRange` from `./months.ts`; `roundMoney` from `./money.ts`.
- Produces:
  - `interface MonthPostRow { post: Post; figures: PostMonthFigures; overridden: boolean }`
  - `interface MonthViewModel { monthId; income; totalAllocation; totalCharges; unallocated; rows: MonthPostRow[] }`
  - `interface YearPostRow { post: Post; byMonth: PostMonthFigures[]; totalAllocation; totalCharges; closingBalance }`
  - `interface YearViewModel { year; months: MonthId[]; incomeByMonth: number[]; totalIncome; totalCharges; rows: YearPostRow[] }`
  - `interface SummaryViewModel { from; to; byPost; byMonth; totalCharges; totalIncome }`
  - `monthView(dataset, monthId): MonthViewModel`
  - `yearView(dataset, year): YearViewModel`
  - `summaryView(dataset, from, to): SummaryViewModel`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/views.test.ts
import { test, expect, describe } from "bun:test";
import { monthView, yearView, summaryView } from "./views.ts";
import type { Dataset, Post, Purchase } from "./types.ts";

function post(id: string, order: number, percent: number, archived = false): Post {
  return {
    id,
    name: id,
    order,
    archived,
    currency: "DKK",
    standingRule: { kind: "percentOfIncome", percent },
  };
}

function spend(id: string, postId: string, amount: number, date: string): Purchase {
  return {
    id,
    date,
    description: id,
    total: { amount, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    schedule: null,
  };
}

const data: Dataset = {
  settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
  fxRates: [],
  posts: [post("food", 0, 20), post("games", 1, 10)],
  months: [
    { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
    {
      id: "2026-02",
      income: { amount: 10000, currency: "DKK" },
      ruleOverrides: { games: { kind: "fixed", amount: { amount: 2000, currency: "DKK" } } },
    },
  ],
  purchases: [spend("a", "food", 500, "2026-01-10"), spend("b", "games", 300, "2026-02-10")],
};

describe("monthView", () => {
  test("reports income, allocations, and the unallocated remainder", () => {
    const view = monthView(data, "2026-01");
    expect(view.income).toBe(10000);
    expect(view.totalAllocation).toBe(3000);
    expect(view.totalCharges).toBe(500);
    expect(view.unallocated).toBe(7000);
  });

  test("rows are ordered by post order and carry their figures", () => {
    const view = monthView(data, "2026-01");
    expect(view.rows.map((r) => r.post.id)).toEqual(["food", "games"]);
    expect(view.rows[0]!.figures.charges).toBe(500);
    expect(view.rows[0]!.figures.remaining).toBe(1500);
  });

  test("flags rows whose rule is overridden this month", () => {
    const view = monthView(data, "2026-02");
    expect(view.rows.find((r) => r.post.id === "games")!.overridden).toBe(true);
    expect(view.rows.find((r) => r.post.id === "food")!.overridden).toBe(false);
  });

  test("unallocated goes negative when percentages exceed income", () => {
    const greedy: Dataset = { ...data, posts: [post("food", 0, 80), post("games", 1, 40)] };
    expect(monthView(greedy, "2026-01").unallocated).toBe(-2000);
  });

  test("archived posts appear only when they have activity", () => {
    const withArchived: Dataset = {
      ...data,
      posts: [...data.posts, post("old", 2, 0, true)],
    };
    expect(monthView(withArchived, "2026-01").rows.map((r) => r.post.id)).toEqual([
      "food",
      "games",
    ]);

    const withActivity: Dataset = {
      ...withArchived,
      purchases: [...data.purchases, spend("c", "old", 50, "2026-01-11")],
    };
    expect(monthView(withActivity, "2026-01").rows.map((r) => r.post.id)).toEqual([
      "food",
      "games",
      "old",
    ]);
  });
});

describe("yearView", () => {
  test("returns twelve months with per-post totals and a closing balance", () => {
    const view = yearView(data, 2026);
    expect(view.months).toHaveLength(12);
    expect(view.incomeByMonth[0]).toBe(10000);
    expect(view.incomeByMonth[2]).toBe(0);
    expect(view.totalIncome).toBe(20000);

    const food = view.rows.find((r) => r.post.id === "food")!;
    expect(food.byMonth).toHaveLength(12);
    expect(food.totalCharges).toBe(500);
    expect(food.totalAllocation).toBe(4000);
    expect(food.closingBalance).toBe(3500);
  });

  test("the closing balance is December's remaining, carrying all year", () => {
    const games = yearView(data, 2026).rows.find((r) => r.post.id === "games")!;
    expect(games.totalAllocation).toBe(3000);
    expect(games.closingBalance).toBe(2700);
  });
});

describe("summaryView", () => {
  test("totals charges by post and by month across a range", () => {
    const view = summaryView(data, "2026-01", "2026-02");
    expect(view.totalCharges).toBe(800);
    expect(view.totalIncome).toBe(20000);
    expect(view.byPost.find((r) => r.post.id === "food")!.charges).toBe(500);
    expect(view.byMonth).toHaveLength(2);
    expect(view.byMonth[1]!.charges).toBe(300);
  });

  test("an empty range totals zero", () => {
    const view = summaryView(data, "2026-05", "2026-04");
    expect(view.totalCharges).toBe(0);
    expect(view.byMonth).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/views.test.ts`
Expected: FAIL — cannot resolve `./views.ts`.

- [ ] **Step 3: Implement**

```ts
// src/domain/views.ts
import { incomeFor, isOverridden } from "./allocation.ts";
import { figuresFor, foldBalances, type Fold, type PostMonthFigures } from "./fold.ts";
import { roundMoney } from "./money.ts";
import { monthRange, monthsOfYear } from "./months.ts";
import type { Dataset, MonthId, Post } from "./types.ts";

export interface MonthPostRow {
  post: Post;
  figures: PostMonthFigures;
  overridden: boolean;
}

export interface MonthViewModel {
  monthId: MonthId;
  income: number;
  totalAllocation: number;
  totalCharges: number;
  /** income - totalAllocation. Negative when allocations exceed income. */
  unallocated: number;
  rows: MonthPostRow[];
}

function hasActivity(figures: PostMonthFigures): boolean {
  return (
    figures.carriedIn !== 0 || figures.allocation !== 0 || figures.charges !== 0
  );
}

function visiblePosts(dataset: Dataset): Post[] {
  return [...dataset.posts].sort((a, b) => a.order - b.order);
}

export function monthView(dataset: Dataset, monthId: MonthId): MonthViewModel {
  const fold = foldBalances(dataset, monthId);
  const month = dataset.months.find((m) => m.id === monthId);
  const income = incomeFor(dataset, monthId);

  const rows: MonthPostRow[] = [];
  for (const post of visiblePosts(dataset)) {
    const figures = figuresFor(fold, post.id, monthId);
    // Archived posts stay visible only while they still have activity.
    if (post.archived && !hasActivity(figures)) continue;
    rows.push({ post, figures, overridden: isOverridden(month, post.id) });
  }

  const base = dataset.settings.baseCurrency;
  const totalAllocation = roundMoney(
    rows.reduce((sum, r) => sum + r.figures.allocation, 0),
    base,
  );
  const totalCharges = roundMoney(
    rows.reduce((sum, r) => sum + r.figures.charges, 0),
    base,
  );

  return {
    monthId,
    income,
    totalAllocation,
    totalCharges,
    unallocated: roundMoney(income - totalAllocation, base),
    rows,
  };
}

export interface YearPostRow {
  post: Post;
  /** Twelve entries, January to December. */
  byMonth: PostMonthFigures[];
  totalAllocation: number;
  totalCharges: number;
  /** December's remaining balance. */
  closingBalance: number;
}

export interface YearViewModel {
  year: number;
  months: MonthId[];
  incomeByMonth: number[];
  totalIncome: number;
  totalCharges: number;
  rows: YearPostRow[];
}

export function yearView(dataset: Dataset, year: number): YearViewModel {
  const months = monthsOfYear(year);
  const fold = foldBalances(dataset, months[11]!);
  const base = dataset.settings.baseCurrency;

  const incomeByMonth = months.map((m) => incomeFor(dataset, m));

  const rows: YearPostRow[] = visiblePosts(dataset).map((post) => {
    const byMonth = months.map((m) => figuresFor(fold, post.id, m));
    return {
      post,
      byMonth,
      totalAllocation: roundMoney(
        byMonth.reduce((sum, f) => sum + f.allocation, 0),
        base,
      ),
      totalCharges: roundMoney(
        byMonth.reduce((sum, f) => sum + f.charges, 0),
        base,
      ),
      closingBalance: byMonth[11]!.remaining,
    };
  });

  return {
    year,
    months,
    incomeByMonth,
    totalIncome: roundMoney(
      incomeByMonth.reduce((a, b) => a + b, 0),
      base,
    ),
    totalCharges: roundMoney(
      rows.reduce((sum, r) => sum + r.totalCharges, 0),
      base,
    ),
    rows,
  };
}

export interface SummaryViewModel {
  from: MonthId;
  to: MonthId;
  byPost: { post: Post; charges: number }[];
  byMonth: { monthId: MonthId; charges: number }[];
  totalCharges: number;
  totalIncome: number;
}

export function summaryView(
  dataset: Dataset,
  from: MonthId,
  to: MonthId,
): SummaryViewModel {
  const months = monthRange(from, to);
  const base = dataset.settings.baseCurrency;
  const fold: Fold =
    months.length > 0 ? foldBalances(dataset, months[months.length - 1]!) : new Map();

  const byPost = visiblePosts(dataset).map((post) => ({
    post,
    charges: roundMoney(
      months.reduce((sum, m) => sum + figuresFor(fold, post.id, m).charges, 0),
      base,
    ),
  }));

  const byMonth = months.map((monthId) => ({
    monthId,
    charges: roundMoney(
      dataset.posts.reduce(
        (sum, p) => sum + figuresFor(fold, p.id, monthId).charges,
        0,
      ),
      base,
    ),
  }));

  return {
    from,
    to,
    byPost,
    byMonth,
    totalCharges: roundMoney(
      byMonth.reduce((sum, m) => sum + m.charges, 0),
      base,
    ),
    totalIncome: roundMoney(
      months.reduce((sum, m) => sum + incomeFor(dataset, m), 0),
      base,
    ),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/views.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole domain suite**

Run: `bun test`
Expected: PASS, all tests. The domain core is complete.

- [ ] **Step 6: Commit**

```bash
git add src/domain/views.ts src/domain/views.test.ts
git commit -m "feat(domain): add month, year, and summary view models

All three aggregate over foldBalances rather than recomputing rollover."
```

---

### Task 10: Seed dataset

**Files:**
- Create: `src/domain/seed.ts`
- Modify: `src/domain/index.ts` (export the whole domain surface)
- Test: `src/domain/seed.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `MonthId`, `Post` from `./types.ts`.
- Produces: `SCHEMA_VERSION: number`, `createSeedDataset(startMonth: MonthId): Dataset`, `newId(): string`.

Note the signature: `createSeedDataset` takes the month as an argument rather
than reading the clock, because the domain layer must stay pure. Callers in the
UI pass the current month in.

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/seed.test.ts
import { test, expect } from "bun:test";
import { createSeedDataset, SCHEMA_VERSION, newId } from "./seed.ts";
import { monthView } from "./views.ts";

test("seeds exactly the three named posts, in order", () => {
  const data = createSeedDataset("2026-09");
  expect(data.posts.map((p) => p.name)).toEqual([
    "Video Games",
    "Food",
    "Events and Social",
  ]);
  expect(data.posts.map((p) => p.order)).toEqual([0, 1, 2]);
});

test("seeded posts are active with a zero fixed standing rule", () => {
  const data = createSeedDataset("2026-09");
  for (const post of data.posts) {
    expect(post.archived).toBe(false);
    expect(post.standingRule).toEqual({
      kind: "fixed",
      amount: { amount: 0, currency: "DKK" },
    });
  }
});

test("the fold starts at the given month and DKK is the base currency", () => {
  const data = createSeedDataset("2026-09");
  expect(data.settings.foldStartMonth).toBe("2026-09");
  expect(data.settings.baseCurrency).toBe("DKK");
  expect(data.settings.schemaVersion).toBe(SCHEMA_VERSION);
});

test("seeds a month record with zero income and no purchases", () => {
  const data = createSeedDataset("2026-09");
  expect(data.months.map((m) => m.id)).toEqual(["2026-09"]);
  expect(data.purchases).toEqual([]);
});

test("the seed dataset renders a valid month view", () => {
  const view = monthView(createSeedDataset("2026-09"), "2026-09");
  expect(view.rows).toHaveLength(3);
  expect(view.income).toBe(0);
  expect(view.unallocated).toBe(0);
});

test("newId returns distinct ids", () => {
  expect(newId()).not.toBe(newId());
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/seed.test.ts`
Expected: FAIL — cannot resolve `./seed.ts`.

- [ ] **Step 3: Implement**

```ts
// src/domain/seed.ts
import type { Dataset, MonthId, Post } from "./types.ts";

export const SCHEMA_VERSION = 1;

const SEED_POST_NAMES = ["Video Games", "Food", "Events and Social"] as const;

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * The first-run dataset. Takes the start month as an argument because the
 * domain layer must not read the ambient clock.
 */
export function createSeedDataset(startMonth: MonthId): Dataset {
  const posts: Post[] = SEED_POST_NAMES.map((name, order) => ({
    id: newId(),
    name,
    order,
    archived: false,
    currency: "DKK",
    standingRule: { kind: "fixed", amount: { amount: 0, currency: "DKK" } },
  }));

  return {
    settings: {
      baseCurrency: "DKK",
      foldStartMonth: startMonth,
      schemaVersion: SCHEMA_VERSION,
    },
    fxRates: [],
    posts,
    months: [
      { id: startMonth, income: { amount: 0, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases: [],
  };
}
```

- [ ] **Step 4: Replace the domain barrel**

```ts
// src/domain/index.ts
export const DOMAIN_READY = true;

export * from "./types.ts";
export * from "./money.ts";
export * from "./months.ts";
export * from "./fx.ts";
export * from "./allocation.ts";
export * from "./charges.ts";
export * from "./fold.ts";
export * from "./views.ts";
export * from "./seed.ts";
```

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: PASS, all tests including the smoke test from Task 1.

- [ ] **Step 6: Commit**

```bash
git add src/domain/seed.ts src/domain/seed.test.ts src/domain/index.ts
git commit -m "feat(domain): add seed dataset and domain barrel"
```

---

## Phase 2 — Persistence

### Task 11: IndexedDB store and migrations

The dataset is written as **one record in one object store**, not a store per
entity. Reads load everything anyway, and a single record makes every write
atomic — there is no way to persist posts without their purchases and corrupt
the fold.

**Files:**
- Create: `src/store/db.ts`, `src/store/migrations.ts`
- Test: `src/store/migrations.test.ts`

**Interfaces:**
- Consumes: `Dataset` from `../domain/types.ts`; `SCHEMA_VERSION` from `../domain/seed.ts`.
- Produces:
  - `DB_NAME`, `STORE_NAME`, `RECORD_KEY` constants
  - `openDb(): Promise<IDBDatabase>`
  - `readDataset(): Promise<Dataset | null>`
  - `writeDataset(dataset: Dataset): Promise<void>`
  - `migrate(raw: unknown): Dataset` (from `migrations.ts`)
  - `UnsupportedSchemaError`

- [ ] **Step 1: Write the failing tests for migrations**

Migrations are pure, so they are tested with no browser. `db.ts` itself is
exercised in the browser by Task 12's manual verification.

```ts
// src/store/migrations.test.ts
import { test, expect, describe } from "bun:test";
import { migrate, UnsupportedSchemaError } from "./migrations.ts";
import { createSeedDataset, SCHEMA_VERSION } from "../domain/seed.ts";

describe("migrate", () => {
  test("passes a current-version dataset through unchanged", () => {
    const data = createSeedDataset("2026-09");
    expect(migrate(data)).toEqual(data);
  });

  test("rejects a version newer than this build understands", () => {
    const future = { ...createSeedDataset("2026-09"), settings: { baseCurrency: "DKK", foldStartMonth: "2026-09", schemaVersion: SCHEMA_VERSION + 1 } };
    expect(() => migrate(future)).toThrow(UnsupportedSchemaError);
  });

  test("rejects a value that is not an object", () => {
    expect(() => migrate("nope")).toThrow(/not a dataset/i);
    expect(() => migrate(null)).toThrow(/not a dataset/i);
  });

  test("rejects a dataset with no schemaVersion", () => {
    expect(() => migrate({ posts: [] })).toThrow(/schemaVersion/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/store/migrations.test.ts`
Expected: FAIL — cannot resolve `./migrations.ts`.

- [ ] **Step 3: Implement migrations**

```ts
// src/store/migrations.ts
import { SCHEMA_VERSION } from "../domain/seed.ts";
import type { Dataset } from "../domain/types.ts";

export class UnsupportedSchemaError extends Error {
  constructor(public readonly found: number) {
    super(
      `Data was written by a newer version of the app (schema ${found}, this build understands ${SCHEMA_VERSION}). Update the app before opening it.`,
    );
    this.name = "UnsupportedSchemaError";
  }
}

/**
 * Ordered migration steps. Each entry upgrades from its index version to the
 * next. Add one whenever SCHEMA_VERSION increases; never edit an existing one,
 * because users' stored data has already been through it.
 */
const MIGRATIONS: Array<(data: any) => any> = [
  // index 0: there is no version 0 in the wild yet.
];

export function migrate(raw: unknown): Dataset {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Stored value is not a dataset");
  }
  const data = raw as Record<string, any>;
  const version = data.settings?.schemaVersion;
  if (typeof version !== "number") {
    throw new Error("Stored dataset has no settings.schemaVersion");
  }
  if (version > SCHEMA_VERSION) throw new UnsupportedSchemaError(version);

  let current = data;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema ${v} to ${v + 1}`);
    current = step(current);
  }
  return current as Dataset;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/store/migrations.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement the IndexedDB wrapper**

```ts
// src/store/db.ts
import type { Dataset } from "../domain/types.ts";
import { migrate } from "./migrations.ts";

export const DB_NAME = "budget2";
export const STORE_NAME = "state";
export const RECORD_KEY = "dataset";

/** IndexedDB's own version. Bumped only when the object stores change. */
const IDB_VERSION = 1;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, IDB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export async function readDataset(): Promise<Dataset | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const raw = await request(tx.objectStore(STORE_NAME).get(RECORD_KEY));
    return raw === undefined ? null : migrate(raw);
  } finally {
    db.close();
  }
}

/** Writes the whole dataset in one transaction, so a write can never tear. */
export async function writeDataset(dataset: Dataset): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    await request(tx.objectStore(STORE_NAME).put(dataset, RECORD_KEY));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/store/db.ts src/store/migrations.ts src/store/migrations.test.ts
git commit -m "feat(store): add IndexedDB persistence and schema migrations

The dataset is one atomic record, so a write can never leave posts and
purchases inconsistent."
```

---

### Task 12: In-memory snapshot with write-through

**Files:**
- Create: `src/store/snapshot.ts`, `src/store/index.ts`
- Test: `src/store/snapshot.test.ts`

**Interfaces:**
- Consumes: `Dataset` from `../domain/types.ts`; `readDataset`, `writeDataset` from `./db.ts`; `createSeedDataset` from `../domain/seed.ts`.
- Produces:
  - `interface Persistence { read(): Promise<Dataset | null>; write(d: Dataset): Promise<void> }`
  - `createSnapshotStore(persistence: Persistence, currentMonth: MonthId): SnapshotStore`
  - `SnapshotStore` with `load()`, `get()`, `mutate(fn)`, `replace(dataset)`, `subscribe(listener)`
  - `store` — the app-wide instance, wired to `db.ts` (from `./index.ts`)

The store takes its persistence as an argument, which is what lets it be tested
with an in-memory fake and no browser.

- [ ] **Step 1: Write the failing tests**

```ts
// src/store/snapshot.test.ts
import { test, expect, describe } from "bun:test";
import { createSnapshotStore, type Persistence } from "./snapshot.ts";
import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset } from "../domain/types.ts";

function fakePersistence(initial: Dataset | null = null) {
  const writes: Dataset[] = [];
  let stored = initial;
  const persistence: Persistence = {
    async read() {
      return stored;
    },
    async write(dataset) {
      stored = dataset;
      writes.push(dataset);
    },
  };
  return { persistence, writes, get stored() { return stored; } };
}

describe("load", () => {
  test("seeds and persists on first run", async () => {
    const fake = fakePersistence(null);
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    expect(store.get().posts).toHaveLength(3);
    expect(fake.writes).toHaveLength(1);
    expect(fake.stored!.settings.foldStartMonth).toBe("2026-09");
  });

  test("uses stored data when it exists and does not rewrite it", async () => {
    const existing = createSeedDataset("2025-01");
    const fake = fakePersistence(existing);
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    expect(store.get().settings.foldStartMonth).toBe("2025-01");
    expect(fake.writes).toHaveLength(0);
  });
});

describe("mutate", () => {
  test("applies the change, writes through, and notifies subscribers", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();

    let notifications = 0;
    store.subscribe(() => notifications++);

    await store.mutate((draft) => {
      draft.months[0]!.income = { amount: 20000, currency: "DKK" };
    });

    expect(store.get().months[0]!.income.amount).toBe(20000);
    expect(fake.stored!.months[0]!.income.amount).toBe(20000);
    expect(notifications).toBe(1);
  });

  test("does not mutate the previous snapshot object", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    const before = store.get();

    await store.mutate((draft) => {
      draft.posts[0]!.name = "Renamed";
    });

    expect(before.posts[0]!.name).toBe("Video Games");
    expect(store.get().posts[0]!.name).toBe("Renamed");
  });

  test("leaves the snapshot untouched when the write fails", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    const store = createSnapshotStore(
      { read: fake.persistence.read, write: async () => { throw new Error("disk full"); } },
      "2026-09",
    );
    await store.load();

    await expect(
      store.mutate((draft) => { draft.posts[0]!.name = "Renamed"; }),
    ).rejects.toThrow("disk full");
    expect(store.get().posts[0]!.name).toBe("Video Games");
  });
});

test("replace swaps the whole dataset, as JSON import needs", async () => {
  const fake = fakePersistence(createSeedDataset("2026-09"));
  const store = createSnapshotStore(fake.persistence, "2026-09");
  await store.load();

  const incoming = createSeedDataset("2020-01");
  await store.replace(incoming);
  expect(store.get().settings.foldStartMonth).toBe("2020-01");
  expect(fake.stored!.settings.foldStartMonth).toBe("2020-01");
});

test("unsubscribe stops notifications", async () => {
  const fake = fakePersistence(createSeedDataset("2026-09"));
  const store = createSnapshotStore(fake.persistence, "2026-09");
  await store.load();

  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  unsubscribe();
  await store.mutate((draft) => { draft.posts[0]!.name = "X"; });
  expect(notifications).toBe(0);
});

test("get before load throws rather than returning empty data", () => {
  const fake = fakePersistence(null);
  const store = createSnapshotStore(fake.persistence, "2026-09");
  expect(() => store.get()).toThrow(/not loaded/i);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/store/snapshot.test.ts`
Expected: FAIL — cannot resolve `./snapshot.ts`.

- [ ] **Step 3: Implement**

```ts
// src/store/snapshot.ts
import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset, MonthId } from "../domain/types.ts";

export interface Persistence {
  read(): Promise<Dataset | null>;
  write(dataset: Dataset): Promise<void>;
}

export type Listener = () => void;

export interface SnapshotStore {
  load(): Promise<void>;
  get(): Dataset;
  mutate(fn: (draft: Dataset) => void): Promise<void>;
  replace(dataset: Dataset): Promise<void>;
  subscribe(listener: Listener): () => void;
}

export function createSnapshotStore(
  persistence: Persistence,
  currentMonth: MonthId,
): SnapshotStore {
  let snapshot: Dataset | null = null;
  const listeners = new Set<Listener>();

  function notify() {
    for (const listener of listeners) listener();
  }

  function get(): Dataset {
    if (!snapshot) throw new Error("Snapshot store is not loaded yet");
    return snapshot;
  }

  async function commit(next: Dataset) {
    // Write first: if persistence fails, the in-memory snapshot must not have
    // moved, or the UI would show data that was never saved.
    await persistence.write(next);
    snapshot = next;
    notify();
  }

  return {
    async load() {
      const stored = await persistence.read();
      if (stored) {
        snapshot = stored;
        notify();
        return;
      }
      await commit(createSeedDataset(currentMonth));
    },

    get,

    async mutate(fn) {
      const draft = structuredClone(get());
      fn(draft);
      await commit(draft);
    },

    async replace(dataset) {
      await commit(dataset);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

```ts
// src/store/index.ts
import { monthOf } from "../domain/months.ts";
import { readDataset, writeDataset } from "./db.ts";
import { createSnapshotStore } from "./snapshot.ts";

/** The current month, read at module load. The UI owns the clock; the domain does not. */
export const currentMonth = monthOf(new Date().toISOString().slice(0, 10));

export const store = createSnapshotStore(
  { read: readDataset, write: writeDataset },
  currentMonth,
);

export * from "./snapshot.ts";
export { UnsupportedSchemaError } from "./migrations.ts";
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/store/snapshot.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/snapshot.ts src/store/index.ts src/store/snapshot.test.ts
git commit -m "feat(store): add in-memory snapshot with write-through

Persistence is injected, so the store is testable with no browser. Writes
land before the snapshot moves, so the UI never shows unsaved data."
```

---

## Phase 3 — Export and import

### Task 13: JSON export and import

**Files:**
- Create: `src/export/json.ts`
- Test: `src/export/json.test.ts`

**Interfaces:**
- Consumes: `Dataset` from `../domain/types.ts`; `migrate` from `../store/migrations.ts`; `remainderIndexOf` from `../domain/charges.ts`.
- Produces:
  - `exportDatasetJson(dataset: Dataset): string`
  - `parseDatasetJson(text: string): Dataset`
  - `describeDataset(dataset: Dataset): { posts: number; months: number; purchases: number }`
  - `ImportValidationError`
  - `exportFilename(monthId: MonthId): string`

- [ ] **Step 1: Write the failing tests**

```ts
// src/export/json.test.ts
import { test, expect, describe } from "bun:test";
import {
  exportDatasetJson,
  parseDatasetJson,
  describeDataset,
  ImportValidationError,
  exportFilename,
} from "./json.ts";
import { createSeedDataset } from "../domain/seed.ts";
import { monthView, yearView } from "../domain/views.ts";
import type { Dataset } from "../domain/types.ts";

function populated(): Dataset {
  const data = createSeedDataset("2026-01");
  data.months[0]!.income = { amount: 20000, currency: "DKK" };
  data.purchases.push({
    id: "p1",
    date: "2026-01-15",
    description: "Console",
    total: { amount: 3000, currency: "DKK" },
    splitMode: "percent",
    splits: [
      { postId: data.posts[0]!.id, value: 70, absorbsRemainder: true },
      { postId: data.posts[2]!.id, value: 30, absorbsRemainder: false },
    ],
    schedule: {
      slices: [
        { month: "2026-01", amount: { amount: 1000, currency: "DKK" } },
        { month: "2026-02", amount: { amount: 2000, currency: "DKK" } },
      ],
    },
  });
  return data;
}

describe("round trip", () => {
  test("export then import yields an equal dataset", () => {
    const data = populated();
    expect(parseDatasetJson(exportDatasetJson(data))).toEqual(data);
  });

  test("derived output is identical after a round trip", () => {
    const data = populated();
    const restored = parseDatasetJson(exportDatasetJson(data));
    expect(monthView(restored, "2026-01")).toEqual(monthView(data, "2026-01"));
    expect(yearView(restored, 2026)).toEqual(yearView(data, 2026));
  });

  test("export is human-readable, indented JSON", () => {
    expect(exportDatasetJson(createSeedDataset("2026-01"))).toContain("\n  ");
  });
});

describe("validation", () => {
  test("rejects malformed JSON", () => {
    expect(() => parseDatasetJson("{not json")).toThrow(ImportValidationError);
  });

  test("rejects a dataset missing a required collection", () => {
    const data = populated() as any;
    delete data.purchases;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/purchases/);
  });

  test("rejects a purchase whose splits reference an unknown post", () => {
    const data = populated();
    data.purchases[0]!.splits[0]!.postId = "ghost";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/ghost/);
  });

  test("rejects a purchase with no remainder-absorbing split", () => {
    const data = populated();
    data.purchases[0]!.splits[0]!.absorbsRemainder = false;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/absorbsRemainder/);
  });

  test("rejects a purchase with two remainder-absorbing splits", () => {
    const data = populated();
    data.purchases[0]!.splits[1]!.absorbsRemainder = true;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/exactly one/i);
  });

  test("rejects a purchase with no splits", () => {
    const data = populated();
    data.purchases[0]!.splits = [];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/at least one split/i);
  });

  test("rejects an unsupported currency", () => {
    const data = populated() as any;
    data.settings.baseCurrency = "GBP";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/GBP/);
  });

  test("rejects a malformed MonthId", () => {
    const data = populated();
    data.months[0]!.id = "2026-1";
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-1/);
  });
});

test("describeDataset counts what an import would replace", () => {
  expect(describeDataset(populated())).toEqual({
    posts: 3,
    months: 1,
    purchases: 1,
  });
});

test("exportFilename is stable and sortable", () => {
  expect(exportFilename("2026-09")).toBe("budget-2026-09.json");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/export/json.test.ts`
Expected: FAIL — cannot resolve `./json.ts`.

- [ ] **Step 3: Implement**

```ts
// src/export/json.ts
import { CURRENCIES, type Currency, type Dataset, type MonthId } from "../domain/types.ts";
import { migrate } from "../store/migrations.ts";

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export function exportDatasetJson(dataset: Dataset): string {
  return JSON.stringify(dataset, null, 2);
}

export function describeDataset(dataset: Dataset) {
  return {
    posts: dataset.posts.length,
    months: dataset.months.length,
    purchases: dataset.purchases.length,
  };
}

export function exportFilename(monthId: MonthId): string {
  return `budget-${monthId}.json`;
}

const MONTH_ID = /^\d{4}-\d{2}$/;

function requireCurrency(value: unknown, where: string): Currency {
  if (!CURRENCIES.includes(value as Currency)) {
    throw new ImportValidationError(`Unsupported currency ${String(value)} in ${where}`);
  }
  return value as Currency;
}

function requireArray(data: Record<string, unknown>, key: string): unknown[] {
  const value = data[key];
  if (!Array.isArray(value)) {
    throw new ImportValidationError(`Dataset field "${key}" is missing or not an array`);
  }
  return value;
}

/**
 * Validates far enough that the fold cannot throw on the imported data: every
 * split points at a real post, every purchase has exactly one remainder
 * absorber, and every MonthId parses.
 */
export function parseDatasetJson(text: string): Dataset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ImportValidationError(
      `File is not valid JSON: ${(error as Error).message}`,
    );
  }

  let dataset: Dataset;
  try {
    dataset = migrate(raw);
  } catch (error) {
    throw new ImportValidationError((error as Error).message);
  }

  const data = dataset as unknown as Record<string, unknown>;
  requireArray(data, "posts");
  requireArray(data, "months");
  requireArray(data, "purchases");
  requireArray(data, "fxRates");

  requireCurrency(dataset.settings.baseCurrency, "settings.baseCurrency");
  if (!MONTH_ID.test(dataset.settings.foldStartMonth)) {
    throw new ImportValidationError(
      `Invalid foldStartMonth "${dataset.settings.foldStartMonth}"`,
    );
  }

  const postIds = new Set(dataset.posts.map((p) => p.id));
  for (const post of dataset.posts) {
    requireCurrency(post.currency, `post "${post.name}"`);
  }

  for (const month of dataset.months) {
    if (!MONTH_ID.test(month.id)) {
      throw new ImportValidationError(`Invalid month id "${month.id}"`);
    }
    requireCurrency(month.income.currency, `month ${month.id} income`);
  }

  for (const purchase of dataset.purchases) {
    const label = `purchase "${purchase.description}"`;
    requireCurrency(purchase.total.currency, label);

    if (purchase.splits.length === 0) {
      throw new ImportValidationError(`${label} has no splits; at least one split is required`);
    }
    const absorbers = purchase.splits.filter((s) => s.absorbsRemainder).length;
    if (absorbers !== 1) {
      throw new ImportValidationError(
        `${label} has ${absorbers} splits flagged absorbsRemainder; exactly one is required`,
      );
    }
    for (const split of purchase.splits) {
      if (!postIds.has(split.postId)) {
        throw new ImportValidationError(
          `${label} references unknown post "${split.postId}"`,
        );
      }
    }
    for (const slice of purchase.schedule?.slices ?? []) {
      if (!MONTH_ID.test(slice.month)) {
        throw new ImportValidationError(`${label} has invalid slice month "${slice.month}"`);
      }
      requireCurrency(slice.amount.currency, `${label} slice ${slice.month}`);
    }
  }

  return dataset;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/export/json.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/json.ts src/export/json.test.ts
git commit -m "feat(export): add JSON export and validated import

Import validates far enough that the fold cannot throw on imported data."
```

---

### Task 14: ODS XML documents

An ODS file is a zip containing four XML documents. This task builds the XML;
Task 15 packages it. Splitting them keeps the fiddly XML testable as strings.

**Files:**
- Create: `src/export/odsXml.ts`
- Test: `src/export/odsXml.test.ts`

**Interfaces:**
- Consumes: nothing outside itself.
- Produces:
  - `type Cell = { kind: "text"; value: string } | { kind: "number"; value: number } | { kind: "empty" }`
  - `text(value: string): Cell`, `num(value: number): Cell`, `empty(): Cell`
  - `interface Sheet { name: string; rows: Cell[][] }`
  - `escapeXml(value: string): string`
  - `buildContentXml(sheets: Sheet[]): string`
  - `buildStylesXml(): string`
  - `buildManifestXml(): string`
  - `ODS_MIMETYPE: string`

- [ ] **Step 1: Write the failing tests**

```ts
// src/export/odsXml.test.ts
import { test, expect, describe } from "bun:test";
import {
  buildContentXml,
  buildManifestXml,
  buildStylesXml,
  escapeXml,
  text,
  num,
  empty,
  ODS_MIMETYPE,
} from "./odsXml.ts";

test("the ODS mimetype is the spreadsheet one", () => {
  expect(ODS_MIMETYPE).toBe("application/vnd.oasis.opendocument.spreadsheet");
});

describe("escapeXml", () => {
  test("escapes the five XML entities", () => {
    expect(escapeXml(`<a & b> "c" 'd'`)).toBe(
      "&lt;a &amp; b&gt; &quot;c&quot; &apos;d&apos;",
    );
  });

  test("leaves ordinary text alone", () => {
    expect(escapeXml("Events and Social")).toBe("Events and Social");
  });
});

describe("buildContentXml", () => {
  const xml = buildContentXml([
    {
      name: "Summary",
      rows: [
        [text("Post"), text("Spent")],
        [text("Food"), num(1234.56)],
        [text("Empty"), empty()],
      ],
    },
  ]);

  test("declares the spreadsheet document namespaces", () => {
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("office:document-content");
    expect(xml).toContain("urn:oasis:names:tc:opendocument:xmlns:office:1.0");
  });

  test("names the table", () => {
    expect(xml).toContain('table:name="Summary"');
  });

  test("writes numbers as float cells with office:value, not text", () => {
    expect(xml).toContain('office:value-type="float" office:value="1234.56"');
    expect(xml).not.toContain("<text:p>1234.56</text:p>");
  });

  test("writes text cells as strings", () => {
    expect(xml).toContain('office:value-type="string"><text:p>Food</text:p>');
  });

  test("writes empty cells with no value type", () => {
    expect(xml).toContain("<table:table-cell/>");
  });

  test("escapes sheet names and cell text", () => {
    const nasty = buildContentXml([
      { name: 'Food & "drink"', rows: [[text("<script>")]] },
    ]);
    expect(nasty).toContain('table:name="Food &amp; &quot;drink&quot;"');
    expect(nasty).toContain("&lt;script&gt;");
  });

  test("emits one table per sheet", () => {
    const two = buildContentXml([
      { name: "A", rows: [[text("x")]] },
      { name: "B", rows: [[text("y")]] },
    ]);
    expect(two.match(/<table:table /g)).toHaveLength(2);
  });

  test("handles a sheet with no rows", () => {
    expect(buildContentXml([{ name: "Blank", rows: [] }])).toContain('table:name="Blank"');
  });
});

test("buildManifestXml lists all four parts", () => {
  const manifest = buildManifestXml();
  for (const path of ["/", "content.xml", "styles.xml"]) {
    expect(manifest).toContain(path);
  }
  expect(manifest).toContain(ODS_MIMETYPE);
});

test("buildStylesXml is a well-formed styles document", () => {
  expect(buildStylesXml()).toContain("office:document-styles");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/export/odsXml.test.ts`
Expected: FAIL — cannot resolve `./odsXml.ts`.

- [ ] **Step 3: Implement**

```ts
// src/export/odsXml.ts

export const ODS_MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet";

export type Cell =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "empty" };

export function text(value: string): Cell {
  return { kind: "text", value };
}

export function num(value: number): Cell {
  return { kind: "number", value };
}

export function empty(): Cell {
  return { kind: "empty" };
}

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderCell(cell: Cell): string {
  switch (cell.kind) {
    case "empty":
      return "<table:table-cell/>";
    case "number":
      // office:value is what makes spreadsheets treat this as a number, so the
      // export can be summed and pivoted rather than just read.
      return `<table:table-cell office:value-type="float" office:value="${cell.value}"><text:p>${cell.value}</text:p></table:table-cell>`;
    case "text":
      return `<table:table-cell office:value-type="string"><text:p>${escapeXml(cell.value)}</text:p></table:table-cell>`;
  }
}

function renderRow(row: Cell[]): string {
  return `<table:table-row>${row.map(renderCell).join("")}</table:table-row>`;
}

function renderSheet(sheet: Sheet): string {
  return `<table:table table:name="${escapeXml(sheet.name)}">${sheet.rows
    .map(renderRow)
    .join("")}</table:table>`;
}

const CONTENT_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'office:version="1.3"',
].join(" ");

export function buildContentXml(sheets: Sheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${CONTENT_NS}><office:body><office:spreadsheet>${sheets
    .map(renderSheet)
    .join("")}</office:spreadsheet></office:body></office:document-content>`;
}

export function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:styles/></office:document-styles>`;
}

export function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODS_MIMETYPE}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/export/odsXml.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/odsXml.ts src/export/odsXml.test.ts
git commit -m "feat(export): build ODS XML documents

Numeric cells carry office:value so the export can be summed and pivoted
in a spreadsheet rather than arriving as text."
```

---

### Task 15: ODS packaging

**Files:**
- Create: `src/export/ods.ts`
- Modify: `src/domain/views.ts` (add `datasetMonthSpan`), `src/domain/views.test.ts`, `package.json` (add `fflate`)
- Test: `src/export/ods.test.ts`

**Interfaces:**
- Consumes: `Sheet`, `text`, `num`, `buildContentXml`, `buildStylesXml`, `buildManifestXml`, `ODS_MIMETYPE` from `./odsXml.ts`; `yearView`, `summaryView`, `monthView`, `datasetMonthSpan` from `../domain/views.ts`; `chargesForPurchaseInMonth`, `sliceAmountForMonth` from `../domain/charges.ts`; `monthRange` from `../domain/months.ts`; `zipSync` from `fflate`.
- Produces:
  - `datasetMonthSpan(dataset): { from: MonthId; to: MonthId }` (in `views.ts`)
  - `buildWorkbook(dataset: Dataset): Sheet[]`
  - `buildOds(dataset: Dataset): Uint8Array`
  - `odsFilename(monthId: MonthId): string`

- [ ] **Step 1: Add the dependency**

```bash
bun add fflate
```

- [ ] **Step 2: Write the failing test for `datasetMonthSpan`**

Append to `src/domain/views.test.ts`:

```ts
import { datasetMonthSpan } from "./views.ts";

test("datasetMonthSpan covers foldStartMonth through the latest activity", () => {
  expect(datasetMonthSpan(data)).toEqual({ from: "2026-01", to: "2026-02" });
});

test("datasetMonthSpan includes future finance-plan slices", () => {
  const financed: Dataset = {
    ...data,
    purchases: [
      {
        id: "f1",
        date: "2026-01-05",
        description: "Console",
        total: { amount: 3000, currency: "DKK" },
        splitMode: "percent",
        splits: [{ postId: "games", value: 100, absorbsRemainder: true }],
        schedule: {
          slices: [
            { month: "2026-01", amount: { amount: 1500, currency: "DKK" } },
            { month: "2026-06", amount: { amount: 1500, currency: "DKK" } },
          ],
        },
      },
    ],
  };
  expect(datasetMonthSpan(financed)).toEqual({ from: "2026-01", to: "2026-06" });
});

test("datasetMonthSpan of an empty dataset is a single month", () => {
  const bare: Dataset = { ...data, months: [], purchases: [] };
  expect(datasetMonthSpan(bare)).toEqual({ from: "2026-01", to: "2026-01" });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `bun test src/domain/views.test.ts`
Expected: FAIL — `datasetMonthSpan` is not exported.

- [ ] **Step 4: Implement `datasetMonthSpan`**

Append to `src/domain/views.ts`:

```ts
import { compareMonths, monthOf } from "./months.ts";

/**
 * The months worth rendering: from the fold start to the latest month touched
 * by any month record or purchase slice, including future finance-plan slices.
 */
export function datasetMonthSpan(dataset: Dataset): { from: MonthId; to: MonthId } {
  const from = dataset.settings.foldStartMonth;
  let to = from;

  const consider = (candidate: MonthId) => {
    if (compareMonths(candidate, to) > 0) to = candidate;
  };

  for (const month of dataset.months) consider(month.id);
  for (const purchase of dataset.purchases) {
    if (purchase.schedule) {
      for (const slice of purchase.schedule.slices) consider(slice.month);
    } else {
      consider(monthOf(purchase.date));
    }
  }

  return { from, to };
}
```

Note: `monthRange` and `monthsOfYear` are already imported in this file; add
`compareMonths` and `monthOf` to that existing import rather than duplicating it.

- [ ] **Step 5: Run and confirm it passes**

Run: `bun test src/domain/views.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Write the failing tests for ODS packaging**

```ts
// src/export/ods.test.ts
import { test, expect, describe } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { buildOds, buildWorkbook, odsFilename } from "./ods.ts";
import { createSeedDataset } from "../domain/seed.ts";
import { ODS_MIMETYPE } from "./odsXml.ts";
import type { Dataset } from "../domain/types.ts";

function populated(): Dataset {
  const data = createSeedDataset("2026-01");
  data.months[0]!.income = { amount: 20000, currency: "DKK" };
  data.posts[1]!.standingRule = { kind: "percentOfIncome", percent: 25 };
  data.purchases.push({
    id: "p1",
    date: "2026-01-15",
    description: "Dinner & drinks",
    total: { amount: 400, currency: "DKK" },
    splitMode: "percent",
    splits: [
      { postId: data.posts[1]!.id, value: 60, absorbsRemainder: true },
      { postId: data.posts[2]!.id, value: 40, absorbsRemainder: false },
    ],
    schedule: null,
  });
  return data;
}

describe("buildWorkbook", () => {
  test("includes Summary, Months, Purchases, and one sheet per post", () => {
    const names = buildWorkbook(populated()).map((s) => s.name);
    expect(names.slice(0, 3)).toEqual(["Summary", "Months", "Purchases"]);
    expect(names).toContain("Video Games");
    expect(names).toContain("Food");
    expect(names).toContain("Events and Social");
    expect(names).toHaveLength(6);
  });

  test("the Purchases sheet has one row per split, plus a header", () => {
    const purchases = buildWorkbook(populated()).find((s) => s.name === "Purchases")!;
    expect(purchases.rows).toHaveLength(3);
    expect(purchases.rows[0]!.every((c) => c.kind === "text")).toBe(true);
  });

  test("split amounts on the Purchases sheet are numeric cells", () => {
    const purchases = buildWorkbook(populated()).find((s) => s.name === "Purchases")!;
    const numbers = purchases.rows
      .slice(1)
      .flatMap((row) => row.filter((cell) => cell.kind === "number"))
      .map((cell) => (cell as { value: number }).value);
    // 400 DKK split 60/40 across two posts.
    expect(numbers).toContain(240);
    expect(numbers).toContain(160);
  });
});

describe("buildOds", () => {
  const bytes = buildOds(populated());
  const entries = unzipSync(bytes);

  test("produces a non-empty byte array", () => {
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test("contains the four required parts", () => {
    expect(Object.keys(entries).sort()).toEqual([
      "META-INF/manifest.xml",
      "content.xml",
      "mimetype",
      "styles.xml",
    ]);
  });

  test("the mimetype entry holds the spreadsheet mimetype", () => {
    expect(strFromU8(entries["mimetype"]!)).toBe(ODS_MIMETYPE);
  });

  test("mimetype is the first entry and stored uncompressed", () => {
    // The ODS spec requires this so file(1) and spreadsheet apps can sniff the
    // type from the first bytes of the archive.
    const header = strFromU8(bytes.slice(0, 64));
    expect(header).toContain("mimetype");
    expect(header).toContain(ODS_MIMETYPE);
  });

  test("content.xml carries every sheet", () => {
    const content = strFromU8(entries["content.xml"]!);
    expect(content).toContain('table:name="Summary"');
    expect(content).toContain('table:name="Events and Social"');
  });

  test("escapes an ampersand in a purchase description", () => {
    const content = strFromU8(entries["content.xml"]!);
    expect(content).toContain("Dinner &amp; drinks");
  });

  test("exports a seed dataset with no purchases without throwing", () => {
    expect(() => buildOds(createSeedDataset("2026-01"))).not.toThrow();
  });
});

test("odsFilename is stable and sortable", () => {
  expect(odsFilename("2026-09")).toBe("budget-2026-09.ods");
});
```

- [ ] **Step 7: Run and confirm failure**

Run: `bun test src/export/ods.test.ts`
Expected: FAIL — cannot resolve `./ods.ts`.

- [ ] **Step 8: Implement**

```ts
// src/export/ods.ts
import { zipSync, strToU8 } from "fflate";
import { chargesForPurchaseInMonth, sliceAmountForMonth } from "../domain/charges.ts";
import { monthRange } from "../domain/months.ts";
import { datasetMonthSpan, monthView, summaryView } from "../domain/views.ts";
import type { Dataset, MonthId } from "../domain/types.ts";
import {
  buildContentXml,
  buildManifestXml,
  buildStylesXml,
  num,
  text,
  ODS_MIMETYPE,
  type Sheet,
} from "./odsXml.ts";

export function odsFilename(monthId: MonthId): string {
  return `budget-${monthId}.ods`;
}

function summarySheet(dataset: Dataset, months: MonthId[]): Sheet {
  const base = dataset.settings.baseCurrency;
  const rows = [
    [text(`Post (${base})`), ...months.map((m) => text(m)), text("Total")],
  ];

  for (const post of [...dataset.posts].sort((a, b) => a.order - b.order)) {
    const perMonth = months.map(
      (m) => monthView(dataset, m).rows.find((r) => r.post.id === post.id)?.figures.charges ?? 0,
    );
    rows.push([
      text(post.name),
      ...perMonth.map(num),
      num(Number(perMonth.reduce((a, b) => a + b, 0).toFixed(2))),
    ]);
  }

  const summary = summaryView(dataset, months[0]!, months[months.length - 1]!);
  rows.push([
    text("Total"),
    ...summary.byMonth.map((m) => num(m.charges)),
    num(summary.totalCharges),
  ]);
  return { name: "Summary", rows };
}

function monthsSheet(dataset: Dataset, months: MonthId[]): Sheet {
  const rows = [
    [text("Month"), text("Income"), text("Allocated"), text("Spent"), text("Unallocated")],
  ];
  for (const monthId of months) {
    const view = monthView(dataset, monthId);
    rows.push([
      text(monthId),
      num(view.income),
      num(view.totalAllocation),
      num(view.totalCharges),
      num(view.unallocated),
    ]);
  }
  return { name: "Months", rows };
}

/** One row per split-slice, so the sheet pivots cleanly. */
function purchasesSheet(dataset: Dataset, months: MonthId[]): Sheet {
  const base = dataset.settings.baseCurrency;
  const postName = new Map(dataset.posts.map((p) => [p.id, p.name]));
  const rows = [
    [
      text("Month"),
      text("Date"),
      text("Description"),
      text("Post"),
      text(`Amount (${base})`),
      text("Original amount"),
      text("Original currency"),
      text("Financed"),
    ],
  ];

  for (const monthId of months) {
    for (const purchase of dataset.purchases) {
      const slice = sliceAmountForMonth(purchase, monthId);
      if (!slice) continue;
      const charges = chargesForPurchaseInMonth(purchase, monthId, base, dataset.fxRates);
      for (const charge of charges) {
        rows.push([
          text(monthId),
          text(purchase.date),
          text(purchase.description),
          text(postName.get(charge.postId) ?? charge.postId),
          num(charge.amount),
          num(slice.amount),
          text(slice.currency),
          text(purchase.schedule ? "yes" : "no"),
        ]);
      }
    }
  }
  return { name: "Purchases", rows };
}

function postSheet(dataset: Dataset, postId: string, name: string, months: MonthId[]): Sheet {
  const rows = [
    [text("Month"), text("Carried in"), text("Allocated"), text("Spent"), text("Remaining")],
  ];
  for (const monthId of months) {
    const figures = monthView(dataset, monthId).rows.find((r) => r.post.id === postId)?.figures;
    rows.push([
      text(monthId),
      num(figures?.carriedIn ?? 0),
      num(figures?.allocation ?? 0),
      num(figures?.charges ?? 0),
      num(figures?.remaining ?? 0),
    ]);
  }
  return { name, rows };
}

export function buildWorkbook(dataset: Dataset): Sheet[] {
  const { from, to } = datasetMonthSpan(dataset);
  const months = monthRange(from, to);

  return [
    summarySheet(dataset, months),
    monthsSheet(dataset, months),
    purchasesSheet(dataset, months),
    ...[...dataset.posts]
      .sort((a, b) => a.order - b.order)
      .map((post) => postSheet(dataset, post.id, post.name, months)),
  ];
}

export function buildOds(dataset: Dataset): Uint8Array {
  // Insertion order matters: `mimetype` must be the first entry and stored
  // uncompressed (level 0) so the archive can be type-sniffed.
  return zipSync(
    {
      mimetype: [strToU8(ODS_MIMETYPE), { level: 0 }],
      "META-INF/manifest.xml": strToU8(buildManifestXml()),
      "content.xml": strToU8(buildContentXml(buildWorkbook(dataset))),
      "styles.xml": strToU8(buildStylesXml()),
    },
    { level: 6 },
  );
}
```

- [ ] **Step 9: Run the tests**

Run: `bun test src/export/ods.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 10: Verify the file opens in a real spreadsheet**

Write a throwaway script and open the result manually. This catches structural
problems that string assertions cannot.

```bash
bun -e '
import { buildOds } from "./src/export/ods.ts";
import { createSeedDataset } from "./src/domain/seed.ts";
const data = createSeedDataset("2026-01");
data.months[0].income = { amount: 20000, currency: "DKK" };
await Bun.write("/tmp/budget-check.ods", buildOds(data));
console.log("wrote /tmp/budget-check.ods");
'
```

Expected: the file opens in LibreOffice Calc (or Excel) with six sheets, and
the amounts are right-aligned numbers rather than left-aligned text. If it will
not open, the fault is almost always the `mimetype` entry's position or
compression level.

- [ ] **Step 11: Run the full suite and commit**

Run: `bun test`
Expected: PASS, all tests.

```bash
git add src/export/ods.ts src/export/ods.test.ts src/domain/views.ts src/domain/views.test.ts package.json bun.lock
git commit -m "feat(export): add ODS workbook export

Generated in-browser with fflate, so export works offline. mimetype is
stored first and uncompressed as the ODS spec requires."
```

---

## Phase 4 — Application shell

### Task 16: Router, base path, and dataset hook

**Files:**
- Create: `src/ui/basePath.ts`, `src/ui/hooks/useDataset.ts`, `src/ui/App.tsx`, `test/setup.ts`
- Modify: `src/frontend.tsx`, `src/App.tsx` (delete — replaced by `src/ui/App.tsx`), `bunfig.toml`, `package.json`
- Test: `src/ui/basePath.test.ts`

**Interfaces:**
- Consumes: `store`, `currentMonth` from `../store/index.ts`; `Dataset` from `../domain/types.ts`.
- Produces:
  - `BASE_PATH: string` and `withBase(path: string): string` (from `basePath.ts`)
  - `useDataset(): Dataset` (from `hooks/useDataset.ts`)
  - `App` component with all routes mounted

- [ ] **Step 1: Add dependencies and the DOM test environment**

```bash
bun add react-router
bun add -d @happy-dom/global-registrator
```

Create `test/setup.ts`:

```ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
```

Add the preload to `bunfig.toml` (keep the existing `[serve.static]` section):

```toml
[test]
preload = ["./test/setup.ts"]
```

- [ ] **Step 2: Write the failing test for base path handling**

```ts
// src/ui/basePath.test.ts
import { test, expect } from "bun:test";
import { withBase, normalizeBase } from "./basePath.ts";

test("normalizeBase defaults to root", () => {
  expect(normalizeBase(undefined)).toBe("/");
  expect(normalizeBase("")).toBe("/");
});

test("normalizeBase adds the leading and trailing slash", () => {
  expect(normalizeBase("budget2.0")).toBe("/budget2.0/");
  expect(normalizeBase("/budget2.0")).toBe("/budget2.0/");
  expect(normalizeBase("/budget2.0/")).toBe("/budget2.0/");
});

test("withBase joins without doubling slashes", () => {
  expect(withBase("/manifest.webmanifest", "/budget2.0/")).toBe(
    "/budget2.0/manifest.webmanifest",
  );
  expect(withBase("manifest.webmanifest", "/budget2.0/")).toBe(
    "/budget2.0/manifest.webmanifest",
  );
  expect(withBase("/sw.js", "/")).toBe("/sw.js");
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `bun test src/ui/basePath.test.ts`
Expected: FAIL — cannot resolve `./basePath.ts`.

- [ ] **Step 4: Implement base path handling**

```ts
// src/ui/basePath.ts

/** Always "/" or "/segment/". Never empty, never without a trailing slash. */
export function normalizeBase(raw: string | undefined): string {
  if (!raw || raw === "/") return "/";
  const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * Bun substitutes process.env.BUN_PUBLIC_* into client code at build time, so
 * this becomes a literal string in the bundle.
 */
export const BASE_PATH = normalizeBase(process.env.BUN_PUBLIC_BASE_PATH);

/** react-router wants the basename without a trailing slash ("" for root). */
export const ROUTER_BASENAME = BASE_PATH === "/" ? "" : BASE_PATH.slice(0, -1);

export function withBase(path: string, base: string = BASE_PATH): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `bun test src/ui/basePath.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Implement the dataset hook**

```ts
// src/ui/hooks/useDataset.ts
import { useSyncExternalStore } from "react";
import { store } from "../../store/index.ts";
import type { Dataset } from "../../domain/types.ts";

/**
 * Subscribes to the snapshot store. Every mutation replaces the snapshot
 * object, so reference equality is a correct change signal.
 */
export function useDataset(): Dataset {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
  );
}
```

- [ ] **Step 7: Implement the shell**

There is deliberately no rendered test for the shell. Rendering it requires a
loaded snapshot, and happy-dom has no IndexedDB, so such a test would either
need the store faked through module mocking or would start failing the moment
Task 18 makes these routes read data. The routing logic worth asserting is the
base path, which Step 2 already covers; the shell itself is verified in the
browser at Step 9.

Placeholder route components are created here and filled in by later tasks, so
the router is testable before any view exists.

```tsx
// src/ui/App.tsx
import { BrowserRouter, Navigate, Route, Routes, NavLink } from "react-router";
import { ROUTER_BASENAME } from "./basePath.ts";
import { currentMonth } from "../store/index.ts";
import { MonthRoute } from "./routes/MonthRoute.tsx";
import { YearRoute } from "./routes/YearRoute.tsx";
import { PostMonthRoute } from "./routes/PostMonthRoute.tsx";
import { PostYearRoute } from "./routes/PostYearRoute.tsx";
import { SummaryRoute } from "./routes/SummaryRoute.tsx";
import { SettingsRoute } from "./routes/SettingsRoute.tsx";

export function AppRoutes() {
  const year = currentMonth.slice(0, 4);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex gap-4 border-b px-6 py-3 text-sm">
        <NavLink to={`/month/${currentMonth}`} className="hover:underline">
          Month
        </NavLink>
        <NavLink to={`/year/${year}`} className="hover:underline">
          Year
        </NavLink>
        <NavLink to="/summary" className="hover:underline">
          Summary
        </NavLink>
        <NavLink to="/settings" className="ml-auto hover:underline">
          Settings
        </NavLink>
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/month/:monthId" element={<MonthRoute />} />
          <Route path="/year/:year" element={<YearRoute />} />
          <Route path="/post/:postId/month/:monthId" element={<PostMonthRoute />} />
          <Route path="/post/:postId/year/:year" element={<PostYearRoute />} />
          <Route path="/summary" element={<SummaryRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="*" element={<Navigate to={`/month/${currentMonth}`} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
```

Create the six placeholder routes. Each is replaced by a later task; they exist
now so the router compiles and is testable.

```tsx
// src/ui/routes/MonthRoute.tsx
import { useParams } from "react-router";

export function MonthRoute() {
  const { monthId } = useParams();
  return <h1 className="text-2xl font-semibold">{monthId}</h1>;
}
```

Create `YearRoute.tsx`, `PostMonthRoute.tsx`, `PostYearRoute.tsx`,
`SummaryRoute.tsx`, and `SettingsRoute.tsx` following the same shape, each
exporting a component of its own name that renders an `<h1>` naming the view.

- [ ] **Step 8: Wire up the entrypoint**

The store must load before React renders, because `useDataset` throws if the
snapshot is missing.

```tsx
// src/frontend.tsx
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./ui/App.tsx";
import { store } from "./store/index.ts";

const container = document.getElementById("root") ?? document.body;

store.load().then(
  () => createRoot(container).render(<App />),
  (error: unknown) => {
    container.textContent = `Could not open your budget data: ${
      error instanceof Error ? error.message : String(error)
    }`;
  },
);
```

Delete the scaffold's `src/App.tsx`, and ensure `src/index.html` contains
`<div id="root"></div>` and the `<script type="module" src="./frontend.tsx">` tag.

- [ ] **Step 9: Run the tests and the dev server**

Run: `bun test`
Expected: PASS, all tests.

Run: `bun --hot src/index.ts`
Expected: the nav renders, clicking Month/Year/Summary/Settings changes the
heading, and an unknown URL redirects to the current month.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(ui): add app shell, router, and base path handling

Base path comes from BUN_PUBLIC_BASE_PATH so the same bundle serves both
a root Docker deploy and a GitHub Pages subpath."
```

---

### Task 17: Plan slicing and dataset actions

Every mutation the UI performs lives here as a pure function over a draft
`Dataset`, so the whole write surface is unit-tested without React.

**Files:**
- Create: `src/domain/plans.ts`, `src/store/actions.ts`
- Modify: `src/domain/index.ts` (export `./plans.ts`)
- Test: `src/domain/plans.test.ts`, `src/store/actions.test.ts`

**Interfaces:**
- Consumes: `distributeByWeight`, `roundMoney` from `../domain/money.ts`; `addMonths` from `../domain/months.ts`; `newId` from `../domain/seed.ts`; domain types.
- Produces (from `plans.ts`):
  - `equalSlices(total: Money, startMonth: MonthId, count: number): ScheduleSlice[]`
  - `sliceTotal(slices: ScheduleSlice[]): number`
  - `slicesBalance(total: Money, slices: ScheduleSlice[]): number`
- Produces (from `actions.ts`):
  - `ensureMonth(draft, monthId): Month`
  - `setIncome(draft, monthId, income: Money): void`
  - `setRuleOverride(draft, monthId, postId, rule: Rule | null): void`
  - `addPost(draft, name, currency, standingRule): Post`
  - `updatePost(draft, postId, changes: Partial<Post>): void`
  - `setPostArchived(draft, postId, archived: boolean): void`
  - `movePost(draft, postId, direction: -1 | 1): void`
  - `addPurchase(draft, purchase: Omit<Purchase, "id">): Purchase`
  - `updatePurchase(draft, purchaseId, changes: Partial<Purchase>): void`
  - `deletePurchase(draft, purchaseId): void`
  - `cancelScheduleFrom(draft, purchaseId, monthId): void`
  - `setFxRate(draft, rate: FxRate): void`
  - `setBaseCurrency(draft, currency): void`

- [ ] **Step 1: Write the failing tests for plan slicing**

```ts
// src/domain/plans.test.ts
import { test, expect } from "bun:test";
import { equalSlices, sliceTotal, slicesBalance } from "./plans.ts";
import { roundMoney } from "./money.ts";

test("equal slices divide the total across consecutive months", () => {
  const slices = equalSlices({ amount: 3000, currency: "DKK" }, "2026-10", 6);
  expect(slices).toHaveLength(6);
  expect(slices[0]).toEqual({ month: "2026-10", amount: { amount: 500, currency: "DKK" } });
  expect(slices[5]!.month).toBe("2027-03");
});

test("uneven totals still sum exactly, the last slice absorbing the drift", () => {
  const slices = equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 3);
  expect(slices.map((s) => s.amount.amount)).toEqual([33.33, 33.33, 33.34]);
  expect(sliceTotal(slices)).toBe(100);
});

test("a single slice takes the whole total", () => {
  const slices = equalSlices({ amount: 99.99, currency: "DKK" }, "2026-01", 1);
  expect(slices).toEqual([
    { month: "2026-01", amount: { amount: 99.99, currency: "DKK" } },
  ]);
});

test("a count below one is rejected", () => {
  expect(() => equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 0)).toThrow(
    /at least one month/i,
  );
});

test("slicesBalance reports the shortfall the editor must show", () => {
  const slices = equalSlices({ amount: 100, currency: "DKK" }, "2026-01", 2);
  expect(slicesBalance({ amount: 100, currency: "DKK" }, slices)).toBe(0);

  slices[0]!.amount.amount = 30;
  expect(slicesBalance({ amount: 100, currency: "DKK" }, slices)).toBe(20);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/domain/plans.test.ts`
Expected: FAIL — cannot resolve `./plans.ts`.

- [ ] **Step 3: Implement plan slicing**

```ts
// src/domain/plans.ts
import { distributeByWeight, roundMoney } from "./money.ts";
import { addMonths } from "./months.ts";
import type { Money, MonthId, ScheduleSlice } from "./types.ts";

/** Splits a total into `count` consecutive monthly slices that sum exactly. */
export function equalSlices(
  total: Money,
  startMonth: MonthId,
  count: number,
): ScheduleSlice[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("A finance plan needs at least one month");
  }
  const weights = new Array(count).fill(1);
  const amounts = distributeByWeight(
    total.amount,
    weights,
    count - 1,
    total.currency,
  );
  return amounts.map((amount, i) => ({
    month: addMonths(startMonth, i),
    amount: { amount, currency: total.currency },
  }));
}

export function sliceTotal(slices: ScheduleSlice[]): number {
  return roundMoney(slices.reduce((sum, s) => sum + s.amount.amount, 0));
}

/** total - sum(slices). Positive means the plan is short of the total. */
export function slicesBalance(total: Money, slices: ScheduleSlice[]): number {
  return roundMoney(total.amount - sliceTotal(slices), total.currency);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `bun test src/domain/plans.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing tests for actions**

```ts
// src/store/actions.test.ts
import { test, expect, describe } from "bun:test";
import * as actions from "./actions.ts";
import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset } from "../domain/types.ts";

function draft(): Dataset {
  return createSeedDataset("2026-09");
}

describe("months", () => {
  test("ensureMonth creates a missing month with zero income", () => {
    const data = draft();
    const month = actions.ensureMonth(data, "2026-10");
    expect(month.income.amount).toBe(0);
    expect(data.months.map((m) => m.id)).toEqual(["2026-09", "2026-10"]);
  });

  test("ensureMonth returns the existing month rather than duplicating it", () => {
    const data = draft();
    actions.ensureMonth(data, "2026-09");
    expect(data.months).toHaveLength(1);
  });

  test("setIncome creates the month if needed", () => {
    const data = draft();
    actions.setIncome(data, "2026-11", { amount: 25000, currency: "DKK" });
    expect(data.months.find((m) => m.id === "2026-11")!.income.amount).toBe(25000);
  });

  test("setRuleOverride sets and clears an override", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleOverride(data, "2026-09", postId, {
      kind: "percentOfIncome",
      percent: 15,
    });
    expect(data.months[0]!.ruleOverrides[postId]).toEqual({
      kind: "percentOfIncome",
      percent: 15,
    });

    actions.setRuleOverride(data, "2026-09", postId, null);
    expect(data.months[0]!.ruleOverrides[postId]).toBeUndefined();
  });
});

describe("posts", () => {
  test("addPost appends with the next order value", () => {
    const data = draft();
    const post = actions.addPost(data, "Travel", "EUR", {
      kind: "percentOfIncome",
      percent: 5,
    });
    expect(post.order).toBe(3);
    expect(post.archived).toBe(false);
    expect(data.posts).toHaveLength(4);
  });

  test("setPostArchived toggles without deleting", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setPostArchived(data, postId, true);
    expect(data.posts.find((p) => p.id === postId)!.archived).toBe(true);
    expect(data.posts).toHaveLength(3);
  });

  test("movePost swaps order with its neighbour", () => {
    const data = draft();
    actions.movePost(data, data.posts[1]!.id, -1);
    expect([...data.posts].sort((a, b) => a.order - b.order).map((p) => p.name)).toEqual([
      "Food",
      "Video Games",
      "Events and Social",
    ]);
  });

  test("movePost at the boundary is a no-op", () => {
    const data = draft();
    actions.movePost(data, data.posts[0]!.id, -1);
    expect(data.posts[0]!.order).toBe(0);
  });

  test("updatePost renames without touching other fields", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.updatePost(data, postId, { name: "Games" });
    const post = data.posts.find((p) => p.id === postId)!;
    expect(post.name).toBe("Games");
    expect(post.currency).toBe("DKK");
  });

  test("an unknown post id throws", () => {
    expect(() => actions.updatePost(draft(), "ghost", { name: "x" })).toThrow(/ghost/);
  });
});

describe("purchases", () => {
  const newPurchase = (postId: string) => ({
    date: "2026-09-14",
    description: "Groceries",
    total: { amount: 200, currency: "DKK" as const },
    splitMode: "percent" as const,
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    schedule: null,
  });

  test("addPurchase assigns an id and ensures the month exists", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, {
      ...newPurchase(data.posts[0]!.id),
      date: "2026-12-01",
    });
    expect(purchase.id).toBeTruthy();
    expect(data.months.map((m) => m.id)).toContain("2026-12");
  });

  test("updatePurchase replaces the given fields", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, newPurchase(data.posts[0]!.id));
    actions.updatePurchase(data, purchase.id, { description: "Dinner" });
    expect(data.purchases[0]!.description).toBe("Dinner");
  });

  test("deletePurchase removes it", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, newPurchase(data.posts[0]!.id));
    actions.deletePurchase(data, purchase.id);
    expect(data.purchases).toHaveLength(0);
  });

  test("cancelScheduleFrom records the cancellation month", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, {
      ...newPurchase(data.posts[0]!.id),
      schedule: {
        slices: [
          { month: "2026-09", amount: { amount: 100, currency: "DKK" } },
          { month: "2026-10", amount: { amount: 100, currency: "DKK" } },
        ],
      },
    });
    actions.cancelScheduleFrom(data, purchase.id, "2026-10");
    expect(data.purchases[0]!.schedule!.cancelledFromMonth).toBe("2026-10");
  });

  test("cancelling an unscheduled purchase throws", () => {
    const data = draft();
    const purchase = actions.addPurchase(data, newPurchase(data.posts[0]!.id));
    expect(() => actions.cancelScheduleFrom(data, purchase.id, "2026-10")).toThrow(
      /no finance plan/i,
    );
  });
});

describe("settings", () => {
  test("setFxRate inserts then updates in place", () => {
    const data = draft();
    actions.setFxRate(data, {
      currency: "EUR",
      baseUnitsPerOne: 7.46,
      updatedAt: "2026-09-01",
      source: "manual",
    });
    expect(data.fxRates).toHaveLength(1);

    actions.setFxRate(data, {
      currency: "EUR",
      baseUnitsPerOne: 7.5,
      updatedAt: "2026-09-02",
      source: "api",
    });
    expect(data.fxRates).toHaveLength(1);
    expect(data.fxRates[0]!.baseUnitsPerOne).toBe(7.5);
  });

  test("setBaseCurrency drops the new base's own rate row", () => {
    const data = draft();
    actions.setFxRate(data, {
      currency: "EUR",
      baseUnitsPerOne: 7.46,
      updatedAt: "2026-09-01",
      source: "manual",
    });
    actions.setBaseCurrency(data, "EUR");
    expect(data.settings.baseCurrency).toBe("EUR");
    expect(data.fxRates.find((r) => r.currency === "EUR")).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `bun test src/store/actions.test.ts`
Expected: FAIL — cannot resolve `./actions.ts`.

- [ ] **Step 7: Implement actions**

```ts
// src/store/actions.ts
import { newId } from "../domain/seed.ts";
import { monthOf } from "../domain/months.ts";
import type {
  Currency,
  Dataset,
  FxRate,
  Money,
  Month,
  MonthId,
  Post,
  PostId,
  Purchase,
  PurchaseId,
  Rule,
} from "../domain/types.ts";

/**
 * Every function here mutates a draft Dataset in place. They are called from
 * store.mutate(), which clones before applying and writes through afterwards.
 */

function requirePost(draft: Dataset, postId: PostId): Post {
  const post = draft.posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Unknown post: ${postId}`);
  return post;
}

function requirePurchase(draft: Dataset, purchaseId: PurchaseId): Purchase {
  const purchase = draft.purchases.find((p) => p.id === purchaseId);
  if (!purchase) throw new Error(`Unknown purchase: ${purchaseId}`);
  return purchase;
}

export function ensureMonth(draft: Dataset, monthId: MonthId): Month {
  const existing = draft.months.find((m) => m.id === monthId);
  if (existing) return existing;
  const created: Month = {
    id: monthId,
    income: { amount: 0, currency: draft.settings.baseCurrency },
    ruleOverrides: {},
  };
  draft.months.push(created);
  draft.months.sort((a, b) => a.id.localeCompare(b.id));
  return created;
}

export function setIncome(draft: Dataset, monthId: MonthId, income: Money): void {
  ensureMonth(draft, monthId).income = income;
}

export function setRuleOverride(
  draft: Dataset,
  monthId: MonthId,
  postId: PostId,
  rule: Rule | null,
): void {
  const month = ensureMonth(draft, monthId);
  if (rule === null) {
    delete month.ruleOverrides[postId];
    return;
  }
  month.ruleOverrides[postId] = rule;
}

export function addPost(
  draft: Dataset,
  name: string,
  currency: Currency,
  standingRule: Rule,
): Post {
  const post: Post = {
    id: newId(),
    name,
    order: draft.posts.length,
    archived: false,
    currency,
    standingRule,
  };
  draft.posts.push(post);
  return post;
}

export function updatePost(
  draft: Dataset,
  postId: PostId,
  changes: Partial<Omit<Post, "id">>,
): void {
  Object.assign(requirePost(draft, postId), changes);
}

/** Archives rather than deletes, because purchases reference posts. */
export function setPostArchived(
  draft: Dataset,
  postId: PostId,
  archived: boolean,
): void {
  requirePost(draft, postId).archived = archived;
}

export function movePost(draft: Dataset, postId: PostId, direction: -1 | 1): void {
  const ordered = [...draft.posts].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((p) => p.id === postId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return;
  const a = ordered[index]!;
  const b = ordered[target]!;
  [a.order, b.order] = [b.order, a.order];
}

export function addPurchase(
  draft: Dataset,
  purchase: Omit<Purchase, "id">,
): Purchase {
  const created: Purchase = { ...purchase, id: newId() };
  draft.purchases.push(created);
  // Make sure every month the purchase touches exists, so income can be
  // entered against it later.
  const months = created.schedule
    ? created.schedule.slices.map((s) => s.month)
    : [monthOf(created.date)];
  for (const monthId of months) ensureMonth(draft, monthId);
  return created;
}

export function updatePurchase(
  draft: Dataset,
  purchaseId: PurchaseId,
  changes: Partial<Omit<Purchase, "id">>,
): void {
  Object.assign(requirePurchase(draft, purchaseId), changes);
}

export function deletePurchase(draft: Dataset, purchaseId: PurchaseId): void {
  draft.purchases = draft.purchases.filter((p) => p.id !== purchaseId);
}

export function cancelScheduleFrom(
  draft: Dataset,
  purchaseId: PurchaseId,
  monthId: MonthId,
): void {
  const purchase = requirePurchase(draft, purchaseId);
  if (!purchase.schedule) {
    throw new Error(`Purchase ${purchaseId} has no finance plan to cancel`);
  }
  purchase.schedule.cancelledFromMonth = monthId;
}

export function setFxRate(draft: Dataset, rate: FxRate): void {
  const index = draft.fxRates.findIndex((r) => r.currency === rate.currency);
  if (index === -1) draft.fxRates.push(rate);
  else draft.fxRates[index] = rate;
}

/** The base currency never has a rate row of its own. */
export function setBaseCurrency(draft: Dataset, currency: Currency): void {
  draft.settings.baseCurrency = currency;
  draft.fxRates = draft.fxRates.filter((r) => r.currency !== currency);
}
```

- [ ] **Step 8: Run the tests**

Run: `bun test src/store/actions.test.ts src/domain/plans.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 9: Export plans from the domain barrel**

Add `export * from "./plans.ts";` to `src/domain/index.ts`.

- [ ] **Step 10: Commit**

```bash
git add src/domain/plans.ts src/domain/plans.test.ts src/store/actions.ts src/store/actions.test.ts src/domain/index.ts
git commit -m "feat(store): add plan slicing and dataset actions

Every mutation is a pure function over a draft dataset, so the write
surface is unit-tested without React."
```

---

### Task 18: Month view

**Files:**
- Create: `src/ui/format.ts`, `src/ui/hooks/useMutate.ts`, `src/ui/components/PostTable.tsx`
- Modify: `src/ui/routes/MonthRoute.tsx`
- Test: `src/ui/format.test.ts`

**Interfaces:**
- Consumes: `monthView` from `../../domain/views.ts`; `setIncome` from `../../store/actions.ts`; `useDataset`, `useMutate`.
- Produces:
  - `formatAmount(amount: number): string`, `formatMoney(amount: number, currency: Currency): string`, `formatSignedMoney(...)` (from `format.ts`)
  - `useMutate(): { mutate: (fn: (draft: Dataset) => void) => void; error: string | null; clearError: () => void }`
  - `PostTable` component

- [ ] **Step 1: Add the shadcn components this phase needs**

```bash
bunx shadcn@latest add table input button dialog select label badge tabs
```

- [ ] **Step 2: Write the failing tests for formatting**

The locale is pinned to `en-GB` so output is identical in every environment,
including CI.

```ts
// src/ui/format.test.ts
import { test, expect } from "bun:test";
import { formatAmount, formatMoney, formatSignedMoney } from "./format.ts";

test("formatAmount groups thousands and always shows two decimals", () => {
  expect(formatAmount(1234.5)).toBe("1,234.50");
  expect(formatAmount(0)).toBe("0.00");
  expect(formatAmount(-42)).toBe("-42.00");
});

test("formatMoney appends the currency code", () => {
  expect(formatMoney(1234.5, "DKK")).toBe("1,234.50 DKK");
});

test("formatSignedMoney marks positive balances with a plus", () => {
  expect(formatSignedMoney(200, "DKK")).toBe("+200.00 DKK");
  expect(formatSignedMoney(-200, "DKK")).toBe("-200.00 DKK");
  expect(formatSignedMoney(0, "DKK")).toBe("0.00 DKK");
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `bun test src/ui/format.test.ts`
Expected: FAIL — cannot resolve `./format.ts`.

- [ ] **Step 4: Implement formatting and the mutation hook**

```ts
// src/ui/format.ts
import type { Currency } from "../domain/types.ts";

// Pinned locale: output must not vary between the user's machine and CI.
const NUMBER = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(amount: number): string {
  return NUMBER.format(amount);
}

export function formatMoney(amount: number, currency: Currency): string {
  return `${formatAmount(amount)} ${currency}`;
}

export function formatSignedMoney(amount: number, currency: Currency): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatMoney(amount, currency)}`;
}
```

```ts
// src/ui/hooks/useMutate.ts
import { useCallback, useState } from "react";
import { store } from "../../store/index.ts";
import type { Dataset } from "../../domain/types.ts";

/**
 * Wraps store.mutate so a failed write surfaces to the user instead of
 * vanishing into an unhandled rejection. The snapshot is unchanged on failure,
 * so the UI keeps showing the last saved state.
 */
export function useMutate() {
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback((fn: (draft: Dataset) => void) => {
    store.mutate(fn).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  return { mutate, error, clearError: useCallback(() => setError(null), []) };
}
```

- [ ] **Step 5: Run and confirm the format tests pass**

Run: `bun test src/ui/format.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Implement the post table**

```tsx
// src/ui/components/PostTable.tsx
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatSignedMoney } from "../format.ts";
import type { MonthPostRow } from "../../domain/views.ts";
import type { Currency, MonthId } from "../../domain/types.ts";

interface Props {
  monthId: MonthId;
  baseCurrency: Currency;
  rows: MonthPostRow[];
}

export function PostTable({ monthId, baseCurrency, rows }: Props) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-muted-foreground">
        <tr>
          <th className="py-2">Post</th>
          <th className="py-2 text-right">Carried in</th>
          <th className="py-2 text-right">Allocated</th>
          <th className="py-2 text-right">Spent</th>
          <th className="py-2 text-right">Remaining</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ post, figures, overridden }) => (
          <tr key={post.id} className="border-b last:border-0">
            <td className="py-2">
              <Link to={`/post/${post.id}/month/${monthId}`} className="hover:underline">
                {post.name}
              </Link>
              {post.archived && (
                <Badge variant="outline" className="ml-2">
                  archived
                </Badge>
              )}
              {overridden && (
                <Badge variant="secondary" className="ml-2" title="This month overrides the standing rule">
                  overridden
                </Badge>
              )}
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatSignedMoney(figures.carriedIn, baseCurrency)}
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatMoney(figures.allocation, baseCurrency)}
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatMoney(figures.charges, baseCurrency)}
            </td>
            <td
              className={`py-2 text-right font-medium tabular-nums ${
                figures.remaining < 0 ? "text-destructive" : ""
              }`}
            >
              {formatSignedMoney(figures.remaining, baseCurrency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 7: Implement the month route**

```tsx
// src/ui/routes/MonthRoute.tsx
import { Link, useParams } from "react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { monthView } from "../../domain/views.ts";
import { addMonths } from "../../domain/months.ts";
import { setIncome } from "../../store/actions.ts";
import { formatMoney, formatSignedMoney } from "../format.ts";
import { PostTable } from "../components/PostTable.tsx";

export function MonthRoute() {
  const { monthId = "" } = useParams();
  const dataset = useDataset();
  const { mutate, error, clearError } = useMutate();
  const view = monthView(dataset, monthId);
  const base = dataset.settings.baseCurrency;

  return (
    <section className="space-y-6">
      {error && (
        <div className="flex items-center justify-between rounded border border-destructive p-3 text-sm">
          <span>Could not save: {error}</span>
          <button onClick={clearError} className="underline">
            dismiss
          </button>
        </div>
      )}

      <header className="flex items-center gap-4">
        <Link to={`/month/${addMonths(monthId, -1)}`} className="text-sm hover:underline">
          &larr; {addMonths(monthId, -1)}
        </Link>
        <h1 className="text-2xl font-semibold">{monthId}</h1>
        <Link to={`/month/${addMonths(monthId, 1)}`} className="text-sm hover:underline">
          {addMonths(monthId, 1)} &rarr;
        </Link>
      </header>

      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-1">
          <Label htmlFor="income">Income this month ({base})</Label>
          <Input
            id="income"
            type="number"
            step="0.01"
            className="w-40 tabular-nums"
            value={view.income}
            onChange={(event) =>
              mutate((draft) =>
                setIncome(draft, monthId, {
                  amount: Number(event.target.value) || 0,
                  currency: base,
                }),
              )
            }
          />
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-muted-foreground">Allocated</dt>
            <dd className="tabular-nums">{formatMoney(view.totalAllocation, base)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Spent</dt>
            <dd className="tabular-nums">{formatMoney(view.totalCharges, base)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Unallocated</dt>
            <dd
              className={`tabular-nums ${view.unallocated < 0 ? "text-destructive" : ""}`}
              title={
                view.unallocated < 0
                  ? "Allocations exceed this month's income. This is allowed."
                  : undefined
              }
            >
              {formatSignedMoney(view.unallocated, base)}
            </dd>
          </div>
        </dl>
      </div>

      <PostTable monthId={monthId} baseCurrency={base} rows={view.rows} />
    </section>
  );
}
```

- [ ] **Step 8: Verify in the browser**

Run: `bun --hot src/index.ts`

Check, in order:
1. The three seed posts are listed with zeroes.
2. Typing `20000` into income updates it, and reloading the page keeps it —
   this proves write-through to IndexedDB works.
3. The month arrows navigate, and a month with no data shows zero income.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ui): add month view with income entry and post table

Negative remaining balances are shown in a warning treatment; nothing
blocks going over budget."
```

---

### Task 19: Purchase dialog with split editor

**Files:**
- Create: `src/ui/components/SplitEditor.tsx`, `src/ui/components/PurchaseDialog.tsx`, `src/ui/purchaseForm.ts`
- Modify: `src/ui/routes/MonthRoute.tsx` (add the button and the purchase list)
- Test: `src/ui/purchaseForm.test.ts`

The validation logic lives in `purchaseForm.ts` as pure functions so it is
tested without rendering. The component only renders what those functions say.

**Interfaces:**
- Consumes: `Purchase`, `Split`, `Money` from domain types; `splitPartsOfTotal` from `../../domain/charges.ts`; `addPurchase`, `updatePurchase`, `deletePurchase` from `../../store/actions.ts`.
- Produces:
  - `interface SplitDraft { postId: string; value: number; absorbsRemainder: boolean }`
  - `interface PurchaseDraft { date; description; amount: number; currency: Currency; splitMode; splits: SplitDraft[]; plan: PlanDraft | null }`
  - `emptyDraft(monthId: MonthId, postId: string): PurchaseDraft`
  - `splitBalance(draft: PurchaseDraft): number`
  - `validatePurchase(draft: PurchaseDraft): string[]`
  - `toPurchase(draft: PurchaseDraft): Omit<Purchase, "id">`
  - `fromPurchase(purchase: Purchase): PurchaseDraft`

- [ ] **Step 1: Write the failing tests**

```ts
// src/ui/purchaseForm.test.ts
import { test, expect, describe } from "bun:test";
import {
  emptyDraft,
  splitBalance,
  validatePurchase,
  toPurchase,
  fromPurchase,
  type PurchaseDraft,
} from "./purchaseForm.ts";

function draft(overrides: Partial<PurchaseDraft> = {}): PurchaseDraft {
  return { ...emptyDraft("2026-09", "food"), amount: 200, description: "Dinner", ...overrides };
}

describe("emptyDraft", () => {
  test("starts on the first of the given month with one full-weight split", () => {
    const d = emptyDraft("2026-09", "food");
    expect(d.date).toBe("2026-09-01");
    expect(d.splitMode).toBe("percent");
    expect(d.splits).toEqual([{ postId: "food", value: 100, absorbsRemainder: true }]);
    expect(d.plan).toBeNull();
  });
});

describe("splitBalance", () => {
  test("is zero when percentages total 100", () => {
    expect(splitBalance(draft())).toBe(0);
  });

  test("reports the missing percentage", () => {
    const d = draft({
      splits: [
        { postId: "food", value: 60, absorbsRemainder: true },
        { postId: "events", value: 30, absorbsRemainder: false },
      ],
    });
    expect(splitBalance(d)).toBe(10);
  });

  test("reports the missing amount in fixed mode", () => {
    const d = draft({
      splitMode: "fixed",
      splits: [
        { postId: "food", value: 120, absorbsRemainder: true },
        { postId: "events", value: 50, absorbsRemainder: false },
      ],
    });
    expect(splitBalance(d)).toBe(30);
  });
});

describe("validatePurchase", () => {
  test("a well-formed draft has no errors", () => {
    expect(validatePurchase(draft())).toEqual([]);
  });

  test("requires a description", () => {
    expect(validatePurchase(draft({ description: "  " }))).toContain(
      "Give the purchase a description.",
    );
  });

  test("requires a non-zero amount", () => {
    expect(validatePurchase(draft({ amount: 0 }))).toContain(
      "Enter an amount other than zero.",
    );
  });

  test("requires at least one split", () => {
    expect(validatePurchase(draft({ splits: [] }))).toContain(
      "Add at least one post to split across.",
    );
  });

  test("requires exactly one remainder absorber", () => {
    const none = draft({
      splits: [{ postId: "food", value: 100, absorbsRemainder: false }],
    });
    expect(validatePurchase(none)).toContain(
      "Choose exactly one post to absorb rounding.",
    );
  });

  test("rejects the same post twice", () => {
    const dup = draft({
      splits: [
        { postId: "food", value: 50, absorbsRemainder: true },
        { postId: "food", value: 50, absorbsRemainder: false },
      ],
    });
    expect(validatePurchase(dup)).toContain("Each post can only appear once.");
  });

  test("does NOT reject going over budget or an unbalanced split", () => {
    // The remainder-absorbing split reconciles any imbalance, and over-budget
    // is always permitted, so neither is an error.
    const unbalanced = draft({
      splits: [
        { postId: "food", value: 10, absorbsRemainder: true },
        { postId: "events", value: 10, absorbsRemainder: false },
      ],
    });
    expect(validatePurchase(unbalanced)).toEqual([]);
  });
});

describe("toPurchase and fromPurchase", () => {
  test("round-trips a simple purchase", () => {
    const d = draft();
    expect(fromPurchase({ ...toPurchase(d), id: "x" })).toEqual(d);
  });

  test("produces a schedule-free purchase when there is no plan", () => {
    expect(toPurchase(draft()).schedule).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/ui/purchaseForm.test.ts`
Expected: FAIL — cannot resolve `./purchaseForm.ts`.

- [ ] **Step 3: Implement the form model**

`PlanDraft` is declared here but only used by Task 20; leaving the field in
place now avoids reworking the round-trip functions later.

```ts
// src/ui/purchaseForm.ts
import { roundMoney } from "../domain/money.ts";
import type {
  Currency,
  IsoDate,
  MonthId,
  Purchase,
  ScheduleSlice,
} from "../domain/types.ts";

export interface SplitDraft {
  postId: string;
  value: number;
  absorbsRemainder: boolean;
}

export interface PlanDraft {
  startMonth: MonthId;
  slices: ScheduleSlice[];
  cancelledFromMonth?: MonthId;
}

export interface PurchaseDraft {
  date: IsoDate;
  description: string;
  amount: number;
  currency: Currency;
  splitMode: "percent" | "fixed";
  splits: SplitDraft[];
  plan: PlanDraft | null;
}

export function emptyDraft(monthId: MonthId, postId: string): PurchaseDraft {
  return {
    date: `${monthId}-01`,
    description: "",
    amount: 0,
    currency: "DKK",
    splitMode: "percent",
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    plan: null,
  };
}

/** What the split editor must show: how far the parts are from the whole. */
export function splitBalance(draft: PurchaseDraft): number {
  const target = draft.splitMode === "percent" ? 100 : draft.amount;
  const sum = draft.splits.reduce((total, split) => total + split.value, 0);
  return roundMoney(target - sum, draft.currency);
}

export function validatePurchase(draft: PurchaseDraft): string[] {
  const errors: string[] = [];

  if (draft.description.trim() === "") {
    errors.push("Give the purchase a description.");
  }
  if (draft.amount === 0) {
    errors.push("Enter an amount other than zero.");
  }
  if (draft.splits.length === 0) {
    errors.push("Add at least one post to split across.");
  }
  if (draft.splits.filter((s) => s.absorbsRemainder).length !== 1) {
    errors.push("Choose exactly one post to absorb rounding.");
  }
  const postIds = draft.splits.map((s) => s.postId);
  if (new Set(postIds).size !== postIds.length) {
    errors.push("Each post can only appear once.");
  }
  if (postIds.some((id) => id === "")) {
    errors.push("Choose a post for every split.");
  }

  // Deliberately absent: any check on whether splits balance, or whether the
  // purchase pushes a post over budget. Both are permitted by design.
  return errors;
}

export function toPurchase(draft: PurchaseDraft): Omit<Purchase, "id"> {
  return {
    date: draft.date,
    description: draft.description.trim(),
    total: { amount: draft.amount, currency: draft.currency },
    splitMode: draft.splitMode,
    splits: draft.splits.map((s) => ({ ...s })),
    schedule: draft.plan
      ? {
          slices: draft.plan.slices.map((s) => ({ ...s, amount: { ...s.amount } })),
          ...(draft.plan.cancelledFromMonth
            ? { cancelledFromMonth: draft.plan.cancelledFromMonth }
            : {}),
        }
      : null,
  };
}

export function fromPurchase(purchase: Purchase): PurchaseDraft {
  return {
    date: purchase.date,
    description: purchase.description,
    amount: purchase.total.amount,
    currency: purchase.total.currency,
    splitMode: purchase.splitMode,
    splits: purchase.splits.map((s) => ({ ...s })),
    plan: purchase.schedule
      ? {
          startMonth: purchase.schedule.slices[0]?.month ?? "",
          slices: purchase.schedule.slices.map((s) => ({ ...s, amount: { ...s.amount } })),
          ...(purchase.schedule.cancelledFromMonth
            ? { cancelledFromMonth: purchase.schedule.cancelledFromMonth }
            : {}),
        }
      : null,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/ui/purchaseForm.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Implement the split editor**

```tsx
// src/ui/components/SplitEditor.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount } from "../format.ts";
import type { PurchaseDraft, SplitDraft } from "../purchaseForm.ts";
import { splitBalance } from "../purchaseForm.ts";
import type { Post } from "../../domain/types.ts";

interface Props {
  draft: PurchaseDraft;
  posts: Post[];
  onChange: (next: PurchaseDraft) => void;
}

export function SplitEditor({ draft, posts, onChange }: Props) {
  const balance = splitBalance(draft);
  const unit = draft.splitMode === "percent" ? "%" : draft.currency;

  function updateSplit(index: number, changes: Partial<SplitDraft>) {
    const splits = draft.splits.map((split, i) =>
      i === index ? { ...split, ...changes } : split,
    );
    onChange({ ...draft, splits });
  }

  function setAbsorber(index: number) {
    onChange({
      ...draft,
      splits: draft.splits.map((split, i) => ({
        ...split,
        absorbsRemainder: i === index,
      })),
    });
  }

  return (
    <fieldset className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Split across posts</Label>
        <div className="flex gap-1 text-xs">
          {(["percent", "fixed"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={draft.splitMode === mode ? "default" : "outline"}
              onClick={() => onChange({ ...draft, splitMode: mode })}
            >
              {mode === "percent" ? "Percentages" : "Amounts"}
            </Button>
          ))}
        </div>
      </div>

      {draft.splits.map((split, index) => (
        <div key={index} className="flex items-center gap-2">
          <select
            className="h-9 flex-1 rounded border bg-background px-2 text-sm"
            value={split.postId}
            onChange={(event) => updateSplit(index, { postId: event.target.value })}
          >
            <option value="">Choose a post…</option>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.name}
              </option>
            ))}
          </select>

          <Input
            type="number"
            step="0.01"
            className="w-28 tabular-nums"
            value={split.value}
            onChange={(event) =>
              updateSplit(index, { value: Number(event.target.value) || 0 })
            }
          />
          <span className="w-10 text-xs text-muted-foreground">{unit}</span>

          <label className="flex items-center gap-1 text-xs" title="This post absorbs rounding">
            <input
              type="radio"
              name="absorber"
              checked={split.absorbsRemainder}
              onChange={() => setAbsorber(index)}
            />
            rounding
          </label>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={draft.splits.length === 1}
            onClick={() =>
              onChange({
                ...draft,
                splits: draft.splits.filter((_, i) => i !== index),
              })
            }
          >
            remove
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between text-xs">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange({
              ...draft,
              splits: [
                ...draft.splits,
                { postId: "", value: 0, absorbsRemainder: false },
              ],
            })
          }
        >
          Add a post
        </Button>
        <span className={balance === 0 ? "text-muted-foreground" : ""}>
          {balance === 0
            ? "Splits balance exactly."
            : `${formatAmount(balance)} ${unit} unassigned — the rounding post absorbs it.`}
        </span>
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 6: Implement the purchase dialog**

The finance-plan section is added in Task 20; this task ships the dialog with
splits only.

```tsx
// src/ui/components/PurchaseDialog.tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SplitEditor } from "./SplitEditor.tsx";
import {
  emptyDraft,
  fromPurchase,
  toPurchase,
  validatePurchase,
  type PurchaseDraft,
} from "../purchaseForm.ts";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { addPurchase, updatePurchase } from "../../store/actions.ts";
import { CURRENCIES, type MonthId, type Purchase } from "../../domain/types.ts";

interface Props {
  monthId: MonthId;
  /** Provide to edit an existing purchase; omit to add a new one. */
  purchase?: Purchase;
  trigger: React.ReactNode;
}

export function PurchaseDialog({ monthId, purchase, trigger }: Props) {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const activePosts = dataset.posts
    .filter((p) => !p.archived)
    .sort((a, b) => a.order - b.order);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PurchaseDraft>(() =>
    purchase ? fromPurchase(purchase) : emptyDraft(monthId, activePosts[0]?.id ?? ""),
  );
  const errors = validatePurchase(draft);

  function reset() {
    setDraft(
      purchase ? fromPurchase(purchase) : emptyDraft(monthId, activePosts[0]?.id ?? ""),
    );
  }

  function save() {
    if (errors.length > 0) return;
    mutate((data) => {
      if (purchase) updatePurchase(data, purchase.id, toPurchase(draft));
      else addPurchase(data, toPurchase(draft));
    });
    setOpen(false);
    if (!purchase) reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{purchase ? "Edit purchase" : "Add purchase"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="purchase-date">Date</Label>
              <Input
                id="purchase-date"
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-description">Description</Label>
              <Input
                id="purchase-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-amount">Total</Label>
              <Input
                id="purchase-amount"
                type="number"
                step="0.01"
                className="tabular-nums"
                value={draft.amount}
                onChange={(event) =>
                  setDraft({ ...draft, amount: Number(event.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-currency">Currency</Label>
              <select
                id="purchase-currency"
                className="h-9 w-full rounded border bg-background px-2 text-sm"
                value={draft.currency}
                onChange={(event) =>
                  setDraft({ ...draft, currency: event.target.value as typeof draft.currency })
                }
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SplitEditor draft={draft} posts={activePosts} onChange={setDraft} />

          {errors.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={errors.length > 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Add the purchase list and button to the month route**

Append to `MonthRoute.tsx`, after the `<PostTable />`:

```tsx
import { Button } from "@/components/ui/button";
import { PurchaseDialog } from "../components/PurchaseDialog.tsx";
import { sliceAmountForMonth } from "../../domain/charges.ts";
import { deletePurchase } from "../../store/actions.ts";
```

```tsx
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Purchases</h2>
          <PurchaseDialog monthId={monthId} trigger={<Button>Add purchase</Button>} />
        </div>
        <ul className="divide-y text-sm">
          {dataset.purchases
            .filter((purchase) => sliceAmountForMonth(purchase, monthId) !== null)
            .map((purchase) => {
              const slice = sliceAmountForMonth(purchase, monthId)!;
              return (
                <li key={purchase.id} className="flex items-center gap-3 py-2">
                  <span className="flex-1">{purchase.description}</span>
                  {purchase.schedule && (
                    <span className="text-xs text-muted-foreground">financed</span>
                  )}
                  <span className="tabular-nums">
                    {formatMoney(slice.amount, slice.currency)}
                  </span>
                  <PurchaseDialog
                    monthId={monthId}
                    purchase={purchase}
                    trigger={
                      <Button size="sm" variant="ghost">
                        edit
                      </Button>
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => mutate((data) => deletePurchase(data, purchase.id))}
                  >
                    delete
                  </Button>
                </li>
              );
            })}
        </ul>
      </section>
```

- [ ] **Step 8: Verify in the browser**

Run: `bun --hot src/index.ts`

Check:
1. Add a 200 DKK purchase split 60/40 across Food and Events and Social. The
   post table shows 120 and 80.
2. Switch the split to Amounts, enter 120 and 50, and save. The rounding post
   receives 80, not 50 — the remainder was absorbed.
3. Add a purchase in EUR with no rate configured. It must show a clear
   "no exchange rate configured for EUR" error rather than a blank screen.
   (Task 23 adds the rate editor that fixes it.)
4. Reload. Everything persists.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ui): add purchase dialog with split editor

Validation lives in purchaseForm.ts as pure functions. Unbalanced splits
and over-budget purchases are deliberately not errors."
```

---

### Task 20: Finance plan editor

**Files:**
- Create: `src/ui/components/PlanEditor.tsx`
- Modify: `src/ui/components/PurchaseDialog.tsx` (mount the plan section), `src/ui/purchaseForm.ts` (add `withPlan`, `withoutPlan`, `setPlanMonths`), `src/ui/purchaseForm.test.ts`
- Test: extends `src/ui/purchaseForm.test.ts`

**Interfaces:**
- Consumes: `equalSlices`, `slicesBalance`, `sliceTotal` from `../domain/plans.ts`.
- Produces:
  - `withPlan(draft: PurchaseDraft, startMonth: MonthId, months: number): PurchaseDraft`
  - `withoutPlan(draft: PurchaseDraft): PurchaseDraft`
  - `setSliceAmount(draft: PurchaseDraft, index: number, amount: number): PurchaseDraft`
  - `planBalance(draft: PurchaseDraft): number`
  - `PlanEditor` component

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/purchaseForm.test.ts`:

```ts
import {
  withPlan,
  withoutPlan,
  setSliceAmount,
  planBalance,
} from "./purchaseForm.ts";

describe("finance plans", () => {
  test("withPlan generates equal slices from the given month", () => {
    const d = withPlan(draft({ amount: 3000 }), "2026-10", 6);
    expect(d.plan!.slices).toHaveLength(6);
    expect(d.plan!.slices[0]).toEqual({
      month: "2026-10",
      amount: { amount: 500, currency: "DKK" },
    });
    expect(d.plan!.slices[5]!.month).toBe("2027-03");
  });

  test("withPlan keeps the splits untouched, so plans and splits compose", () => {
    const split = draft({
      amount: 3000,
      splits: [
        { postId: "games", value: 70, absorbsRemainder: true },
        { postId: "events", value: 30, absorbsRemainder: false },
      ],
    });
    expect(withPlan(split, "2026-10", 2).splits).toEqual(split.splits);
  });

  test("withoutPlan clears the schedule", () => {
    expect(withoutPlan(withPlan(draft(), "2026-10", 3)).plan).toBeNull();
  });

  test("setSliceAmount edits one slice and leaves the others alone", () => {
    const d = setSliceAmount(withPlan(draft({ amount: 3000 }), "2026-10", 3), 0, 1500);
    expect(d.plan!.slices.map((s) => s.amount.amount)).toEqual([1500, 1000, 1000]);
  });

  test("planBalance reports the difference between the slices and the total", () => {
    const even = withPlan(draft({ amount: 3000 }), "2026-10", 3);
    expect(planBalance(even)).toBe(0);
    expect(planBalance(setSliceAmount(even, 0, 1500))).toBe(-500);
  });

  test("planBalance is zero when there is no plan", () => {
    expect(planBalance(draft())).toBe(0);
  });

  test("a plan with unbalanced slices is still valid", () => {
    // A deposit-then-instalments plan may legitimately not sum to the total
    // yet while the user is typing; the editor warns rather than blocking.
    const d = setSliceAmount(withPlan(draft({ amount: 3000 }), "2026-10", 3), 0, 1500);
    expect(validatePurchase(d)).toEqual([]);
  });

  test("a plan with zero months is rejected", () => {
    expect(() => withPlan(draft(), "2026-10", 0)).toThrow(/at least one month/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/ui/purchaseForm.test.ts`
Expected: FAIL — `withPlan` is not exported.

- [ ] **Step 3: Implement the plan helpers**

Append to `src/ui/purchaseForm.ts`:

```ts
import { equalSlices, sliceTotal } from "../domain/plans.ts";

export function withPlan(
  draft: PurchaseDraft,
  startMonth: MonthId,
  months: number,
): PurchaseDraft {
  return {
    ...draft,
    plan: {
      startMonth,
      slices: equalSlices({ amount: draft.amount, currency: draft.currency }, startMonth, months),
    },
  };
}

export function withoutPlan(draft: PurchaseDraft): PurchaseDraft {
  return { ...draft, plan: null };
}

export function setSliceAmount(
  draft: PurchaseDraft,
  index: number,
  amount: number,
): PurchaseDraft {
  if (!draft.plan) return draft;
  return {
    ...draft,
    plan: {
      ...draft.plan,
      slices: draft.plan.slices.map((slice, i) =>
        i === index ? { ...slice, amount: { ...slice.amount, amount } } : slice,
      ),
    },
  };
}

/** slices - total. Negative means the plan charges more than the purchase cost. */
export function planBalance(draft: PurchaseDraft): number {
  if (!draft.plan) return 0;
  return roundMoney(draft.amount - sliceTotal(draft.plan.slices), draft.currency);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/ui/purchaseForm.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Implement the plan editor**

```tsx
// src/ui/components/PlanEditor.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount } from "../format.ts";
import {
  planBalance,
  setSliceAmount,
  withPlan,
  withoutPlan,
  type PurchaseDraft,
} from "../purchaseForm.ts";
import { monthOf } from "../../domain/months.ts";

interface Props {
  draft: PurchaseDraft;
  onChange: (next: PurchaseDraft) => void;
}

export function PlanEditor({ draft, onChange }: Props) {
  const balance = planBalance(draft);

  if (!draft.plan) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(withPlan(draft, monthOf(draft.date), 3))}
      >
        Spread this over several months
      </Button>
    );
  }

  return (
    <fieldset className="space-y-3 rounded border p-3">
      <div className="flex items-center justify-between">
        <Label>Finance plan</Label>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">months</span>
          <Input
            type="number"
            min={1}
            className="h-8 w-16 tabular-nums"
            value={draft.plan.slices.length}
            onChange={(event) => {
              const months = Number(event.target.value);
              if (months >= 1) {
                onChange(withPlan(draft, draft.plan!.startMonth, months));
              }
            }}
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(withoutPlan(draft))}>
            remove plan
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        {draft.plan.slices.map((slice, index) => (
          <div key={slice.month} className="flex items-center gap-2 text-sm">
            <span className="w-20 text-muted-foreground">{slice.month}</span>
            <Input
              type="number"
              step="0.01"
              className="h-8 w-32 tabular-nums"
              value={slice.amount.amount}
              onChange={(event) =>
                onChange(setSliceAmount(draft, index, Number(event.target.value) || 0))
              }
            />
            <span className="text-xs text-muted-foreground">{draft.currency}</span>
          </div>
        ))}
      </div>

      <p className={`text-xs ${balance === 0 ? "text-muted-foreground" : ""}`}>
        {balance === 0
          ? `Slices total ${formatAmount(draft.amount)} ${draft.currency}, matching the purchase.`
          : `Slices are ${formatAmount(Math.abs(balance))} ${draft.currency} ${
              balance > 0 ? "short of" : "over"
            } the purchase total.`}
      </p>
    </fieldset>
  );
}
```

- [ ] **Step 6: Mount it in the dialog**

In `PurchaseDialog.tsx`, import `PlanEditor` and render it directly after
`<SplitEditor ... />`:

```tsx
          <PlanEditor draft={draft} onChange={setDraft} />
```

Also add a cancel control for an existing plan, below the plan editor, so a
saved plan can be stopped without deleting its history:

```tsx
          {purchase?.schedule && !purchase.schedule.cancelledFromMonth && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                mutate((data) => cancelScheduleFrom(data, purchase.id, monthId));
                setOpen(false);
              }}
            >
              Cancel remaining slices from {monthId}
            </Button>
          )}
```

Import `cancelScheduleFrom` from `../../store/actions.ts`.

- [ ] **Step 7: Verify in the browser**

Run: `bun --hot src/index.ts`

Check:
1. Add a 3000 DKK purchase, click "Spread this over several months", set 6
   months. Slices show 500 each.
2. Change the first slice to 1000. The warning says the slices are 500 over
   the total; saving is still allowed.
3. Set slices to 1000/500/1500 across three months and save. Each of those
   three months shows only its own slice in its post table.
4. Combine it: split 70/30 across two posts *and* finance it. Each month's
   two posts receive that month's slice in a 70/30 ratio.
5. Reopen the purchase and cancel from the second month. The first month keeps
   its slice; later months show nothing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): add finance plan editor

Plans default to an equal split, each slice is individually editable, and
plans compose with splits. Cancelling keeps past slices."
```

---

### Task 21: Year view and per-post views

All three views aggregate over `yearView` and `monthView`; none recomputes
rollover.

**Files:**
- Modify: `src/ui/routes/YearRoute.tsx`, `src/ui/routes/PostMonthRoute.tsx`, `src/ui/routes/PostYearRoute.tsx`
- Create: `src/ui/components/YearMatrix.tsx`

**Interfaces:**
- Consumes: `yearView`, `monthView` from `../../domain/views.ts`; `sliceAmountForMonth`, `chargesForPurchaseInMonth` from `../../domain/charges.ts`; `formatMoney`, `formatSignedMoney`.
- Produces: `YearMatrix` component with a `mode: "spend" | "balance"` prop.

- [ ] **Step 1: Implement the year matrix**

```tsx
// src/ui/components/YearMatrix.tsx
import { Link } from "react-router";
import { formatAmount } from "../format.ts";
import type { YearViewModel } from "../../domain/views.ts";

interface Props {
  view: YearViewModel;
  mode: "spend" | "balance";
}

export function YearMatrix({ view, mode }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="py-2 text-left">Post</th>
            {view.months.map((month) => (
              <th key={month} className="py-2 text-right font-normal">
                {month.slice(5)}
              </th>
            ))}
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b text-muted-foreground">
            <td className="py-2">Income</td>
            {view.incomeByMonth.map((income, i) => (
              <td key={i} className="py-2 text-right tabular-nums">
                {formatAmount(income)}
              </td>
            ))}
            <td className="py-2 text-right tabular-nums">{formatAmount(view.totalIncome)}</td>
          </tr>

          {view.rows.map((row) => (
            <tr key={row.post.id} className="border-b last:border-0">
              <td className="py-2">
                <Link to={`/post/${row.post.id}/year/${view.year}`} className="hover:underline">
                  {row.post.name}
                </Link>
              </td>
              {row.byMonth.map((figures, i) => {
                const value = mode === "spend" ? figures.charges : figures.remaining;
                return (
                  <td
                    key={i}
                    className={`py-2 text-right tabular-nums ${
                      mode === "balance" && value < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {formatAmount(value)}
                  </td>
                );
              })}
              <td className="py-2 text-right font-medium tabular-nums">
                {formatAmount(mode === "spend" ? row.totalCharges : row.closingBalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Implement the year route**

```tsx
// src/ui/routes/YearRoute.tsx
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { yearView } from "../../domain/views.ts";
import { formatMoney } from "../format.ts";
import { YearMatrix } from "../components/YearMatrix.tsx";

export function YearRoute() {
  const { year = "" } = useParams();
  const dataset = useDataset();
  const [mode, setMode] = useState<"spend" | "balance">("spend");
  const numericYear = Number(year);
  const view = yearView(dataset, numericYear);
  const base = dataset.settings.baseCurrency;

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-4">
        <Link to={`/year/${numericYear - 1}`} className="text-sm hover:underline">
          &larr; {numericYear - 1}
        </Link>
        <h1 className="text-2xl font-semibold">{year}</h1>
        <Link to={`/year/${numericYear + 1}`} className="text-sm hover:underline">
          {numericYear + 1} &rarr;
        </Link>
        <div className="ml-auto flex gap-1">
          {(["spend", "balance"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={mode === option ? "default" : "outline"}
              onClick={() => setMode(option)}
            >
              {option === "spend" ? "Spent" : "Closing balance"}
            </Button>
          ))}
        </div>
      </header>

      <p className="text-sm text-muted-foreground">
        Income {formatMoney(view.totalIncome, base)} &middot; spent{" "}
        {formatMoney(view.totalCharges, base)}
      </p>

      <YearMatrix view={view} mode={mode} />
    </section>
  );
}
```

- [ ] **Step 3: Implement the per-post month route**

Committed future slices are what make a finance plan visible before it lands,
so they are listed separately from this month's charges.

```tsx
// src/ui/routes/PostMonthRoute.tsx
import { Link, useParams } from "react-router";
import { useDataset } from "../hooks/useDataset.ts";
import { monthView } from "../../domain/views.ts";
import { chargesForPurchaseInMonth, sliceAmountForMonth } from "../../domain/charges.ts";
import { addMonths, compareMonths } from "../../domain/months.ts";
import { formatMoney, formatSignedMoney } from "../format.ts";

export function PostMonthRoute() {
  const { postId = "", monthId = "" } = useParams();
  const dataset = useDataset();
  const post = dataset.posts.find((p) => p.id === postId);
  if (!post) return <p>That post no longer exists.</p>;

  const base = dataset.settings.baseCurrency;
  const row = monthView(dataset, monthId).rows.find((r) => r.post.id === postId);

  const thisMonth = dataset.purchases.flatMap((purchase) => {
    const charges = chargesForPurchaseInMonth(purchase, monthId, base, dataset.fxRates);
    const mine = charges.find((c) => c.postId === postId);
    return mine ? [{ purchase, amount: mine.amount }] : [];
  });

  const committed = dataset.purchases.flatMap((purchase) => {
    if (!purchase.schedule) return [];
    return purchase.schedule.slices
      .filter((slice) => compareMonths(slice.month, monthId) > 0)
      .filter(() => purchase.splits.some((s) => s.postId === postId))
      .map((slice) => ({ purchase, slice }));
  });

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-4">
        <Link to={`/post/${postId}/month/${addMonths(monthId, -1)}`} className="text-sm hover:underline">
          &larr;
        </Link>
        <h1 className="text-2xl font-semibold">
          {post.name} &middot; {monthId}
        </h1>
        <Link to={`/post/${postId}/month/${addMonths(monthId, 1)}`} className="text-sm hover:underline">
          &rarr;
        </Link>
        <Link to={`/post/${postId}/year/${monthId.slice(0, 4)}`} className="ml-auto text-sm hover:underline">
          year view
        </Link>
      </header>

      <dl className="flex gap-6 text-sm">
        <div>
          <dt className="text-muted-foreground">Carried in</dt>
          <dd className="tabular-nums">{formatSignedMoney(row?.figures.carriedIn ?? 0, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Allocated</dt>
          <dd className="tabular-nums">{formatMoney(row?.figures.allocation ?? 0, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Spent</dt>
          <dd className="tabular-nums">{formatMoney(row?.figures.charges ?? 0, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Remaining</dt>
          <dd
            className={`tabular-nums ${
              (row?.figures.remaining ?? 0) < 0 ? "text-destructive" : ""
            }`}
          >
            {formatSignedMoney(row?.figures.remaining ?? 0, base)}
          </dd>
        </div>
      </dl>

      <div>
        <h2 className="mb-2 text-lg font-medium">This month</h2>
        <ul className="divide-y text-sm">
          {thisMonth.map(({ purchase, amount }) => (
            <li key={purchase.id} className="flex gap-3 py-2">
              <span className="flex-1">{purchase.description}</span>
              {purchase.splits.length > 1 && (
                <span className="text-xs text-muted-foreground">split</span>
              )}
              <span className="tabular-nums">{formatMoney(amount, base)}</span>
            </li>
          ))}
          {thisMonth.length === 0 && <li className="py-2 text-muted-foreground">Nothing yet.</li>}
        </ul>
      </div>

      {committed.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-medium">Already committed</h2>
          <ul className="divide-y text-sm text-muted-foreground">
            {committed.map(({ purchase, slice }) => (
              <li key={`${purchase.id}-${slice.month}`} className="flex gap-3 py-2">
                <span className="w-20">{slice.month}</span>
                <span className="flex-1">{purchase.description}</span>
                <span className="tabular-nums">
                  {formatMoney(slice.amount.amount, slice.amount.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Implement the per-post year route**

```tsx
// src/ui/routes/PostYearRoute.tsx
import { Link, useParams } from "react-router";
import { useDataset } from "../hooks/useDataset.ts";
import { yearView } from "../../domain/views.ts";
import { formatAmount, formatMoney, formatSignedMoney } from "../format.ts";

export function PostYearRoute() {
  const { postId = "", year = "" } = useParams();
  const dataset = useDataset();
  const post = dataset.posts.find((p) => p.id === postId);
  if (!post) return <p>That post no longer exists.</p>;

  const base = dataset.settings.baseCurrency;
  const view = yearView(dataset, Number(year));
  const row = view.rows.find((r) => r.post.id === postId);
  if (!row) return <p>No data for this post in {year}.</p>;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {post.name} &middot; {year}
      </h1>
      <p className="text-sm text-muted-foreground">
        Allocated {formatMoney(row.totalAllocation, base)} &middot; spent{" "}
        {formatMoney(row.totalCharges, base)} &middot; closing balance{" "}
        {formatSignedMoney(row.closingBalance, base)}
      </p>

      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">Month</th>
            <th className="py-2 text-right">Carried in</th>
            <th className="py-2 text-right">Allocated</th>
            <th className="py-2 text-right">Spent</th>
            <th className="py-2 text-right">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {view.months.map((month, i) => {
            const figures = row.byMonth[i]!;
            return (
              <tr key={month} className="border-b last:border-0">
                <td className="py-2">
                  <Link to={`/post/${postId}/month/${month}`} className="hover:underline">
                    {month}
                  </Link>
                </td>
                <td className="py-2 text-right tabular-nums">{formatAmount(figures.carriedIn)}</td>
                <td className="py-2 text-right tabular-nums">{formatAmount(figures.allocation)}</td>
                <td className="py-2 text-right tabular-nums">{formatAmount(figures.charges)}</td>
                <td
                  className={`py-2 text-right font-medium tabular-nums ${
                    figures.remaining < 0 ? "text-destructive" : ""
                  }`}
                >
                  {formatAmount(figures.remaining)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 5: Verify in the browser**

Run: `bun --hot src/index.ts`

Check:
1. The year matrix shows twelve columns and an income row; toggling to
   "Closing balance" shows the rollover accumulating across months.
2. Clicking a post name from the month view opens its month detail with the
   carried-in figure matching the previous month's remaining.
3. A financed purchase's future slices appear under "Already committed" in
   earlier months.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add year matrix and per-post month and year views

Future finance-plan slices are surfaced as already-committed so a plan is
visible before it lands."
```

---

### Task 22: Summary view

**Files:**
- Modify: `src/ui/routes/SummaryRoute.tsx`

**Interfaces:**
- Consumes: `summaryView`, `datasetMonthSpan` from `../../domain/views.ts`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Implement the summary route**

```tsx
// src/ui/routes/SummaryRoute.tsx
import { useState } from "react";
import { Link } from "react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { datasetMonthSpan, summaryView } from "../../domain/views.ts";
import { formatAmount, formatMoney } from "../format.ts";

export function SummaryRoute() {
  const dataset = useDataset();
  const span = datasetMonthSpan(dataset);
  const [from, setFrom] = useState(span.from);
  const [to, setTo] = useState(span.to);
  const [groupBy, setGroupBy] = useState<"post" | "month">("post");

  const view = summaryView(dataset, from, to);
  const base = dataset.settings.baseCurrency;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Summary</h1>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input id="from" className="w-32" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <Input id="to" className="w-32" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={() => { setFrom(span.from); setTo(span.to); }}>
          All time
        </Button>
        <div className="ml-auto flex gap-1">
          {(["post", "month"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={groupBy === option ? "default" : "outline"}
              onClick={() => setGroupBy(option)}
            >
              by {option}
            </Button>
          ))}
        </div>
      </div>

      <dl className="flex gap-6 text-sm">
        <div>
          <dt className="text-muted-foreground">Income</dt>
          <dd className="tabular-nums">{formatMoney(view.totalIncome, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Spent</dt>
          <dd className="tabular-nums">{formatMoney(view.totalCharges, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Difference</dt>
          <dd className="tabular-nums">
            {formatMoney(Number((view.totalIncome - view.totalCharges).toFixed(2)), base)}
          </dd>
        </div>
      </dl>

      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">{groupBy === "post" ? "Post" : "Month"}</th>
            <th className="py-2 text-right">Spent</th>
            <th className="py-2 text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {groupBy === "post"
            ? view.byPost.map((entry) => (
                <tr key={entry.post.id} className="border-b last:border-0">
                  <td className="py-2">{entry.post.name}</td>
                  <td className="py-2 text-right tabular-nums">{formatAmount(entry.charges)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {view.totalCharges === 0
                      ? "—"
                      : `${((entry.charges / view.totalCharges) * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))
            : view.byMonth.map((entry) => (
                <tr key={entry.monthId} className="border-b last:border-0">
                  <td className="py-2">
                    <Link to={`/month/${entry.monthId}`} className="hover:underline">
                      {entry.monthId}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatAmount(entry.charges)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {view.totalCharges === 0
                      ? "—"
                      : `${((entry.charges / view.totalCharges) * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Check that the default range covers all data, that switching between "by post"
and "by month" keeps the same total, and that an inverted range (`to` before
`from`) shows zeroes rather than crashing.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): add summary view with post and month grouping"
```

---

### Task 23: Settings — currency, rates, posts, export and import

**Files:**
- Create: `src/store/fxApi.ts`, `src/ui/download.ts`, `src/ui/routes/settings/CurrencySection.tsx`, `src/ui/routes/settings/PostsSection.tsx`, `src/ui/routes/settings/DataSection.tsx`
- Modify: `src/ui/routes/SettingsRoute.tsx`, `src/domain/types.ts` (add `Settings.fxApiUrl?`)
- Test: `src/store/fxApi.test.ts`

`Settings.fxApiUrl` is added as an **optional** field, so no migration is
needed: existing datasets simply have it undefined.

**Interfaces:**
- Consumes: all actions from `../../store/actions.ts`; `exportDatasetJson`, `parseDatasetJson`, `describeDataset`, `exportFilename` from `../../export/json.ts`; `buildOds`, `odsFilename` from `../../export/ods.ts`.
- Produces:
  - `DEFAULT_FX_API_URL: string`
  - `buildFxUrl(template: string, base: Currency, targets: Currency[]): string`
  - `parseFxResponse(body: unknown, base: Currency): FxRate[]`
  - `fetchFxRates(url: string, base: Currency, targets: Currency[]): Promise<FxRate[]>`
  - `downloadBlob(filename: string, blob: Blob): void`

- [ ] **Step 1: Write the failing tests for the FX API adapter**

Parsing is pure and therefore tested directly; only the `fetch` call is not.

```ts
// src/store/fxApi.test.ts
import { test, expect, describe } from "bun:test";
import { buildFxUrl, parseFxResponse, DEFAULT_FX_API_URL } from "./fxApi.ts";

describe("buildFxUrl", () => {
  test("substitutes the base and target placeholders", () => {
    expect(buildFxUrl(DEFAULT_FX_API_URL, "DKK", ["USD", "EUR"])).toBe(
      "https://api.frankfurter.app/latest?from=DKK&to=USD,EUR",
    );
  });
});

describe("parseFxResponse", () => {
  test("inverts the rates into base units per one unit", () => {
    // The API returns how many target units 1 base unit buys; we store the
    // inverse, so 1 EUR = 7.46 DKK becomes baseUnitsPerOne 7.46.
    const rates = parseFxResponse({ rates: { EUR: 0.134048, USD: 0.144928 } }, "DKK");
    expect(rates.find((r) => r.currency === "EUR")!.baseUnitsPerOne).toBeCloseTo(7.46, 2);
    expect(rates.every((r) => r.source === "api")).toBe(true);
    expect(rates.every((r) => r.updatedAt !== "")).toBe(true);
  });

  test("skips the base currency's own row if the API returns one", () => {
    const rates = parseFxResponse({ rates: { DKK: 1, EUR: 0.134 } }, "DKK");
    expect(rates.map((r) => r.currency)).toEqual(["EUR"]);
  });

  test("ignores unsupported currencies", () => {
    const rates = parseFxResponse({ rates: { GBP: 0.11, EUR: 0.134 } }, "DKK");
    expect(rates.map((r) => r.currency)).toEqual(["EUR"]);
  });

  test("rejects a response with no rates object", () => {
    expect(() => parseFxResponse({}, "DKK")).toThrow(/rates/);
    expect(() => parseFxResponse("nope", "DKK")).toThrow(/rates/);
  });

  test("rejects a zero or negative rate rather than storing an infinity", () => {
    expect(() => parseFxResponse({ rates: { EUR: 0 } }, "DKK")).toThrow(/EUR/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/store/fxApi.test.ts`
Expected: FAIL — cannot resolve `./fxApi.ts`.

- [ ] **Step 3: Implement the FX adapter**

```ts
// src/store/fxApi.ts
import { CURRENCIES, type Currency, type FxRate } from "../domain/types.ts";

/** Frankfurter needs no API key. The URL is user-editable in settings. */
export const DEFAULT_FX_API_URL = "https://api.frankfurter.app/latest?from={base}&to={targets}";

export function buildFxUrl(
  template: string,
  base: Currency,
  targets: Currency[],
): string {
  return template
    .replace("{base}", base)
    .replace("{targets}", targets.join(","));
}

export function parseFxResponse(body: unknown, base: Currency): FxRate[] {
  const rates =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).rates
      : undefined;
  if (typeof rates !== "object" || rates === null) {
    throw new Error("Exchange rate response has no `rates` object");
  }

  const updatedAt = new Date().toISOString();
  const out: FxRate[] = [];

  for (const [currency, value] of Object.entries(rates as Record<string, unknown>)) {
    if (currency === base) continue;
    if (!CURRENCIES.includes(currency as Currency)) continue;
    if (typeof value !== "number" || !(value > 0)) {
      throw new Error(`Exchange rate for ${currency} is not a positive number`);
    }
    // The API gives target-per-base; we store base-per-target.
    out.push({
      currency: currency as Currency,
      baseUnitsPerOne: Number((1 / value).toFixed(6)),
      updatedAt,
      source: "api",
    });
  }
  return out;
}

/** Fails soft at the call site: callers keep the cached rates on error. */
export async function fetchFxRates(
  template: string,
  base: Currency,
  targets: Currency[],
): Promise<FxRate[]> {
  const response = await fetch(buildFxUrl(template, base, targets));
  if (!response.ok) {
    throw new Error(`Rate service returned ${response.status}`);
  }
  return parseFxResponse(await response.json(), base);
}
```

Add the optional field to `Settings` in `src/domain/types.ts`:

```ts
export interface Settings {
  baseCurrency: Currency;
  foldStartMonth: MonthId;
  schemaVersion: number;
  /** Optional: no migration needed, existing datasets leave it undefined. */
  fxApiUrl?: string;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/store/fxApi.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the download helper**

```ts
// src/ui/download.ts

/** Triggers a browser download. Works only in a real page, not in tests. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a turn to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 6: Implement the currency section**

```tsx
// src/ui/routes/settings/CurrencySection.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import { setBaseCurrency, setFxRate } from "../../../store/actions.ts";
import { DEFAULT_FX_API_URL, fetchFxRates } from "../../../store/fxApi.ts";
import { CURRENCIES, type Currency } from "../../../domain/types.ts";

export function CurrencySection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const base = dataset.settings.baseCurrency;
  const apiUrl = dataset.settings.fxApiUrl ?? DEFAULT_FX_API_URL;
  const [status, setStatus] = useState<string | null>(null);
  const targets = CURRENCIES.filter((c) => c !== base);

  async function refresh() {
    setStatus("Fetching…");
    try {
      const rates = await fetchFxRates(apiUrl, base, targets);
      mutate((draft) => {
        for (const rate of rates) setFxRate(draft, rate);
      });
      setStatus(`Updated ${rates.length} rate(s).`);
    } catch (error) {
      // Fails soft: the cached rates are still in place.
      setStatus(
        `Could not fetch rates (${
          error instanceof Error ? error.message : String(error)
        }). Your saved rates are unchanged.`,
      );
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Currency</h2>

      <div className="space-y-1">
        <Label htmlFor="base-currency">Base currency (all totals use this)</Label>
        <select
          id="base-currency"
          className="h-9 w-32 rounded border bg-background px-2 text-sm"
          value={base}
          onChange={(event) =>
            mutate((draft) => setBaseCurrency(draft, event.target.value as Currency))
          }
        >
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full max-w-md text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">Currency</th>
            <th className="py-2 text-right">1 unit = ? {base}</th>
            <th className="py-2 text-right">Source</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((currency) => {
            const rate = dataset.fxRates.find((r) => r.currency === currency);
            return (
              <tr key={currency} className="border-b last:border-0">
                <td className="py-2">{currency}</td>
                <td className="py-2 text-right">
                  <Input
                    type="number"
                    step="0.000001"
                    className="ml-auto h-8 w-32 tabular-nums"
                    value={rate?.baseUnitsPerOne ?? ""}
                    onChange={(event) =>
                      mutate((draft) =>
                        setFxRate(draft, {
                          currency,
                          baseUnitsPerOne: Number(event.target.value) || 0,
                          updatedAt: new Date().toISOString(),
                          source: "manual",
                        }),
                      )
                    }
                  />
                </td>
                <td className="py-2 text-right text-xs text-muted-foreground">
                  {rate ? `${rate.source} · ${rate.updatedAt.slice(0, 10)}` : "not set"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="fx-url">Rate service URL</Label>
          <Input
            id="fx-url"
            className="max-w-xl"
            value={apiUrl}
            onChange={(event) =>
              mutate((draft) => {
                draft.settings.fxApiUrl = event.target.value;
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            {"{base}"} and {"{targets}"} are substituted. Fetching is optional — the app
            works offline with the rates you type in above.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          Fetch rates now
        </Button>
        {status && <p className="text-xs">{status}</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Implement the posts section**

```tsx
// src/ui/routes/settings/PostsSection.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import { addPost, movePost, setPostArchived, updatePost } from "../../../store/actions.ts";
import { CURRENCIES, type Currency, type Rule } from "../../../domain/types.ts";

export function PostsSection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const [newName, setNewName] = useState("");
  const ordered = [...dataset.posts].sort((a, b) => a.order - b.order);
  const base = dataset.settings.baseCurrency;

  function ruleEditor(postId: string, rule: Rule) {
    return (
      <div className="flex items-center gap-2">
        <select
          className="h-8 rounded border bg-background px-1 text-xs"
          value={rule.kind}
          onChange={(event) =>
            mutate((draft) =>
              updatePost(draft, postId, {
                standingRule:
                  event.target.value === "fixed"
                    ? { kind: "fixed", amount: { amount: 0, currency: base } }
                    : { kind: "percentOfIncome", percent: 0 },
              }),
            )
          }
        >
          <option value="fixed">fixed amount</option>
          <option value="percentOfIncome">% of income</option>
        </select>
        <Input
          type="number"
          step="0.01"
          className="h-8 w-28 tabular-nums"
          value={rule.kind === "fixed" ? rule.amount.amount : rule.percent}
          onChange={(event) => {
            const value = Number(event.target.value) || 0;
            mutate((draft) =>
              updatePost(draft, postId, {
                standingRule:
                  rule.kind === "fixed"
                    ? { kind: "fixed", amount: { ...rule.amount, amount: value } }
                    : { kind: "percentOfIncome", percent: value },
              }),
            );
          }}
        />
        <span className="w-10 text-xs text-muted-foreground">
          {rule.kind === "fixed" ? rule.amount.currency : "%"}
        </span>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Posts</h2>
      <p className="text-xs text-muted-foreground">
        Standing rules apply to every month automatically. Any single month can
        override its own allocation from the month view. Percentages may total
        more than 100%.
      </p>

      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">Name</th>
            <th className="py-2">Display currency</th>
            <th className="py-2">Standing rule</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {ordered.map((post, index) => (
            <tr key={post.id} className={`border-b last:border-0 ${post.archived ? "opacity-50" : ""}`}>
              <td className="py-2">
                <Input
                  className="h-8 w-48"
                  value={post.name}
                  onChange={(event) =>
                    mutate((draft) => updatePost(draft, post.id, { name: event.target.value }))
                  }
                />
              </td>
              <td className="py-2">
                <select
                  className="h-8 rounded border bg-background px-1 text-xs"
                  value={post.currency}
                  onChange={(event) =>
                    mutate((draft) =>
                      updatePost(draft, post.id, { currency: event.target.value as Currency }),
                    )
                  }
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2">{ruleEditor(post.id, post.standingRule)}</td>
              <td className="py-2 text-right">
                <Button size="sm" variant="ghost" disabled={index === 0}
                  onClick={() => mutate((draft) => movePost(draft, post.id, -1))}>
                  up
                </Button>
                <Button size="sm" variant="ghost" disabled={index === ordered.length - 1}
                  onClick={() => mutate((draft) => movePost(draft, post.id, 1))}>
                  down
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => mutate((draft) => setPostArchived(draft, post.id, !post.archived))}>
                  {post.archived ? "restore" : "archive"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Archiving hides a post from new purchases while keeping its history. Posts
        are never deleted, because purchases reference them.
      </p>

      <div className="flex items-end gap-2">
        <Input
          className="w-48"
          placeholder="New post name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={newName.trim() === ""}
          onClick={() => {
            mutate((draft) =>
              addPost(draft, newName.trim(), base, {
                kind: "fixed",
                amount: { amount: 0, currency: base },
              }),
            );
            setNewName("");
          }}
        >
          Add post
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Implement the data section**

```tsx
// src/ui/routes/settings/DataSection.tsx
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDataset } from "../../hooks/useDataset.ts";
import { downloadBlob } from "../../download.ts";
import { store, currentMonth } from "../../../store/index.ts";
import {
  describeDataset,
  exportDatasetJson,
  exportFilename,
  parseDatasetJson,
} from "../../../export/json.ts";
import { buildOds, odsFilename } from "../../../export/ods.ts";
import type { Dataset } from "../../../domain/types.ts";

export function DataSection() {
  const dataset = useDataset();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  function exportJson() {
    downloadBlob(
      exportFilename(currentMonth),
      new Blob([exportDatasetJson(dataset)], { type: "application/json" }),
    );
  }

  function exportOds() {
    downloadBlob(
      odsFilename(currentMonth),
      new Blob([buildOds(dataset) as BlobPart], {
        type: "application/vnd.oasis.opendocument.spreadsheet",
      }),
    );
  }

  async function chooseFile(file: File) {
    setError(null);
    try {
      setPending(parseDatasetJson(await file.text()));
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function confirmImport() {
    if (!pending) return;
    // Back up first: import replaces everything, and this is the user's only copy.
    exportJson();
    await store.replace(pending);
    setPending(null);
  }

  const counts = describeDataset(dataset);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Your data</h2>
      <p className="text-xs text-muted-foreground">
        Everything lives in this browser. Export regularly — it is both your
        backup and how you move your budget to another device.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportJson}>
          Export JSON
        </Button>
        <Button variant="outline" onClick={exportOds}>
          Export ODS (spreadsheet)
        </Button>
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          Import JSON…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void chooseFile(file);
            event.target.value = "";
          }}
        />
      </div>

      {error && <p className="text-sm text-destructive">Could not import: {error}</p>}

      {pending && (
        <div className="space-y-2 rounded border border-destructive p-3 text-sm">
          <p className="font-medium">This replaces everything currently stored.</p>
          <p>
            Now: {counts.posts} posts, {counts.months} months, {counts.purchases} purchases.
            <br />
            After import: {describeDataset(pending).posts} posts,{" "}
            {describeDataset(pending).months} months,{" "}
            {describeDataset(pending).purchases} purchases.
          </p>
          <p className="text-xs text-muted-foreground">
            A backup of your current data will download first.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => void confirmImport()}>
              Replace my data
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 9: Compose the settings route**

```tsx
// src/ui/routes/SettingsRoute.tsx
import { CurrencySection } from "./settings/CurrencySection.tsx";
import { PostsSection } from "./settings/PostsSection.tsx";
import { DataSection } from "./settings/DataSection.tsx";

export function SettingsRoute() {
  return (
    <div className="max-w-4xl space-y-10">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <CurrencySection />
      <PostsSection />
      <DataSection />
    </div>
  );
}
```

- [ ] **Step 10: Verify in the browser**

Run: `bun --hot src/index.ts`

Check:
1. Set EUR to 7.46 manually. The EUR purchase from Task 19 now shows ~74.60 DKK.
2. Click "Fetch rates now" with the network on — rates update and show source
   "api". Turn the network off and click again: the message says the saved rates
   are unchanged, and the app keeps working.
3. Add a post named Travel; it appears in the month view and the purchase dialog.
4. Archive Food; it disappears from the purchase dialog's post list but its past
   months still show it.
5. Export JSON, then import that same file: the confirmation names the counts,
   a backup downloads, and the data is unchanged afterwards.
6. Import a deliberately broken file (delete a `"purchases"` key in a copy). It
   must show a readable error and change nothing.
7. Export ODS and open it in LibreOffice.

- [ ] **Step 11: Run the full suite and commit**

Run: `bun test`
Expected: PASS, all tests.

```bash
git add -A
git commit -m "feat(ui): add settings for currency, rates, posts, and data

Rate fetching is optional and fails soft. Import replaces everything and
downloads a backup first."
```

---

## Phase 5 — Ship

### Task 24: PWA — service worker, manifest, and the production build

No PWA plugin exists for Bun, so the service worker and manifest are ours.
`build.ts` emits the precache list from `Bun.build`'s outputs, so hashed
filenames stay in sync automatically.

**Files:**
- Create: `src/sw.ts`, `src/ui/components/UpdatePrompt.tsx`, `src/ui/registerSw.ts`, `src/icon.svg`
- Modify: `build.ts`, `src/index.html`, `src/frontend.tsx`, `src/ui/App.tsx`, `package.json`
- Test: `src/ui/registerSw.test.ts`

**Interfaces:**
- Consumes: `BASE_PATH`, `withBase` from `./basePath.ts`.
- Produces:
  - `registerServiceWorker(onUpdateReady: () => void): void`
  - `applyUpdate(): void`
  - `buildManifest(basePath: string): string` (in `build.ts`, exported for testing)

- [ ] **Step 1: Write the failing test for registration guards**

The registration helper must be safe to call where service workers do not
exist — happy-dom, and any non-secure context.

```ts
// src/ui/registerSw.test.ts
import { test, expect } from "bun:test";
import { registerServiceWorker } from "./registerSw.ts";

test("registration is a no-op when the browser has no service worker support", () => {
  const original = (globalThis as any).navigator;
  // happy-dom's navigator has no serviceWorker, which is the case under test.
  expect(() => registerServiceWorker(() => {})).not.toThrow();
  (globalThis as any).navigator = original;
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/ui/registerSw.test.ts`
Expected: FAIL — cannot resolve `./registerSw.ts`.

- [ ] **Step 3: Implement the service worker**

```ts
// src/sw.ts
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// Both are replaced at build time by Bun.build's `define`.
const PRECACHE: string[] = JSON.parse(process.env.PRECACHE_MANIFEST ?? "[]");
const VERSION = process.env.SW_VERSION ?? "dev";
const BASE = process.env.BUN_PUBLIC_BASE_PATH ?? "/";

const CACHE = `budget2-${VERSION}`;
const SHELL = `${BASE}index.html`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([...PRECACHE, SHELL])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions.
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // Sent by applyUpdate() when the user accepts a new version.
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache the rate API

  // Navigations fall back to the cached shell, which also covers deep links.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          return (await caches.match(SHELL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Hashed assets: cache-first, since a changed file gets a new name.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        void cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
```

- [ ] **Step 4: Implement registration and the update prompt**

```ts
// src/ui/registerSw.ts
import { BASE_PATH, withBase } from "./basePath.ts";

let waiting: ServiceWorker | null = null;

/**
 * Registers the worker and calls `onUpdateReady` when a new version is waiting.
 * Without an explicit update path, a stale worker can pin the user to an old
 * build indefinitely.
 */
export function registerServiceWorker(onUpdateReady: () => void): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  void navigator.serviceWorker
    .register(withBase("sw.js"), { scope: BASE_PATH })
    .then((registration) => {
      if (registration.waiting) {
        waiting = registration.waiting;
        onUpdateReady();
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            waiting = installing;
            onUpdateReady();
          }
        });
      });
    })
    .catch(() => {
      // An unavailable worker must never break the app; it just means no offline.
    });
}

export function applyUpdate(): void {
  waiting?.postMessage({ type: "SKIP_WAITING" });
  waiting = null;
  window.location.reload();
}
```

```tsx
// src/ui/components/UpdatePrompt.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { applyUpdate, registerServiceWorker } from "../registerSw.ts";

export function UpdatePrompt() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    registerServiceWorker(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <div className="fixed bottom-4 right-4 flex items-center gap-3 rounded border bg-background p-3 text-sm shadow-lg">
      <span>A new version is ready.</span>
      <Button size="sm" onClick={applyUpdate}>
        Reload
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setReady(false)}>
        Later
      </Button>
    </div>
  );
}
```

Render `<UpdatePrompt />` inside `AppRoutes`, just before the closing `</div>`.

- [ ] **Step 5: Add an app icon**

Create `src/icon.svg` — a simple mark is enough:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <path d="M128 320h64V192h-64zm96 0h64V128h-64zm96 0h64V240h-64z" fill="#38bdf8"/>
  <rect x="96" y="352" width="320" height="24" rx="12" fill="#e2e8f0"/>
</svg>
```

Note: Chrome's install prompt wants a 192px and a 512px PNG. Add
`src/icon-192.png` and `src/icon-512.png` when you want installability; the SVG
alone is enough for offline caching to work.

- [ ] **Step 6: Rewrite the production build**

```ts
// build.ts
import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";
import { normalizeBase } from "./src/ui/basePath.ts";

const basePath = normalizeBase(process.env.BUN_PUBLIC_BASE_PATH);
const outdir = path.join(process.cwd(), "dist");
const version = process.env.BUILD_VERSION ?? String(Date.now());

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [...new Bun.Glob("src/**/*.html").scanSync()],
  outdir,
  plugins: [tailwind],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  // publicPath prefixes asset and chunk imports, which is what makes a subpath
  // deploy work without hardcoding it anywhere.
  publicPath: basePath,
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.BUN_PUBLIC_BASE_PATH": JSON.stringify(basePath),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Build failed");
}

// The precache list comes from the build's own outputs, so hashed filenames can
// never drift out of sync with the service worker.
const precache = result.outputs
  .filter((output) => !output.path.endsWith(".map"))
  .map((output) => basePath + path.relative(outdir, output.path).replaceAll(path.sep, "/"));

const swResult = await Bun.build({
  entrypoints: ["src/sw.ts"],
  outdir,
  target: "browser",
  minify: true,
  naming: "sw.js", // must be a stable URL, so no hash
  define: {
    "process.env.PRECACHE_MANIFEST": JSON.stringify(JSON.stringify(precache)),
    "process.env.SW_VERSION": JSON.stringify(version),
    "process.env.BUN_PUBLIC_BASE_PATH": JSON.stringify(basePath),
  },
});

if (!swResult.success) {
  for (const log of swResult.logs) console.error(log);
  throw new Error("Service worker build failed");
}

export function buildManifest(base: string): string {
  return JSON.stringify(
    {
      name: "Budget 2.0",
      short_name: "Budget",
      start_url: base,
      scope: base,
      display: "standalone",
      background_color: "#0f172a",
      theme_color: "#0f172a",
      icons: [{ src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml" }],
    },
    null,
    2,
  );
}

await Bun.write(path.join(outdir, "manifest.webmanifest"), buildManifest(basePath));
await Bun.write(path.join(outdir, "icon.svg"), Bun.file("src/icon.svg"));

// GitHub Pages has no rewrite rules, so a deep link on a cold load lands on
// 404.html. Serving the shell from there makes client-side routing work.
const indexHtml = await Bun.file(path.join(outdir, "index.html")).text();
await Bun.write(path.join(outdir, "404.html"), indexHtml);

console.log(`Built for base path ${basePath}`);
for (const output of result.outputs) {
  console.log(
    `  ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`,
  );
}
```

- [ ] **Step 7: Link the manifest from the HTML**

Add to `<head>` in `src/index.html`:

```html
<link rel="manifest" href="manifest.webmanifest" />
<link rel="icon" href="icon.svg" type="image/svg+xml" />
<meta name="theme-color" content="#0f172a" />
```

Relative hrefs are used deliberately: they resolve against the page's own URL,
so they work at both `/` and `/budget2.0/` with no substitution.

- [ ] **Step 8: Run the tests and verify the build**

Run: `bun test`
Expected: PASS, all tests.

```bash
bun run build
ls dist
```

Expected: `dist/` contains `index.html`, `404.html`, `sw.js`,
`manifest.webmanifest`, `icon.svg`, and hashed JS/CSS.

```bash
BUN_PUBLIC_BASE_PATH=/budget2.0/ bun run build
grep -o '"/budget2.0/[^"]*"' dist/sw.js | head
```

Expected: the precache entries are prefixed with `/budget2.0/`. Confirm
`dist/manifest.webmanifest` has `"scope": "/budget2.0/"`.

- [ ] **Step 9: Verify offline behaviour**

```bash
bun run build && bunx serve dist -l 4000
```

In the browser at `http://localhost:4000`: confirm the service worker registers
(Application → Service Workers), then tick "Offline" and reload. The app must
load and remain fully usable. Navigate directly to
`http://localhost:4000/summary` while offline — the navigation fallback must
serve the shell rather than a 404.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(pwa): add service worker, manifest, and subpath-aware build

The precache list is generated from Bun.build's outputs, so hashed asset
names cannot drift. A waiting worker prompts to reload rather than
pinning the user to a stale build."
```

---

### Task 25: Docker and CI

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `server.ts`, `.github/workflows/ci.yml`, `.github/workflows/pages.yml`
- Modify: `package.json` (add `serve` script), `README.md`

**Interfaces:**
- Consumes: `dist/` from Task 24's build.
- Produces: a runnable container and two CI workflows.

- [ ] **Step 1: Write the static server**

```ts
// server.ts
import { serve } from "bun";
import path from "node:path";

const root = path.join(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 3000);
const basePath = (process.env.BUN_PUBLIC_BASE_PATH ?? "/").replace(/\/*$/, "/");

serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (basePath !== "/" && pathname.startsWith(basePath)) {
      pathname = `/${pathname.slice(basePath.length)}`;
    }

    // Reject traversal before touching the filesystem.
    const resolved = path.join(root, pathname);
    if (!resolved.startsWith(root)) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(resolved);
    if (await file.exists()) {
      const headers =
        // sw.js must never be served stale, or updates can never land.
        pathname.endsWith("/sw.js")
          ? { "Cache-Control": "no-cache" }
          : /-[A-Za-z0-9]{8,}\.(js|css)$/.test(pathname)
            ? { "Cache-Control": "public, max-age=31536000, immutable" }
            : { "Cache-Control": "no-cache" };
      return new Response(file, { headers });
    }

    // Client-side routing: unknown paths get the shell.
    return new Response(Bun.file(path.join(root, "index.html")), {
      headers: { "Cache-Control": "no-cache", "Content-Type": "text/html" },
    });
  },
});

console.log(`Serving dist on http://localhost:${port}${basePath}`);
```

Add to `package.json` scripts:

```json
    "serve": "bun server.ts",
    "test": "bun test"
```

- [ ] **Step 2: Write the Dockerfile**

```dockerfile
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG BUN_PUBLIC_BASE_PATH=/
ENV BUN_PUBLIC_BASE_PATH=$BUN_PUBLIC_BASE_PATH
RUN bun run build

FROM oven/bun:1.3-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.ts ./
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "server.ts"]
```

```
# .dockerignore
node_modules
dist
.git
.idea
docs
```

- [ ] **Step 3: Verify the container**

```bash
docker build -t budget2 .
docker run --rm -p 3000:3000 budget2
```

Expected: the app loads at `http://localhost:3000`, and a hard reload of
`http://localhost:3000/summary` serves the app rather than a 404.

Then check the subpath build:

```bash
docker build -t budget2-sub --build-arg BUN_PUBLIC_BASE_PATH=/budget2.0/ .
docker run --rm -p 3001:3000 -e BUN_PUBLIC_BASE_PATH=/budget2.0/ budget2-sub
```

Expected: the app loads at `http://localhost:3001/budget2.0/` with assets
resolving correctly.

- [ ] **Step 4: Write the CI workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun test
      - run: bunx tsc --noEmit
      - run: bun run build

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t budget2 .
      - name: Serve the image and check it responds
        run: |
          docker run -d --rm -p 3000:3000 --name budget2 budget2
          for i in $(seq 1 30); do
            if curl -fsS http://localhost:3000/ > /dev/null; then break; fi
            sleep 1
          done
          curl -fsS http://localhost:3000/ | grep -q "Budget"
          curl -fsS http://localhost:3000/sw.js > /dev/null
          curl -fsS http://localhost:3000/manifest.webmanifest > /dev/null
          docker stop budget2
```

- [ ] **Step 5: Write the Pages workflow**

The repository is `budget2.0`, so Pages serves it from `/budget2.0/`.

```yaml
# .github/workflows/pages.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun test
      - name: Build for the Pages subpath
        env:
          BUN_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}/
          BUILD_VERSION: ${{ github.sha }}
        run: bun run build
      - name: Stop Pages from running the output through Jekyll
        run: touch dist/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: Document it in the README**

Replace `README.md` with:

```markdown
# Budget 2.0

A personal budgeting PWA. Envelope-style monthly budgets with rollover, split
purchases, finance plans, multi-currency, and JSON/ODS export. All data lives in
your browser — there is no server and no account.

## Development

```bash
bun install
bun --hot src/index.ts    # dev server with hot reload
bun test                  # run the test suite
bun run build             # production build into dist/
```

## Self-hosting with Docker

```bash
docker build -t budget2 .
docker run --rm -p 3000:3000 budget2
```

To serve from a subpath, build and run with `BUN_PUBLIC_BASE_PATH`:

```bash
docker build -t budget2 --build-arg BUN_PUBLIC_BASE_PATH=/budget/ .
docker run --rm -p 3000:3000 -e BUN_PUBLIC_BASE_PATH=/budget/ budget2
```

## GitHub Pages

Pushing to `main` builds and deploys to Pages automatically, using
`/<repository-name>/` as the base path. Enable Pages with "GitHub Actions" as
the source in the repository settings.

## Your data

Everything is stored in this browser's IndexedDB. **Export regularly** from
Settings → Your data: the JSON export is both your backup and how you move your
budget to another device. Import replaces everything and downloads a backup of
your current data first.

## Documentation

- Design: `docs/superpowers/specs/2026-09-01-budget-app-design.md`
- Implementation plan: `docs/superpowers/plans/2026-09-01-budget-app.md`
```

- [ ] **Step 7: Final verification**

Run each and confirm it passes:

```bash
bun test
bunx tsc --noEmit
bun run build
docker build -t budget2 .
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(deploy): add Docker image, static server, and CI workflows

One build artifact serves both a self-hosted subpath deploy and GitHub
Pages. CI runs the tests, typechecks, builds, and smoke-tests the image."
```
