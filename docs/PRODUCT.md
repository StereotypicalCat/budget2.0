# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner of the money, managing their own budget. They are leaving
a spreadsheet, so they already know their own categories, already think in
months, and value speed of entry over guidance. They tolerate rough edges in
exchange for the tool doing exactly what they mean.

Confirmed permanently single-user. One person, one browser, one dataset. There
are no accounts, no second role, and no shared or household use planned.

## Product Purpose

Envelope budgeting for a single person, replacing a spreadsheet.

Money is divided each month into named envelopes ("posts"). Unspent allocation
carries into the next month; overspending carries forward as debt. The app
answers two questions at a glance: how much is left in this envelope, and did I
overspend.

Success is that the owner stops maintaining a spreadsheet, and that a month's
purchases can be entered fast enough not to be a chore.

## Positioning

Two things a general budgeting app does not do:

- **Envelope rollover is the whole model, not a feature.** Every figure derives
  from one left-fold across months, so a balance is always the honest
  consequence of every prior month.
- **The data never leaves the browser and never needs an account.** IndexedDB is
  the only store. That is a deliberate product position, not a missing backend.

## Operating Context

The owner records spending after the fact, often in batches — a grocery trip is
twenty lines entered in one sitting, not twenty separate visits. Income arrives
monthly and varies, so it is entered per month rather than assumed.

Purchases frequently belong to more than one envelope (food bought at a social
event), and larger purchases are spread across several months deliberately
rather than absorbed by one.

Money is handled in DKK, USD and EUR, with DKK as the base.

## Capabilities and Constraints

Confirmed and in place:

- Posts (envelopes) with monthly allocation, created and archived by the owner.
  Posts are archived, never deleted, because purchases reference them.
- Allocation is either a fixed amount or a percentage of that month's income.
- A purchase can be split across several posts, by percentage or by fixed
  amounts, and can also be spread across future months as a payment plan. The
  two compose.
- Per-month income, entered directly, varying month to month.
- Multi-currency (DKK/USD/EUR) against a user-maintained exchange-rate table,
  with an optional on-demand fetch that fails soft and is never required.
- JSON export/import and ODS (spreadsheet) export, both generated in the
  browser.
- Offline-capable installable PWA. Currently deploys as one static artifact to
  both GitHub Pages (under a subpath) and a self-hosted Docker image.
- Recurring costs — a bill that repeats every N months, every N days, or
  every N weeks on a weekday, split across posts like any purchase. Each due date is a
  projected occurrence the owner confirms into a real purchase; the month view
  shows what is still expected alongside a second, projected balance per post,
  so a known bill is visible before it is paid without touching the reconciled
  figure a bank statement is checked against.

Terminology: an envelope is called a **post**. A **finance plan** is a purchase
spread across months. An **override** is a one-month exception to a post's
allocation. A **recurring cost** is a bill expected to repeat; each due date it
projects is an **occurrence**; **confirming** an occurrence turns it into a
real purchase.

Undecided: nothing outstanding at the product level.

## Brand Commitments

The product is called **Budget 2.0**. No logo, wordmark, or brand assets exist,
and none have been commissioned.

## Evidence on Hand

None, and none may be invented. This is a personal tool: there are no
customers, testimonials, case studies, usage statistics, press, pricing, or
third-party integrations. Any future surface must not manufacture them.

The only real content is the owner's own budget data, which never leaves their
browser and is therefore never available as example material. Illustrative data
must be visibly synthetic.

## Product Principles

1. **Over-budget is always allowed.** The app reports the truth and never
   blocks, clamps, or hides overspending. A negative balance is a normal value.
2. **Changing an allocation must never destroy history.** Adjusting what a post
   gets going forward leaves what it got before intact and still visible.
3. **Splitting a purchase across posts must stay easy.** It is a routine act,
   not an advanced feature, and must not be buried behind extra steps.
4. **The data stays portable and in the owner's hands.** Export is always
   available and always complete; nothing traps a budget inside the app.
5. **Entry speed is a feature.** Recording a month of spending is the most
   repeated act in the product, and friction there is the reason spreadsheets
   get abandoned.

## Accessibility & Inclusion

No condition-specific requirement was established by the owner. The existing
implementation holds itself to WCAG AA contrast, visible keyboard focus, and
respecting reduced-motion preferences; keyboard-first entry is a stated goal of
the fast-entry flow rather than only an accessibility accommodation.
