# Recurring Costs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bills that repeat — rent monthly, a subscription every 28 days, a phone bill every 30 days whose clock restarts when the data cap is hit — project as *expected* charges and are confirmed into real purchases when the money moves.

**Architecture:** A new `RecurringCost` entity projects occurrence dates through a pure walk (`src/domain/occurrences.ts`) built on new pure day arithmetic (`src/domain/days.ts`). Occurrences are computed on every fold and never stored. The fold gains a second balance track — `projected` alongside `remaining` — fed by unconfirmed occurrences. Confirming one writes an ordinary `Purchase` carrying `source: { recurringId, occurrenceDate }`, which suppresses that slot on the next fold.

**Tech Stack:** Bun (runtime, test runner, bundler, package manager), TypeScript, React 19, Tailwind 4, shadcn/ui. No new dependencies.

**Spec:** `docs/specs/2026-09-03-recurring-costs-design.md` — read it before Task 1. The plan argues from the spec; where they disagree, the spec wins and the plan is wrong.

## Global Constraints

Copied verbatim from `AGENTS.md`. Every task's requirements implicitly include these.

- **Bun only.** `bun test`, `bun install`, `bun run <script>`, `bunx`. Never node, npm, jest, vitest, webpack, vite.
- **`src/domain/` is pure.** No React, no IndexedDB, no `Date.now()`, no `new Date()` without an explicit argument. `src/domain/smoke.test.ts` imports it with no DOM.
- **No `Date` at all in `days.ts` or `occurrences.ts`.** `months.ts` avoids `Date` to avoid timezones; the new modules hold that line. Integer arithmetic on a day ordinal only.
- **`roundMoney(amount, digits)` takes a DIGIT COUNT.** Read `dataset.settings.digits`. There is no `digitsFor`, and `CurrencyDef` has no `digits` (removed in `8d2b2ca`).
- **Round after any division, after any FX conversion, and before persisting.** Display is a boundary too: use `useMoneyFormat()` in components, never a literal `2`.
- **When splitting an amount, never round the last part independently.** `distributeByWeight` / `distributeByAmount` already do this; do not hand-roll a split.
- **Never read `event.target.value` inside a `mutate()` callback.** Capture it into a `const` in the handler first. → `src/ui/eventCapture.test.ts`
- **Every awaited `store.*` call in `src/ui/` must be guarded.** Use `useMutate`. → `src/ui/storeWriteErrors.test.ts`
- **Never define a bare `--accent`**, and never `var()` a token `src/index.css` does not define. → `src/cssPairs.test.ts`, `src/ui/cssTokens.test.ts`
- **A migration step must not import a live default.** Frozen local copies only. → `src/store/migrations.test.ts`
- **Do not "fix" a domain throw by making it return a fallback.** Silently wrong numbers are worse than a visible error.
- **Schema version for this work is 7.** The decimals change took 6 in `8d2b2ca`.

## Clarification the spec leaves implicit

`RecurringCost.archived` is a **UI flag only**. Projection is governed by `startDate` and `endedFrom`, exactly as archived posts still fold. Archiving must never retroactively delete past expected charges, because that would silently move a historical `projected` figure. The UI's "end" action sets **both** `endedFrom` and `archived` — see Task 6's `endRecurringCost`.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/domain/days.ts` | create | Day ordinal arithmetic. No `Date`. |
| `src/domain/days.test.ts` | create | Round-trips, leap years, weekdays. |
| `src/domain/occurrences.ts` | create | The walk: recurrence → occurrence dates. |
| `src/domain/occurrences.test.ts` | create | All kinds, both anchorings, the phone bill. |
| `src/domain/types.ts` | modify | `Recurrence`, `Anchoring`, `RecurringCost`, `Purchase.source`, `Dataset.recurring`. |
| `src/domain/seed.ts` | modify | `SCHEMA_VERSION` 7, `recurring: []`. |
| `src/domain/charges.ts` | modify | Extract `splitParts` / `distributeToSplits`; add `expectedForMonth`. |
| `src/domain/fold.ts` | modify | Second balance track. |
| `src/domain/index.ts` | modify | Re-export the two new modules. |
| `src/store/migrations.ts` | modify | Step 6 → 7. |
| `src/store/actions.ts` | modify | CRUD plus `confirmOccurrence`. |
| `src/export/json.ts` | modify | Validate `recurring` and `Purchase.source`. |
| `src/ui/routes/settings/RecurringSection.tsx` | create | Define costs. |
| `src/ui/components/ExpectedBand.tsx` | create | Confirm occurrences in the month view. |
| `src/ui/routes/SettingsRoute.tsx` | modify | Mount `RecurringSection`. |
| `src/ui/routes/MonthRoute.tsx` | modify | Mount `ExpectedBand`. |
| `scripts/demo-data.ts` | modify | Seed a rent and a 28-day subscription. |

---

### Task 1: Day arithmetic

**Files:**
- Create: `src/domain/days.ts`
- Test: `src/domain/days.test.ts`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Consumes: `IsoDate` from `src/domain/types.ts` (exists).
- Produces: `toDayOrdinal(date: IsoDate): number`, `fromDayOrdinal(ordinal: number): IsoDate`, `addDays(date: IsoDate, count: number): IsoDate`, `weekdayOf(date: IsoDate): number` (0 = Sunday), `isDayGranular(date: IsoDate): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/days.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { addDays, fromDayOrdinal, isDayGranular, toDayOrdinal, weekdayOf } from "./days.ts";

describe("day ordinals", () => {
  test("the epoch is day zero", () => {
    expect(toDayOrdinal("1970-01-01")).toBe(0);
  });

  test("known dates convert to known ordinals", () => {
    expect(toDayOrdinal("1969-12-31")).toBe(-1);
    expect(toDayOrdinal("2000-03-01")).toBe(11017);
    expect(toDayOrdinal("2026-09-03")).toBe(20699);
  });

  test("every date in a four-year window round-trips", () => {
    // 2024 is a leap year, 2025 and 2026 are not, so this covers both.
    for (let ordinal = toDayOrdinal("2024-01-01"); ordinal <= toDayOrdinal("2027-12-31"); ordinal++) {
      expect(toDayOrdinal(fromDayOrdinal(ordinal))).toBe(ordinal);
    }
  });

  test("leap day exists in 2024 and not in 2026", () => {
    expect(fromDayOrdinal(toDayOrdinal("2024-02-28") + 1)).toBe("2024-02-29");
    expect(fromDayOrdinal(toDayOrdinal("2026-02-28") + 1)).toBe("2026-03-01");
  });

  test("century rules: 1900 is not a leap year, 2000 is", () => {
    expect(fromDayOrdinal(toDayOrdinal("1900-02-28") + 1)).toBe("1900-03-01");
    expect(fromDayOrdinal(toDayOrdinal("2000-02-28") + 1)).toBe("2000-02-29");
  });

  test("a month-only date is rejected, not silently treated as the first", () => {
    expect(() => toDayOrdinal("2026-09")).toThrow(/day-granular/);
  });

  test("an impossible day is rejected", () => {
    expect(() => toDayOrdinal("2026-02-30")).toThrow();
    expect(() => toDayOrdinal("2026-13-01")).toThrow();
  });
});

describe("addDays", () => {
  test("crosses a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  test("crosses a year boundary", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
  });

  test("a 28-day cycle lands on the same weekday every time", () => {
    let date = "2026-01-05";
    const weekday = weekdayOf(date);
    for (let i = 0; i < 13; i++) {
      date = addDays(date, 28);
      expect(weekdayOf(date)).toBe(weekday);
    }
  });

  test("a 30-day cycle drifts through the calendar", () => {
    // The phone bill's shape: 30 days is not a month, so it walks backwards
    // through the month over a year.
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });
});

describe("weekdayOf", () => {
  test("the epoch was a Thursday", () => {
    expect(weekdayOf("1970-01-01")).toBe(4);
  });

  test("known weekdays", () => {
    expect(weekdayOf("2026-09-03")).toBe(4); // Thursday
    expect(weekdayOf("2026-09-06")).toBe(0); // Sunday
    expect(weekdayOf("2026-09-07")).toBe(1); // Monday
  });

  test("seven consecutive days cover every weekday exactly once", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 7; i++) seen.add(weekdayOf(addDays("2026-09-03", i)));
    expect(seen.size).toBe(7);
  });
});

describe("isDayGranular", () => {
  test("distinguishes the two IsoDate shapes", () => {
    expect(isDayGranular("2026-09-03")).toBe(true);
    expect(isDayGranular("2026-09")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/days.test.ts`
Expected: FAIL — `Cannot find module './days.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/days.ts`:

```ts
import type { IsoDate } from "./types.ts";

/**
 * Day-level arithmetic, in the same character as `months.ts`: integer maths on
 * a day ordinal, never a `Date`.
 *
 * `months.ts` avoids `Date` to avoid timezones, and the reasoning applies here
 * with more force. "2026-03-29" names the same day everywhere; the instant a
 * `Date` would give it does not, and a recurrence that steps 28 days must not
 * gain or lose one at a DST boundary or in a different host timezone.
 *
 * Only the day-granular recurrences need this. `everyNMonths` stays on
 * `months.ts`, because rent occurs IN a month rather than on a date.
 */

const DAY_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Cheap enough to inline, but named because the walk branches on it. */
export function isDayGranular(date: IsoDate): boolean {
  return DAY_DATE.test(date);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Days since 1970-01-01, by Howard Hinnant's `days_from_civil`. Proleptic
 * Gregorian, exact for every date this app can hold, and pure integer maths.
 *
 * The algorithm shifts the year to start in March so that the leap day is the
 * LAST day of the year rather than an insertion in the middle, which is what
 * removes every special case from the day-of-year term.
 */
export function toDayOrdinal(date: IsoDate): number {
  const match = DAY_DATE.exec(date);
  if (!match) {
    throw new Error(`Not a day-granular IsoDate: ${date}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in IsoDate: ${date}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid day in IsoDate: ${date}`);
  }

  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The exact inverse of `toDayOrdinal` (Hinnant's `civil_from_days`). */
export function fromDayOrdinal(ordinal: number): IsoDate {
  const z = ordinal + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth + (shiftedMonth < 10 ? 3 : -9);
  const calendarYear = month <= 2 ? year + 1 : year;

  return `${String(calendarYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: IsoDate, count: number): IsoDate {
  return fromDayOrdinal(toDayOrdinal(date) + count);
}

/** 0 = Sunday. Day 0 of the ordinal was a Thursday, hence the + 4. */
export function weekdayOf(date: IsoDate): number {
  const shifted = (toDayOrdinal(date) + 4) % 7;
  return shifted < 0 ? shifted + 7 : shifted;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/domain/days.test.ts`
Expected: PASS, all tests.

If `toDayOrdinal("2026-09-03")` does not equal `20699`, the algorithm is wrong — do not adjust the expected value to match the code. Check the epoch case first (`1970-01-01` must be `0`).

- [ ] **Step 5: Re-export from the domain index**

In `src/domain/index.ts`, add after the `months.ts` line:

```ts
export * from "./days.ts";
```

- [ ] **Step 6: Run the whole suite**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS. Nothing else imports `days.ts` yet, so this only proves nothing broke.

- [ ] **Step 7: Commit**

```bash
git add src/domain/days.ts src/domain/days.test.ts src/domain/index.ts
git commit -m "feat(domain): day arithmetic without Date

Recurrences of 28 and 30 days do not align to months, so the domain needs
day-level maths for the first time. It gets it the way months.ts does: an
integer ordinal, no Date anywhere. A Date would make 2026-03-29 a different
instant per timezone while being the same day everywhere, and a 28-day step
must not gain or lose a day at a DST boundary.

Hinnant's days_from_civil, which shifts the year to start in March so the leap
day is the last day rather than an insertion, removing every special case."
```

---

### Task 2: Types, seed and the 6 → 7 migration

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/seed.ts`
- Modify: `src/store/migrations.ts`
- Test: `src/store/migrations.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Recurrence`, `Anchoring`, `RecurringCostId`, `RecurringCost`, `Purchase.source`, `Dataset.recurring`, `SCHEMA_VERSION = 7`.

These land together because adding a required field to `Dataset` does not typecheck until `createSeedDataset` supplies it.

- [ ] **Step 1: Write the failing migration test**

In `src/store/migrations.test.ts`, add a new `describe` block at the end:

```ts
describe("6 -> 7: recurring costs join the dataset", () => {
  test("a v6 dataset gains an empty recurring array", () => {
    const v6 = { ...createSeedDataset("2026-09"), recurring: undefined };
    delete (v6 as any).recurring;
    (v6 as any).settings = { ...v6.settings, schemaVersion: 6 };

    const migrated = migrate(v6 as any);

    expect(migrated.recurring).toEqual([]);
    expect(migrated.settings.schemaVersion).toBe(SCHEMA_VERSION);
  });

  test("recurring costs the owner already has are left alone", () => {
    // A hand-edited file could already carry them; discarding would be data loss.
    const existing = [{ id: "r1", name: "Rent" }];
    const v6: any = { ...createSeedDataset("2026-09"), recurring: existing };
    v6.settings = { ...v6.settings, schemaVersion: 6 };

    expect(migrate(v6).recurring).toEqual(existing);
  });

  test("NO figure changes: every post in every month folds identically", () => {
    const v6: any = { ...createSeedDataset("2026-09"), settings: { ...createSeedDataset("2026-09").settings, schemaVersion: 6 } };
    delete v6.recurring;

    const migrated = migrate(v6);
    const fold = foldBalances(migrated, "2026-12");

    for (const post of migrated.posts) {
      for (const month of ["2026-09", "2026-10", "2026-11", "2026-12"]) {
        const figures = figuresFor(fold, post.id, month);
        expect(figures.projected).toBe(figures.remaining);
        expect(figures.expected).toBe(0);
      }
    }
  });
});
```

Add to the imports at the top of that file:

```ts
import { figuresFor, foldBalances } from "../domain/fold.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/migrations.test.ts`
Expected: FAIL — `migrated.recurring` is `undefined`, and `figures.projected` does not exist.

The third test cannot pass until Task 5. That is expected and correct: it is the behaviour-preservation guard, and it is written here because this is the task that creates the risk.

- [ ] **Step 3: Add the types**

In `src/domain/types.ts`, add after the `Schedule` interface:

```ts
export type RecurringCostId = string;

/**
 * How occurrence dates are generated.
 *
 * Extensible on purpose: a new variant here plus one case in `stepFrom`
 * (`occurrences.ts`) is the whole change — nothing else in the app switches on
 * this. `n` must be an integer >= 1 in every variant, which is what makes the
 * projection walk terminate; both write boundaries enforce it.
 */
export type Recurrence =
  | { kind: "everyNMonths"; n: number }
  | { kind: "everyNDays"; n: number }
  /** `weekday` is 0 = Sunday, matching `weekdayOf` in `days.ts`. */
  | { kind: "everyNWeeks"; n: number; weekday: number };

/**
 * Where the NEXT occurrence is measured from.
 *
 * `calendar` — from the previous slot, wherever it fell. Rent, and a
 * subscription that bills on its own schedule whatever you do.
 *
 * `lastCharge` — from the date the previous charge ACTUALLY happened. This is
 * the phone bill: hitting the data cap makes a charge happen early, and the
 * next 30 days run from there. The domain never learns what a data cap is;
 * confirming the occurrence early is the whole mechanism.
 */
export type Anchoring = "calendar" | "lastCharge";

export interface RecurringCost {
  id: RecurringCostId;
  name: string;
  order: number;
  /**
   * A UI flag ONLY. Projection is governed by `startDate` and `endedFrom`,
   * exactly as an archived post still folds — archiving must not retroactively
   * remove past expected charges, because that would move a historical figure.
   */
  archived: boolean;
  /**
   * Expected amount, in its own currency, converted to base at fold time.
   *
   * A single mutable value with no dated series, unlike `Post.rules`. A rent
   * increase edits it, and history survives because every past occurrence is
   * a confirmed `Purchase` holding what was actually paid. Only unconfirmed
   * future occurrences move.
   */
  amount: Money;
  /** The first occurrence. "YYYY-MM" for everyNMonths, "YYYY-MM-DD" otherwise. */
  startDate: IsoDate;
  /** Occurrences on or after this date are not projected. This is cancellation. */
  endedFrom?: IsoDate;
  recurrence: Recurrence;
  anchoring: Anchoring;
  /** Same shape and same invariant as Purchase: exactly one absorbsRemainder. */
  splitMode: "percent" | "fixed";
  splits: Split[];
}
```

Then add to `Purchase`, after `schedule`:

```ts
  /**
   * Present when this purchase confirms a projected occurrence.
   *
   * `occurrenceDate` is IDENTITY — the slot the projector generated, which
   * this purchase claims so the slot stops being projected. `Purchase.date` is
   * TRUTH — when the money moved. They differ whenever a bill is paid off
   * schedule, and under `lastCharge` anchoring it is `date`, not
   * `occurrenceDate`, that the next occurrence is measured from.
   */
  source?: { recurringId: RecurringCostId; occurrenceDate: IsoDate };
```

And to `Dataset`, after `purchases`:

```ts
  /**
   * Bills that repeat. Their occurrences are COMPUTED on every fold and never
   * stored — the original design rejected materialised snapshots, and an
   * unbounded recurrence would otherwise need an arbitrary horizon.
   */
  recurring: RecurringCost[];
```

- [ ] **Step 4: Bump the schema version and seed the field**

In `src/domain/seed.ts`:

```ts
export const SCHEMA_VERSION = 7;
```

and in the object `createSeedDataset` returns, add alongside `purchases`:

```ts
    recurring: [],
```

A new dataset seeds no recurring costs. Unlike currencies and FX rates, there is no sensible default bill — the app cannot guess what the owner pays.

- [ ] **Step 5: Add the migration step**

In `src/store/migrations.ts`, append to the `MIGRATIONS` array, after the 5 → 6 step:

```ts
  // 6 -> 7: recurring costs join the dataset.
  //
  // Behaviour-preserving by construction, and more strongly than most: an
  // empty array projects no occurrences, so `expected` is zero everywhere and
  // `projected` equals `remaining` in every month of every existing dataset.
  // Not one stored figure is read, let alone written.
  //
  // An existing `recurring` field is left alone rather than overwritten, for
  // the same reason the 2 -> 3 step leaves `currencies` alone: a hand-edited
  // file could already carry them, and discarding them would be data loss.
  //
  // Nothing is frozen here because nothing is copied — the step writes a
  // literal empty array and reads no default, live or otherwise.
  (data: any) => ({
    ...data,
    settings: { ...data.settings, schemaVersion: 7 },
    recurring: Array.isArray(data.recurring) ? data.recurring : [],
  }),
```

- [ ] **Step 6: Fix the Dataset literals the new required field breaks**

Run: `bunx tsc --noEmit`

Six files construct `Dataset` object literals and now fail to typecheck. Add `recurring: [],` to each:

```
src/domain/allocation.test.ts
src/domain/charges.test.ts
src/domain/currencyDigits.test.ts
src/domain/views.test.ts
src/store/migrations.test.ts
```

(`src/domain/seed.ts` was handled in Step 4.) Find them with:

```bash
grep -rn "purchases: \[" src/
```

- [ ] **Step 7: Run the tests**

Run: `bun test src/store/migrations.test.ts && bunx tsc --noEmit`
Expected: the two `recurring`-array tests PASS; the "NO figure changes" test still FAILS on `figures.projected` being undefined. That is correct until Task 5.

- [ ] **Step 8: Commit**

```bash
git add src/domain/types.ts src/domain/seed.ts src/store/migrations.ts src/store/migrations.test.ts src/domain/*.test.ts
git commit -m "feat(types): recurring costs in the dataset, schema 7

Recurrence is two orthogonal fields, not a list of special cases: a kind
(everyNMonths / everyNDays / everyNWeeks) and an anchoring (calendar /
lastCharge). The phone bill that recharges early when its data cap is hit is
everyNDays(30) anchored to lastCharge — the domain never learns what a data cap
is, because confirming the occurrence early already records the date.

Purchase.source pairs occurrenceDate (identity: which slot this claims) with
Purchase.date (truth: when the money moved). They differ whenever a bill is
paid off schedule, and lastCharge measures from the latter.

RecurringCost.amount is a single mutable Money with no RuleVersion-style
series. Safe only because confirmed purchases hold what was actually paid;
under projection-only it would destroy history.

The 6 -> 7 step writes an empty array and reads nothing. Decimals took 6."
```

---

### Task 3: The occurrence walk

**Files:**
- Create: `src/domain/occurrences.ts`
- Test: `src/domain/occurrences.test.ts`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Consumes: `addDays`, `weekdayOf` (Task 1); `RecurringCost`, `Recurrence`, `Occurrence` types (Task 2); `addMonths`, `compareMonths`, `monthOf` from `src/domain/months.ts` (exists).
- Produces:
  - `interface Occurrence { recurringId: RecurringCostId; date: IsoDate; amount: Money; confirmedBy: PurchaseId | null }`
  - `stepFrom(date: IsoDate, recurrence: Recurrence): IsoDate`
  - `confirmationsFor(purchases: readonly Purchase[], recurringId: RecurringCostId): Map<IsoDate, Purchase>`
  - `occurrencesOf(cost: RecurringCost, confirmations: ReadonlyMap<IsoDate, Purchase>, upToMonth: MonthId): Occurrence[]`
  - `occurrencesByMonth(dataset: Dataset, upToMonth: MonthId): Map<MonthId, Occurrence[]>`

- [ ] **Step 1: Write the failing test**

Create `src/domain/occurrences.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { occurrencesByMonth, occurrencesOf, stepFrom } from "./occurrences.ts";
import type { Dataset, Purchase, RecurringCost } from "./types.ts";

function cost(overrides: Partial<RecurringCost> = {}): RecurringCost {
  return {
    id: "r1",
    name: "Rent",
    order: 0,
    archived: false,
    amount: { amount: 8000, currency: "DKK" },
    startDate: "2026-01",
    recurrence: { kind: "everyNMonths", n: 1 },
    anchoring: "calendar",
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    ...overrides,
  };
}

function confirmation(occurrenceDate: string, paidOn: string, id = "p1"): Purchase {
  return {
    id,
    date: paidOn,
    description: "Rent",
    total: { amount: 8000, currency: "DKK" },
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    schedule: null,
    source: { recurringId: "r1", occurrenceDate },
  };
}

const none = new Map<string, Purchase>();

describe("stepFrom", () => {
  test("everyNMonths steps whole months and stays month-granular", () => {
    expect(stepFrom("2026-01", { kind: "everyNMonths", n: 1 })).toBe("2026-02");
    expect(stepFrom("2026-11", { kind: "everyNMonths", n: 3 })).toBe("2027-02");
  });

  test("everyNMonths from a day-granular date returns the month", () => {
    // Reachable under lastCharge anchoring, where the step runs from an actual
    // purchase date.
    expect(stepFrom("2026-01-17", { kind: "everyNMonths", n: 1 })).toBe("2026-02");
  });

  test("everyNDays steps days", () => {
    expect(stepFrom("2026-01-05", { kind: "everyNDays", n: 28 })).toBe("2026-02-02");
    expect(stepFrom("2026-01-31", { kind: "everyNDays", n: 30 })).toBe("2026-03-02");
  });

  test("everyNWeeks lands on the named weekday", () => {
    // 2026-09-03 is a Thursday (4). Two weeks on is 2026-09-17, also Thursday.
    expect(stepFrom("2026-09-03", { kind: "everyNWeeks", n: 2, weekday: 4 })).toBe("2026-09-17");
  });

  test("everyNWeeks snaps forward when the cursor is off-weekday", () => {
    // Reachable under lastCharge: paid on a Saturday, but the series is Thursdays.
    // 2026-09-05 is a Saturday; +1 week is 2026-09-12 (Saturday), snapping
    // forward to the next Thursday gives 2026-09-17.
    expect(stepFrom("2026-09-05", { kind: "everyNWeeks", n: 1, weekday: 4 })).toBe("2026-09-17");
  });
});

describe("occurrencesOf — calendar anchoring", () => {
  test("a monthly cost yields one occurrence per month", () => {
    const dates = occurrencesOf(cost(), none, "2026-04").map((o) => o.date);
    expect(dates).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  test("a 28-day cost puts two occurrences in some months", () => {
    const subscription = cost({
      startDate: "2026-01-05",
      recurrence: { kind: "everyNDays", n: 28 },
    });
    const dates = occurrencesOf(subscription, none, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-05", "2026-02-02", "2026-03-02", "2026-03-30"]);
  });

  test("nothing is produced before the start date", () => {
    const later = cost({ startDate: "2026-03" });
    expect(occurrencesOf(later, none, "2026-04").map((o) => o.date)).toEqual([
      "2026-03",
      "2026-04",
    ]);
  });

  test("endedFrom stops the series, and the boundary date itself is excluded", () => {
    const ended = cost({ endedFrom: "2026-03" });
    expect(occurrencesOf(ended, none, "2026-06").map((o) => o.date)).toEqual([
      "2026-01",
      "2026-02",
    ]);
  });

  test("a confirmation does NOT move a calendar-anchored series", () => {
    const paidLate = new Map([["2026-01", confirmation("2026-01", "2026-01-28")]]);
    const dates = occurrencesOf(cost(), paidLate, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  test("archived does not stop projection", () => {
    // Archiving is a UI flag. Stopping a bill is endedFrom, because archiving
    // must not retroactively remove a past expected charge.
    const dates = occurrencesOf(cost({ archived: true }), none, "2026-02").map((o) => o.date);
    expect(dates).toEqual(["2026-01", "2026-02"]);
  });
});

describe("occurrencesOf — confirmation", () => {
  test("a confirmed slot carries the purchase id", () => {
    const claimed = new Map([["2026-02", confirmation("2026-02", "2026-02", "pX")]]);
    const found = occurrencesOf(cost(), claimed, "2026-03");
    expect(found.map((o) => o.confirmedBy)).toEqual([null, "pX", null]);
  });

  test("a slot is claimed by occurrenceDate, not by the purchase's own date", () => {
    // Paid on the 28th for the slot dated 2026-01. The slot is claimed; a new
    // one does not appear.
    const claimed = new Map([["2026-01", confirmation("2026-01", "2026-01-28", "pY")]]);
    const found = occurrencesOf(cost(), claimed, "2026-02");
    expect(found[0]!.confirmedBy).toBe("pY");
    expect(found[1]!.confirmedBy).toBeNull();
  });
});

describe("occurrencesOf — lastCharge anchoring: the phone bill", () => {
  const phone = cost({
    id: "r1",
    name: "Phone",
    startDate: "2026-01-01",
    recurrence: { kind: "everyNDays", n: 30 },
    anchoring: "lastCharge",
  });

  test("unconfirmed, it behaves exactly like a calendar series", () => {
    // Each occurrence steps from its own projected date: the projection assumes
    // bills are paid on time.
    const dates = occurrencesOf(phone, none, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-01", "2026-01-31", "2026-03-02"]);
  });

  test("hitting the data cap early rebases the whole series", () => {
    // The slot sits at 2026-01-31. The cap is hit on the 12th, so the owner
    // confirms THAT slot with a purchase dated 2026-01-12. The next occurrence
    // is 30 days after the 12th, not after the 31st.
    const capHit = new Map([
      ["2026-01-01", confirmation("2026-01-01", "2026-01-01", "pA")],
      ["2026-01-31", confirmation("2026-01-31", "2026-01-12", "pB")],
    ]);
    const dates = occurrencesOf(phone, capHit, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-01", "2026-01-31", "2026-02-11", "2026-03-13"]);
  });

  test("the cap can be hit twice", () => {
    const twice = new Map([
      ["2026-01-01", confirmation("2026-01-01", "2026-01-01", "pA")],
      ["2026-01-31", confirmation("2026-01-31", "2026-01-12", "pB")],
      ["2026-02-11", confirmation("2026-02-11", "2026-01-20", "pC")],
    ]);
    const dates = occurrencesOf(phone, twice, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-01", "2026-01-31", "2026-02-11", "2026-02-19", "2026-03-21"]);
  });

  test("deleting the confirming purchase un-confirms the slot and restores the series", () => {
    const dates = occurrencesOf(phone, none, "2026-03").map((o) => o.date);
    expect(dates).toEqual(["2026-01-01", "2026-01-31", "2026-03-02"]);
  });
});

describe("occurrencesOf — termination", () => {
  test("a confirmation dated absurdly early throws rather than walking backwards", () => {
    // The ONLY way a valid recurrence fails to advance. Under lastCharge the
    // step runs from the confirmation's own date, so a payment recorded more
    // than n days before the slot it claims would move the cursor backwards.
    // A visible error beats a fold that silently emits duplicate months.
    const phone = cost({
      startDate: "2026-01-01",
      recurrence: { kind: "everyNDays", n: 30 },
      anchoring: "lastCharge",
    });
    const outOfOrder = new Map([
      ["2026-01-31", confirmation("2026-01-31", "2025-11-02", "pBad")],
    ]);
    expect(() => occurrencesOf(phone, outOfOrder, "2026-03")).toThrow(/did not advance/);
  });

  test("a recurrence that cannot advance throws rather than hanging", () => {
    const broken = cost({ recurrence: { kind: "everyNDays", n: 0 }, startDate: "2026-01-01" });
    expect(() => occurrencesOf(broken, none, "2026-02")).toThrow(/did not advance/);
  });

  test("a negative step throws too", () => {
    const backwards = cost({ recurrence: { kind: "everyNDays", n: -7 }, startDate: "2026-01-01" });
    expect(() => occurrencesOf(backwards, none, "2026-02")).toThrow(/did not advance/);
  });
});

describe("occurrencesByMonth", () => {
  function dataset(recurring: RecurringCost[], purchases: Purchase[] = []): Dataset {
    return {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 7, digits: 2 },
      currencies: [{ code: "DKK", symbol: "kr", name: "Danish krone" }],
      fxRates: [],
      posts: [],
      months: [],
      purchases,
      recurring,
    };
  }

  test("groups every cost's occurrences by the month they land in", () => {
    const byMonth = occurrencesByMonth(
      dataset([
        cost({ id: "rent", startDate: "2026-01" }),
        cost({ id: "wow", startDate: "2026-01-05", recurrence: { kind: "everyNDays", n: 28 } }),
      ]),
      "2026-02",
    );

    expect(byMonth.get("2026-01")!.map((o) => o.recurringId).sort()).toEqual(["rent", "wow"]);
    expect(byMonth.get("2026-02")!.map((o) => o.recurringId).sort()).toEqual(["rent", "wow"]);
  });

  test("a purchase confirming one cost does not claim another cost's slot", () => {
    const shared = confirmation("2026-01", "2026-01", "pZ");
    const byMonth = occurrencesByMonth(
      dataset([cost({ id: "r1" }), cost({ id: "r2" })], [shared]),
      "2026-01",
    );
    const january = byMonth.get("2026-01")!;
    expect(january.find((o) => o.recurringId === "r1")!.confirmedBy).toBe("pZ");
    expect(january.find((o) => o.recurringId === "r2")!.confirmedBy).toBeNull();
  });

  test("months with no occurrence have no entry at all", () => {
    const byMonth = occurrencesByMonth(dataset([cost({ endedFrom: "2026-02" })]), "2026-04");
    expect(byMonth.has("2026-01")).toBe(true);
    expect(byMonth.has("2026-02")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/occurrences.test.ts`
Expected: FAIL — `Cannot find module './occurrences.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/occurrences.ts`:

```ts
import { addDays, weekdayOf } from "./days.ts";
import { addMonths, compareMonths, monthOf } from "./months.ts";
import type {
  Dataset,
  IsoDate,
  Money,
  MonthId,
  Purchase,
  PurchaseId,
  Recurrence,
  RecurringCost,
  RecurringCostId,
} from "./types.ts";

/**
 * One projected charge of one recurring cost.
 *
 * Occurrences are COMPUTED on every fold and never stored. The dataset holds
 * the rule and the confirmations; everything here is derived from those two.
 */
export interface Occurrence {
  recurringId: RecurringCostId;
  /**
   * The slot this walk generated. IDENTITY: a confirmation claims a slot by
   * this date, which is not necessarily the date it was paid.
   */
  date: IsoDate;
  /** Expected amount, in the cost's own currency. */
  amount: Money;
  /** The purchase that confirmed this slot, or null while it is still expected. */
  confirmedBy: PurchaseId | null;
}

/**
 * ISO dates compare correctly as strings, and mixed granularity falls out
 * right: "2026-09" < "2026-09-17" < "2026-10", so a month-only date reads as
 * the start of that month. That is exactly what `endedFrom` needs when a
 * monthly cost is cancelled.
 */
function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}

/** Moves forward to the next occurrence of `weekday`, or stays put if already on it. */
function snapForward(date: IsoDate, weekday: number): IsoDate {
  const delta = (weekday - weekdayOf(date) + 7) % 7;
  return delta === 0 ? date : addDays(date, delta);
}

/**
 * Where the next occurrence falls, given the one before it.
 *
 * Adding a recurrence kind means adding a case here and a variant to
 * `Recurrence`. Nothing else in the app switches on the kind.
 */
export function stepFrom(date: IsoDate, recurrence: Recurrence): IsoDate {
  switch (recurrence.kind) {
    case "everyNMonths":
      // Month-granular in, month-granular out. `monthOf` also accepts a
      // day-granular date, which is what a lastCharge rebase supplies.
      return addMonths(monthOf(date), recurrence.n);
    case "everyNDays":
      return addDays(date, recurrence.n);
    case "everyNWeeks":
      return snapForward(addDays(date, 7 * recurrence.n), recurrence.weekday);
  }
}

/**
 * The purchases confirming one cost, keyed by the slot each one claims.
 *
 * Keyed by `source.occurrenceDate` rather than by `Purchase.date`, because the
 * slot is what a confirmation claims. The two differ whenever a bill is paid
 * off schedule.
 */
export function confirmationsFor(
  purchases: readonly Purchase[],
  recurringId: RecurringCostId,
): Map<IsoDate, Purchase> {
  const found = new Map<IsoDate, Purchase>();
  for (const purchase of purchases) {
    if (purchase.source?.recurringId === recurringId) {
      found.set(purchase.source.occurrenceDate, purchase);
    }
  }
  return found;
}

/**
 * Every occurrence of one cost from its start through `upToMonth`, in order.
 *
 * A walk rather than a per-month query, because under `lastCharge` anchoring
 * where the series sits in a given month depends on every confirmation before
 * it. The walk always begins at `startDate` even when that precedes the fold
 * start, because the phase depends on the whole history; callers read only the
 * months they need. The cost is trivial — thirty-five years of a 28-day cycle
 * is about thirteen thousand integer additions.
 *
 * `upToMonth` comes from the caller. This module reads no clock, which is what
 * keeps `src/domain/` pure.
 */
export function occurrencesOf(
  cost: RecurringCost,
  confirmations: ReadonlyMap<IsoDate, Purchase>,
  upToMonth: MonthId,
): Occurrence[] {
  const found: Occurrence[] = [];

  // A monthly cost is month-granular throughout, even if its start date was
  // typed with a day. Rent occurs IN a month.
  let cursor =
    cost.recurrence.kind === "everyNMonths" ? monthOf(cost.startDate) : cost.startDate;

  while (compareMonths(monthOf(cursor), upToMonth) <= 0) {
    if (cost.endedFrom && !isBefore(cursor, cost.endedFrom)) break;

    const confirmation = confirmations.get(cursor) ?? null;
    found.push({
      recurringId: cost.id,
      date: cursor,
      amount: cost.amount,
      confirmedBy: confirmation?.id ?? null,
    });

    // `lastCharge` measures from when the money ACTUALLY moved, which is what
    // makes an early charge rebase the series. An unconfirmed occurrence steps
    // from its own projected date: the projection assumes bills are paid on
    // time, and self-corrects as they are confirmed.
    const from =
      cost.anchoring === "lastCharge" && confirmation ? confirmation.date : cursor;
    const next = stepFrom(from, cost.recurrence);

    // The loop terminates only if the step strictly increases. `n >= 1` is
    // enforced at both write boundaries, so reaching this is a bug rather than
    // bad input — and a hang is the one failure mode worse than a visible
    // error. Never soften this into a break: silently dropping a bill would
    // put a wrong number on the screen, which AGENTS.md forbids outright.
    if (!isBefore(cursor, next)) {
      // Two causes, and the message names both because they need different
      // fixes. With a valid `n >= 1` a CALENDAR series can never reach this:
      // every kind adds at least one day. Only `lastCharge` can, and only when
      // a confirmation is dated more than one step before the slot it claims.
      throw new Error(
        `Recurring cost "${cost.name}" did not advance past ${cursor} (produced ${next}). ` +
          (confirmation
            ? `Purchase ${confirmation.id} claims that slot but is dated ${confirmation.date}, ` +
              `more than one step earlier — correct its date to move the series forward.`
            : `A recurrence must move strictly forward; check that n is at least 1.`),
      );
    }
    cursor = next;
  }

  return found;
}

/**
 * Every cost's occurrences through `upToMonth`, grouped by the month they land
 * in. The fold calls this once and reads a month at a time.
 */
export function occurrencesByMonth(
  dataset: Dataset,
  upToMonth: MonthId,
): Map<MonthId, Occurrence[]> {
  const byMonth = new Map<MonthId, Occurrence[]>();

  for (const cost of dataset.recurring) {
    const confirmations = confirmationsFor(dataset.purchases, cost.id);
    for (const occurrence of occurrencesOf(cost, confirmations, upToMonth)) {
      const month = monthOf(occurrence.date);
      const existing = byMonth.get(month);
      if (existing) existing.push(occurrence);
      else byMonth.set(month, [occurrence]);
    }
  }

  return byMonth;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/domain/occurrences.test.ts`
Expected: PASS, all tests.

The phone-bill test is the one that matters. If `["2026-01-01", "2026-01-31", "2026-02-11", "2026-03-13"]` does not come out, check that `from` uses `confirmation.date` and not `cursor` — that single line is the whole data-cap behaviour.

- [ ] **Step 5: Re-export from the domain index**

In `src/domain/index.ts`, add after the `charges.ts` line:

```ts
export * from "./occurrences.ts";
```

- [ ] **Step 6: Run the whole suite**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS except the "NO figure changes" migration test from Task 2, which needs Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/domain/occurrences.ts src/domain/occurrences.test.ts src/domain/index.ts
git commit -m "feat(domain): project recurring occurrences, never store them

A walk rather than a per-month query: under lastCharge anchoring, where a
series sits in a given month depends on every confirmation before it, so the
projection starts at startDate and steps forward. Bounded by upToMonth, which
the caller supplies — the domain still reads no clock.

The data-cap behaviour is one line. \`from\` is the confirmation's own date
under lastCharge, so confirming a slot early moves every later occurrence with
it. Confirm the 2026-01-31 slot with a purchase dated the 12th and the next
lands on 2026-02-11, not 2026-03-02.

The walk throws if a step fails to advance. n >= 1 is enforced at both write
boundaries so this should be unreachable, but a hang is worse than a throw and
dropping a bill silently is worse than both."
```

---

### Task 4: Expected charges

**Files:**
- Modify: `src/domain/charges.ts`
- Test: `src/domain/charges.test.ts`

**Interfaces:**
- Consumes: `Occurrence` (Task 3); `RecurringCost` (Task 2).
- Produces:
  - `remainderIndexIn(splits: readonly Split[], label: string): number`
  - `splitParts(total: number, splits: readonly Split[], splitMode: "percent" | "fixed", remainderIndex: number, digits: number): number[]`
  - `distributeToSplits(amount: Money, splits: readonly Split[], weights: number[], remainderIndex: number, baseCurrency: Currency, rates: FxRate[], digits: number): Charge[]`
  - `expectedForMonth(dataset: Dataset, occurrences: readonly Occurrence[]): Map<PostId, number>`

`remainderIndexOf(purchase)` and `splitPartsOfTotal(purchase, digits)` keep their current signatures and become thin wrappers, so no existing caller changes.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/charges.test.ts`:

```ts
describe("expectedForMonth", () => {
  function dataset(cost: RecurringCost, purchases: Purchase[] = []): Dataset {
    return {
      settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 7, digits: 2 },
      currencies: [
        { code: "DKK", symbol: "kr", name: "Danish krone" },
        { code: "USD", symbol: "$", name: "US dollar" },
      ],
      fxRates: [{ currency: "USD", baseUnitsPerOne: 7, updatedAt: "2026-01-01", source: "manual" }],
      posts: [],
      months: [],
      purchases,
      recurring: [cost],
    };
  }

  const rent: RecurringCost = {
    id: "r1",
    name: "Rent",
    order: 0,
    archived: false,
    amount: { amount: 8000, currency: "DKK" },
    startDate: "2026-01",
    recurrence: { kind: "everyNMonths", n: 1 },
    anchoring: "calendar",
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
  };

  test("an unconfirmed occurrence charges its post", () => {
    const data = dataset(rent);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    expect(expected.get("housing")).toBe(8000);
  });

  test("a CONFIRMED occurrence contributes nothing — it is a real purchase now", () => {
    const confirmed: Purchase = {
      id: "p1",
      date: "2026-01",
      description: "Rent",
      total: { amount: 8000, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null,
      source: { recurringId: "r1", occurrenceDate: "2026-01" },
    };
    const data = dataset(rent, [confirmed]);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    expect(expected.get("housing")).toBeUndefined();
  });

  test("a split cost divides exactly, with the remainder absorbed", () => {
    const split = {
      ...rent,
      amount: { amount: 1000, currency: "DKK" },
      splits: [
        { postId: "a", value: 33.333, absorbsRemainder: false },
        { postId: "b", value: 33.333, absorbsRemainder: false },
        { postId: "c", value: 33.334, absorbsRemainder: true },
      ],
    };
    const data = dataset(split);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    const total = ["a", "b", "c"].reduce((sum, id) => sum + expected.get(id)!, 0);
    expect(total).toBe(1000);
  });

  test("a foreign-currency cost converts to base", () => {
    const inUsd = { ...rent, amount: { amount: 15, currency: "USD" } };
    const data = dataset(inUsd);
    const expected = expectedForMonth(data, occurrencesByMonth(data, "2026-01").get("2026-01")!);
    expect(expected.get("housing")).toBe(105);
  });

  test("two occurrences in one month sum", () => {
    const fortnightly = {
      ...rent,
      amount: { amount: 100, currency: "DKK" },
      startDate: "2026-01-05",
      recurrence: { kind: "everyNDays" as const, n: 14 },
    };
    const data = dataset(fortnightly);
    const january = occurrencesByMonth(data, "2026-01").get("2026-01")!;
    expect(january.length).toBe(2);
    expect(expectedForMonth(data, january).get("housing")).toBe(200);
  });

  test("no occurrences means an empty map, not zeros", () => {
    expect(expectedForMonth(dataset(rent), []).size).toBe(0);
  });
});
```

Add to that file's imports:

```ts
import { expectedForMonth } from "./charges.ts";
import { occurrencesByMonth } from "./occurrences.ts";
import type { Purchase, RecurringCost } from "./types.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/charges.test.ts`
Expected: FAIL — `expectedForMonth is not a function`.

- [ ] **Step 3: Extract the shared split machinery**

In `src/domain/charges.ts`, replace `remainderIndexOf` and `splitPartsOfTotal` with the generalised pair plus wrappers:

```ts
/**
 * Exactly one split absorbs the remainder, which is what makes the parts sum
 * exactly to the total. `label` names the owning record so the message is
 * actionable — this is reachable from a hand-edited import.
 */
export function remainderIndexIn(splits: readonly Split[], label: string): number {
  const index = splits.findIndex((s) => s.absorbsRemainder);
  if (index === -1) {
    throw new Error(`${label} has no split flagged absorbsRemainder`);
  }
  return index;
}

export function remainderIndexOf(purchase: Purchase): number {
  return remainderIndexIn(purchase.splits, `Purchase ${purchase.id}`);
}

/**
 * How an amount divides across splits, in the currency the amount is in.
 * Parts sum exactly to the total.
 */
export function splitParts(
  total: number,
  splits: readonly Split[],
  splitMode: "percent" | "fixed",
  remainderIndex: number,
  digits: number,
): number[] {
  const values = splits.map((s) => s.value);
  return splitMode === "percent"
    ? distributeByWeight(total, values, remainderIndex, digits)
    : distributeByAmount(total, values, remainderIndex, digits);
}

/**
 * How the whole purchase divides across its posts, in the purchase's own
 * currency. Parts sum exactly to the total.
 */
export function splitPartsOfTotal(purchase: Purchase, digits: number): number[] {
  return splitParts(
    purchase.total.amount,
    purchase.splits,
    purchase.splitMode,
    remainderIndexOf(purchase),
    digits,
  );
}

/**
 * Converts `amount` to base and distributes it across `splits` in the
 * proportions `weights` describes.
 *
 * Shared by real charges and expected ones deliberately. Two implementations
 * could round differently or absorb the remainder differently, and the gap
 * would surface as a penny of phantom drift between the fold's two tracks —
 * a difference with no cause the owner could ever find.
 */
export function distributeToSplits(
  amount: Money,
  splits: readonly Split[],
  weights: number[],
  remainderIndex: number,
  baseCurrency: Currency,
  rates: FxRate[],
  digits: number,
): Charge[] {
  const base = toBase(amount, baseCurrency, rates, digits);
  const parts = distributeByWeight(base, weights, remainderIndex, digits);
  return splits.map((split, i) => ({ postId: split.postId, amount: parts[i]! }));
}
```

Then rewrite `chargesForPurchaseInMonth`'s body to use it:

```ts
export function chargesForPurchaseInMonth(
  purchase: Purchase,
  monthId: MonthId,
  baseCurrency: Currency,
  rates: FxRate[],
  digits: number,
): Charge[] {
  const slice = sliceAmountForMonth(purchase, monthId);
  if (!slice) return [];

  // Split proportions come from the WHOLE purchase, so a financed purchase
  // divides each slice in the same ratio as the purchase as a whole — which is
  // what makes splits and finance plans compose without a special case.
  return distributeToSplits(
    slice,
    purchase.splits,
    splitPartsOfTotal(purchase, digits),
    remainderIndexOf(purchase),
    baseCurrency,
    rates,
    digits,
  );
}
```

- [ ] **Step 4: Add `expectedForMonth`**

Append to `src/domain/charges.ts`:

```ts
/**
 * Total EXPECTED per post in one month, in base currency.
 *
 * The mirror of `chargesForMonth` for money that has not moved yet. Confirmed
 * occurrences are skipped: they are ordinary purchases and `chargesForMonth`
 * has already counted them. Counting both would double every settled bill.
 *
 * Takes the month's occurrences rather than a MonthId because the fold
 * computes them all in one walk — see `occurrencesByMonth`.
 */
export function expectedForMonth(
  dataset: Dataset,
  occurrences: readonly Occurrence[],
): Map<PostId, number> {
  const totals = new Map<PostId, number>();
  const digits = dataset.settings.digits;
  const byId = new Map(dataset.recurring.map((cost) => [cost.id, cost]));

  for (const occurrence of occurrences) {
    if (occurrence.confirmedBy) continue;
    const cost = byId.get(occurrence.recurringId);
    if (!cost) continue;

    const index = remainderIndexIn(cost.splits, `Recurring cost "${cost.name}"`);
    const weights = splitParts(
      cost.amount.amount,
      cost.splits,
      cost.splitMode,
      index,
      digits,
    );
    const charges = distributeToSplits(
      occurrence.amount,
      cost.splits,
      weights,
      index,
      dataset.settings.baseCurrency,
      dataset.fxRates,
      digits,
    );

    for (const charge of charges) {
      const previous = totals.get(charge.postId) ?? 0;
      totals.set(charge.postId, roundMoney(previous + charge.amount, digits));
    }
  }

  return totals;
}
```

Add to that file's imports:

```ts
import type { Occurrence } from "./occurrences.ts";
import type { Split } from "./types.ts";
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/domain/charges.test.ts && bunx tsc --noEmit`
Expected: PASS. The pre-existing charge tests must be untouched — the extraction is behaviour-preserving, so if any of them moved, the refactor is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/domain/charges.ts src/domain/charges.test.ts
git commit -m "feat(domain): expected charges, sharing one split implementation

expectedForMonth mirrors chargesForMonth for money that has not moved yet, and
skips confirmed occurrences — those are ordinary purchases that chargesForMonth
has already counted, so counting both would double every settled bill.

The split machinery is extracted rather than duplicated. Two implementations
could round differently or absorb the remainder differently, and the gap would
show up as a penny of drift between the fold's two tracks with no cause the
owner could find. remainderIndexOf and splitPartsOfTotal keep their signatures
as wrappers, so no existing caller changes.

Smaller than planned: 8d2b2ca already made these functions take digits rather
than a currency table, so the shared helper needs no currency plumbing."
```

---

### Task 5: The second balance track

**Files:**
- Modify: `src/domain/fold.ts`
- Test: `src/domain/fold.test.ts`

**Interfaces:**
- Consumes: `expectedForMonth` (Task 4), `occurrencesByMonth` (Task 3).
- Produces: `PostMonthFigures` with `expected`, `projectedCarriedIn`, `projected`.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/fold.test.ts`:

```ts
describe("the projected track", () => {
  test("with no recurring costs, projected shadows remaining exactly", () => {
    // The behaviour-preservation guard. Every existing dataset must fold to
    // figures it already folded to, with the new track adding nothing.
    const data = createSeedDataset("2026-01");
    data.months.push({ id: "2026-01", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} });
    const fold = foldBalances(data, "2026-06");

    for (const post of data.posts) {
      for (const month of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]) {
        const figures = figuresFor(fold, post.id, month);
        expect(figures.expected).toBe(0);
        expect(figures.projectedCarriedIn).toBe(figures.carriedIn);
        expect(figures.projected).toBe(figures.remaining);
      }
    }
  });

  test("an unconfirmed occurrence lowers projected and leaves remaining alone", () => {
    const data = datasetWithRent();
    const figures = figuresFor(foldBalances(data, "2026-01"), "housing", "2026-01");

    expect(figures.charges).toBe(0);
    expect(figures.expected).toBe(8000);
    expect(figures.remaining).toBe(10000);
    expect(figures.projected).toBe(2000);
  });

  test("the projected shortfall carries forward on its own track", () => {
    const data = datasetWithRent();
    const fold = foldBalances(data, "2026-02");
    const february = figuresFor(fold, "housing", "2026-02");

    expect(february.carriedIn).toBe(10000);
    expect(february.projectedCarriedIn).toBe(2000);
    expect(february.remaining).toBe(20000);
    // 2000 carried on the projected track + 10000 allocated - 8000 expected.
    expect(february.projected).toBe(4000);
  });

  test("confirming every occurrence reconverges the two tracks", () => {
    const data = datasetWithRent();
    data.purchases.push({
      id: "p1",
      date: "2026-01",
      description: "Rent",
      total: { amount: 8000, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null,
      source: { recurringId: "rent", occurrenceDate: "2026-01" },
    });

    const figures = figuresFor(foldBalances(data, "2026-01"), "housing", "2026-01");
    expect(figures.charges).toBe(8000);
    expect(figures.expected).toBe(0);
    expect(figures.projected).toBe(figures.remaining);
  });

  test("EMPTY_FIGURES carries the new fields", () => {
    expect(EMPTY_FIGURES.expected).toBe(0);
    expect(EMPTY_FIGURES.projected).toBe(0);
    expect(EMPTY_FIGURES.projectedCarriedIn).toBe(0);
  });
});
```

Add this helper above that block, in the same file:

```ts
function datasetWithRent(): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 7, digits: 2 },
    currencies: [{ code: "DKK", symbol: "kr", name: "Danish krone" }],
    fxRates: [],
    posts: [
      {
        id: "housing",
        name: "Housing",
        order: 0,
        archived: false,
        currency: "DKK",
        rules: [{ from: "2026-01", rule: { kind: "fixed", amount: { amount: 10000, currency: "DKK" } } }],
      },
    ],
    months: [],
    purchases: [],
    recurring: [
      {
        id: "rent",
        name: "Rent",
        order: 0,
        archived: false,
        amount: { amount: 8000, currency: "DKK" },
        startDate: "2026-01",
        recurrence: { kind: "everyNMonths", n: 1 },
        anchoring: "calendar",
        splitMode: "percent",
        splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      },
    ],
  };
}
```

Ensure `EMPTY_FIGURES` and `createSeedDataset` are imported in that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/fold.test.ts`
Expected: FAIL — `figures.expected` is undefined.

- [ ] **Step 3: Widen `PostMonthFigures`**

In `src/domain/fold.ts`:

```ts
export interface PostMonthFigures {
  carriedIn: number;
  allocation: number;
  charges: number;
  /** carriedIn + allocation - charges. Negative means overspent. */
  remaining: number;
  /**
   * Unconfirmed recurring occurrences landing in this month, base currency.
   * Money committed but not yet moved.
   */
  expected: number;
  /** The previous month's `projected`. */
  projectedCarriedIn: number;
  /**
   * projectedCarriedIn + allocation - charges - expected.
   *
   * A second, parallel balance: what is left once commitments are counted.
   * It never influences `remaining`, so adding a recurring cost cannot move a
   * figure the owner already reconciled against their bank.
   */
  projected: number;
}

export const EMPTY_FIGURES: PostMonthFigures = Object.freeze({
  carriedIn: 0,
  allocation: 0,
  charges: 0,
  remaining: 0,
  expected: 0,
  projectedCarriedIn: 0,
  projected: 0,
});
```

- [ ] **Step 4: Run two accumulators in the fold**

Rewrite `foldBalances`:

```ts
export function foldBalances(dataset: Dataset, upToMonth: MonthId): Fold {
  const { foldStartMonth, baseCurrency, digits: baseDigits } = dataset.settings;
  const fold: Fold = new Map();

  if (compareMonths(upToMonth, foldStartMonth) < 0) return fold;

  // One walk for every recurring cost, because under `lastCharge` anchoring a
  // month's occurrences depend on every confirmation before it.
  const occurrences = occurrencesByMonth(dataset, upToMonth);

  const carried = new Map<PostId, number>();
  const carriedProjected = new Map<PostId, number>();

  for (const monthId of monthRange(foldStartMonth, upToMonth)) {
    const charges = chargesForMonth(dataset, monthId);
    const expected = expectedForMonth(dataset, occurrences.get(monthId) ?? []);
    const monthFigures = new Map<PostId, PostMonthFigures>();

    for (const post of dataset.posts) {
      const carriedIn = carried.get(post.id) ?? 0;
      const projectedCarriedIn = carriedProjected.get(post.id) ?? 0;
      const allocation = allocationFor(dataset, post.id, monthId);
      const spent = charges.get(post.id) ?? 0;
      const due = expected.get(post.id) ?? 0;

      const remaining = roundMoney(carriedIn + allocation - spent, baseDigits);
      const projected = roundMoney(
        projectedCarriedIn + allocation - spent - due,
        baseDigits,
      );

      monthFigures.set(post.id, {
        carriedIn,
        allocation,
        charges: spent,
        remaining,
        expected: due,
        projectedCarriedIn,
        projected,
      });
      carried.set(post.id, remaining);
      carriedProjected.set(post.id, projected);
    }

    fold.set(monthId, monthFigures);
  }

  return fold;
}
```

Note `baseCurrency` is now unused in this function — remove it from the destructure if the linter complains.

Add the imports:

```ts
import { chargesForMonth, expectedForMonth } from "./charges.ts";
import { occurrencesByMonth } from "./occurrences.ts";
```

- [ ] **Step 5: Run the tests**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS, including Task 2's "NO figure changes" migration test, which has been failing since then and is the point of this task.

`src/ui/meterSegments.ts` takes `PostMonthFigures` and keeps compiling — the fields are additive and the meter is deliberately unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/domain/fold.ts src/domain/fold.test.ts
git commit -m "feat(fold): a second balance for money committed but not moved

remaining is untouched: carriedIn + allocation - charges, exactly as before, so
no figure the owner has reconciled against their bank can move when they add a
recurring cost. projected runs beside it on its own carry, subtracting
unconfirmed occurrences as well.

Two invariants pin it, both tested. With no recurring costs the tracks are
identical in every month — that is the behaviour-preservation guard for every
dataset that exists today. Once a month's occurrences are all confirmed they
reconverge there, because a confirmation is an ordinary purchase counted in
charges and skipped by expected.

An unconfirmed occurrence in a PAST month therefore holds projected below
remaining forever. That is the honest reading — an unreconciled commitment —
and the month view surfaces the count so it is not silent."
```

---

### Task 6: Store actions

**Files:**
- Modify: `src/store/actions.ts`
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: `RecurringCost`, `Recurrence` (Task 2); `addPurchase`, `ensureMonth`, `roundMoneyValue`, `roundSplits`, `newId` (all exist in `actions.ts`).
- Produces:
  - `addRecurringCost(draft, cost: Omit<RecurringCost, "id" | "order">): RecurringCost`
  - `updateRecurringCost(draft, id: RecurringCostId, changes: Partial<Omit<RecurringCost, "id">>): void`
  - `moveRecurringCost(draft, id: RecurringCostId, direction: -1 | 1): void`
  - `endRecurringCost(draft, id: RecurringCostId, from: IsoDate): void`
  - `restoreRecurringCost(draft, id: RecurringCostId): void`
  - `confirmOccurrence(draft, recurringId, occurrenceDate: IsoDate, overrides?: { date?: IsoDate; amount?: Money }): Purchase`

- [ ] **Step 1: Write the failing test**

Append to `src/store/actions.test.ts`:

```ts
describe("recurring costs", () => {
  function draft(): Dataset {
    const data = createSeedDataset("2026-01");
    data.posts[0]!.id = "housing";
    return data;
  }

  const rentInput = {
    name: "Rent",
    archived: false,
    amount: { amount: 8000, currency: "DKK" },
    startDate: "2026-01",
    recurrence: { kind: "everyNMonths" as const, n: 1 },
    anchoring: "calendar" as const,
    splitMode: "percent" as const,
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
  };

  test("adding assigns an id and an order", () => {
    const data = draft();
    const first = addRecurringCost(data, rentInput);
    const second = addRecurringCost(data, { ...rentInput, name: "Phone" });

    expect(first.id).not.toBe(second.id);
    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
    expect(data.recurring.length).toBe(2);
  });

  test("the amount is rounded to the dataset's digits before it lands", () => {
    const data = draft();
    data.settings.digits = 0;
    const cost = addRecurringCost(data, { ...rentInput, amount: { amount: 8000.7, currency: "DKK" } });
    expect(cost.amount.amount).toBe(8001);
  });

  test("a recurrence with n below 1 is refused", () => {
    // The projection walk terminates only if every step advances, and the
    // importer is not the only write path.
    const data = draft();
    expect(() => addRecurringCost(data, { ...rentInput, recurrence: { kind: "everyNDays", n: 0 } }))
      .toThrow(/at least 1/);
    expect(() => addRecurringCost(data, { ...rentInput, recurrence: { kind: "everyNDays", n: 1.5 } }))
      .toThrow(/whole number/);
  });

  test("a weekday outside 0-6 is refused", () => {
    const data = draft();
    expect(() =>
      addRecurringCost(data, { ...rentInput, recurrence: { kind: "everyNWeeks", n: 1, weekday: 7 } }),
    ).toThrow(/weekday/);
  });

  test("updating validates the new recurrence too", () => {
    const data = draft();
    const cost = addRecurringCost(data, rentInput);
    expect(() =>
      updateRecurringCost(data, cost.id, { recurrence: { kind: "everyNDays", n: 0 } }),
    ).toThrow(/at least 1/);
  });

  test("ending sets both endedFrom and archived", () => {
    const data = draft();
    const cost = addRecurringCost(data, rentInput);
    endRecurringCost(data, cost.id, "2026-06");

    expect(data.recurring[0]!.endedFrom).toBe("2026-06");
    expect(data.recurring[0]!.archived).toBe(true);
  });

  test("restoring clears both", () => {
    const data = draft();
    const cost = addRecurringCost(data, rentInput);
    endRecurringCost(data, cost.id, "2026-06");
    restoreRecurringCost(data, cost.id);

    expect(data.recurring[0]!.endedFrom).toBeUndefined();
    expect(data.recurring[0]!.archived).toBe(false);
  });

  test("moving swaps order with its neighbour", () => {
    const data = draft();
    const first = addRecurringCost(data, rentInput);
    const second = addRecurringCost(data, { ...rentInput, name: "Phone" });
    moveRecurringCost(data, second.id, -1);

    expect(data.recurring.find((c) => c.id === second.id)!.order).toBe(0);
    expect(data.recurring.find((c) => c.id === first.id)!.order).toBe(1);
  });
});

describe("confirmOccurrence", () => {
  function draft(): Dataset {
    const data = createSeedDataset("2026-01");
    data.posts[0]!.id = "housing";
    addRecurringCost(data, {
      name: "Rent",
      archived: false,
      amount: { amount: 8000, currency: "DKK" },
      startDate: "2026-01",
      recurrence: { kind: "everyNMonths", n: 1 },
      anchoring: "calendar",
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    });
    return data;
  }

  test("writes an ordinary purchase carrying the slot it claims", () => {
    const data = draft();
    const purchase = confirmOccurrence(data, data.recurring[0]!.id, "2026-03");

    expect(purchase.source).toEqual({ recurringId: data.recurring[0]!.id, occurrenceDate: "2026-03" });
    expect(purchase.date).toBe("2026-03");
    expect(purchase.total).toEqual({ amount: 8000, currency: "DKK" });
    expect(purchase.description).toBe("Rent");
    expect(purchase.schedule).toBeNull();
    expect(data.purchases.length).toBe(1);
  });

  test("the purchase date may differ from the slot — this is the data-cap case", () => {
    const data = draft();
    const purchase = confirmOccurrence(data, data.recurring[0]!.id, "2026-03", { date: "2026-02-12" });

    expect(purchase.source!.occurrenceDate).toBe("2026-03");
    expect(purchase.date).toBe("2026-02-12");
  });

  test("an overridden amount is what gets recorded", () => {
    const data = draft();
    const purchase = confirmOccurrence(data, data.recurring[0]!.id, "2026-03", {
      amount: { amount: 8250, currency: "DKK" },
    });
    expect(purchase.total.amount).toBe(8250);
  });

  test("the month the purchase lands in is created, so income can be entered", () => {
    const data = draft();
    confirmOccurrence(data, data.recurring[0]!.id, "2026-05");
    expect(data.months.some((m) => m.id === "2026-05")).toBe(true);
  });

  test("splits are copied, not shared with the cost", () => {
    const data = draft();
    const purchase = confirmOccurrence(data, data.recurring[0]!.id, "2026-03");
    purchase.splits[0]!.value = 50;
    expect(data.recurring[0]!.splits[0]!.value).toBe(100);
  });

  test("an unknown cost throws", () => {
    expect(() => confirmOccurrence(draft(), "nope", "2026-03")).toThrow(/Unknown recurring cost/);
  });
});
```

Add the new action names and `Dataset` to that file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/actions.test.ts`
Expected: FAIL — `addRecurringCost is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/store/actions.ts`:

```ts
function requireRecurringCost(draft: Dataset, id: RecurringCostId): RecurringCost {
  const cost = draft.recurring.find((c) => c.id === id);
  if (!cost) throw new Error(`Unknown recurring cost: ${id}`);
  return cost;
}

/**
 * The projection walk in `domain/occurrences.ts` terminates only if every step
 * strictly advances, and `n` is what guarantees that. The JSON importer checks
 * the same thing; this is the other write path, and both have to hold or the
 * fold can hang.
 */
function requireRecurrence(recurrence: Recurrence): Recurrence {
  if (!Number.isInteger(recurrence.n)) {
    throw new Error(`A recurrence interval must be a whole number, not ${recurrence.n}`);
  }
  if (recurrence.n < 1) {
    throw new Error(`A recurrence interval must be at least 1, not ${recurrence.n}`);
  }
  if (recurrence.kind === "everyNWeeks") {
    if (!Number.isInteger(recurrence.weekday) || recurrence.weekday < 0 || recurrence.weekday > 6) {
      throw new Error(`A weekday must be 0-6 (0 is Sunday), not ${recurrence.weekday}`);
    }
  }
  return recurrence;
}

export function addRecurringCost(
  draft: Dataset,
  cost: Omit<RecurringCost, "id" | "order">,
): RecurringCost {
  const created: RecurringCost = {
    ...cost,
    id: newId(),
    order: draft.recurring.length,
    recurrence: requireRecurrence(cost.recurrence),
    amount: roundMoneyValue(draft, cost.amount),
    splits: roundSplits(draft, cost.splits, cost.splitMode, cost.amount.currency),
  };
  draft.recurring.push(created);
  return created;
}

export function updateRecurringCost(
  draft: Dataset,
  id: RecurringCostId,
  changes: Partial<Omit<RecurringCost, "id">>,
): void {
  const cost = requireRecurringCost(draft, id);
  const resolved: Partial<Omit<RecurringCost, "id">> = { ...changes };

  if (changes.recurrence) {
    resolved.recurrence = requireRecurrence(changes.recurrence);
  }
  if (changes.amount) {
    resolved.amount = roundMoneyValue(draft, changes.amount);
  }
  if (changes.splits) {
    // Either field may be absent from a partial update; the stored cost
    // supplies whichever one is, so the mode and currency always agree with
    // the values being rounded.
    resolved.splits = roundSplits(
      draft,
      changes.splits,
      changes.splitMode ?? cost.splitMode,
      (resolved.amount ?? cost.amount).currency,
    );
  }

  Object.assign(cost, resolved);
}

export function moveRecurringCost(
  draft: Dataset,
  id: RecurringCostId,
  direction: -1 | 1,
): void {
  const ordered = [...draft.recurring].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((c) => c.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return;
  const a = ordered[index]!;
  const b = ordered[target]!;
  [a.order, b.order] = [b.order, a.order];
}

/**
 * Stops a bill from `from` onward and hides it from the list.
 *
 * Both fields, because they mean different things: `endedFrom` stops the
 * PROJECTION, and `archived` only hides the row. Archiving alone would leave
 * the bill projecting forever; setting `endedFrom` alone would leave a dead
 * bill cluttering the list. Neither touches a past occurrence, so no
 * historical figure moves.
 */
export function endRecurringCost(draft: Dataset, id: RecurringCostId, from: IsoDate): void {
  const cost = requireRecurringCost(draft, id);
  cost.endedFrom = from;
  cost.archived = true;
}

export function restoreRecurringCost(draft: Dataset, id: RecurringCostId): void {
  const cost = requireRecurringCost(draft, id);
  delete cost.endedFrom;
  cost.archived = false;
}

/**
 * Turns one projected occurrence into a real purchase.
 *
 * `occurrenceDate` is the slot being claimed and goes into `source`;
 * `overrides.date` is when the money actually moved and goes on the purchase.
 * They differ whenever a bill is paid off schedule, and under `lastCharge`
 * anchoring it is the latter that rebases the series — which is the whole of
 * the phone-bill behaviour.
 *
 * Deleting the purchase later un-confirms the slot, with nothing to reconcile.
 */
export function confirmOccurrence(
  draft: Dataset,
  recurringId: RecurringCostId,
  occurrenceDate: IsoDate,
  overrides: { date?: IsoDate; amount?: Money } = {},
): Purchase {
  const cost = requireRecurringCost(draft, recurringId);
  return addPurchase(draft, {
    date: overrides.date ?? occurrenceDate,
    description: cost.name,
    total: overrides.amount ?? cost.amount,
    splitMode: cost.splitMode,
    // Copied, not shared: editing the purchase's splits must not rewrite the
    // cost's, and `mutate` clones the draft rather than deep-freezing it.
    splits: cost.splits.map((split) => ({ ...split })),
    schedule: null,
    source: { recurringId, occurrenceDate },
  });
}
```

Add `IsoDate`, `Recurrence`, `RecurringCost` and `RecurringCostId` to the type imports at the top of the file.

- [ ] **Step 4: Run the tests**

Run: `bun test src/store/actions.test.ts && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat(store): recurring cost actions, and confirming an occurrence

confirmOccurrence writes an ordinary Purchase: the slot it claims goes in
source.occurrenceDate, the date the money moved goes on the purchase, and the
two differ whenever a bill is paid off schedule. Splits are copied rather than
shared, so editing the purchase cannot rewrite the cost.

endRecurringCost sets endedFrom AND archived, because they do different jobs —
one stops the projection, the other only hides the row. Archiving alone would
leave a cancelled bill projecting forever. Neither touches a past occurrence,
so no historical figure moves.

requireRecurrence rejects n below 1 and non-integers rather than clamping.
The walk terminates only if every step advances, and the importer is not the
only write path."
```

---

### Task 7: Import validation

**Files:**
- Modify: `src/export/json.ts`
- Test: `src/export/json.test.ts`

**Interfaces:**
- Consumes: the types from Task 2.
- Produces: no new exports; `parseDatasetJson` gains `recurring` and `Purchase.source` checks.

- [ ] **Step 1: Write the failing test**

Append to `src/export/json.test.ts`, following the file's existing style:

```ts
describe("recurring cost validation", () => {
  function withRecurring(recurring: unknown[]): string {
    const data: any = createSeedDataset("2026-01");
    data.posts[0].id = "housing";
    data.recurring = recurring;
    return JSON.stringify(data);
  }

  const valid = {
    id: "r1",
    name: "Rent",
    order: 0,
    archived: false,
    amount: { amount: 8000, currency: "DKK" },
    startDate: "2026-01",
    recurrence: { kind: "everyNMonths", n: 1 },
    anchoring: "calendar",
    splitMode: "percent",
    splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
  };

  test("a well-formed cost is accepted", () => {
    expect(parseDatasetJson(withRecurring([valid])).recurring.length).toBe(1);
  });

  test("an undefined currency is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, amount: { amount: 1, currency: "XYZ" } }])))
      .toThrow(/Unsupported currency/);
  });

  test("a malformed start date is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, startDate: "2026-13" }])))
      .toThrow(/start date/);
  });

  test("a malformed endedFrom is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, endedFrom: "nope" }])))
      .toThrow(/ended-from date/);
  });

  test("an interval below 1 is refused, not clamped", () => {
    // Clamping would silently change the bill's schedule. The walk in
    // occurrences.ts cannot terminate without this.
    expect(() => parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyNDays", n: 0 } }])))
      .toThrow(/at least 1/);
  });

  test("a fractional interval is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyNDays", n: 1.5 } }])))
      .toThrow(/whole number/);
  });

  test("an unknown recurrence kind is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyFullMoon", n: 1 } }])))
      .toThrow(/unknown kind/);
  });

  test("a weekday outside 0-6 is refused", () => {
    expect(() =>
      parseDatasetJson(withRecurring([{ ...valid, recurrence: { kind: "everyNWeeks", n: 1, weekday: 7 } }])),
    ).toThrow(/weekday/);
  });

  test("an unknown anchoring is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, anchoring: "whenever" }])))
      .toThrow(/anchoring/);
  });

  test("splits must have exactly one remainder absorber", () => {
    expect(() =>
      parseDatasetJson(withRecurring([{
        ...valid,
        splits: [
          { postId: "housing", value: 50, absorbsRemainder: true },
          { postId: "housing", value: 50, absorbsRemainder: true },
        ],
      }])),
    ).toThrow(/absorbsRemainder/);
  });

  test("a split naming an unknown post is refused", () => {
    expect(() =>
      parseDatasetJson(withRecurring([{
        ...valid,
        splits: [{ postId: "ghost", value: 100, absorbsRemainder: true }],
      }])),
    ).toThrow(/unknown post/);
  });

  test("no splits at all is refused", () => {
    expect(() => parseDatasetJson(withRecurring([{ ...valid, splits: [] }])))
      .toThrow(/no splits/);
  });
});

describe("Purchase.source validation", () => {
  function withSource(source: unknown): string {
    const data: any = createSeedDataset("2026-01");
    data.posts[0].id = "housing";
    data.recurring = [];
    data.purchases = [{
      id: "p1",
      date: "2026-01",
      description: "Rent",
      total: { amount: 8000, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null,
      source,
    }];
    return JSON.stringify(data);
  }

  test("a purchase with no source is fine", () => {
    const data: any = createSeedDataset("2026-01");
    data.recurring = [];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("a source naming an unknown cost is refused", () => {
    expect(() => parseDatasetJson(withSource({ recurringId: "ghost", occurrenceDate: "2026-01" })))
      .toThrow(/unknown recurring cost/);
  });

  test("a source with a malformed occurrence date is refused", () => {
    const data: any = JSON.parse(withSource({ recurringId: "r1", occurrenceDate: "nope" }));
    data.recurring = [{
      id: "r1", name: "Rent", order: 0, archived: false,
      amount: { amount: 8000, currency: "DKK" },
      startDate: "2026-01",
      recurrence: { kind: "everyNMonths", n: 1 },
      anchoring: "calendar",
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    }];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/occurrence date/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/export/json.test.ts`
Expected: FAIL — the malformed values are accepted.

- [ ] **Step 3: Write the validation**

In `src/export/json.ts`, add near the other constants:

```ts
const ANCHORINGS = new Set(["calendar", "lastCharge"]);
const RECURRENCE_KINDS = new Set(["everyNMonths", "everyNDays", "everyNWeeks"]);
```

Add this function above `parseDatasetJson`:

```ts
/**
 * `n` is checked hard rather than clamped. The projection walk in
 * `domain/occurrences.ts` terminates only if every step strictly advances, and
 * a clamped zero would silently give the owner a schedule their file does not
 * describe. Rejecting tells them the file is wrong; clamping tells them
 * nothing and quietly changes a bill.
 */
function requireRecurrence(recurrence: any, label: string): void {
  if (!recurrence || !RECURRENCE_KINDS.has(recurrence.kind)) {
    throw new ImportValidationError(
      `${label} has a recurrence of unknown kind "${String(recurrence?.kind)}"`,
    );
  }
  if (typeof recurrence.n !== "number" || !Number.isInteger(recurrence.n)) {
    throw new ImportValidationError(
      `${label} has a recurrence interval that is not a whole number: ${String(recurrence.n)}`,
    );
  }
  if (recurrence.n < 1) {
    throw new ImportValidationError(
      `${label} has a recurrence interval of ${recurrence.n}; it must be at least 1`,
    );
  }
  if (recurrence.kind === "everyNWeeks") {
    const { weekday } = recurrence;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new ImportValidationError(
        `${label} has a weekday of ${String(weekday)}; it must be 0-6, where 0 is Sunday`,
      );
    }
  }
}
```

Then, inside `parseDatasetJson`, after the posts loop and before the months loop, add:

```ts
  const recurring = Array.isArray(dataset.recurring) ? dataset.recurring : [];
  dataset.recurring = recurring;
  const recurringIds = new Set(recurring.map((cost: any) => cost.id));

  for (const cost of recurring) {
    const label = `Recurring cost "${cost.name}"`;
    requireCurrency(cost.amount?.currency, label, defined);

    if (!PURCHASE_DATE.test(cost.startDate)) {
      throw new ImportValidationError(`${label} has an invalid start date "${cost.startDate}"`);
    }
    if (cost.endedFrom !== undefined && !PURCHASE_DATE.test(cost.endedFrom)) {
      throw new ImportValidationError(`${label} has an invalid ended-from date "${cost.endedFrom}"`);
    }
    requireRecurrence(cost.recurrence, label);

    if (!ANCHORINGS.has(cost.anchoring)) {
      throw new ImportValidationError(
        `${label} has an unknown anchoring "${String(cost.anchoring)}"`,
      );
    }
    if (!Array.isArray(cost.splits) || cost.splits.length === 0) {
      throw new ImportValidationError(`${label} has no splits; at least one split is required`);
    }
    const absorbers = cost.splits.filter((s: any) => s.absorbsRemainder).length;
    if (absorbers !== 1) {
      throw new ImportValidationError(
        `${label} has ${absorbers} splits flagged absorbsRemainder; exactly one is required`,
      );
    }
    for (const split of cost.splits) {
      if (!postIds.has(split.postId)) {
        throw new ImportValidationError(`${label} references unknown post "${split.postId}"`);
      }
    }
  }
```

And inside the existing purchases loop, at the end:

```ts
    if (purchase.source !== undefined) {
      if (!recurringIds.has(purchase.source.recurringId)) {
        throw new ImportValidationError(
          `${label} names unknown recurring cost "${purchase.source.recurringId}"`,
        );
      }
      if (!PURCHASE_DATE.test(purchase.source.occurrenceDate)) {
        throw new ImportValidationError(
          `${label} has an invalid occurrence date "${purchase.source.occurrenceDate}"`,
        );
      }
    }
```

`PURCHASE_DATE` already accepts both `"YYYY-MM"` and `"YYYY-MM-DD"`, which is exactly the range an occurrence date can take.

- [ ] **Step 4: Run the tests**

Run: `bun test src/export/json.test.ts && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export/json.ts src/export/json.test.ts
git commit -m "feat(import): validate recurring costs at the boundary

The one check that is load-bearing rather than tidy: a recurrence interval
below 1, or a fractional one, is REFUSED rather than clamped. The projection
walk terminates only if every step strictly advances, and a clamped zero would
hand the owner a schedule their file does not describe — silently.

Purchase.source is checked too: the cost it names must exist, and the
occurrence date must parse. PURCHASE_DATE already accepts both YYYY-MM and
YYYY-MM-DD, which is exactly the range a slot date can take."
```

---

### Task 8: Defining recurring costs in Settings

**Files:**
- Create: `src/ui/routes/settings/RecurringSection.tsx`
- Modify: `src/ui/routes/SettingsRoute.tsx`

**Interfaces:**
- Consumes: `addRecurringCost`, `updateRecurringCost`, `moveRecurringCost`, `endRecurringCost`, `restoreRecurringCost` (Task 6); `useDataset`, `useMutate`, `useMoneyFormat`, `Section`, `Button`, `Input`, `NativeSelect`, `parseMoneyInput`, `currentMonth`.
- Produces: `<RecurringSection />`.

This is the definition surface, not the repeated one — it follows `PostsSection.tsx` closely on purpose. Read that file before starting; the table markup, the `size="xs"` ghost row actions with their `-mr-2`, and the "add" row at the bottom are all established patterns to copy rather than reinvent.

- [ ] **Step 1: Create the component**

Create `src/ui/routes/settings/RecurringSection.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import { useMoneyFormat } from "../../hooks/useMoneyFormat.ts";
import {
  addRecurringCost,
  endRecurringCost,
  moveRecurringCost,
  restoreRecurringCost,
  updateRecurringCost,
} from "../../../store/actions.ts";
import { parseMoneyInput } from "../../moneyInput.ts";
import { currentMonth } from "../../../store/index.ts";
import { Section } from "../../components/Section.tsx";
import type { Recurrence, RecurringCost } from "../../../domain/types.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Plain English for a rule the owner typed as two fields. */
function describeRecurrence(recurrence: Recurrence): string {
  switch (recurrence.kind) {
    case "everyNMonths":
      return recurrence.n === 1 ? "every month" : `every ${recurrence.n} months`;
    case "everyNDays":
      return `every ${recurrence.n} days`;
    case "everyNWeeks":
      return recurrence.n === 1
        ? `every ${WEEKDAYS[recurrence.weekday]}`
        : `every ${recurrence.n} weeks on ${WEEKDAYS[recurrence.weekday]}`;
  }
}

export function RecurringSection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const money = useMoneyFormat();
  const [newName, setNewName] = useState("");
  const ordered = [...dataset.recurring].sort((a, b) => a.order - b.order);
  const base = dataset.settings.baseCurrency;
  const firstPost = [...dataset.posts].sort((a, b) => a.order - b.order)[0];

  function amountCell(cost: RecurringCost) {
    return (
      <Input
        className="h-8 w-28"
        // text, not number: a number input strips the "$" before
        // parseMoneyInput ever sees it, so "30$" would lose its currency.
        type="text"
        aria-label={`Amount for ${cost.name}`}
        defaultValue={`${cost.amount.amount} ${cost.amount.currency}`}
        onBlur={(event) => {
          // (text, currency options, fallback) — the same three arguments
          // PurchaseDialog passes. The options list is what lets "30$" resolve
          // to USD; the fallback is used when no symbol or code is typed.
          const parsed = parseMoneyInput(
            event.target.value,
            dataset.currencies,
            cost.amount.currency,
          );
          if (!parsed) return;
          mutate((draft) => updateRecurringCost(draft, cost.id, { amount: parsed }));
        }}
      />
    );
  }

  function intervalCell(cost: RecurringCost) {
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-8 w-14"
          type="number"
          min={1}
          step={1}
          aria-label={`Interval for ${cost.name}`}
          value={cost.recurrence.n}
          onChange={(event) => {
            // Captured BEFORE mutate: mutate defers behind the write queue and
            // React resets the DOM value first, so reading it inside the
            // callback commits the previous keystroke.
            const n = Number(event.target.value);
            if (!Number.isInteger(n) || n < 1) return;
            mutate((draft) =>
              updateRecurringCost(draft, cost.id, { recurrence: { ...cost.recurrence, n } }),
            );
          }}
        />
        <NativeSelect
          className="h-8 w-auto text-xs md:text-xs"
          aria-label={`Unit for ${cost.name}`}
          value={cost.recurrence.kind}
          onChange={(event) => {
            const kind = event.target.value as Recurrence["kind"];
            const recurrence: Recurrence =
              kind === "everyNWeeks"
                ? { kind, n: cost.recurrence.n, weekday: 1 }
                : { kind, n: cost.recurrence.n };
            mutate((draft) => updateRecurringCost(draft, cost.id, { recurrence }));
          }}
        >
          <option value="everyNDays">days</option>
          <option value="everyNWeeks">weeks</option>
          <option value="everyNMonths">months</option>
        </NativeSelect>
        {cost.recurrence.kind === "everyNWeeks" && (
          <NativeSelect
            className="h-8 w-auto text-xs md:text-xs"
            aria-label={`Weekday for ${cost.name}`}
            value={cost.recurrence.weekday}
            onChange={(event) => {
              const weekday = Number(event.target.value);
              mutate((draft) =>
                updateRecurringCost(draft, cost.id, {
                  recurrence: { kind: "everyNWeeks", n: cost.recurrence.n, weekday },
                }),
              );
            }}
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
    );
  }

  return (
    <Section
      title="Recurring costs"
      hint="Bills that repeat. Each one projects forward as EXPECTED spending and is confirmed from the month view when the money actually moves — expected never touches a post's real balance. Anchoring decides where the next charge is measured from: the calendar, or the date the last one actually charged. Use the second for a bill that can charge early, like a phone plan that recharges when its data runs out."
    >
      {ordered.length === 0 ? (
        <p className="text-sm text-budget-ink-muted">
          No recurring costs yet. Add rent, a subscription, or a phone bill below.
        </p>
      ) : (
        <div className="-mr-2 overflow-x-auto pr-2">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left">
              <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Every</th>
                <th className="py-2 font-medium">Measured from</th>
                <th className="py-2 font-medium">Starts</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((cost, index) => (
                <tr
                  key={cost.id}
                  className={`border-b last:border-0 ${cost.archived ? "opacity-50" : ""}`}
                >
                  <td className="py-2">
                    <Input
                      className="h-8 w-40"
                      value={cost.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        mutate((draft) => updateRecurringCost(draft, cost.id, { name }));
                      }}
                    />
                  </td>
                  <td className="py-2">{amountCell(cost)}</td>
                  <td className="py-2">{intervalCell(cost)}</td>
                  <td className="py-2">
                    <NativeSelect
                      className="h-8 w-auto text-xs md:text-xs"
                      aria-label={`Anchoring for ${cost.name}`}
                      value={cost.anchoring}
                      onChange={(event) => {
                        const anchoring = event.target.value as RecurringCost["anchoring"];
                        mutate((draft) => updateRecurringCost(draft, cost.id, { anchoring }));
                      }}
                    >
                      <option value="calendar">the calendar</option>
                      <option value="lastCharge">the last charge</option>
                    </NativeSelect>
                  </td>
                  <td className="py-2">
                    <Input
                      className="h-8 w-32"
                      type="text"
                      aria-label={`Start date for ${cost.name}`}
                      value={cost.startDate}
                      onChange={(event) => {
                        const startDate = event.target.value;
                        mutate((draft) => updateRecurringCost(draft, cost.id, { startDate }));
                      }}
                    />
                  </td>
                  <td className="py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => mutate((draft) => moveRecurringCost(draft, cost.id, -1))}
                      >
                        up
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={index === ordered.length - 1}
                        onClick={() => mutate((draft) => moveRecurringCost(draft, cost.id, 1))}
                      >
                        down
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="-mr-2"
                        onClick={() =>
                          mutate((draft) =>
                            cost.archived
                              ? restoreRecurringCost(draft, cost.id)
                              : endRecurringCost(draft, cost.id, currentMonth),
                          )
                        }
                      >
                        {cost.archived ? "restart" : "end"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-budget-ink-muted">
        Ending a cost stops it from this month onward and leaves every past
        occurrence exactly as it was. Changing the amount only moves occurrences
        that have not been confirmed yet — what you already paid is recorded on
        the purchases themselves, so a price rise never rewrites history.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-budget-rule pt-5">
        <Input
          className="w-48"
          placeholder="New cost name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={newName.trim() === "" || !firstPost}
          onClick={() => {
            const name = newName.trim();
            mutate((draft) =>
              addRecurringCost(draft, {
                name,
                archived: false,
                amount: { amount: 0, currency: base },
                startDate: currentMonth,
                recurrence: { kind: "everyNMonths", n: 1 },
                anchoring: "calendar",
                splitMode: "percent",
                splits: [{ postId: firstPost!.id, value: 100, absorbsRemainder: true }],
              }),
            );
            setNewName("");
          }}
        >
          Add recurring cost
        </Button>
        {!firstPost && (
          <span className="text-xs text-budget-ink-muted">Create a post first.</span>
        )}
      </div>
    </Section>
  );
}
```

`money` is imported but only needed once the amount column formats rather than echoes; leave the import in place and use `money.money(cost.amount.amount, cost.amount.currency)` as the `defaultValue` if you prefer the formatted form. Do not reach for `format.ts` directly.

- [ ] **Step 2: Mount it**

In `src/ui/routes/SettingsRoute.tsx`, import and place it between `PostsSection` and `DataSection` — costs reference posts, so posts come first, and both come before the destructive import/export controls:

```tsx
import { RecurringSection } from "./settings/RecurringSection.tsx";
```

```tsx
      <CurrencySection />
      <PostsSection />
      <RecurringSection />
      <DataSection />
      <ColophonSection />
```

- [ ] **Step 3: Run the guard tests**

Run: `bun test src/ui/eventCapture.test.ts src/ui/storeWriteErrors.test.ts src/ui/cssTokens.test.ts src/cssPairs.test.ts && bunx tsc --noEmit`
Expected: PASS. These are source-level guards, so a new file is exactly what they exist to catch.

- [ ] **Step 4: Screenshot it**

With `bun run dev` running:

```bash
bun scripts/demo-data.ts /tmp/seed.js
bun scripts/screenshot.ts http://localhost:3000/settings /tmp/settings.png \
  --eval-file=/tmp/seed.js --reload --full
```

Read `/tmp/settings.png`. Check: the table does not overflow its card, the row actions are reachable, and the weekday select appears only for a weekly cost. Repeat with `--dark`. `--reload` is not optional — without it the app re-seeds itself empty and the screenshot shows nothing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/routes/settings/RecurringSection.tsx src/ui/routes/SettingsRoute.tsx
git commit -m "feat(settings): define recurring costs

Follows PostsSection: same table, same xs ghost row actions, same add row.
Definition is the rare act, so it lives here rather than in the month view.

Placed after Posts because a cost's splits reference posts, and before the
data section so the destructive import controls stay last.

'end' sets endedFrom to the current month and archives in one action, which is
what the owner means by cancelling a subscription. Past occurrences are
untouched, so no historical figure moves."
```

---

### Task 9: Confirming occurrences in the month view

**Files:**
- Create: `src/ui/components/ExpectedBand.tsx`
- Modify: `src/ui/routes/MonthRoute.tsx`

**Interfaces:**
- Consumes: `occurrencesByMonth`, `compareMonths`, `confirmOccurrence`, `useDataset`, `useMutate`, `useMoneyFormat`, `Section`, `parseMoneyInput`.
- Produces: `<ExpectedBand monthId={monthId} />`.

This is the repeated act, so it is one click, not a dialog. Entry speed is a product principle.

- [ ] **Step 1: Create the component**

Create `src/ui/components/ExpectedBand.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { useMoneyFormat } from "../hooks/useMoneyFormat.ts";
import { confirmOccurrence } from "../../store/actions.ts";
import { occurrencesByMonth } from "../../domain/occurrences.ts";
import { compareMonths, monthOf } from "../../domain/months.ts";
import { parseMoneyInput } from "../moneyInput.ts";
import { Section } from "./Section.tsx";
import type { MonthId } from "../../domain/types.ts";

/**
 * The month's expected charges, and the one click that turns each into a real
 * purchase.
 *
 * Confirmation is offered on any unconfirmed occurrence in this month,
 * INCLUDING one whose date has not arrived yet. That is not an oversight: a
 * bill anchored to its last charge can charge early — a phone plan whose data
 * cap is hit on the 12th when the slot sat on the 30th — and confirming the
 * pending slot with the real date is exactly how the series rebases.
 */
export function ExpectedBand({ monthId }: { monthId: MonthId }) {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const money = useMoneyFormat();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const { pending, overdue } = useMemo(() => {
    const byMonth = occurrencesByMonth(dataset, monthId);
    const thisMonth = (byMonth.get(monthId) ?? []).filter((o) => !o.confirmedBy);

    // Everything unconfirmed in an EARLIER month. An occurrence nobody ever
    // confirms holds the projected balance down forever, which is the honest
    // reading of an unreconciled commitment — but it is silent unless counted.
    let earlier = 0;
    for (const [month, occurrences] of byMonth) {
      if (compareMonths(month, monthId) >= 0) continue;
      earlier += occurrences.filter((o) => !o.confirmedBy).length;
    }

    return { pending: thisMonth, overdue: earlier };
  }, [dataset, monthId]);

  if (pending.length === 0 && overdue === 0) return null;

  const nameOf = (recurringId: string) =>
    dataset.recurring.find((c) => c.id === recurringId)?.name ?? "Unknown";

  return (
    <Section
      title="Expected"
      hint="Committed but not yet spent. These do not touch a post's balance until you confirm one, which records it as an ordinary purchase you can edit or delete afterwards."
    >
      {pending.length > 0 && (
        <ul className="divide-y divide-budget-rule">
          {pending.map((occurrence) => {
            const key = `${occurrence.recurringId}:${occurrence.date}`;
            const typed = amounts[key];
            return (
              <li
                key={key}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm">{nameOf(occurrence.recurringId)}</div>
                  <div className="text-xs text-budget-ink-muted">{occurrence.date}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 w-28"
                    // text, not number: a number input discards the "$" before
                    // parseMoneyInput can read it.
                    type="text"
                    aria-label={`Amount for ${nameOf(occurrence.recurringId)} on ${occurrence.date}`}
                    value={typed ?? String(occurrence.amount.amount)}
                    onChange={(event) => {
                      const next = event.target.value;
                      setAmounts((current) => ({ ...current, [key]: next }));
                    }}
                  />
                  <span className="text-xs text-budget-ink-muted">
                    {occurrence.amount.currency}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // Captured before mutate, per AGENTS.md: mutate defers
                      // behind the write queue and React resets the input
                      // first, so reading in the callback commits stale text.
                      const parsed =
                        typed === undefined
                          ? null
                          : parseMoneyInput(typed, dataset.currencies, occurrence.amount.currency);
                      mutate((draft) =>
                        confirmOccurrence(draft, occurrence.recurringId, occurrence.date, {
                          amount: parsed ?? undefined,
                        }),
                      );
                      setAmounts((current) => {
                        const next = { ...current };
                        delete next[key];
                        return next;
                      });
                    }}
                  >
                    Confirm
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {overdue > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-budget-ink-muted">
          {overdue} earlier {overdue === 1 ? "occurrence has" : "occurrences have"} never
          been confirmed. Until {overdue === 1 ? "it is" : "they are"}, the projected
          balance stays lower than the real one by that amount.
        </p>
      )}
    </Section>
  );
}
```

- [ ] **Step 2: Mount it in the month view**

In `src/ui/routes/MonthRoute.tsx`, import it and place it after the totals `Section` (around line 127) and before the post table, so committed money is visible above the balances it affects:

```tsx
import { ExpectedBand } from "../components/ExpectedBand.tsx";
```

```tsx
      <ExpectedBand monthId={monthId} />
```

The component returns `null` when there is nothing expected and nothing overdue, so a dataset with no recurring costs sees no change at all.

- [ ] **Step 3: Run the guard tests and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS. `eventCapture.test.ts` and `storeWriteErrors.test.ts` both read source text, so they cover this new file automatically.

- [ ] **Step 4: Screenshot the flow**

With `bun run dev` running and demo data that includes a recurring cost (Task 10 adds it — do Task 10 Step 1 first if you want real data here):

```bash
bun scripts/demo-data.ts /tmp/seed.js
bun scripts/screenshot.ts http://localhost:3000/month/2026-09 /tmp/month.png \
  --eval-file=/tmp/seed.js --reload --full
```

Read `/tmp/month.png`. Then confirm one and check the band shrinks:

```bash
bun scripts/screenshot.ts http://localhost:3000/month/2026-09 /tmp/confirmed.png \
  --eval-file=/tmp/seed.js --reload --full --click='button:has-text("Confirm")'
```

If `--click` cannot express that selector, drive it with `--eval-after-file` instead. Repeat with `--dark`.

What a screenshot proves here: the band renders, the rows align, and the click path works. What it does NOT prove: that the design is good, or that the container's fonts resemble the owner's. Say so rather than claiming otherwise.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ExpectedBand.tsx src/ui/routes/MonthRoute.tsx
git commit -m "feat(month): confirm expected charges in one click

The repeated act, so it is a row and a button rather than a dialog — entry
speed is a product principle and a modal per bill would defeat it. The amount
is editable inline because paying a different figure is common; anything more
unusual is edited afterwards like any other purchase.

Confirmation is offered on a pending occurrence whose date has not arrived yet,
deliberately. A bill anchored to its last charge can charge EARLY, and
confirming the pending slot with the real date is how the series rebases.

The overdue count is not decoration. An occurrence nobody ever confirms holds
the projected balance down forever, which is the honest reading of an
unreconciled commitment but is invisible without it.

Returns null when nothing is expected, so a dataset with no recurring costs
sees no change to the month view at all."
```

---

### Task 10: Demo data, documents, and whole-app verification

**Files:**
- Modify: `scripts/demo-data.ts`
- Modify: `AGENTS.md`, `docs/DECISIONS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/TODO.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code exports.

- [ ] **Step 1: Seed demo recurring costs**

In `scripts/demo-data.ts`, add two costs after the `setRuleOverride` line. The
script builds its dataset through `actions.*` rather than object literals, so
these go through `addRecurringCost` and pick up its rounding and validation:

```ts
const wowSub = actions.addRecurringCost(d, {
  name: "World of Warcraft",
  archived: false,
  amount: { amount: 13, currency: "USD" },
  startDate: "2026-06-05",
  recurrence: { kind: "everyNDays", n: 28 },
  anchoring: "calendar",
  splitMode: "percent",
  splits: [{ postId: games.id, value: 100, absorbsRemainder: true }],
});

actions.addRecurringCost(d, {
  name: "Rent",
  archived: false,
  amount: { amount: 8200, currency: "DKK" },
  startDate: "2026-06",
  recurrence: { kind: "everyNMonths", n: 1 },
  anchoring: "calendar",
  splitMode: "percent",
  splits: [{ postId: rent.id, value: 100, absorbsRemainder: true }],
});

// One confirmed occurrence, so a screenshot shows both states at once: the
// band lists what is still expected, and the fold's two tracks have already
// reconverged for this one.
actions.confirmOccurrence(d, wowSub.id, "2026-06-05", { date: "2026-06-05" });
```

`games` and `rent` are already in scope in that file — `games` from the seed
posts, `rent` from the `addPost` call above. The 28-day subscription is the one
worth having: it puts two occurrences in some months, which is the case the
band exists to make legible, and it is in USD so the screenshot exercises FX
conversion on the expected track too.

- [ ] **Step 2: Update AGENTS.md §1**

Add two invariants after the `MonthId` bullet:

```markdown
- **A recurring cost's occurrences are COMPUTED, never stored.** `Dataset`
  holds the rule and the confirmations; `occurrencesByMonth` derives the rest
  on every fold. There is no horizon and no "generate ahead" step, and
  `upToMonth` comes from the caller so `src/domain/` stays clock-free. Storing
  them would reintroduce the materialised snapshot the original design rejected.
- **On a confirmation, `Purchase.date` is TRUTH and `source.occurrenceDate` is
  IDENTITY.** The slot is what a confirmation claims, so the projector stops
  emitting it; the date is when the money moved, so the fold counts it there.
  They differ whenever a bill is paid off schedule, and under `lastCharge`
  anchoring it is `date` that rebases the series. Do not "simplify" them into
  one field — that erases the phone-bill behaviour entirely.
```

- [ ] **Step 3: Update AGENTS.md §2**

Add after the `roundMoney` guard:

```markdown
- **A recurrence interval must be an integer `>= 1`, rejected rather than
  clamped**, at BOTH write boundaries — `requireRecurrence` in
  `src/store/actions.ts` and in `src/export/json.ts`. The projection walk
  terminates only because every step strictly advances, and a clamped zero
  would hand the owner a schedule their data does not describe. The walk throws
  if a step fails to advance; do not soften that into a `break`.
  → `src/domain/occurrences.test.ts`, `src/store/actions.test.ts`,
  `src/export/json.test.ts`
```

- [ ] **Step 4: Update the other documents**

- `docs/DECISIONS.md` — a new `## Recurring costs` heading with entries for: two-stage confirmation over projection-only or generation-only; a new entity over extending `Purchase.schedule`; `lastCharge` anchoring over a data-cap concept; day-less `everyNMonths` over `monthlyOnDay`; a mutable amount over a dated series. Each points at `docs/specs/2026-09-03-recurring-costs-design.md`. Change "Now at version 6" to 7.
- `docs/PRODUCT.md` — add recurring costs to "Capabilities and Constraints", and add **recurring cost**, **occurrence** and **confirming** to the terminology line.
- `docs/ARCHITECTURE.md` — add `days.ts` and `occurrences.ts` to the layer description, and the second balance to the derived-values list.
- `docs/TODO.md` — update the "Current state" test count, note schema is at 7, and record what still needs a human (below).

- [ ] **Step 5: Run everything**

```bash
bun test
bunx tsc --noEmit
bun run build
```

Expected: all pass. `src/docsLinks.test.ts` will fail if any path named in `AGENTS.md`, `README.md` or `docs/*.md` is not git-tracked — commit new files before running it, or it flags them.

- [ ] **Step 6: Screenshot both routes, both themes**

```bash
bun scripts/demo-data.ts /tmp/seed.js
for route in "month/2026-09" "settings"; do
  for mode in "" "--dark"; do
    bun scripts/screenshot.ts "http://localhost:3000/$route" "/tmp/$(echo $route | tr / -)$mode.png" \
      --eval-file=/tmp/seed.js --reload --full $mode
  done
done
```

Read every PNG. Also check a phone width with `--w=390`.

- [ ] **Step 7: State what is NOT verified**

In the final report, say plainly — do not claim otherwise:

- **How it looks and feels.** A screenshot proves a layout is not broken. The container's fontconfig is not the owner's fonts.
- **The overdue count against a real backlog.** Demo data has no months-old unconfirmed occurrences unless you seed them.
- **Whether the two-stage model matches how the owner actually reconciles.** That is a product question a week of use answers and no test can.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md docs/ scripts/demo-data.ts
git commit -m "docs(recurring): record the invariants and what they cost

Two rules that only review catches, so they go in AGENTS.md §1: occurrences are
computed and never stored, and a confirmation's date and its slot are different
facts. Collapsing the second pair into one field would silently delete the
phone-bill behaviour, which is why it is written down rather than left to the
types.

§2 gets the termination guard. n >= 1 is rejected at both write boundaries
rather than clamped, and the walk throws rather than breaking, because a bill
silently dropped from a budget is worse than a visible error.

Demo data seeds a monthly rent and a 28-day subscription — the second is what
puts two occurrences in one month, which is the case worth looking at."
```

---

## Self-review

**Spec coverage.** Every numbered section of the spec maps to a task:

| Spec § | Task |
| --- | --- |
| 1. Types | 2 |
| 2. No dated amount series | 2 (documented on the type) |
| 3. `days.ts` | 1 |
| 4. The walk | 3 |
| 5. Confirmation and the unconfirmed occurrence | 3 (suppression), 9 (overdue count) |
| 6. Fold integration | 4 (extraction, `expectedForMonth`), 5 (two tracks) |
| 7. Migration | 2 |
| 8. Validation | 7 |
| 9. Store actions | 6 |
| 10. UI | 8 (Settings), 9 (month view) |
| 11. Tests | distributed; `currencyDigits.test.ts` is the one gap — see below |
| Documents to update | 10 |

**One deliberate deviation from the spec.** The spec's §11 lists a
`currencyDigits.test.ts` addition. It is not a separate task because the file
now drives the whole dataset at zero decimals; adding a recurring cost to its
fixture is a two-line change that belongs in Task 5, where the fold gains the
`expected` track. Do it there: add a recurring cost to that file's dataset and
assert `expected` and `projected` are whole units at `digits: 0`, alongside the
existing assertions.

**Ordering.** Tasks 1–5 are the domain and must run in order. Task 6 depends on
2. Task 7 depends on 2. Tasks 8 and 9 depend on 6. Task 10 depends on all.
Tasks 6 and 7 are independent of each other and of 3–5 beyond the types.
