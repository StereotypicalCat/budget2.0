# Design foundation

Sub-project 1 of the visual redesign. Owner's brief: *"right now it looks a bit
boring, simple and ugly. We want sleek, modern, and nice to use."* Owner's
answers to the four scoping questions: both themes with a toggle, a full
rethink of every screen, purchases compact and grouped by date, and a
self-hosted webfont. Owner then delegated the specifics: *"Override everything
you want for this step. This needs to look good."*

## The diagnosis that shaped everything else

A design system already existed and was never wired up. `src/index.css`
defined `--paper` (annotated "cool statement-paper ground, NOT cream"),
`--ink`, a muted teal, and surplus/overspend colours, with a design-contract
document behind them. The app painted itself with shadcn's defaults —
`bg-background text-foreground`, i.e. white and near-black. Those tokens
reached the screen in exactly two places: the carry meter, and the sign
colours on figures.

So "boring, simple and ugly" was not a missing design. It was a design that was
specified and then bypassed. That is why the foundation comes first in the
decomposition, and why it re-themes shadcn rather than styling screens: doing
it screen by screen is how the bypass happened.

## Decomposition

The redesign is four sub-projects, each its own spec → plan → implementation:

1. **Design foundation** (this document) — tokens, themes, type, shared furniture.
2. **Month view** — income and totals, post rows and carry meter, purchases grouped by date.
3. **Year, Summary, Post detail** — the reporting screens, including whether the 12-month matrix stays a scrolling table.
4. **Dialogs and fast entry** — purchase dialog, split editor, plan editor, bulk entry.

A single spec covering all four would have meant dozens of layout decisions
made on the owner's behalf under one approval.

## Token architecture

Two layers, deliberately separate.

**Layer 1, `--budget-*`**: the app's own vocabulary — paper, raised, ink,
ink-muted, rule, rule-strong, accent, accent-ink, tint — plus `--surplus` and
`--overspend`, which shadcn has no concept of. Defined once per theme. The only
colours app components may name.

**Layer 2, shadcn**: its entire variable set points at layer 1. Every primitive
(dialog, select, badge, button) inherits both themes for free.

### The brand teal is `--primary`, never `--accent`

CLAUDE.md's hardest-won rule is "never define a bare `--accent`", paid for with
an app-wide contrast bug. The mechanism matters: shadcn uses `--accent` as a
hover **background** with `--accent-foreground` as the text on it. Setting one
without the other repaints the background and leaves the text behind.

Two conclusions follow, and both are enforced rather than remembered:

- Every shadcn pair is redefined **together**, in both themes.
  `src/cssPairs.test.ts` fails the build if either half of a pair appears
  without the other, in any block.
- The saturated teal belongs on `--primary`. Putting a brand colour on
  `--accent` — which is what "override `--accent`" invites — turns every hover
  into a coloured slab with dark text on it. `--accent` stays a tint of the
  surface.

### Contrast was computed, not chosen

Weakest text pair: 5.50:1 (muted on paper, light) against a 4.5:1 requirement.
Field borders were iterated until they cleared the 3:1 non-text requirement on
**both** backgrounds they appear against — the first two candidates measured
2.17 and 2.55 and were rejected. The final palette was then read back out of
the live browser in both themes, so the check is on what actually rendered
rather than on the arithmetic.

## Typography

Inter for text, JetBrains Mono for figures, both variable, both self-hosted,
latin + latin-ext only. SIL OFL 1.1; licences committed beside the files.
Self-hosted rather than CDN-linked because PRODUCT.md's position is that the
data never leaves the browser and the app needs no third party — a font request
to another origin on every cold load quietly contradicts that.

`.font-money` carries tabular figures and a slashed zero, so columns align on
the decimal and `0` cannot be misread as `O`.

### Rejected: @font-face in the bundled stylesheet

The obvious home. Bun's CSS bundler resolves every `url()` from disk and inlines
woff2 as base64 — **relative or absolute**, and `loader: { ".woff2": "file" }`
does not change it. Measured cost: `index.css` went from 70 KB to 303 KB of
render-blocking bytes, and the `unicode-range` subsetting became pointless,
since a subset embedded in the stylesheet downloads whether or not one
character needs it.

Also rejected: a `<link rel="stylesheet" href="/fonts.css">`. It works in a
production build (`external: ["*fonts.css"]`), but the dev server's HTML
bundler resolves every `<link href>` from disk and has no `external` option, so
dev would serve a placeholder and screenshots would lie about typography.
Making the manifest and icon hrefs root-absolute for the same reason 500'd the
dev server outright.

**Chosen**: `src/fontCss.ts` is the one definition, injected as a `<style>` at
boot by `frontend.tsx`. Identical in dev and in a subpath build, no placeholder
file, no href rewriting. The cost is that faces are requested after the JS
parses rather than from the HTML; `font-display: swap` keeps text readable
throughout, and the service worker precaches all four files.

## Theme switching

Cycles system → light → dark. Three states because "follow the system" is a
real answer and, once you have chosen otherwise, there must be a way back to
it. While set to "system" the app keeps listening, so it follows the OS
switching at sunset without a reload.

Stored in `localStorage`, not in the dataset: the dataset is the owner's budget,
which is exported, imported and schema-versioned, and importing a backup taken
on a desktop must not flip a phone to dark. Every storage access is wrapped —
`localStorage` **throws** on access in some configurations rather than
returning null, and a display preference must never be why the app fails to
boot.

A tiny inline script in `index.html` applies the saved theme before first
paint, so a dark-theme user never sees a flash of the light palette. It cannot
import the module (it has to run before any module loads), so it repeats the
key and the fallback logic; `src/ui/theme.test.ts` asserts the two agree.

## The regression this produced, and the guard it earned

Renaming `--rule` to `--budget-rule` silently killed the carry meter — the
month view's signature element. An undefined custom property inside
`linear-gradient()` does not warn, does not throw, and does not fall back: the
whole declaration is invalid, so the element paints nothing. It looked like a
missing feature rather than a bug, and no test noticed. Pixel-sampling a
screenshot found it.

`src/ui/cssTokens.test.ts` now fails if any TypeScript file references a custom
property `src/index.css` does not define. This is the second guard of its kind
in the repo, after `eventCapture.test.ts`, and for the same reason: the failure
is invisible in review and invisible in a green suite.

## Verification, and its limits

`scripts/screenshot.ts` drives headless Chrome over CDP, which is how any of
this was seen at all. Both themes were rendered with real data on every route
at desktop and mobile widths; the resolved tokens were read out of the browser;
the carry meter's presence was confirmed by pixel sampling rather than by eye.

Not verified, and not verifiable here: how it feels, real offline behaviour,
the install prompt, and typography on the owner's actual platform — this
container has no Inter installed for the fallback stack and its fontconfig maps
every generic family to a monospace face, so screenshots need a
`FONTCONFIG_FILE` override to be representative at all.
