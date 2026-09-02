# Time-versioned allocation rules — Design

**Date:** 2026-09-02
**Status:** Awaiting review
**Extends** `2026-09-01-budget-app-design.md`. Every invariant there still holds,
with one deliberate replacement noted below.

## Purpose

A post's allocation changes over time: Food is 10% from April, then 15% from
July. Today a post has exactly one `standingRule` covering all of history, plus
a per-month override. Expressing "15% from July onward" currently means editing
every month individually, and the fact that it was a deliberate change is lost.

Rules become a dated series. A version takes effect in its month and continues
until the next version replaces it.

This model was offered during the original design and declined in favour of the
simpler standing rule. It is being adopted now because using the app showed the
simpler model does not survive contact with a budget that evolves.

## Non-goals

- **Versioning anything else.** Post name, currency and archived status stay
  single-valued. Only the allocation rule is time-varying.
- **Retroactive recalculation prompts.** Adding a version dated in the past
  changes past allocations, and therefore every later balance, because the
  rollover fold is a left fold. That is correct and intended; the app does not
  warn about it beyond showing the new numbers.
- **Reworking the fold.** `allocationFor` keeps its signature; only its
  internals change.

## Decisions and why

### Dated series AND per-month overrides both survive

They mean different things, and collapsing them loses information:

- A **version** is a permanent change from month X onward: "Food is 15% from
  July."
- An **override** is a one-month exception that leaves the series intact:
  "December only, 3000 for Christmas."

Expressing a one-month exception as versions needs two entries — change, then
change back — and forgetting the second silently makes an exception permanent.

### No rule yet means an allocation of zero

If a post's earliest version starts in 2026-04, its allocation for every month
before that is 0. The post genuinely had no budget then. Spending in those
months still records and shows as overspend against a zero envelope, so nothing
is concealed.

Rejected: applying the earliest rule backwards. It invents budget for months the
user never budgeted, and the rollover fold would then carry that fictional
surplus forward into real months.

### The series lives on the post

`Post.rules` rather than a top-level `Dataset.ruleVersions` collection. The
fold reads a post's rule for every post in every month, so a top-level
collection would mean filtering by `postId` on the hottest path in the app, and
would separate a rule from the thing it governs when archiving or exporting.

Rejected: keeping `standingRule` and adding a map of later changes. It cannot
express "no rule yet" — a standing rule always exists — so it contradicts the
zero-before-start decision, and leaves two concepts describing one thing.

## Domain model

```ts
interface RuleVersion {
  /** The rule takes effect in this month and continues until the next version. */
  from: MonthId;
  rule: Rule;
}

interface Post {
  // ...unchanged...
  rules: RuleVersion[];
}
```

`Post.standingRule` is **removed**, replaced by `rules`.

### Invariants

- `rules` is sorted ascending by `from`.
- **At most one version per month.** Setting a rule for a month that already has
  one replaces it; two versions sharing a `from` would make the effective rule
  ambiguous.
- An empty `rules` array is legal and means the post has never been budgeted.
- A `from` earlier than `settings.foldStartMonth` is legal but inert: the fold
  never evaluates months before its start, so such a version simply has no
  effect until the fold start moves earlier.

**A deliberate difference between new and migrated data.** Seeded posts start
with `rules: []` — a new user has genuinely not budgeted anything yet. Migrated
posts get one version carrying their existing rule, which for untouched seed
data is a zero fixed amount. So a fresh install shows "not budgeted" where a
migrated install shows an explicit 0. Those were indistinguishable under the old
model and are now different states; keeping them distinct is correct, because a
migrated user really did have a rule and a new user really does not.

### Resolution

`ruleAt(post, monthId): RuleVersion | null` returns the last version whose
`from <= monthId`, or `null` when none applies.

`allocationFor` resolves in strict precedence:

1. `month.ruleOverrides[postId]` — one-month exception, wins outright
2. `ruleAt(post, monthId)` — the effective version
3. neither -> **0**

`allocationFor` keeps its current signature, so `foldBalances`, the view models
and the ODS export are untouched.

`isOverridden` keeps its current meaning — an explicit one-month exception — and
continues to drive the month view's badge.

## Migration: schemaVersion 1 -> 2

```
{ standingRule } -> { rules: [{ from: settings.foldStartMonth, rule: standingRule }] }
```

This is the project's first real migration. It is a pure shape change with no
arithmetic, and it is **behaviour-preserving by construction**: today's standing
rule already applies from the fold start onward, so every month resolves to the
allocation it resolved to before.

Existing `Month.ruleOverrides` are untouched.

The migration runs in the browser against the user's only copy of their data.
Two things contain the risk: `migrate()` already refuses to open data written by
a newer build, so a half-upgraded state cannot silently corrupt; and the
behaviour-preserving property is asserted by test rather than assumed.

## UI

Two editing surfaces, both writing through the same `setRuleFrom` action, so
they cannot drift out of step with each other.

### Settings — the history editor

Each post row shows the rule **in effect for the current calendar month**
(Settings has no month context of its own), with a control
opening a chronological editor: a list of `from` month + rule, with add and
remove. A post with no rules shows "not budgeted" rather than a zero rule, since
those are different states.

Adding a version for a month that already has one replaces it, and the editor
says so rather than silently keeping the last write.

### Month view — change from here

Each post row gains a control that creates a version starting **that** month,
because the natural moment to decide "15% from July" is while looking at July.
It writes the same `setRuleFrom` action the history editor uses.

It opens pre-filled with the rule currently in effect for that month, so the
common act of nudging 10% to 15% is an edit rather than re-entry. If the post
has no rule yet, it opens empty.

The month view distinguishes the two kinds of change: an override keeps its
existing badge; a month where a version *begins* is marked separately, so a step
in the numbers has a visible cause. A month can carry both markers at once — a
version starting in a month the user also overrode is unusual but legal, and
showing only one would hide the reason the number is what it is. The override
still wins the allocation, per the precedence above.

## Actions

- `setRuleFrom(draft, postId, from: MonthId, rule: Rule)` — inserts or replaces
  the version for that month, keeping `rules` sorted. Rounds the rule at the
  mutation boundary like every other money-shaped write.
- `removeRuleFrom(draft, postId, from: MonthId)` — deletes that version. Removing
  the earliest one means earlier months resolve to 0.

## Validation

`parseDatasetJson` must, for each post: accept a `rules` array; reject a
malformed or out-of-range `from` month using the existing tightened month
pattern; and reject duplicate `from` months, since the resulting effective rule
would be ambiguous.

Over-budget remains always permitted: no rule value is rejected for magnitude,
and percentages above 100% stay legal.

## Testing

- `ruleAt`: before the first version -> `null`; exactly on a version's month;
  between two versions; after the last.
- `allocationFor`: no rule -> 0; an override beats the effective version; a
  version applies from its month onward.
- **The fold across a rule change** — 10% through June, 15% from July — asserting
  the allocation steps in July and that the rollover carries correctly across the
  boundary. This is the test that proves the feature, because the fold is what
  every view reads.
- **The migration preserves behaviour.** Build a v1 dataset, migrate it, and
  assert *every month's allocation is identical before and after*. A shape-only
  test would pass while balances moved; this is the property that matters.
- JSON import accepts v2, migrates v1, and rejects duplicate `from` months.
- `setRuleFrom` replaces rather than appends for a month that already has a
  version, and keeps the array sorted.
- Archived posts still resolve rules, since they still fold.

Not covered: anything visual in either editing surface, and the real IndexedDB
upgrade path. Both need a browser.

## Files

| File | Change |
|---|---|
| `src/domain/types.ts` | `RuleVersion`; `Post.rules` replaces `standingRule` |
| `src/domain/allocation.ts` | `ruleAt`; precedence in `allocationFor` |
| `src/domain/seed.ts` | seed posts start with empty `rules`; `SCHEMA_VERSION` 2 |
| `src/store/migrations.ts` | the v1 -> v2 migration |
| `src/store/actions.ts` | `setRuleFrom`, `removeRuleFrom`; `addPost`/`updatePost` |
| `src/export/json.ts` | validate `rules`, reject duplicate months |
| `src/ui/routes/settings/PostsSection.tsx` | history editor |
| `src/ui/routes/MonthRoute.tsx`, `src/ui/components/PostTable.tsx` | change-from-here control; version-starts-here marker |
