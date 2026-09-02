# Time-Versioned Allocation Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A post's allocation rule becomes a dated series — 10% from April, 15% from July — instead of one rule covering all of history.

**Architecture:** `Post.standingRule` is replaced by `Post.rules: RuleVersion[]`, resolved by `ruleAt(post, monthId)` which returns the last version effective at or before that month. Per-month overrides survive as one-month exceptions and still win outright. A post with no applicable version allocates zero. `allocationFor` keeps its signature, so the balance fold, the view models and the ODS export are untouched.

**Tech Stack:** Bun (runtime, package manager, test runner), TypeScript strict, React 19, Tailwind 4, shadcn/ui. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-versioned-allocation-rules-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Bun only.** `bun test`, `bun run`, `bunx`. Never npm, jest, vitest, or vite.
- **`src/domain/` stays pure**: no React, no IndexedDB, no ambient clock. It must be importable with no DOM (`src/domain/smoke.test.ts` asserts this).
- **The rollover fold has exactly one implementation**, in `src/domain/fold.ts`. Nothing may recompute `carriedIn + allocation − charges`.
- **Money is a float**, rounded at every boundary via `roundMoney`, and at the `src/store/actions.ts` mutation boundary. `FxRate.baseUnitsPerOne` is NEVER rounded — rates are stored at six decimals and are not money.
- **Over-budget is always permitted.** Nothing may clamp or reject a value for magnitude; percentages above 100% stay legal.
- **Posts are archived, never deleted.** Archived posts still resolve rules, because they still fold.
- **`MonthId` is `"YYYY-MM"`.** `IsoDate` is `"YYYY-MM-DD"` or `"YYYY-MM"`.
- **Never read `event.target.value` inside a `mutate()` callback.** Capture it synchronously first; `src/ui/eventCapture.test.ts` enforces this.
- **UI adds no money rounding** — the mutation boundary does it.
- Base path comes from `BUN_PUBLIC_BASE_PATH`; never hardcode a subpath.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/types.ts` | `RuleVersion`; `Post.rules` replaces `standingRule` |
| `src/domain/allocation.ts` | `ruleAt`, and the three-level precedence in `allocationFor` |
| `src/domain/seed.ts` | seeded posts start unbudgeted; `SCHEMA_VERSION` 2 |
| `src/store/migrations.ts` | the v1 → v2 shape change |
| `src/store/actions.ts` | `setRuleFrom`, `removeRuleFrom`; `addPost` no longer takes a rule |
| `src/export/json.ts` | validate `rules`; reject duplicate `from` months |
| `src/ui/routes/settings/PostsSection.tsx` | the rule history editor |
| `src/ui/components/PostTable.tsx` | version-starts-here marker |
| `src/ui/routes/MonthRoute.tsx` | change-from-this-month control |

---

### Task 1: The dated-rule model

**This task is deliberately large because it is atomic.** Replacing
`Post.standingRule` with `Post.rules` is a breaking type change: TypeScript will
not compile a partial version, so everything referencing the old field moves
together. The settings UI gets only a minimal adaptation here — Task 4 builds
the real history editor.

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/allocation.ts`, `src/domain/seed.ts`, `src/store/actions.ts`, `src/ui/routes/settings/PostsSection.tsx`
- Test: `src/domain/allocation.test.ts`

**Interfaces:**
- Consumes: `Rule`, `MonthId`, `Post`, `Month`, `Dataset` from `./types.ts`; `compareMonths` from `./months.ts`; `resolveRule`, `incomeFor`, `isOverridden` (existing, unchanged) from `./allocation.ts`.
- Produces:
  - `interface RuleVersion { from: MonthId; rule: Rule }` (in `types.ts`)
  - `Post.rules: RuleVersion[]` replacing `Post.standingRule`
  - `ruleAt(post: Post, monthId: MonthId): RuleVersion | null`
  - `ruleForPost(month: Month | undefined, post: Post, monthId: MonthId): Rule | null` — note the added third parameter
  - `allocationFor(dataset, postId, monthId): number` — signature UNCHANGED
  - `SCHEMA_VERSION = 2`
  - `addPost(draft, name, currency): Post` — the rule parameter is GONE

- [ ] **Step 1: Write the failing tests**

Replace the whole of `src/domain/allocation.test.ts` with this. The existing
fixtures build posts with `standingRule` and will not compile otherwise.

```ts
import { test, expect, describe } from "bun:test";
import {
  resolveRule,
  ruleAt,
  ruleForPost,
  isOverridden,
  allocationFor,
  incomeFor,
} from "./allocation.ts";
import { foldBalances, figuresFor } from "./fold.ts";
import type { Dataset, FxRate, Post, Rule } from "./types.ts";

const rates: FxRate[] = [
  { currency: "EUR", baseUnitsPerOne: 7.46, updatedAt: "2026-09-01", source: "manual" },
  { currency: "USD", baseUnitsPerOne: 6.9, updatedAt: "2026-09-01", source: "manual" },
];

const pct = (percent: number): Rule => ({ kind: "percentOfIncome", percent });
const fixed = (amount: number): Rule => ({
  kind: "fixed",
  amount: { amount, currency: "DKK" },
});

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    name: "Food",
    order: 0,
    archived: false,
    currency: "DKK",
    rules: [{ from: "2026-01", rule: fixed(400) }],
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 2 },
    fxRates: rates,
    posts: [post()],
    months: [
      { id: "2026-01", income: { amount: 20000, currency: "DKK" }, ruleOverrides: {} },
    ],
    purchases: [],
    ...overrides,
  };
}

describe("resolveRule", () => {
  test("a fixed rule in base currency is its amount", () => {
    expect(resolveRule(fixed(400), 20000, "DKK", rates)).toBe(400);
  });

  test("a fixed rule in a foreign currency converts to base", () => {
    expect(
      resolveRule({ kind: "fixed", amount: { amount: 50, currency: "EUR" } }, 20000, "DKK", rates),
    ).toBe(373);
  });

  test("a percentage rule resolves against income", () => {
    expect(resolveRule(pct(25), 20000, "DKK", rates)).toBe(5000);
  });

  test("a percentage above 100 is permitted", () => {
    expect(resolveRule(pct(150), 1000, "DKK", rates)).toBe(1500);
  });
});

describe("ruleAt", () => {
  const p = post({
    rules: [
      { from: "2026-04", rule: pct(10) },
      { from: "2026-07", rule: pct(15) },
    ],
  });

  test("returns null before the earliest version", () => {
    expect(ruleAt(p, "2026-03")).toBeNull();
  });

  test("applies from the version's own month", () => {
    expect(ruleAt(p, "2026-04")?.rule).toEqual(pct(10));
  });

  test("keeps applying between versions", () => {
    expect(ruleAt(p, "2026-06")?.rule).toEqual(pct(10));
  });

  test("the later version takes over from its month", () => {
    expect(ruleAt(p, "2026-07")?.rule).toEqual(pct(15));
  });

  test("the last version continues indefinitely", () => {
    expect(ruleAt(p, "2030-11")?.rule).toEqual(pct(15));
  });

  test("a post with no versions has no rule at all", () => {
    expect(ruleAt(post({ rules: [] }), "2026-06")).toBeNull();
  });

  test("resolves correctly even if the array is not sorted", () => {
    const unsorted = post({
      rules: [
        { from: "2026-07", rule: pct(15) },
        { from: "2026-04", rule: pct(10) },
      ],
    });
    expect(ruleAt(unsorted, "2026-05")?.rule).toEqual(pct(10));
    expect(ruleAt(unsorted, "2026-08")?.rule).toEqual(pct(15));
  });
});

describe("precedence", () => {
  test("a month override beats the effective version", () => {
    const data = dataset({
      posts: [post({ rules: [{ from: "2026-01", rule: fixed(400) }] })],
      months: [
        {
          id: "2026-01",
          income: { amount: 20000, currency: "DKK" },
          ruleOverrides: { p1: fixed(999) },
        },
      ],
    });
    expect(allocationFor(data, "p1", "2026-01")).toBe(999);
    expect(isOverridden(data.months[0], "p1")).toBe(true);
  });

  test("without an override the effective version applies", () => {
    expect(allocationFor(dataset(), "p1", "2026-01")).toBe(400);
  });

  test("no applicable version means an allocation of zero", () => {
    const data = dataset({ posts: [post({ rules: [{ from: "2026-06", rule: fixed(400) }] })] });
    expect(allocationFor(data, "p1", "2026-01")).toBe(0);
  });

  test("a post with no versions allocates zero rather than throwing", () => {
    expect(allocationFor(dataset({ posts: [post({ rules: [] })] }), "p1", "2026-01")).toBe(0);
  });

  test("an override still applies in a month with no version", () => {
    const data = dataset({
      posts: [post({ rules: [] })],
      months: [
        {
          id: "2026-01",
          income: { amount: 20000, currency: "DKK" },
          ruleOverrides: { p1: fixed(250) },
        },
      ],
    });
    expect(allocationFor(data, "p1", "2026-01")).toBe(250);
  });

  test("ruleForPost returns null when nothing applies", () => {
    expect(ruleForPost(undefined, post({ rules: [] }), "2026-01")).toBeNull();
  });

  test("an unknown post id throws", () => {
    expect(() => allocationFor(dataset(), "nope", "2026-01")).toThrow(/nope/);
  });
});

describe("incomeFor", () => {
  test("returns the month's income", () => {
    expect(incomeFor(dataset(), "2026-01")).toBe(20000);
  });

  test("a month with no record has zero income", () => {
    expect(incomeFor(dataset(), "2026-10")).toBe(0);
  });
});

describe("the fold across a rule change", () => {
  // The feature's headline behaviour: 10% through June, 15% from July, with the
  // rollover carrying correctly across the boundary.
  const data: Dataset = {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-05", schemaVersion: 2 },
    fxRates: [],
    posts: [
      post({
        rules: [
          { from: "2026-04", rule: pct(10) },
          { from: "2026-07", rule: pct(15) },
        ],
      }),
    ],
    months: ["2026-05", "2026-06", "2026-07", "2026-08"].map((id) => ({
      id,
      income: { amount: 10000, currency: "DKK" },
      ruleOverrides: {},
    })),
    purchases: [],
  };

  test("the allocation steps up in the version's month", () => {
    const fold = foldBalances(data, "2026-08");
    expect(figuresFor(fold, "p1", "2026-06").allocation).toBe(1000);
    expect(figuresFor(fold, "p1", "2026-07").allocation).toBe(1500);
  });

  test("unspent budget carries across the change", () => {
    const fold = foldBalances(data, "2026-08");
    // 1000 + 1000 = 2000 carried into July, + 1500 = 3500, + 1500 = 5000.
    expect(figuresFor(fold, "p1", "2026-07").carriedIn).toBe(2000);
    expect(figuresFor(fold, "p1", "2026-08").remaining).toBe(5000);
  });

  test("a version dated before the fold start is legal but inert", () => {
    // The fold never evaluates months before its start, so such a version
    // simply has no effect until the fold start moves earlier.
    const early: Dataset = {
      ...data,
      posts: [
        post({
          rules: [
            { from: "2020-01", rule: pct(99) },
            { from: "2026-04", rule: pct(10) },
          ],
        }),
      ],
    };
    const fold = foldBalances(early, "2026-06");
    expect(figuresFor(fold, "p1", "2026-05").allocation).toBe(1000);
    expect(fold.has("2020-01")).toBe(false);
  });

  test("an archived post still resolves its rules, because it still folds", () => {
    const archived: Dataset = {
      ...data,
      posts: [post({ archived: true, rules: [{ from: "2026-05", rule: pct(10) }] })],
    };
    const fold = foldBalances(archived, "2026-06");
    expect(figuresFor(fold, "p1", "2026-05").allocation).toBe(1000);
    expect(figuresFor(fold, "p1", "2026-06").carriedIn).toBe(1000);
  });

  test("months before the earliest version allocate nothing", () => {
    const early: Dataset = {
      ...data,
      settings: { ...data.settings, foldStartMonth: "2026-02" },
      months: [
        { id: "2026-02", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
        ...data.months,
      ],
    };
    const fold = foldBalances(early, "2026-05");
    expect(figuresFor(fold, "p1", "2026-02").allocation).toBe(0);
    expect(figuresFor(fold, "p1", "2026-05").allocation).toBe(1000);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test src/domain/allocation.test.ts`
Expected: FAIL — `ruleAt` is not exported, and `Post` has no `rules` property.

- [ ] **Step 3: Add `RuleVersion` and swap the field on `Post`**

In `src/domain/types.ts`, add after the `Rule` union:

```ts
export interface RuleVersion {
  /** The rule takes effect in this month and continues until the next version. */
  from: MonthId;
  rule: Rule;
}
```

Then in `interface Post`, replace the line `standingRule: Rule;` with:

```ts
  /**
   * The post's allocation rule over time, sorted ascending by `from`, at most
   * one entry per month. Empty means the post has never been budgeted, and its
   * allocation is zero — not the same as a rule of zero.
   */
  rules: RuleVersion[];
```

- [ ] **Step 4: Implement `ruleAt` and the new precedence**

In `src/domain/allocation.ts`, add `compareMonths` to the existing import from
`./months.ts` (do not add a second import statement), and add `RuleVersion` to
the existing type import from `./types.ts`. Then replace `ruleForPost` with:

```ts
/**
 * The version in effect for `monthId`: the last one whose `from` is at or
 * before it, or null when the post was not yet budgeted.
 *
 * Scans rather than assuming sorted order. The array is kept sorted by
 * `setRuleFrom`, but a hand-edited import must still resolve correctly.
 */
export function ruleAt(post: Post, monthId: MonthId): RuleVersion | null {
  let effective: RuleVersion | null = null;
  for (const version of post.rules) {
    if (compareMonths(version.from, monthId) > 0) continue;
    if (effective === null || compareMonths(version.from, effective.from) > 0) {
      effective = version;
    }
  }
  return effective;
}

/**
 * Precedence: a one-month override wins outright; otherwise the version in
 * effect; otherwise nothing, which the caller renders as an allocation of zero.
 */
export function ruleForPost(
  month: Month | undefined,
  post: Post,
  monthId: MonthId,
): Rule | null {
  const override = month?.ruleOverrides[post.id];
  if (override) return override;
  return ruleAt(post, monthId)?.rule ?? null;
}
```

Then change the body of `allocationFor` so a missing rule means zero:

```ts
export function allocationFor(
  dataset: Dataset,
  postId: PostId,
  monthId: MonthId,
): number {
  const post = dataset.posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Unknown post: ${postId}`);
  const month = dataset.months.find((m) => m.id === monthId);
  const rule = ruleForPost(month, post, monthId);
  if (rule === null) return 0;
  return resolveRule(
    rule,
    incomeFor(dataset, monthId),
    dataset.settings.baseCurrency,
    dataset.fxRates,
  );
}
```

`isOverridden` and `resolveRule` are unchanged.

- [ ] **Step 5: Update the seed and bump the schema version**

In `src/domain/seed.ts`, change `SCHEMA_VERSION` to `2`, and in the seeded post
replace the `standingRule:` line with:

```ts
    // A new user has genuinely not budgeted anything yet. This is a different
    // state from a rule of zero, and the app distinguishes them.
    rules: [],
```

- [ ] **Step 6: Update the actions that referenced the old field**

In `src/store/actions.ts`, change `addPost` so it no longer takes a rule — a new
post starts unbudgeted, and a rule is added with `setRuleFrom` (Task 3):

```ts
export function addPost(draft: Dataset, name: string, currency: Currency): Post {
  const post: Post = {
    id: newId(),
    name,
    order: draft.posts.length,
    archived: false,
    currency,
    rules: [],
  };
  draft.posts.push(post);
  return post;
}
```

In `updatePost`, delete the `if (changes.standingRule) { ... }` block entirely —
rules are changed only through `setRuleFrom`/`removeRuleFrom`. Keep the rest of
`updatePost` exactly as it is, including its rounding of other fields.

- [ ] **Step 7: Minimal settings adaptation so the build compiles**

In `src/ui/routes/settings/PostsSection.tsx`, the rule editor currently reads and
writes `post.standingRule`. Replace the whole `ruleEditor` helper and its call
site with a read-only summary for now; Task 4 replaces this with the real
history editor.

Add to the imports:

```ts
import { ruleAt } from "../../../domain/allocation.ts";
import { currentMonth } from "../../../store/index.ts";
```

Replace the `ruleEditor` function with:

```tsx
  function ruleSummary(post: Post) {
    const effective = ruleAt(post, currentMonth);
    if (!effective) {
      return <span className="text-xs text-muted-foreground">not budgeted</span>;
    }
    const { rule } = effective;
    return (
      <span className="text-xs">
        {rule.kind === "fixed"
          ? `${rule.amount.amount} ${rule.amount.currency}`
          : `${rule.percent}% of income`}
        <span className="ml-1 text-muted-foreground">from {effective.from}</span>
      </span>
    );
  }
```

Change the cell that rendered it from `{ruleEditor(post.id, post.standingRule)}`
to `{ruleSummary(post)}`, and fix the "Add post" button's `addPost(...)` call to
drop its rule argument: `addPost(draft, newName.trim(), base)`.

Add `Post` to the existing type import from `../../../domain/types.ts`.

- [ ] **Step 8: Run the tests and the typechecker**

Run: `bun test src/domain/allocation.test.ts`
Expected: PASS, 26 tests.

Run: `bunx tsc --noEmit`
Expected: clean. If anything still references `standingRule`, it appears here.

Run: `bun test`
Expected: some OTHER suites fail — `seed.test.ts`, `actions.test.ts`,
`json.test.ts` and `views.test.ts` build posts with `standingRule`. Fix each
fixture by replacing `standingRule: X` with `rules: [{ from: "2026-01", rule: X }]`,
choosing a `from` at or before the earliest month that suite uses, so the
resolved allocations stay what those tests already assert. Do NOT change any
assertion values: this task must not move a single number.

Run: `bun test` again.
Expected: PASS, whole suite green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(domain): allocation rules become a dated series

Post.standingRule becomes Post.rules: RuleVersion[], resolved by ruleAt() as
the last version effective at or before a month. Per-month overrides still win
outright; a post with no applicable version allocates zero rather than
applying its earliest rule backwards.

allocationFor keeps its signature, so the fold, the views and the ODS export
are untouched. Settings gets a read-only rule summary for now; the history
editor follows."
```

---

### Task 2: The v1 to v2 migration

**Files:**
- Modify: `src/store/migrations.ts`
- Test: `src/store/migrations.test.ts`

**Interfaces:**
- Consumes: `SCHEMA_VERSION` (now 2) from `../domain/seed.ts`; `Dataset`, `Rule`, `RuleVersion` from `../domain/types.ts`; `allocationFor` from `../domain/allocation.ts` (test only).
- Produces: `MIGRATIONS[1]` — the v1 → v2 step. `migrate` itself is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/migrations.test.ts`:

```ts
import { allocationFor } from "../domain/allocation.ts";

/** A v1 dataset, in the shape that shipped before rules were versioned. */
function v1Dataset() {
  return {
    settings: { baseCurrency: "DKK", foldStartMonth: "2026-01", schemaVersion: 1 },
    fxRates: [],
    posts: [
      {
        id: "food",
        name: "Food",
        order: 0,
        archived: false,
        currency: "DKK",
        standingRule: { kind: "percentOfIncome", percent: 20 },
      },
      {
        id: "games",
        name: "Video Games",
        order: 1,
        archived: false,
        currency: "DKK",
        standingRule: { kind: "fixed", amount: { amount: 400, currency: "DKK" } },
      },
    ],
    months: [
      { id: "2026-01", income: { amount: 10000, currency: "DKK" }, ruleOverrides: {} },
      {
        id: "2026-02",
        income: { amount: 12000, currency: "DKK" },
        ruleOverrides: { games: { kind: "fixed", amount: { amount: 900, currency: "DKK" } } },
      },
    ],
    purchases: [],
  };
}

describe("v1 -> v2: rules become a dated series", () => {
  test("each standingRule becomes one version starting at the fold start", () => {
    const migrated = migrate(v1Dataset());
    expect(migrated.settings.schemaVersion).toBe(2);
    expect(migrated.posts[0]!.rules).toEqual([
      { from: "2026-01", rule: { kind: "percentOfIncome", percent: 20 } },
    ]);
    expect(migrated.posts[1]!.rules).toEqual([
      { from: "2026-01", rule: { kind: "fixed", amount: { amount: 400, currency: "DKK" } } },
    ]);
  });

  test("the old field is gone afterwards", () => {
    const migrated = migrate(v1Dataset()) as unknown as Record<string, any>;
    expect("standingRule" in (migrated.posts as any[])[0]).toBe(false);
  });

  test("per-month overrides are left untouched", () => {
    const migrated = migrate(v1Dataset());
    expect(migrated.months[1]!.ruleOverrides.games).toEqual({
      kind: "fixed",
      amount: { amount: 900, currency: "DKK" },
    });
  });

  // The property that matters: this is a shape change, not a recalculation.
  // A shape-only test would pass while every balance quietly moved.
  test("NO allocation changes: every post in every month resolves identically", () => {
    const before = v1Dataset();
    const migrated = migrate(v1Dataset());

    // Resolve the v1 way by hand, since allocationFor now speaks v2 only.
    const v1Allocation = (postId: string, monthId: string) => {
      const post = before.posts.find((p) => p.id === postId)!;
      const month = before.months.find((m) => m.id === monthId);
      const rule = (month?.ruleOverrides as any)?.[postId] ?? post.standingRule;
      const income = before.months.find((m) => m.id === monthId)?.income.amount ?? 0;
      return rule.kind === "fixed"
        ? rule.amount.amount
        : Number(((income * rule.percent) / 100).toFixed(2));
    };

    for (const postId of ["food", "games"]) {
      for (const monthId of ["2026-01", "2026-02"]) {
        expect(allocationFor(migrated, postId, monthId)).toBe(v1Allocation(postId, monthId));
      }
    }
  });

  test("a v1 post with no posts at all migrates without throwing", () => {
    const empty = { ...v1Dataset(), posts: [] };
    expect(migrate(empty).posts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/store/migrations.test.ts`
Expected: FAIL — `migrate` throws "No migration from schema 1 to 2", because
`MIGRATIONS` is still empty.

- [ ] **Step 3: Implement the migration**

In `src/store/migrations.ts`, replace the empty `MIGRATIONS` array with:

```ts
const MIGRATIONS: Array<(data: any) => any> = [
  // index 0: there is no version 0 in the wild.
  undefined as unknown as (data: any) => any,

  // 1 -> 2: a post's single `standingRule` becomes a one-entry dated series,
  // effective from the fold start. Behaviour-preserving by construction: the
  // standing rule already applied from the fold start onward, so every month
  // resolves to exactly the allocation it did before.
  (data: any) => ({
    ...data,
    settings: { ...data.settings, schemaVersion: 2 },
    posts: (data.posts ?? []).map((post: any) => {
      const { standingRule, ...rest } = post;
      return {
        ...rest,
        rules:
          standingRule === undefined
            ? []
            : [{ from: data.settings.foldStartMonth, rule: standingRule }],
      };
    }),
  }),
];
```

Note the index-0 hole: `MIGRATIONS[v]` is looked up by the version being
migrated FROM, so the v1 → v2 step must sit at index 1.

- [ ] **Step 4: Run the tests**

Run: `bun test src/store/migrations.test.ts`
Expected: PASS, 9 tests.

Run: `bun test`
Expected: whole suite green.

- [ ] **Step 5: Commit**

```bash
git add src/store/migrations.ts src/store/migrations.test.ts
git commit -m "feat(store): migrate allocation rules to a dated series (v1 -> v2)

A pure shape change: standingRule becomes one version effective from the fold
start, which is where it already applied from. Asserted behaviour-preserving —
every post in every month resolves to the same allocation before and after, so
no balance moves."
```

---

### Task 3: Actions for editing the series

**Files:**
- Modify: `src/store/actions.ts`
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: `requirePost`, `roundRule` (both already private in `actions.ts`); `compareMonths` from `../domain/months.ts`; `RuleVersion`, `Rule`, `MonthId`, `PostId`, `Dataset` from `../domain/types.ts`.
- Produces:
  - `setRuleFrom(draft: Dataset, postId: PostId, from: MonthId, rule: Rule): void`
  - `removeRuleFrom(draft: Dataset, postId: PostId, from: MonthId): void`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/actions.test.ts`:

```ts
describe("rule versions", () => {
  const pct = (percent: number) => ({ kind: "percentOfIncome" as const, percent });

  test("setRuleFrom adds a version to a post that had none", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    expect(data.posts[0]!.rules).toEqual([{ from: "2026-04", rule: pct(10) }]);
  });

  test("setRuleFrom REPLACES an existing version for the same month", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.setRuleFrom(data, postId, "2026-04", pct(15));
    expect(data.posts[0]!.rules).toHaveLength(1);
    expect(data.posts[0]!.rules[0]!.rule).toEqual(pct(15));
  });

  test("versions are kept sorted regardless of insertion order", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-07", pct(15));
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.setRuleFrom(data, postId, "2026-05", pct(12));
    expect(data.posts[0]!.rules.map((v) => v.from)).toEqual(["2026-04", "2026-05", "2026-07"]);
  });

  test("a fixed rule is rounded at the mutation boundary", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", {
      kind: "fixed",
      amount: { amount: 12.345, currency: "DKK" },
    });
    const stored = data.posts[0]!.rules[0]!.rule;
    expect(stored.kind === "fixed" && stored.amount.amount).toBe(12.35);
  });

  test("a percentage above 100 is stored, not clamped", () => {
    const data = draft();
    actions.setRuleFrom(data, data.posts[0]!.id, "2026-04", pct(150));
    expect(data.posts[0]!.rules[0]!.rule).toEqual(pct(150));
  });

  test("removeRuleFrom deletes exactly that version", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.setRuleFrom(data, postId, "2026-07", pct(15));
    actions.removeRuleFrom(data, postId, "2026-04");
    expect(data.posts[0]!.rules).toEqual([{ from: "2026-07", rule: pct(15) }]);
  });

  test("removing a month that has no version is a no-op, not an error", () => {
    const data = draft();
    const postId = data.posts[0]!.id;
    actions.setRuleFrom(data, postId, "2026-04", pct(10));
    actions.removeRuleFrom(data, postId, "2026-09");
    expect(data.posts[0]!.rules).toHaveLength(1);
  });

  test("both throw on an unknown post id", () => {
    expect(() => actions.setRuleFrom(draft(), "ghost", "2026-04", pct(10))).toThrow(/ghost/);
    expect(() => actions.removeRuleFrom(draft(), "ghost", "2026-04")).toThrow(/ghost/);
  });

  test("addPost creates an unbudgeted post", () => {
    const data = draft();
    const post = actions.addPost(data, "Travel", "EUR");
    expect(post.rules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/store/actions.test.ts`
Expected: FAIL — `setRuleFrom` is not exported.

- [ ] **Step 3: Implement both actions**

In `src/store/actions.ts`, add `compareMonths` to the existing import from
`../domain/months.ts` and `RuleVersion` to the existing type import from
`../domain/types.ts`. Then add:

```ts
/**
 * Inserts or replaces the version starting at `from`, keeping `rules` sorted.
 * Replacing rather than appending is what keeps the effective rule
 * unambiguous: two versions sharing a month would both be "in effect".
 */
export function setRuleFrom(
  draft: Dataset,
  postId: PostId,
  from: MonthId,
  rule: Rule,
): void {
  const post = requirePost(draft, postId);
  const version: RuleVersion = { from, rule: roundRule(rule) };
  const existing = post.rules.findIndex((v) => v.from === from);
  if (existing === -1) post.rules.push(version);
  else post.rules[existing] = version;
  post.rules.sort((a, b) => compareMonths(a.from, b.from));
}

/**
 * Deletes the version starting at `from`. Removing the earliest one means the
 * months before the next version now resolve to no rule, and allocate zero.
 */
export function removeRuleFrom(
  draft: Dataset,
  postId: PostId,
  from: MonthId,
): void {
  const post = requirePost(draft, postId);
  post.rules = post.rules.filter((v) => v.from !== from);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/store/actions.test.ts`
Expected: PASS, including the 9 new tests.

Run: `bun test && bunx tsc --noEmit`
Expected: whole suite green, types clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat(store): add setRuleFrom and removeRuleFrom

setRuleFrom replaces rather than appends for a month that already has a
version, keeping the effective rule unambiguous, and keeps the series sorted."
```

---

### Task 4: Import validation for the series

**Files:**
- Modify: `src/export/json.ts`
- Test: `src/export/json.test.ts`

**Interfaces:**
- Consumes: `MONTH_ID` (already defined in `json.ts`), `ImportValidationError`.
- Produces: no new exports; `parseDatasetJson` gains validation.

- [ ] **Step 1: Write the failing tests**

Append to `src/export/json.test.ts`:

```ts
describe("rule versions on import", () => {
  const pct = (percent: number) => ({ kind: "percentOfIncome" as const, percent });

  test("accepts a well-formed series", () => {
    const data = populated();
    data.posts[0]!.rules = [
      { from: "2026-01", rule: pct(10) },
      { from: "2026-07", rule: pct(15) },
    ];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("accepts an empty series — an unbudgeted post is legal", () => {
    const data = populated();
    data.posts[0]!.rules = [];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });

  test("rejects a post whose rules is missing or not an array", () => {
    const data = populated() as any;
    delete data.posts[0].rules;
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/rules/);
  });

  test("rejects a malformed from month", () => {
    const data = populated();
    data.posts[0]!.rules = [{ from: "2026-1", rule: pct(10) }];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-1/);
  });

  test("rejects an out-of-range from month", () => {
    const data = populated();
    data.posts[0]!.rules = [{ from: "2026-13", rule: pct(10) }];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-13/);
  });

  test("rejects two versions sharing a month, which would be ambiguous", () => {
    const data = populated();
    data.posts[0]!.rules = [
      { from: "2026-04", rule: pct(10) },
      { from: "2026-04", rule: pct(15) },
    ];
    expect(() => parseDatasetJson(JSON.stringify(data))).toThrow(/2026-04/);
  });

  test("does NOT reject a percentage above 100", () => {
    const data = populated();
    data.posts[0]!.rules = [{ from: "2026-01", rule: pct(150) }];
    expect(() => parseDatasetJson(JSON.stringify(data))).not.toThrow();
  });
});
```

You will also need to update `populated()` in that file so its posts carry
`rules` rather than `standingRule`, if Task 1 has not already done so.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test src/export/json.test.ts`
Expected: FAIL — a missing `rules` array and a duplicate month both import
cleanly today.

- [ ] **Step 3: Implement the validation**

In `src/export/json.ts`, inside the existing `for (const post of dataset.posts)`
loop, after the `requireCurrency(post.currency, ...)` line, add:

```ts
    const rules = (post as unknown as Record<string, unknown>).rules;
    if (!Array.isArray(rules)) {
      throw new ImportValidationError(
        `Post "${post.name}" is missing its rules array`,
      );
    }
    const seenFrom = new Set<string>();
    for (const version of rules as Array<{ from: string }>) {
      if (!MONTH_ID.test(version.from)) {
        throw new ImportValidationError(
          `Post "${post.name}" has a rule with an invalid start month "${version.from}"`,
        );
      }
      if (seenFrom.has(version.from)) {
        throw new ImportValidationError(
          `Post "${post.name}" has two rules starting in "${version.from}"; the effective rule would be ambiguous`,
        );
      }
      seenFrom.add(version.from);
    }
```

Deliberately absent: any check on the rule's value. A percentage above 100 and a
negative fixed amount are both legal, because over-budget is always permitted.

- [ ] **Step 4: Run the tests**

Run: `bun test src/export/json.test.ts`
Expected: PASS.

Run: `bun test && bunx tsc --noEmit`
Expected: whole suite green, types clean.

- [ ] **Step 5: Commit**

```bash
git add src/export/json.ts src/export/json.test.ts
git commit -m "feat(export): validate rule versions on import

Rejects a missing rules array, a malformed or out-of-range start month, and two
versions sharing a month — which would make the effective rule ambiguous — at
the import boundary rather than letting the fold resolve something arbitrary."
```

---

### Task 5: The rule history editor in Settings

**Files:**
- Create: `src/ui/components/RuleHistory.tsx`
- Modify: `src/ui/routes/settings/PostsSection.tsx`

**Interfaces:**
- Consumes: `setRuleFrom`, `removeRuleFrom` from `../../store/actions.ts`; `ruleAt` from `../../domain/allocation.ts`; `useMutate`; `currentMonth` from `../../store/index.ts`; `Post`, `Rule`, `MonthId` from `../../domain/types.ts`.
- Produces: `RuleHistory` component, props `{ post: Post }`.

There is no failing-test step here: this renders already-tested pure functions,
and asserting markup needs a DOM this project registers only per-file for the
one test that requires it. The verification burden shifts to reading the code
against the actions it calls.

- [ ] **Step 1: Create the history editor**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutate } from "../hooks/useMutate.ts";
import { removeRuleFrom, setRuleFrom } from "../../store/actions.ts";
import { currentMonth } from "../../store/index.ts";
import type { Post, Rule } from "../../domain/types.ts";

interface Props {
  post: Post;
}

/**
 * A post's allocation over time. Each row is "from this month, this rule",
 * effective until the next row takes over. Adding a row for a month that
 * already has one replaces it — `setRuleFrom` enforces that, and the form says
 * so rather than letting it look like an append.
 */
export function RuleHistory({ post }: Props) {
  const { mutate } = useMutate();
  const [from, setFrom] = useState<string>(currentMonth);
  const [kind, setKind] = useState<Rule["kind"]>("percentOfIncome");
  const [value, setValue] = useState<number>(0);

  const replaces = post.rules.some((v) => v.from === from);

  function add() {
    const rule: Rule =
      kind === "fixed"
        ? { kind: "fixed", amount: { amount: value, currency: post.currency } }
        : { kind: "percentOfIncome", percent: value };
    mutate((draft) => setRuleFrom(draft, post.id, from, rule));
  }

  return (
    <div className="space-y-2 rounded border p-3">
      {post.rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Not budgeted. Until a rule starts, this post is allocated nothing —
          spending still records, and shows as overspend.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">From</th>
              <th className="py-1">Rule</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {post.rules.map((version) => (
              <tr key={version.from} className="border-t">
                <td className="py-1 font-money">{version.from}</td>
                <td className="py-1">
                  {version.rule.kind === "fixed"
                    ? `${version.rule.amount.amount} ${version.rule.amount.currency}`
                    : `${version.rule.percent}% of income`}
                </td>
                <td className="py-1 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => mutate((draft) => removeRuleFrom(draft, post.id, version.from))}
                  >
                    remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="font-money h-8 w-28"
          placeholder="YYYY-MM"
          value={from}
          onChange={(event) => {
            const next = event.target.value;
            setFrom(next);
          }}
        />
        <select
          className="h-8 rounded border bg-background px-1 text-xs"
          value={kind}
          onChange={(event) => {
            const next = event.target.value as Rule["kind"];
            setKind(next);
          }}
        >
          <option value="percentOfIncome">% of income</option>
          <option value="fixed">fixed amount</option>
        </select>
        <Input
          className="font-money h-8 w-24"
          type="number"
          step="0.01"
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value) || 0;
            setValue(next);
          }}
        />
        <Button size="sm" variant="outline" onClick={add}>
          {replaces ? "Replace" : "Add"}
        </Button>
        {replaces && (
          <span className="text-xs text-muted-foreground">
            {from} already has a rule; this replaces it.
          </span>
        )}
      </div>
    </div>
  );
}
```

Note every `onChange` captures `event.target.value` into a local const before
using it. `src/ui/eventCapture.test.ts` fails the build otherwise, and the bug
it guards froze an input at zero once already.

- [ ] **Step 2: Mount it in Settings**

In `src/ui/routes/settings/PostsSection.tsx`, import the component:

```ts
import { RuleHistory } from "../../components/RuleHistory.tsx";
```

Add a per-post expansion state near the other hooks:

```ts
  const [openHistory, setOpenHistory] = useState<string | null>(null);
```

Change the rule cell so the summary from Task 1 becomes a toggle:

```tsx
              <td className="py-2">
                <button
                  type="button"
                  className="underline decoration-dotted"
                  onClick={() => setOpenHistory((id) => (id === post.id ? null : post.id))}
                >
                  {ruleSummary(post)}
                </button>
              </td>
```

And directly after each post's `<tr>`, render the expanded editor:

```tsx
            {openHistory === post.id && (
              <tr>
                <td colSpan={4} className="pb-3">
                  <RuleHistory post={post} />
                </td>
              </tr>
            )}
```

- [ ] **Step 3: Verify**

Run: `bun test && bunx tsc --noEmit`
Expected: whole suite green, types clean. In particular
`src/ui/eventCapture.test.ts` must pass.

Run: `bun run build`
Expected: succeeds.

Start the dev server, curl `/settings` to confirm it serves, then STOP it:

```bash
bun --hot src/index.ts   # curl -s -o /dev/null -w '%{http_code}' localhost:3000/settings
```

You cannot verify the editor visually — there is no browser here. Say so in your
report; do not claim otherwise.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): add the rule history editor to Settings

Each post's allocation over time, as rows of 'from this month, this rule'.
Adding a rule for a month that already has one replaces it, and the form says
so rather than looking like an append. An unbudgeted post says so explicitly,
since that is a different state from a rule of zero."
```

---

### Task 6: Change from this month, in the month view

**Files:**
- Modify: `src/ui/components/PostTable.tsx`, `src/ui/routes/MonthRoute.tsx`

**Interfaces:**
- Consumes: `ruleAt` from `../../domain/allocation.ts`; `setRuleFrom` from `../../store/actions.ts`; `useMutate`; `MonthPostRow` from `../../domain/views.ts`.
- Produces: no new exports.

- [ ] **Step 1: Mark the month a version begins**

`PostTable` already receives `rows` and shows an `overridden` badge. Add a
second, distinct marker so a step in the numbers has a visible cause.

In `src/ui/components/PostTable.tsx`, add to the imports:

```ts
import { ruleAt } from "../../domain/allocation.ts";
```

Inside the row map, after the existing `overridden` badge, add:

```tsx
              {ruleAt(post, monthId)?.from === monthId && (
                <Badge
                  variant="outline"
                  className="ml-2"
                  title="This post's allocation rule changes from this month"
                >
                  rule changes here
                </Badge>
              )}
```

A month can show both badges: a version starting in a month the user also
overrode is unusual but legal, and hiding either would obscure why the number is
what it is. The override still wins the allocation.

- [ ] **Step 2: Add the change-from-here control**

In `src/ui/routes/MonthRoute.tsx`, add the imports:

```ts
import { ruleAt } from "../../domain/allocation.ts";
import { setRuleFrom } from "../../store/actions.ts";
```

Add local state for the inline editor near the other hooks:

```tsx
  const [changingRuleFor, setChangingRuleFor] = useState<string | null>(null);
```

`useState` is already imported in this file if the mode toggle exists; add it to
the existing React import otherwise.

Then render the control beneath the post table:

```tsx
      {changingRuleFor && (() => {
        const post = dataset.posts.find((p) => p.id === changingRuleFor);
        if (!post) return null;
        const effective = ruleAt(post, monthId)?.rule;
        return (
          <RuleFromMonth
            post={post}
            monthId={monthId}
            initial={effective}
            onDone={() => setChangingRuleFor(null)}
          />
        );
      })()}
```

- [ ] **Step 3: Write the inline control**

Add this component at the bottom of `src/ui/routes/MonthRoute.tsx`:

```tsx
function RuleFromMonth({
  post,
  monthId,
  initial,
  onDone,
}: {
  post: Post;
  monthId: MonthId;
  initial: Rule | undefined;
  onDone: () => void;
}) {
  const { mutate } = useMutate();
  // Pre-filled with what is currently in effect, so nudging 10% to 15% is an
  // edit rather than re-entry. Empty when the post has no rule yet.
  const [kind, setKind] = useState<Rule["kind"]>(initial?.kind ?? "percentOfIncome");
  const [value, setValue] = useState<number>(
    initial === undefined ? 0 : initial.kind === "fixed" ? initial.amount.amount : initial.percent,
  );

  function apply() {
    const rule: Rule =
      kind === "fixed"
        ? { kind: "fixed", amount: { amount: value, currency: post.currency } }
        : { kind: "percentOfIncome", percent: value };
    mutate((draft) => setRuleFrom(draft, post.id, monthId, rule));
    onDone();
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm">
      <span>
        {post.name}: allocate from <span className="font-money">{monthId}</span> onward
      </span>
      <select
        className="h-8 rounded border bg-background px-1 text-xs"
        value={kind}
        onChange={(event) => {
          const next = event.target.value as Rule["kind"];
          setKind(next);
        }}
      >
        <option value="percentOfIncome">% of income</option>
        <option value="fixed">fixed amount</option>
      </select>
      <Input
        className="font-money h-8 w-24"
        type="number"
        step="0.01"
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value) || 0;
          setValue(next);
        }}
      />
      <Button size="sm" onClick={apply}>
        Apply
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}
```

Add `Post`, `Rule` and `MonthId` to the existing type import from
`../../domain/types.ts`, and `useState` to the existing React import.

- [ ] **Step 4: Give each post row a way to open it**

In `src/ui/components/PostTable.tsx`, add an optional prop and a control:

```ts
interface Props {
  monthId: MonthId;
  baseCurrency: Currency;
  rows: MonthPostRow[];
  onChangeRule?: (postId: string) => void;
}
```

In the row, after the badges:

```tsx
              {onChangeRule && (
                <button
                  type="button"
                  className="ml-2 text-xs text-muted-foreground underline decoration-dotted"
                  onClick={() => onChangeRule(post.id)}
                >
                  change from here
                </button>
              )}
```

And pass it from `MonthRoute`:

```tsx
      <PostTable
        monthId={monthId}
        baseCurrency={base}
        rows={view.rows}
        onChangeRule={setChangingRuleFor}
      />
```

- [ ] **Step 5: Verify**

Run: `bun test && bunx tsc --noEmit`
Expected: whole suite green, types clean, `eventCapture` guard passing.

Run: `bun run build`
Expected: succeeds.

Then exercise the whole feature end to end with a script, since the UI itself
cannot be clicked here:

```bash
bun -e '
import { createSeedDataset } from "./src/domain/seed.ts";
import { setRuleFrom } from "./src/store/actions.ts";
import { foldBalances, figuresFor } from "./src/domain/fold.ts";
const d = createSeedDataset("2026-05");
const food = d.posts[1].id;
for (const m of ["2026-05","2026-06","2026-07","2026-08"])
  if (!d.months.find(x=>x.id===m)) d.months.push({ id:m, income:{amount:10000,currency:"DKK"}, ruleOverrides:{} });
d.months[0].income = { amount: 10000, currency: "DKK" };
setRuleFrom(d, food, "2026-05", { kind:"percentOfIncome", percent:10 });
setRuleFrom(d, food, "2026-07", { kind:"percentOfIncome", percent:15 });
const fold = foldBalances(d, "2026-08");
for (const m of ["2026-05","2026-06","2026-07","2026-08"])
  console.log(m, "allocation", figuresFor(fold, food, m).allocation, "remaining", figuresFor(fold, food, m).remaining);
'
```

Expected: allocations 1000, 1000, 1500, 1500 and a remaining that accumulates
1000, 2000, 3500, 5000.

Report plainly that the two editing surfaces have not been seen in a browser.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): change a post's rule from the month you are looking at

The natural moment to decide '15% from July' is while looking at July. The
control writes the same setRuleFrom action the history editor uses, so the two
surfaces cannot drift apart. A month where a version begins gets its own badge,
distinct from a one-month override, so a step in the numbers has a visible
cause; a month can carry both."
```
