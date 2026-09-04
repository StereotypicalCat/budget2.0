# Recurring Costs: The Anchored Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `lastCharge` recurring cost stops having slots — its next due date is derived from the latest actual charge, so it can be charged any number of times per cycle and each charge restarts the clock.

**Architecture:** `occurrencesOf` splits on `cost.anchoring` into two walks that share only `stepFrom`. `calendar` keeps the shipped grid, byte-for-byte. `lastCharge` gains an anchored walk with no slots, no confirmation lookup, and no possibility of stepping backwards — which lets three guards be deleted. Two additive UI changes ride along: a real split editor for recurring costs, and a recurring-cost control in the purchase dialog.

**Tech Stack:** Bun (runtime, test runner, bundler, package manager), TypeScript, React 19, Tailwind 4, shadcn/ui. No new dependencies.

**Spec:** `docs/specs/2026-09-05-recurring-costs-anchored-model.md` — read it before Task 1. Where plan and spec disagree, the spec wins and the plan is wrong.

## Global Constraints

Copied from `AGENTS.md`. Every task's requirements implicitly include these.

- **Bun only.** `bun test`, `bun install`, `bun run <script>`, `bunx`. Never node, npm, jest, vitest, webpack, vite.
- **`src/domain/` is pure.** No React, no IndexedDB, no `Date.now()`, no `new Date()` without an explicit argument. `src/domain/days.ts` and `src/domain/occurrences.ts` use no `Date` **at all** — integer arithmetic on a day ordinal only.
- **`roundMoney(amount, digits)` takes a DIGIT COUNT** from `dataset.settings.digits`. There is no `digitsFor`. Never a literal `2` — display included, where `useMoneyFormat()` is how a component gets digits bound.
- **When splitting an amount, never round the last part independently.** Use `distributeByWeight` / `distributeByAmount`; do not hand-roll a split.
- **Do not soften a domain throw into a fallback.** Silently wrong numbers are worse than a visible error.
- **A migration step must not import a live default.** Frozen local literals only. → `src/store/migrations.test.ts`
- **AGENTS.md §3 — validation that is DELIBERATELY ABSENT.** Do NOT add guards for: going over budget, allocation percentages past 100, splits that do not sum to the total, or negative amounts. Adding one is a regression, not an improvement. This plan adds validators; keeping §3 clean through them is a hard requirement.
- **Never read `event.target.value` inside a `mutate()` callback** — capture it into a `const` in the handler first. → `src/ui/eventCapture.test.ts`
- **Every awaited `store.*` call in `src/ui/` must be guarded** — `useMutate` is the guard. → `src/ui/storeWriteErrors.test.ts`
- **Never a bare `--accent`**; shadcn tokens are redefined only in `-foreground` pairs; the app's own tokens are `--budget-*`; a `var()` naming a token `src/index.css` does not define paints NOTHING, silently, and the guard matches source TEXT so it flags a token named even in a comment. → `src/cssPairs.test.ts`, `src/ui/cssTokens.test.ts`
- **An amount field is `type="text"`, never `type="number"`** — a number input strips the "$" before `parseMoneyInput` sees it.
- **Schema goes to 8.** Recurring costs took 7.

## Baseline

`main` at the merge of the round-1 branch: **651 tests pass, 0 fail**, `bunx tsc --noEmit` clean, `bun run build` succeeds. Any failure at the end of a task that is not explicitly called out as expected is new breakage.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/domain/days.ts` | modify | Add `addMonthsToDate` — day-precise month stepping with end-of-month clamping. |
| `src/domain/occurrences.ts` | modify | Two walks; delete `rebasedFrom` and `wouldAdvancePast`; `chargesFor`. |
| `src/domain/types.ts` | modify | `source.occurrenceDate` becomes optional. |
| `src/domain/seed.ts` | modify | `SCHEMA_VERSION = 8`. |
| `src/store/migrations.ts` | modify | Step 7 → 8. |
| `src/store/actions.ts` | modify | Delete `requireConfirmationAdvances`; widen granularity rule; refuse anchoring change; anchored `confirmOccurrence`. |
| `src/export/json.ts` | modify | The `occurrenceDate` required/forbidden pairing; widened granularity rule. |
| `src/ui/components/ExpectedBand.tsx` | modify | Delete the offerability guard; anchored coming-up rows are informational. |
| `src/ui/components/SplitEditor.tsx` | modify | Generalise from `PurchaseDraft` to `SplitTarget`. |
| `src/ui/purchaseForm.ts` | modify | Export `SplitTarget`; narrow `splitBalance`. |
| `src/ui/routes/settings/RecurringSection.tsx` | modify | Use `SplitEditor`; disable the anchoring control when charges exist. |
| `src/ui/components/PurchaseDialog.tsx` | modify | The recurring-cost control. |
| `src/ui/recurringForm.ts` | create | Pure helpers for the dialog's control, testable with no DOM. |
| `scripts/demo-data.ts` | modify | An anchored cost with two charges in one month. |

---

### Task 1: Day-precise month stepping

**Files:**
- Modify: `src/domain/days.ts`
- Test: `src/domain/days.test.ts`

**Interfaces:**
- Consumes: `toDayOrdinal`, `fromDayOrdinal`, and the private `daysInMonth` — all already in `src/domain/days.ts`.
- Produces: `addMonthsToDate(date: IsoDate, n: number): IsoDate`.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/days.test.ts`:

```ts
describe("addMonthsToDate", () => {
  test("keeps the day of month when the target month is long enough", () => {
    expect(addMonthsToDate("2026-09-20", 1)).toBe("2026-10-20");
    expect(addMonthsToDate("2026-01-15", 3)).toBe("2026-04-15");
  });

  test("clamps to the last day when the target month is shorter", () => {
    // A billing cycle anchored on the 31st cannot land on 31 February; every
    // calendar library settles on the last valid day, and so do we.
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonthsToDate("2026-08-31", 6)).toBe("2027-02-28");
  });

  test("clamps to 29 February in a leap year", () => {
    expect(addMonthsToDate("2024-01-31", 1)).toBe("2024-02-29");
  });

  test("crosses a year boundary", () => {
    expect(addMonthsToDate("2026-11-20", 3)).toBe("2027-02-20");
    expect(addMonthsToDate("2026-12-31", 1)).toBe("2027-01-31");
  });

  test("a twelve-month step lands on the same day", () => {
    expect(addMonthsToDate("2026-09-20", 12)).toBe("2027-09-20");
  });

  test("clamping does not accumulate — each step measures from the ORIGINAL day", () => {
    // Stepping 31 Jan by one month twice must reach 31 March, not 28 March.
    // That only holds if the caller keeps the original anchor; this test pins
    // the single-step behaviour the caller relies on.
    expect(addMonthsToDate("2026-01-31", 2)).toBe("2026-03-31");
  });

  test("rejects a month-granular date", () => {
    expect(() => addMonthsToDate("2026-09", 1)).toThrow();
  });
});
```

Add `addMonthsToDate` to that file's import from `./days.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/days.test.ts`
Expected: FAIL — `addMonthsToDate is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/days.ts`:

```ts
/**
 * `date` plus `n` months, staying day-granular, clamping to the last day of
 * the target month: 31 Jan + 1 month is 28 Feb (29 in a leap year).
 *
 * Only the ANCHORED path needs this. A `calendar` monthly cost is
 * month-granular and steps with `addMonths` on a MonthId, where the question
 * cannot arise — which is why this codebase had no clamp rule until a phone
 * plan that refreshes on the 20th needed to be next due on the 20th.
 *
 * `Date`-free like the rest of this module: the year/month arithmetic is
 * integer division, and `daysInMonth` already knows the leap rule.
 */
export function addMonthsToDate(date: IsoDate, n: number): IsoDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Not a day-granular IsoDate: ${date}`);
  }
  // Validates the input date (including an impossible day) before stepping.
  toDayOrdinal(date);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const zeroBased = year * 12 + (month - 1) + n;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth));

  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/domain/days.test.ts`
Expected: PASS.

If `addMonthsToDate("2026-01-31", 2)` gives `2026-03-28`, the implementation is clamping twice — it must compute the target month from the original day, not step month by month.

- [ ] **Step 5: Run the whole suite and commit**

Run: `bun test && bunx tsc --noEmit`
Expected: 651 + 7 pass, 0 fail, tsc clean.

```bash
git add src/domain/days.ts src/domain/days.test.ts
git commit -m "feat(domain): day-precise month stepping, clamped

A phone plan that refreshes on 20 September is next due 20 October, not
'October'. The anchored path is day-granular, so month arithmetic finally
needs a clamp rule: 31 Jan + 1 month is 28 Feb.

Clamping measures from the ORIGINAL day rather than stepping month by month,
so 31 Jan + 2 months is 31 March and not 28 March. Date-free like the rest of
days.ts; daysInMonth already knew the leap rule."
```

---

### Task 2: Types and `stepFrom`

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/occurrences.ts`
- Test: `src/domain/occurrences.test.ts`

**Interfaces:**
- Consumes: `addMonthsToDate` (Task 1).
- Produces: `Purchase.source.occurrenceDate?: IsoDate`; `stepFrom(date: IsoDate, recurrence: Recurrence, anchoring: Anchoring): IsoDate`.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/occurrences.test.ts`:

```ts
describe("stepFrom, by anchoring", () => {
  const monthly = { kind: "everyNMonths", n: 1 } as const;

  test("everyNMonths under calendar stays month-granular", () => {
    expect(stepFrom("2026-09", monthly, "calendar")).toBe("2026-10");
    expect(stepFrom("2026-09-20", monthly, "calendar")).toBe("2026-10");
  });

  test("everyNMonths under lastCharge is day-precise", () => {
    // The whole point: a plan refreshed on the 20th is next due on the 20th.
    expect(stepFrom("2026-09-20", monthly, "lastCharge")).toBe("2026-10-20");
    expect(stepFrom("2026-01-31", monthly, "lastCharge")).toBe("2026-02-28");
  });

  test("day and week kinds ignore anchoring", () => {
    for (const anchoring of ["calendar", "lastCharge"] as const) {
      expect(stepFrom("2026-01-05", { kind: "everyNDays", n: 28 }, anchoring)).toBe("2026-02-02");
      expect(stepFrom("2026-09-03", { kind: "everyNWeeks", n: 2, weekday: 4 }, anchoring)).toBe("2026-09-17");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/occurrences.test.ts`
Expected: FAIL — `stepFrom` takes two arguments, and the day-precise monthly case returns `"2026-10"`.

- [ ] **Step 3: Make `occurrenceDate` optional**

In `src/domain/types.ts`, replace the `source` field on `Purchase`:

```ts
  /**
   * Present when this purchase is a charge for a recurring cost.
   *
   * `occurrenceDate` is the slot this purchase settles, and exists ONLY for a
   * `calendar` cost, where a fixed grid of slots is what a payment settles.
   * A `lastCharge` cost has no grid — its next due date is derived from this
   * purchase's own `date` — so the field is absent there, and its presence
   * would be a lie about how that schedule is computed.
   */
  source?: { recurringId: RecurringCostId; occurrenceDate?: IsoDate };
```

- [ ] **Step 4: Give `stepFrom` the anchoring**

In `src/domain/occurrences.ts`, replace `stepFrom`:

```ts
/**
 * Where the next occurrence falls, given the one before it.
 *
 * Takes the anchoring because `everyNMonths` means two different things:
 * under `calendar` rent occurs IN a month and the grid is month-granular;
 * under `lastCharge` a plan refreshed on the 20th is next due on the 20th,
 * so the step is day-precise and clamps (`addMonthsToDate`). The other two
 * kinds are day-granular either way and ignore the argument.
 *
 * Adding a recurrence kind means adding a case here and a variant to
 * `Recurrence`. Nothing else in the app switches on the kind.
 */
export function stepFrom(
  date: IsoDate,
  recurrence: Recurrence,
  anchoring: Anchoring,
): IsoDate {
  switch (recurrence.kind) {
    case "everyNMonths":
      return anchoring === "lastCharge"
        ? addMonthsToDate(date, recurrence.n)
        : addMonths(monthOf(date), recurrence.n);
    case "everyNDays":
      return addDays(date, recurrence.n);
    case "everyNWeeks":
      return snapForward(addDays(date, 7 * recurrence.n), recurrence.weekday);
  }
}
```

Add `addMonthsToDate` to the `./days.ts` import and `Anchoring` to the type import.

Update the two existing call sites inside this file (`rebasedFrom`'s caller in `wouldAdvancePast`, and `occurrencesOf`) to pass `cost.anchoring`. Both are deleted or rewritten in Task 3; passing the argument now just keeps the file compiling.

- [ ] **Step 5: Run the tests**

Run: `bun test src/domain/occurrences.test.ts && bunx tsc --noEmit`
Expected: the new `stepFrom` tests PASS. `tsc` may flag call sites that read `source.occurrenceDate` as now-possibly-undefined — fix each by narrowing, not by casting. Those sites are `src/domain/occurrences.ts` (`confirmationsFor`), `src/store/actions.ts`, and `src/export/json.ts`; all three are rewritten properly in Tasks 3, 5 and 6, so a narrow `if (!source.occurrenceDate) continue;`-style guard is acceptable here as scaffolding **only if** you leave a `// rewritten in Task N` comment beside it.

- [ ] **Step 6: Run the whole suite and commit**

Run: `bun test && bunx tsc --noEmit`
Expected: 0 fail, tsc clean.

```bash
git add src/domain/types.ts src/domain/occurrences.ts src/domain/occurrences.test.ts
git commit -m "feat(types): occurrenceDate is optional, stepFrom takes anchoring

A lastCharge cost has no grid of slots, so a purchase against one settles
nothing — its own date is the whole story. occurrenceDate stays required for
calendar, where a slot is exactly what a payment settles.

stepFrom needs the anchoring because everyNMonths means two different things:
a month-granular grid under calendar, a day-precise clamped step under
lastCharge."
```

---

### Task 3: The anchored walk

**Files:**
- Modify: `src/domain/occurrences.ts`
- Test: `src/domain/occurrences.test.ts`

**Interfaces:**
- Consumes: `stepFrom(date, recurrence, anchoring)` (Task 2).
- Produces: `chargesFor(purchases: readonly Purchase[], recurringId: RecurringCostId): Purchase[]` (ascending by date); `occurrencesOf(cost: RecurringCost, purchases: readonly Purchase[], upToMonth: MonthId): Occurrence[]`.
- **Deletes:** `rebasedFrom`, `wouldAdvancePast`.

`occurrencesOf`'s second parameter changes from a confirmations `Map` to the raw purchase list, because the two walks need different views of it and only this function knows which. `occurrencesByMonth` already holds `dataset.purchases`.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/occurrences.test.ts`. `cost()` and `confirmation()` already exist in that file; add an anchored fixture beside them:

```ts
describe("the anchored walk (lastCharge)", () => {
  function phone(overrides: Partial<RecurringCost> = {}): RecurringCost {
    return cost({
      id: "phone",
      name: "Phone plan",
      startDate: "2026-09-01",
      recurrence: { kind: "everyNMonths", n: 1 },
      anchoring: "lastCharge",
      ...overrides,
    });
  }
  /** A charge against a cost carries NO occurrenceDate — there is no slot. */
  function charge(id: string, date: string, recurringId = "phone"): Purchase {
    return {
      id, date, description: "Phone plan",
      total: { amount: 300, currency: "DKK" },
      splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null,
      source: { recurringId },
    };
  }

  test("with no charges, the first occurrence is the start date", () => {
    expect(occurrencesOf(phone(), [], "2026-11").map((o) => o.date)).toEqual([
      "2026-09-01", "2026-10-01", "2026-11-01",
    ]);
  });

  test("a charge re-anchors the series to its own date", () => {
    const dates = occurrencesOf(phone(), [charge("p1", "2026-09-20")], "2026-11").map((o) => o.date);
    expect(dates).toEqual(["2026-10-20", "2026-11-20"]);
  });

  test("THE REPORTED BUG: two charges in one month leave the next due one cycle after the LATER", () => {
    const dates = occurrencesOf(
      phone(),
      [charge("p1", "2026-09-05"), charge("p2", "2026-09-20")],
      "2026-11",
    ).map((o) => o.date);
    // NOT 2026-11-xx. Two payments in September do not buy two months.
    expect(dates[0]).toBe("2026-10-20");
  });

  test("three charges in one month — the cap can be hit as often as it likes", () => {
    const dates = occurrencesOf(
      phone(),
      [charge("p1", "2026-09-05"), charge("p2", "2026-09-12"), charge("p3", "2026-09-28")],
      "2026-11",
    ).map((o) => o.date);
    expect(dates[0]).toBe("2026-10-28");
  });

  test("charges are ordered by date, not by array position", () => {
    const dates = occurrencesOf(
      phone(),
      [charge("p2", "2026-09-20"), charge("p1", "2026-09-05")],
      "2026-10",
    ).map((o) => o.date);
    expect(dates[0]).toBe("2026-10-20");
  });

  test("a charge back-dated before startDate cannot pull the series backwards", () => {
    const dates = occurrencesOf(phone(), [charge("p1", "2026-06-01")], "2026-11").map((o) => o.date);
    // Anchored at startDate, not at the stray charge.
    expect(dates[0]).toBe("2026-10-01");
  });

  test("every anchored occurrence is unconfirmed — a charge is a Purchase, not an occurrence", () => {
    const found = occurrencesOf(phone(), [charge("p1", "2026-09-20")], "2026-11");
    expect(found.every((o) => o.confirmedBy === null)).toBe(true);
  });

  test("a charge for a DIFFERENT cost does not re-anchor this one", () => {
    const dates = occurrencesOf(phone(), [charge("p1", "2026-09-20", "other")], "2026-10").map((o) => o.date);
    expect(dates[0]).toBe("2026-09-01");
  });

  test("endedFrom still stops the series", () => {
    const dates = occurrencesOf(phone({ endedFrom: "2026-10" }), [], "2026-12").map((o) => o.date);
    expect(dates).toEqual(["2026-09-01"]);
  });

  test("a day-granular anchored cost steps in days", () => {
    const daily = phone({ recurrence: { kind: "everyNDays", n: 30 }, startDate: "2026-09-01" });
    const dates = occurrencesOf(daily, [charge("p1", "2026-09-12")], "2026-11").map((o) => o.date);
    expect(dates).toEqual(["2026-10-12", "2026-11-11"]);
  });
});

describe("the calendar walk is unchanged", () => {
  test("a purchase settles the slot it names, and two settle two", () => {
    const rent = cost({ id: "rent", startDate: "2026-09", anchoring: "calendar" });
    /** A calendar charge DOES carry a slot — that is the difference. */
    function settles(id: string, slot: string, paidOn: string): Purchase {
      return {
        id, date: paidOn, description: "Rent",
        total: { amount: 8200, currency: "DKK" },
        splitMode: "percent",
        splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
        schedule: null,
        source: { recurringId: "rent", occurrenceDate: slot },
      };
    }
    const found = occurrencesOf(
      rent,
      [settles("p1", "2026-09", "2026-09-05"), settles("p2", "2026-10", "2026-09-20")],
      "2026-11",
    );
    // For a calendar bill this IS correct: paying September and October's
    // rent really does mean nothing is due until November.
    expect(found.map((o) => o.confirmedBy)).toEqual(["p1", "p2", null]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/occurrences.test.ts`
Expected: FAIL — `occurrencesOf` takes a `Map`, so the array argument produces no confirmations and the anchored expectations do not hold.

- [ ] **Step 3: Add `chargesFor` and split the walk**

In `src/domain/occurrences.ts`, add beside `confirmationsFor`:

```ts
/**
 * Every purchase recorded as a charge for one cost, oldest first.
 *
 * The anchored walk needs the LATEST of these and nothing else: a charge is
 * not a confirmation of anything, it is the event that restarts the cycle.
 */
export function chargesFor(
  purchases: readonly Purchase[],
  recurringId: RecurringCostId,
): Purchase[] {
  return purchases
    .filter((p) => p.source?.recurringId === recurringId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
```

Then replace `occurrencesOf` entirely:

```ts
/**
 * Every occurrence of one cost from its start through `upToMonth`, in order.
 *
 * Two walks, one per anchoring, sharing only `stepFrom`.
 *
 * `calendar` is a fixed grid: slots from `startDate`, each settled or not by
 * the purchase naming it. Nothing a payment does moves the grid, so paying
 * September AND October's rent correctly leaves nothing due until November.
 *
 * `lastCharge` has no grid. Its next due date is one cycle after the latest
 * actual charge, so a bill can be charged any number of times per cycle and
 * each charge restarts the clock — which is what a phone plan that refreshes
 * when its data runs out actually does. Every occurrence it emits is
 * unconfirmed by definition: a charge that happened is a `Purchase`, not an
 * occurrence.
 *
 * `upToMonth` comes from the caller. This module reads no clock, which is what
 * keeps `src/domain/` pure.
 */
export function occurrencesOf(
  cost: RecurringCost,
  purchases: readonly Purchase[],
  upToMonth: MonthId,
): Occurrence[] {
  return cost.anchoring === "lastCharge"
    ? anchoredOccurrences(cost, purchases, upToMonth)
    : gridOccurrences(cost, confirmationsFor(purchases, cost.id), upToMonth);
}

function anchoredOccurrences(
  cost: RecurringCost,
  purchases: readonly Purchase[],
  upToMonth: MonthId,
): Occurrence[] {
  const charges = chargesFor(purchases, cost.id);
  const latest = charges.length > 0 ? charges[charges.length - 1]!.date : null;

  // `max(latest, startDate)`: a charge back-dated before the cost existed must
  // not pull the series behind its own start.
  const anchor = latest === null ? null : isBefore(latest, cost.startDate) ? cost.startDate : latest;

  let cursor = anchor === null ? cost.startDate : stepFrom(anchor, cost.recurrence, cost.anchoring);

  const found: Occurrence[] = [];
  while (compareMonths(monthOf(cursor), upToMonth) <= 0) {
    if (cost.endedFrom && !isBefore(cursor, cost.endedFrom)) break;

    found.push({
      recurringId: cost.id,
      date: cursor,
      amount: cost.amount,
      // Always null: an anchored occurrence is a projection, and a charge that
      // happened is a Purchase counted in `charges`, never an occurrence here.
      confirmedBy: null,
    });

    const next = stepFrom(cursor, cost.recurrence, cost.anchoring);
    // Defensive. Stepping forward from a real date with `n >= 1` always
    // advances, so this should be unreachable — but a hang is the one failure
    // worse than a visible error, and both write boundaries enforce n >= 1.
    if (!isBefore(cursor, next)) {
      throw new Error(
        `Recurring cost "${cost.name}" did not advance past ${cursor} (produced ${next}). ` +
          `A recurrence must move strictly forward; check that n is at least 1.`,
      );
    }
    cursor = next;
  }
  return found;
}
```

Rename the existing slot walk's body to `gridOccurrences(cost, confirmations, upToMonth)`, keeping its logic **exactly as it is** apart from passing `cost.anchoring` to `stepFrom` and dropping the `rebasedFrom` call (a `calendar` cost never rebased anyway — `rebasedFrom` returned `cursor` unchanged for it, so removing it is behaviour-preserving; confirm that by reading the deleted function before you delete it).

- [ ] **Step 4: Delete the dead guards**

Delete `rebasedFrom` and `wouldAdvancePast` from `src/domain/occurrences.ts`, and their tests from `src/domain/occurrences.test.ts`.

Both existed to stop a confirmation landing behind the slot it claims. With no slots on the anchored path and no rebasing on the grid path, the situation cannot arise. Deleting a guard is not something to do quietly — say so in the commit message, with that reasoning.

`src/ui/components/ExpectedBand.tsx` and `src/store/actions.ts` both import `wouldAdvancePast` and will not compile. Tasks 6 and 7 fix them properly; to keep this task's suite runnable, do those two deletions now as part of this commit (they are removals, not rewrites):
- `ExpectedBand.tsx`: drop the import and the `wouldAdvancePast(...)` condition from `expectedGroups`, leaving the X3 "unresolved" suppression in place.
- `actions.ts`: delete `requireConfirmationAdvances` and its call in `updatePurchase`.

- [ ] **Step 5: Update `occurrencesByMonth`**

It currently builds a confirmations map per cost. Pass `dataset.purchases` straight through:

```ts
  for (const cost of dataset.recurring) {
    for (const occurrence of occurrencesOf(cost, dataset.purchases, upToMonth)) {
```

- [ ] **Step 6: Run the tests**

Run: `bun test && bunx tsc --noEmit`
Expected: the new anchored tests PASS, the calendar test PASSES, tsc clean.

Some round-1 tests asserted the old anchored rebasing (a confirmation claiming a slot and moving the series). Those describe behaviour that no longer exists; delete them and say so in the commit. Do NOT delete a test that still describes reachable behaviour just because it fails — read each one and decide.

- [ ] **Step 7: Commit**

```bash
git add src/domain/occurrences.ts src/domain/occurrences.test.ts src/ui/components/ExpectedBand.tsx src/store/actions.ts
git commit -m "feat(domain): anchored costs have no slots

A lastCharge cost's next due date is one cycle after the latest actual charge.
So it can be charged any number of times per cycle, each charge restarts the
clock, and the reported bug is gone: two payments in September leave the next
due in October, not November.

calendar is untouched and keeps its grid. Paying September AND October's rent
really does mean nothing is due until November — the bug was only ever a bug
for the anchored case.

DELETED: rebasedFrom, wouldAdvancePast, requireConfirmationAdvances and the
band's offerability guard. All four existed to stop a confirmation landing
behind the slot it claims. The anchored walk steps forward from a real date
with n >= 1 and the grid walk never rebases, so the situation cannot arise.
The termination throw stays as a defensive assert.

This removes more code than it adds."
```

---

### Task 4: Migration 7 → 8

**Files:**
- Modify: `src/domain/seed.ts`
- Modify: `src/store/migrations.ts`
- Test: `src/store/migrations.test.ts`

**Interfaces:**
- Consumes: the optional `occurrenceDate` (Task 2).
- Produces: `SCHEMA_VERSION = 8`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/migrations.test.ts`:

```ts
describe("7 -> 8: the anchored model", () => {
  function v7(recurring: any[], purchases: any[]): any {
    const base = createSeedDataset("2026-09");
    return {
      ...base,
      settings: { ...base.settings, schemaVersion: 7 },
      recurring,
      purchases,
    };
  }
  const anchored = {
    id: "phone", name: "Phone", order: 0, archived: false,
    amount: { amount: 300, currency: "DKK" },
    startDate: "2026-09", recurrence: { kind: "everyNMonths", n: 1 },
    anchoring: "lastCharge", splitMode: "percent",
    splits: [{ postId: "p", value: 100, absorbsRemainder: true }],
  };
  const grid = { ...anchored, id: "rent", name: "Rent", anchoring: "calendar" };

  function purchase(recurringId: string, occurrenceDate: string) {
    return {
      id: `pay-${recurringId}`, date: "2026-09-20", description: "x",
      total: { amount: 300, currency: "DKK" }, splitMode: "percent",
      splits: [{ postId: "p", value: 100, absorbsRemainder: true }],
      schedule: null, source: { recurringId, occurrenceDate },
    };
  }

  test("strips occurrenceDate from an ANCHORED cost's charges", () => {
    const out = migrate(v7([anchored], [purchase("phone", "2026-09")]));
    expect(out.purchases[0]!.source).toEqual({ recurringId: "phone" });
    expect(out.settings.schemaVersion).toBe(SCHEMA_VERSION);
  });

  test("LEAVES occurrenceDate on a calendar cost's charges", () => {
    const out = migrate(v7([grid], [purchase("rent", "2026-09")]));
    expect(out.purchases[0]!.source).toEqual({ recurringId: "rent", occurrenceDate: "2026-09" });
  });

  test("expands a month-only startDate on an anchored MONTHLY cost", () => {
    // Day precision now needs a real day; the 1st is the honest reading of
    // "this cost started in September".
    expect(migrate(v7([anchored], [])).recurring[0]!.startDate).toBe("2026-09-01");
  });

  test("leaves a calendar monthly cost's month-only startDate alone", () => {
    expect(migrate(v7([grid], [])).recurring[0]!.startDate).toBe("2026-09");
  });

  test("leaves an already day-granular startDate alone", () => {
    const dated = { ...anchored, startDate: "2026-09-20" };
    expect(migrate(v7([dated], [])).recurring[0]!.startDate).toBe("2026-09-20");
  });

  test("an ordinary purchase with no source is untouched", () => {
    const plain = { ...purchase("phone", "2026-09"), source: undefined };
    delete (plain as any).source;
    const out = migrate(v7([anchored], [plain]));
    expect(out.purchases[0]!.source).toBeUndefined();
  });

  test("NO recorded figure changes", () => {
    const out = migrate(v7([anchored], [purchase("phone", "2026-09")]));
    expect(out.purchases[0]!.total).toEqual({ amount: 300, currency: "DKK" });
    expect(out.recurring[0]!.amount).toEqual({ amount: 300, currency: "DKK" });
    expect(out.purchases.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/migrations.test.ts`
Expected: FAIL — no 7 → 8 step exists.

- [ ] **Step 3: Bump the version and append the step**

In `src/domain/seed.ts`: `export const SCHEMA_VERSION = 8;`

Append to `MIGRATIONS` in `src/store/migrations.ts`:

```ts
  // 7 -> 8: recurring costs split into two projection models.
  //
  // A `lastCharge` cost no longer has a grid of slots — its next due date is
  // one cycle after the latest actual charge — so `occurrenceDate` on its
  // charges is meaningless, and leaving it would invite a future reader to
  // trust it. A `calendar` cost keeps its slots and is not touched.
  //
  // Day precision also now requires a real day, so an anchored MONTHLY cost
  // whose startDate was month-only is expanded to the 1st.
  //
  // NOT behaviour-preserving, and it must not pretend to be: an anchored
  // cost's projected dates deliberately change, which is the point of the
  // change. What IS preserved is every recorded figure — no Money is touched,
  // no purchase is added or removed.
  //
  // The two literals below are inline strings, not imported constants: this
  // step must not read a live default.
  (data: any) => {
    const recurring = Array.isArray(data.recurring) ? data.recurring : [];
    const anchoredIds = new Set(
      recurring.filter((c: any) => c?.anchoring === "lastCharge").map((c: any) => c?.id),
    );
    return {
      ...data,
      settings: { ...data.settings, schemaVersion: 8 },
      recurring: recurring.map((cost: any) => {
        if (cost?.anchoring !== "lastCharge") return cost;
        if (cost?.recurrence?.kind !== "everyNMonths") return cost;
        if (typeof cost.startDate !== "string" || cost.startDate.length !== 7) return cost;
        return { ...cost, startDate: `${cost.startDate}-01` };
      }),
      purchases: (Array.isArray(data.purchases) ? data.purchases : []).map((p: any) => {
        if (!p?.source || !anchoredIds.has(p.source.recurringId)) return p;
        return { ...p, source: { recurringId: p.source.recurringId } };
      }),
    };
  },
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/store/migrations.test.ts && bunx tsc --noEmit`
Expected: PASS. The existing no-live-default assertion covers the new step automatically.

- [ ] **Step 5: Run the whole suite and commit**

Run: `bun test && bunx tsc --noEmit`

```bash
git add src/domain/seed.ts src/store/migrations.ts src/store/migrations.test.ts
git commit -m "feat(store): migrate to the anchored model, schema 8

Strips occurrenceDate from an anchored cost's charges, because that path has
no slots and a leftover slot id is a lie a future reader would trust. Expands
a month-only startDate on an anchored monthly cost to the 1st, because day
precision now needs a real day. calendar costs are not touched at all.

Deliberately NOT behaviour-preserving — an anchored cost's projected dates
change, which is the point. Every recorded figure is preserved: no Money is
touched, no purchase added or removed."
```

---

### Task 5: Validation at both write boundaries

**Files:**
- Modify: `src/export/json.ts`
- Modify: `src/store/actions.ts`
- Test: `src/export/json.test.ts`, `src/store/actions.test.ts`

**Interfaces:**
- Consumes: the optional `occurrenceDate` (Task 2).
- Produces: no new exports. `requireStartDateGranularity(recurrence, startDate, anchoring)` gains a third parameter.

- [ ] **Step 1: Write the failing tests**

Append to `src/export/json.test.ts`:

```ts
describe("the occurrenceDate / anchoring pairing", () => {
  function withCostAndCharge(anchoring: string, source: any): string {
    const data: any = createSeedDataset("2026-09");
    data.posts[0].id = "housing";
    data.recurring = [{
      id: "r1", name: "Bill", order: 0, archived: false,
      amount: { amount: 300, currency: "DKK" },
      startDate: anchoring === "lastCharge" ? "2026-09-01" : "2026-09",
      recurrence: { kind: "everyNMonths", n: 1 },
      anchoring, splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    }];
    data.purchases = [{
      id: "p1", date: "2026-09-20", description: "Bill",
      total: { amount: 300, currency: "DKK" }, splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
      schedule: null, source,
    }];
    return JSON.stringify(data);
  }

  test("a calendar charge REQUIRES occurrenceDate", () => {
    expect(() => parseDatasetJson(withCostAndCharge("calendar", { recurringId: "r1" })))
      .toThrow(/occurrence date/i);
  });

  test("a calendar charge with occurrenceDate is accepted", () => {
    expect(() =>
      parseDatasetJson(withCostAndCharge("calendar", { recurringId: "r1", occurrenceDate: "2026-09" })),
    ).not.toThrow();
  });

  test("an anchored charge FORBIDS occurrenceDate", () => {
    // Its presence describes a schedule the app will not compute.
    expect(() =>
      parseDatasetJson(withCostAndCharge("lastCharge", { recurringId: "r1", occurrenceDate: "2026-09" })),
    ).toThrow(/does not settle a slot|no slots|anchored/i);
  });

  test("an anchored charge without occurrenceDate is accepted", () => {
    expect(() => parseDatasetJson(withCostAndCharge("lastCharge", { recurringId: "r1" }))).not.toThrow();
  });
});

describe("startDate granularity under the anchored model", () => {
  function withCost(anchoring: string, kind: string, startDate: string): string {
    const data: any = createSeedDataset("2026-09");
    data.posts[0].id = "housing";
    data.recurring = [{
      id: "r1", name: "Bill", order: 0, archived: false,
      amount: { amount: 300, currency: "DKK" },
      startDate, recurrence: kind === "everyNMonths" ? { kind, n: 1 } : { kind, n: 30 },
      anchoring, splitMode: "percent",
      splits: [{ postId: "housing", value: 100, absorbsRemainder: true }],
    }];
    data.purchases = [];
    return JSON.stringify(data);
  }

  test("anchored + everyNMonths now needs a DAY", () => {
    expect(() => parseDatasetJson(withCost("lastCharge", "everyNMonths", "2026-09"))).toThrow(/day-granular/);
  });

  test("calendar + everyNMonths still accepts a month", () => {
    expect(() => parseDatasetJson(withCost("calendar", "everyNMonths", "2026-09"))).not.toThrow();
  });

  test("calendar + everyNMonths still accepts a day", () => {
    expect(() => parseDatasetJson(withCost("calendar", "everyNMonths", "2026-09-20"))).not.toThrow();
  });

  test("a calendar-impossible date is still refused", () => {
    expect(() => parseDatasetJson(withCost("lastCharge", "everyNMonths", "2026-09-31"))).toThrow(/impossible/i);
  });
});
```

Append to `src/store/actions.test.ts`:

```ts
describe("anchoring cannot change once a cost has charges", () => {
  function seeded(anchoring: "calendar" | "lastCharge") {
    const d = createSeedDataset("2026-09");
    const post = d.posts[0]!;
    const cost = addRecurringCost(d, {
      name: "Bill", archived: false,
      amount: { amount: 300, currency: "DKK" },
      startDate: anchoring === "lastCharge" ? "2026-09-01" : "2026-09",
      recurrence: { kind: "everyNMonths", n: 1 },
      anchoring, splitMode: "percent",
      splits: [{ postId: post.id, value: 100, absorbsRemainder: true }],
    });
    return { d, cost };
  }

  test("changing anchoring is allowed while the cost has no charges", () => {
    const { d, cost } = seeded("calendar");
    updateRecurringCost(d, cost.id, { anchoring: "lastCharge", startDate: "2026-09-01" });
    expect(d.recurring[0]!.anchoring).toBe("lastCharge");
  });

  test("changing anchoring is REFUSED once a charge exists", () => {
    // There is no honest way to invent which slot each existing charge
    // settled, and guessing would leave real money settling nothing.
    const { d, cost } = seeded("lastCharge");
    confirmOccurrence(d, cost.id, "2026-09-01", {});
    expect(() => updateRecurringCost(d, cost.id, { anchoring: "calendar" }))
      .toThrow(/charge/i);
  });

  test("other fields are still editable on a cost with charges", () => {
    const { d, cost } = seeded("lastCharge");
    confirmOccurrence(d, cost.id, "2026-09-01", {});
    updateRecurringCost(d, cost.id, { name: "Renamed" });
    expect(d.recurring[0]!.name).toBe("Renamed");
  });

  test("setting anchoring to its CURRENT value is not a change", () => {
    const { d, cost } = seeded("lastCharge");
    confirmOccurrence(d, cost.id, "2026-09-01", {});
    expect(() => updateRecurringCost(d, cost.id, { anchoring: "lastCharge" })).not.toThrow();
  });
});

describe("confirmOccurrence by anchoring", () => {
  test("an anchored confirmation records NO occurrenceDate", () => {
    const d = createSeedDataset("2026-09");
    const post = d.posts[0]!;
    const cost = addRecurringCost(d, {
      name: "Phone", archived: false,
      amount: { amount: 300, currency: "DKK" }, startDate: "2026-09-01",
      recurrence: { kind: "everyNMonths", n: 1 }, anchoring: "lastCharge",
      splitMode: "percent",
      splits: [{ postId: post.id, value: 100, absorbsRemainder: true }],
    });
    const p = confirmOccurrence(d, cost.id, "2026-09-01", {});
    expect(p.source).toEqual({ recurringId: cost.id });
    expect(p.date).toBe("2026-09-01");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/export/json.test.ts src/store/actions.test.ts`
Expected: FAIL on every new case.

- [ ] **Step 3: Widen the granularity rule in both validators**

In `src/store/actions.ts`, `requireStartDateGranularity` takes the anchoring:

```ts
/**
 * A day-granular kind always needs a day. `everyNMonths` needs one too when
 * the cost is ANCHORED, because its next due date is computed day-precisely
 * from a real charge date — a month-only start has no day to carry forward.
 * Under `calendar` a monthly cost is a month-granular grid and either shape
 * is fine.
 */
function requireStartDateGranularity(
  recurrence: Recurrence,
  startDate: IsoDate,
  anchoring: Anchoring,
): void {
  const dayGranular = DAY_GRANULAR_DATE.test(startDate);
  const needsDay = recurrence.kind !== "everyNMonths" || anchoring === "lastCharge";
  if (needsDay && !dayGranular) {
    throw new Error(
      `A "${recurrence.kind}" recurrence anchored to ${anchoring} needs a day-granular startDate ("YYYY-MM-DD"), not "${startDate}"`,
    );
  }
  try {
    if (dayGranular) toDayOrdinal(startDate);
    else monthOf(startDate);
  } catch (error) {
    throw new Error(
      `A "${recurrence.kind}" recurrence needs a valid startDate, not "${startDate}" (${(error as Error).message})`,
    );
  }
}
```

Update both call sites (`addRecurringCost`, `updateRecurringCost`) to pass the resolved anchoring — `changes.anchoring ?? cost.anchoring` on the update path, the same resolved-pair style the file already uses for splits.

Mirror the identical rule in `src/export/json.ts`'s recurring loop, in that file's error style. The two boundaries must agree on exactly what they accept; a file the app can create must always re-import.

- [ ] **Step 4: Add the pairing check**

In `src/export/json.ts`'s purchases loop, replace the existing `source` block:

```ts
    if (purchase.source !== undefined) {
      if (!purchase.source || typeof purchase.source !== "object") {
        throw new ImportValidationError(`${label} has a source that is not an object`);
      }
      const cost = recurring.find((c: any) => c?.id === purchase.source.recurringId);
      if (!cost) {
        throw new ImportValidationError(
          `${label} names unknown recurring cost "${purchase.source.recurringId}"`,
        );
      }
      // A calendar cost has a grid, and a charge against it settles one slot.
      // An anchored cost has no grid at all, so a slot id there describes a
      // schedule this app will not compute — refuse it rather than ignore it.
      if (cost.anchoring === "lastCharge") {
        if (purchase.source.occurrenceDate !== undefined) {
          throw new ImportValidationError(
            `${label} carries an occurrence date, but "${cost.name}" is anchored to its last charge and has no slots to settle`,
          );
        }
      } else {
        if (!PURCHASE_DATE.test(purchase.source.occurrenceDate)) {
          throw new ImportValidationError(
            `${label} has an invalid occurrence date "${String(purchase.source.occurrenceDate)}"`,
          );
        }
      }
    }
```

- [ ] **Step 5: Refuse an anchoring change on a cost with charges**

In `src/store/actions.ts`, inside `updateRecurringCost`, before the assignment:

```ts
  if (changes.anchoring && changes.anchoring !== cost.anchoring) {
    // Switching calendar -> lastCharge could strip the now-forbidden slot ids
    // mechanically, but the reverse cannot: there is no honest way to invent
    // which slot each existing charge settled, and guessing would leave real
    // money claiming slots that are not on the new grid. Ending the cost and
    // creating a new one keeps the history and states the change plainly.
    const charged = draft.purchases.some((p) => p.source?.recurringId === cost.id);
    if (charged) {
      throw new Error(
        `"${cost.name}" already has charges recorded, so its anchoring cannot change. ` +
          `End this cost and create a new one with the anchoring you want — its history stays intact.`,
      );
    }
  }
```

- [ ] **Step 6: Make `confirmOccurrence` anchoring-aware**

```ts
    source:
      cost.anchoring === "lastCharge"
        ? { recurringId }
        : { recurringId, occurrenceDate },
```

- [ ] **Step 7: Run the tests and commit**

Run: `bun test && bunx tsc --noEmit`
Expected: 0 fail, tsc clean.

Check AGENTS.md §3 has not regressed: a negative split value, a value over 100, and splits that do not sum must all still import. `src/export/json.test.ts` already asserts these — they must still pass untouched.

```bash
git add src/export/json.ts src/store/actions.ts src/export/json.test.ts src/store/actions.test.ts
git commit -m "feat(validation): occurrenceDate is required by calendar, forbidden by anchored

Both boundaries enforce both directions, because a cost's anchoring now
determines what a charge against it may carry. A slot id on an anchored cost
describes a schedule the app will not compute.

startDate granularity widens: anchored monthly costs now need a real day,
since their next due date is computed day-precisely from a charge date.

Changing anchoring on a cost that already has charges is refused. Stripping
slot ids one way is mechanical; inventing them the other way is not, and a
guess would leave real money settling nothing."
```

---

### Task 6: The band — anchored rows are informational when they are in the future

**Files:**
- Modify: `src/ui/components/ExpectedBand.tsx`
- Test: `src/ui/components/ExpectedBand.test.ts`

**Interfaces:**
- Consumes: `occurrencesByMonth` (Task 3), `recordedDateFor` (exists).
- Produces: `ExpectedGroups.comingUp` entries gain `confirmable: boolean`; `recordedDateFor(group, today, anchoring)`.

Task 3 already deleted the `wouldAdvancePast` condition. This task settles what the band DOES for an anchored cost.

The rule, from the spec's §5:

| row | `calendar` | `lastCharge` |
| --- | --- | --- |
| this month (pending) | Confirm at the slot's date | **Confirm at the occurrence's date** — "paid on time" |
| a later month (coming up) | Confirm at today | **informational, no Confirm** |

An anchored coming-up row has no Confirm because confirming a future anchored charge IS the refresh, and a refresh needs a real date and possibly a different amount — that is the purchase dialog's job (Task 8). A one-click button here would have to invent a date, and inventing it is what produced the round-1 Critical.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/ExpectedBand.test.ts`:

```ts
describe("anchored rows", () => {
  test("this month's anchored row is confirmable at its own date", () => {
    expect(recordedDateFor("pending", "2026-09-04", "lastCharge")).toBeNull();
  });

  test("a coming-up row on a CALENDAR cost still records today", () => {
    expect(recordedDateFor("comingUp", "2026-09-04", "calendar")).toBe("2026-09-04");
  });

  test("an anchored coming-up row is not confirmable at all", () => {
    const groups = expectedGroups(anchoredDatasetDueNextMonth(), "2026-09", "2026-09-04");
    const row = groups.comingUp.find((o) => o.recurringId === "phone");
    expect(row).toBeDefined();
    expect(row!.confirmable).toBe(false);
  });

  test("a calendar coming-up row IS confirmable", () => {
    const groups = expectedGroups(calendarDatasetSettledThisMonth(), "2026-09", "2026-09-04");
    const row = groups.comingUp.find((o) => o.recurringId === "rent");
    expect(row).toBeDefined();
    expect(row!.confirmable).toBe(true);
  });
});
```

Write the two fixtures beside the file's existing ones: `anchoredDatasetDueNextMonth()` is a `lastCharge` cost whose latest charge puts the next due date in October; `calendarDatasetSettledThisMonth()` is a `calendar` cost with September's slot confirmed so October reaches `comingUp`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/ui/components/ExpectedBand.test.ts`
Expected: FAIL — `recordedDateFor` takes two arguments and `confirmable` does not exist.

- [ ] **Step 3: Implement**

Give `recordedDateFor` the anchoring:

```ts
/**
 * What a Confirm click should record. A this-month row confirms at the
 * occurrence's own date (`null`, `confirmOccurrence`'s default) whatever the
 * anchoring — for an anchored cost that means "paid on time", which re-anchors
 * from the due date.
 *
 * A coming-up row is being paid EARLY, and only a calendar cost can express
 * that: its grid does not move, so settling a future slot today is simply
 * paying ahead. An anchored cost has no slot to settle early — recording it
 * today IS the refresh, which belongs in the purchase dialog where the owner
 * sets the real date. So this returns null for it and the row carries no
 * Confirm at all; see `confirmable` below.
 */
export function recordedDateFor(
  group: ExpectedRowGroup,
  today: IsoDate,
  anchoring: Anchoring,
): IsoDate | null {
  if (group !== "comingUp") return null;
  return anchoring === "calendar" ? today : null;
}
```

Widen the coming-up entries. `Occurrence` is a domain type and must not gain a UI flag, so the band carries its own row shape:

```ts
export interface ComingUpRow extends Occurrence {
  /** False for an anchored cost: see `recordedDateFor`. */
  confirmable: boolean;
}
```

`ExpectedGroups.comingUp` becomes `ComingUpRow[]`. In `expectedGroups`, when pushing a coming-up entry, look the cost up and set `confirmable: cost.anchoring === "calendar"`.

In the JSX, render a `confirmable: false` row with its date and amount as plain text and, in place of the button, one muted line naming what to do instead — following the file's existing `text-budget-ink-muted` treatment:

```tsx
<span className="text-xs text-budget-ink-muted">
  Add a purchase and tag it to this cost to record a charge early.
</span>
```

- [ ] **Step 4: Run the tests**

Run: `bun test && bunx tsc --noEmit`
Expected: 0 fail, tsc clean. The `eventCapture`, `storeWriteErrors` and `cssTokens` guards cover this file automatically.

- [ ] **Step 5: Screenshot and READ the PNGs**

The seed at `.claude/worktrees/recurring-costs/.superpowers/sdd/2026-09-03-recurring-costs/shots/seed.ts` is gone with that worktree if it was removed; if so, write a small seed of your own covering one calendar and one anchored cost. With `bun run dev` running:

```bash
bun scripts/demo-data.ts /tmp/seed.js
bun scripts/screenshot.ts http://localhost:3000/month/2026-09 /tmp/month.png \
  --eval-file=/tmp/seed.js --reload --full
```

`--reload` is NOT optional — without it the app re-seeds itself empty and you screenshot zeros. Read the PNG; check an anchored coming-up row shows no Confirm and a calendar one does. Repeat with `--dark`. Kill the dev server. Do NOT claim the design is good — a screenshot cannot show that, and this container substitutes its own fonts.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/ExpectedBand.tsx src/ui/components/ExpectedBand.test.ts
git commit -m "feat(month): an anchored cost's future row is informational

This month's row keeps its one-click Confirm for both anchorings — for an
anchored cost that records 'paid on time' at the due date, and paying a bill
on schedule is the common case that must not get slower.

A future row is different. Only a calendar cost can be paid early in a way a
button can express, because its grid does not move. Confirming a future
ANCHORED charge is the refresh, and a refresh needs a real date and possibly a
different amount — the purchase dialog's job. A button here would have to
invent a date, and inventing it is what produced the round-1 Critical."
```

---

### Task 7: A real split editor for recurring costs

**Files:**
- Modify: `src/ui/purchaseForm.ts`
- Modify: `src/ui/components/SplitEditor.tsx`
- Modify: `src/ui/routes/settings/RecurringSection.tsx`
- Test: `src/ui/routes/settings/RecurringSection.test.ts`

**Interfaces:**
- Consumes: `updateRecurringCost` (exists, Task 5 for the anchoring refusal).
- Produces: `SplitTarget` exported from `src/ui/purchaseForm.ts`; `SplitEditor<T extends SplitTarget>`.

This is the owner's first problem: a cost's post is fixed at creation. `RecurringCost` has carried `splits` and `splitMode` with the same shape as `Purchase` since the first version, so this wires up a capability the data model already has.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/routes/settings/RecurringSection.test.ts`:

```ts
describe("a cost's splits are editable", () => {
  test("splitTargetOf exposes the fields SplitEditor needs", () => {
    const cost = {
      id: "r1", name: "Rent", order: 0, archived: false,
      amount: { amount: 8200, currency: "DKK" },
      startDate: "2026-09", recurrence: { kind: "everyNMonths", n: 1 },
      anchoring: "calendar", splitMode: "percent",
      splits: [{ postId: "a", value: 100, absorbsRemainder: true }],
    } as const;
    expect(splitTargetOf(cost)).toEqual({
      amount: 8200,
      currency: "DKK",
      splitMode: "percent",
      splits: [{ postId: "a", value: 100, absorbsRemainder: true }],
    });
  });

  test("splitChangesOf turns an edited target back into a cost update", () => {
    const next = {
      amount: 8200, currency: "DKK", splitMode: "fixed" as const,
      splits: [
        { postId: "a", value: 5000, absorbsRemainder: false },
        { postId: "b", value: 3200, absorbsRemainder: true },
      ],
    };
    expect(splitChangesOf(next)).toEqual({
      splitMode: "fixed",
      splits: [
        { postId: "a", value: 5000, absorbsRemainder: false },
        { postId: "b", value: 3200, absorbsRemainder: true },
      ],
    });
  });

  test("splitChangesOf does not carry the amount back", () => {
    // The amount has its own field in the table; letting the split editor
    // write it too would give one value two owners.
    expect(splitChangesOf({
      amount: 999, currency: "DKK", splitMode: "percent",
      splits: [{ postId: "a", value: 100, absorbsRemainder: true }],
    })).not.toHaveProperty("amount");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/ui/routes/settings/RecurringSection.test.ts`
Expected: FAIL — neither helper exists.

- [ ] **Step 3: Narrow `SplitEditor`**

In `src/ui/purchaseForm.ts`:

```ts
/**
 * The slice of a form draft that `SplitEditor` actually reads. `PurchaseDraft`
 * satisfies it structurally, so the purchase dialog's call site is unchanged —
 * and a recurring cost can now use the same editor without pretending to be a
 * purchase.
 */
export interface SplitTarget {
  amount: number;
  currency: Currency;
  splitMode: "percent" | "fixed";
  splits: SplitDraft[];
}
```

Narrow `splitBalance(target: SplitTarget, digits: number)` — it already reads only these fields.

In `src/ui/components/SplitEditor.tsx`, make the component generic:

```tsx
interface Props<T extends SplitTarget> {
  draft: T;
  posts: Post[];
  onChange: (next: T) => void;
}

export function SplitEditor<T extends SplitTarget>({ draft, posts, onChange }: Props<T>) {
```

Its body needs no other change: every `onChange({ ...draft, ... })` already spreads the incoming object, so the extra fields on a `PurchaseDraft` survive.

- [ ] **Step 4: Use it in `RecurringSection`**

Add the two pure helpers to `src/ui/routes/settings/RecurringSection.tsx` (exported for the test):

```ts
/** A cost, viewed as the split editor sees it. */
export function splitTargetOf(cost: RecurringCost): SplitTarget {
  return {
    amount: cost.amount.amount,
    currency: cost.amount.currency,
    splitMode: cost.splitMode,
    splits: cost.splits.map((s) => ({ ...s })),
  };
}

/**
 * The edited target, as an update to the cost. The amount is deliberately NOT
 * carried back: it has its own column in the table, and one value with two
 * owners is how a form starts fighting itself.
 */
export function splitChangesOf(next: SplitTarget): Partial<RecurringCost> {
  return { splitMode: next.splitMode, splits: next.splits.map((s) => ({ ...s })) };
}
```

Render the editor in an expandable row per cost, following the pattern `PostsSection.tsx` already uses for rule history (a `size="xs"` ghost button toggling a `<tr>` with a `colSpan` body). The row summary shows the post name when there is one split, and "N posts" when there are several.

- [ ] **Step 5: Disable the anchoring control when charges exist**

Task 5 made `updateRecurringCost` refuse the change. The UI must not offer it and then fail:

```tsx
const charged = dataset.purchases.some((p) => p.source?.recurringId === cost.id);
```

Pass `disabled={charged}` to the anchoring `NativeSelect`, with a `title` naming the reason: *"This cost has charges recorded, so its anchoring cannot change. End it and create a new one."*

- [ ] **Step 6: Run the tests, screenshot, commit**

Run: `bun test && bunx tsc --noEmit`

Screenshot `/settings` light and dark, read the PNGs, confirm the split editor expands and the table does not overflow its card. Kill the dev server.

```bash
git add src/ui/purchaseForm.ts src/ui/components/SplitEditor.tsx \
        src/ui/routes/settings/RecurringSection.tsx src/ui/routes/settings/RecurringSection.test.ts
git commit -m "feat(settings): a recurring cost's splits are editable

The owner's first report: a cost's post was fixed at creation and could not be
changed. RecurringCost has carried splits and splitMode with the same shape as
Purchase since the first version, so this wires up a capability the data model
already had rather than adding one — and a bill can now span envelopes.

SplitEditor is narrowed from PurchaseDraft to the four fields it actually
reads. PurchaseDraft satisfies that structurally, so the dialog's call site
does not change at all.

The anchoring control is disabled once a cost has charges, matching the store's
refusal rather than offering an action that would fail on save."
```

---

### Task 8: The purchase dialog's recurring-cost control

**Files:**
- Create: `src/ui/recurringForm.ts`
- Create: `src/ui/recurringForm.test.ts`
- Modify: `src/ui/components/PurchaseDialog.tsx`

**Interfaces:**
- Consumes: `SplitTarget` (Task 7), `addRecurringCost` / `addPurchase` (exist).
- Produces: `offerableCosts(dataset, date)`, `seedCostFromDraft(draft, recurrence, anchoring)`, `sourceFor(cost, purchaseDate)`.

This is the owner's second request, and it is also the refresh mechanism from the spec's §6: tagging a purchase to a cost books the money AND restarts the cycle, because the anchor is the latest charge.

- [ ] **Step 1: Write the failing test**

Create `src/ui/recurringForm.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { offerableCosts, seedCostFromDraft, sourceFor } from "./recurringForm.ts";
import { createSeedDataset } from "../domain/seed.ts";
import * as actions from "../store/actions.ts";
import type { Dataset, RecurringCost } from "../domain/types.ts";

function withCosts(): Dataset {
  const d = createSeedDataset("2026-09");
  const post = d.posts[0]!;
  actions.addRecurringCost(d, {
    name: "Rent", archived: false, amount: { amount: 8200, currency: "DKK" },
    startDate: "2026-09", recurrence: { kind: "everyNMonths", n: 1 },
    anchoring: "calendar", splitMode: "percent",
    splits: [{ postId: post.id, value: 100, absorbsRemainder: true }],
  });
  actions.addRecurringCost(d, {
    name: "Phone", archived: false, amount: { amount: 300, currency: "DKK" },
    startDate: "2026-09-01", recurrence: { kind: "everyNDays", n: 30 },
    anchoring: "lastCharge", splitMode: "percent",
    splits: [{ postId: post.id, value: 100, absorbsRemainder: true }],
  });
  return d;
}

describe("offerableCosts", () => {
  test("an anchored cost is offerable on any date", () => {
    const names = offerableCosts(withCosts(), "2027-05-11").map((c) => c.name);
    expect(names).toContain("Phone");
  });

  test("a calendar cost is offerable only when its grid has a slot in that month", () => {
    const d = withCosts();
    expect(offerableCosts(d, "2026-09-20").map((c) => c.name)).toContain("Rent");
    // Before the cost started, its grid has no slot to settle.
    expect(offerableCosts(d, "2026-07-20").map((c) => c.name)).not.toContain("Rent");
  });

  test("an archived cost is not offered", () => {
    const d = withCosts();
    actions.endRecurringCost(d, d.recurring[0]!.id, "2026-09");
    expect(offerableCosts(d, "2026-09-20").map((c) => c.name)).not.toContain("Rent");
  });
});

describe("sourceFor", () => {
  test("an anchored cost's source carries no slot", () => {
    const phone = withCosts().recurring.find((c) => c.name === "Phone")!;
    expect(sourceFor(phone, "2026-09-20")).toEqual({ recurringId: phone.id });
  });

  test("a calendar cost's source names the slot in the purchase's own month", () => {
    const rent = withCosts().recurring.find((c) => c.name === "Rent")!;
    expect(sourceFor(rent, "2026-10-03")).toEqual({
      recurringId: rent.id,
      occurrenceDate: "2026-10",
    });
  });
});

describe("seedCostFromDraft", () => {
  test("carries the purchase's amount, currency, splits and date", () => {
    const draft = {
      date: "2026-09-20", description: "Gym", note: "", amount: 349,
      currency: "DKK" as const, splitMode: "percent" as const,
      splits: [{ postId: "p1", value: 100, absorbsRemainder: true }],
      plan: null,
    };
    const seeded = seedCostFromDraft(draft, { kind: "everyNMonths", n: 1 }, "calendar");
    expect(seeded.name).toBe("Gym");
    expect(seeded.amount).toEqual({ amount: 349, currency: "DKK" });
    expect(seeded.splits).toEqual([{ postId: "p1", value: 100, absorbsRemainder: true }]);
    expect(seeded.anchoring).toBe("calendar");
  });

  test("a calendar monthly cost starts in the purchase's MONTH", () => {
    const draft = {
      date: "2026-09-20", description: "Rent", note: "", amount: 8200,
      currency: "DKK" as const, splitMode: "percent" as const,
      splits: [{ postId: "p1", value: 100, absorbsRemainder: true }],
      plan: null,
    };
    expect(seedCostFromDraft(draft, { kind: "everyNMonths", n: 1 }, "calendar").startDate)
      .toBe("2026-09");
  });

  test("an anchored monthly cost starts on the purchase's DAY", () => {
    // Day precision: the cycle runs from the charge, so it needs a real day.
    const draft = {
      date: "2026-09-20", description: "Phone", note: "", amount: 300,
      currency: "DKK" as const, splitMode: "percent" as const,
      splits: [{ postId: "p1", value: 100, absorbsRemainder: true }],
      plan: null,
    };
    expect(seedCostFromDraft(draft, { kind: "everyNMonths", n: 1 }, "lastCharge").startDate)
      .toBe("2026-09-20");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/ui/recurringForm.test.ts`
Expected: FAIL — `Cannot find module './recurringForm.ts'`.

- [ ] **Step 3: Write the helpers**

Create `src/ui/recurringForm.ts`. Pure functions with no React, so the dialog's logic is testable without a DOM — the same reasoning that put `resolveExpectedAmount` in `ExpectedBand.tsx`:

```ts
import { monthOf } from "../domain/months.ts";
import { occurrencesOf } from "../domain/occurrences.ts";
import type {
  Anchoring, Dataset, IsoDate, Purchase, Recurrence, RecurringCost,
} from "../domain/types.ts";
import type { PurchaseDraft } from "./purchaseForm.ts";

/**
 * The costs a purchase dated `date` could be a charge for.
 *
 * An anchored cost is always offerable: any date can be the moment its cycle
 * restarted. A calendar cost is offerable only where its grid actually has a
 * slot in that purchase's month — tagging one outside its grid would record a
 * charge settling nothing.
 */
export function offerableCosts(dataset: Dataset, date: IsoDate): RecurringCost[] {
  const month = monthOf(date);
  return dataset.recurring
    .filter((cost) => !cost.archived)
    .filter((cost) => {
      if (cost.anchoring === "lastCharge") return true;
      return occurrencesOf(cost, dataset.purchases, month).some((o) => monthOf(o.date) === month);
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * The `source` a purchase gets when tagged to a cost. An anchored cost has no
 * slots, so the purchase's own date is the whole story; a calendar cost's
 * charge settles the slot in its own month.
 */
export function sourceFor(cost: RecurringCost, purchaseDate: IsoDate): Purchase["source"] {
  return cost.anchoring === "lastCharge"
    ? { recurringId: cost.id }
    : { recurringId: cost.id, occurrenceDate: monthOf(purchaseDate) };
}

/**
 * A new cost seeded from the purchase being typed.
 *
 * A calendar monthly cost is month-granular; an anchored one needs a real day,
 * because its next due date is computed day-precisely from the charge.
 */
export function seedCostFromDraft(
  draft: PurchaseDraft,
  recurrence: Recurrence,
  anchoring: Anchoring,
): Omit<RecurringCost, "id" | "order"> {
  const monthGranular = recurrence.kind === "everyNMonths" && anchoring === "calendar";
  return {
    name: draft.description,
    archived: false,
    amount: { amount: draft.amount, currency: draft.currency },
    startDate: monthGranular ? monthOf(draft.date) : draft.date,
    recurrence,
    anchoring,
    splitMode: draft.splitMode,
    splits: draft.splits.map((s) => ({ ...s })),
  };
}
```

Note `sourceFor` for a calendar cost uses `monthOf(purchaseDate)`, which is correct only for a month-granular grid. A calendar cost with a day-granular kind (`everyNDays` + `calendar`) has slots on specific days, and the slot in that month is whichever occurrence falls there — so for that case, look the occurrence up rather than deriving it. Write that branch; do not leave the month-only version to cover both.

- [ ] **Step 4: Wire the control into the dialog**

In `src/ui/components/PurchaseDialog.tsx`, add one `NativeSelect` below the note field and above `SplitEditor`:

```
Recurring cost   [ None | <each offerable cost> | + New recurring cost… ]
```

- Selecting a cost stores its id in local state. On save, `addPurchase` receives `source: sourceFor(cost, draft.date)`.
- Selecting **+ New** reveals the interval, unit, weekday (when weekly) and anchoring controls — the same shapes `RecurringSection` uses. On save, `addRecurringCost(draft, seedCostFromDraft(...))` runs first, then `addPurchase` with a `source` naming the new cost, inside the SAME `mutate` callback so the two land in one write.
- When editing an existing purchase, the control shows its current association and can clear it.

Every value read from an event goes into a `const` before `mutate`; the amount field stays `type="text"`; the write goes through `useMutate` and the dialog stays open on a rejected save, as it already does.

- [ ] **Step 5: Run the tests, screenshot, commit**

Run: `bun test && bunx tsc --noEmit`

Screenshot the month view with the dialog open (`--click` the Add purchase button), read the PNG, confirm the control renders and "+ New" reveals its fields. Kill the dev server.

```bash
git add src/ui/recurringForm.ts src/ui/recurringForm.test.ts src/ui/components/PurchaseDialog.tsx
git commit -m "feat(purchase): tag a purchase to a recurring cost, or create one from it

Two requests in one control. Tagging an existing cost is the refresh: the data
runs out, the owner enters the purchase, picks the plan, and the money is
booked while the cycle restarts from that date — because the anchor is the
latest charge. The data cap stops needing a flow of its own.

'+ New recurring cost' seeds a cost from the purchase being typed, and that
purchase becomes its first charge, so an anchored cost created this way is
anchored from the moment it exists.

A calendar cost is offered only where its grid has a slot in the purchase's
month; tagging one outside its grid would record a charge settling nothing."
```

---

### Task 9: Demo data and documents

**Files:**
- Modify: `scripts/demo-data.ts`
- Modify: `AGENTS.md`, `docs/DECISIONS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/TODO.md`
- Modify: `docs/specs/2026-09-03-recurring-costs-design.md` (header note only)

- [ ] **Step 1: Seed the reported case**

In `scripts/demo-data.ts`, make the anchored cost show what changed: give "Car insurance" (or a new "Phone plan") `anchoring: "lastCharge"` and **two charges in one month**, so a screenshot shows the next due date one cycle after the later one rather than two cycles out. Use `actions.addRecurringCost` and `actions.confirmOccurrence` / `actions.addPurchase` — that file builds through actions, never object literals.

- [ ] **Step 2: Rewrite the AGENTS.md §1 invariant that is now half wrong**

It currently says a confirmation's `Purchase.date` is truth while `source.occurrenceDate` is identity. That is true only for `calendar` now. Replace with:

```markdown
- **A recurring cost has one of two schedules, and they are not the same
  shape.** A `calendar` cost is a fixed grid: `source.occurrenceDate` is the
  slot a charge settles, and the grid never moves. A `lastCharge` cost has NO
  grid — its next due date is one cycle after the latest charge, so a charge
  carries no slot at all and its own `Purchase.date` is the whole story. That
  is what lets a phone plan charge many times in one cycle, each restarting
  the clock. Do not "unify" them: the grid is right for rent and wrong for a
  bill that restarts on payment, and collapsing them reintroduces the bug
  where paying twice in September pushed the next charge to November.
```

- [ ] **Step 3: Update AGENTS.md §2's termination bullet**

The throw is now a defensive assert, not a live guard. Say so plainly rather than describing a condition the code can no longer reach — but keep the `n >= 1` rule and its two write boundaries, which are still what make it unreachable.

- [ ] **Step 4: The other documents**

- `docs/DECISIONS.md` — a new entry under "Recurring costs": two projection models over one, what it was chosen over (a unified model; slots holding several payments), and that it deleted three guards.
- `docs/PRODUCT.md` — a recurring cost can charge more than once per cycle, and can be created while entering a purchase. Fix the `everyNMonths` wording if the round-1 minor is still open.
- `docs/ARCHITECTURE.md` — the anchored walk beside the grid walk.
- `docs/TODO.md` — the test count, schema 8, and what still needs a human.
- `docs/specs/2026-09-03-recurring-costs-design.md` — a header note pointing at the new spec, and NOTHING else. That document is an accurate record of what was decided then; rewriting it to match the present is how a decisions log stops being worth reading.

`src/docsLinks.test.ts` requires every repository path named in `AGENTS.md`, `README.md` or `docs/*.md` to be git-TRACKED. Commit new files before running the suite.

- [ ] **Step 5: Full verification**

```bash
bun test
bunx tsc --noEmit
bun run build
```

Then screenshot `/month/2026-09` and `/settings`, light and dark, plus `--w=390`, and READ every PNG.

- [ ] **Step 6: State what is NOT verified**

In the final report, plainly: how it looks and feels (this container substitutes its own fonts); real offline behaviour and the install prompt; whether a downloaded backup lands on disk; whether the `.ods` opens in a real spreadsheet; and **whether the anchored model matches how the owner's phone plan actually bills** — which only real use answers.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/ scripts/demo-data.ts
git commit -m "docs(recurring): two schedules, and why they must not be unified

AGENTS.md §1's old invariant was half wrong the moment anchored costs lost
their slots: occurrenceDate is identity for calendar only. The replacement says
what each schedule is and, more usefully, warns against collapsing them —
that collapse is exactly the bug where paying twice in September pushed the
next charge to November.

§2's termination bullet now describes a defensive assert rather than a live
guard, because the anchored walk steps forward from a real date and the grid
walk never rebases.

Demo data seeds two charges in one month on an anchored cost, so the fixed
behaviour is the first thing a screenshot shows."
```

---

## Self-review

**Spec coverage.**

| Spec § | Task |
| --- | --- |
| 1. Types (`occurrenceDate` optional) | 2 |
| 2. The two projections | 3 |
| 3. Day-precise month stepping | 1 (helper), 2 (`stepFrom`) |
| 4. What gets deleted | 3 |
| 5. The "Coming up" group | 6 |
| 6. The purchase dialog | 8 |
| 7. `RecurringSection` split editor | 7 |
| 8. Migration 7 → 8 | 4 |
| 9. Validation | 5 |
| 10. Store actions | 5 |
| 11. Tests | distributed through every task |
| Documents to update | 9 |

**Ordering and dependencies.** 1 → 2 → 3 is a strict chain and must run in order. 4, 5 and 6 each depend on 3. 7 is independent of the domain work and could run at any point after the baseline. 8 depends on 7 (for `SplitTarget`) and on 5 (for the anchoring-aware `source`). 9 depends on all.

**One deliberate scope decision.** Task 3 does two deletions (`ExpectedBand`'s guard condition, `actions.ts`'s `requireConfirmationAdvances`) that belong tidily to Tasks 6 and 5. They are done early because deleting `wouldAdvancePast` breaks compilation in both files, and a task that cannot run its own suite cannot be reviewed. Both are removals of code the same commit's reasoning covers, not rewrites.

**Known risk.** `SplitEditor` becoming generic touches the purchase dialog, which is unrelated to recurring costs and already carries the fix for a swallowed-error defect. The claim that `PurchaseDraft` satisfies `SplitTarget` structurally — so that call site does not change — is checkable by `bunx tsc --noEmit` alone and should be verified before the rest of Task 7 is written.
