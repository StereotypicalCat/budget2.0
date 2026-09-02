# Month view

Sub-project 2 of the visual redesign, decomposed in
`2026-09-02-design-foundation-design.md`: *"Month view — income and totals,
post rows and carry meter, purchases grouped by date."* Date-grouped purchases
shipped ahead of the rest (`a159189`); this spec covers what was left open.

The owner's standing instruction for the redesign still applies — *"override
everything you want for this step. This needs to look good."* — so the three
forks below were put to them as concrete alternatives rather than as open
questions. All three were answered with the recommended option.

## The diagnosis

Three problems, found by looking at the rendered page in Chrome at 1280px and
390px rather than by reading the code.

**The totals block was four peer figures with no relationship between them.**
Income, Allocated, Spent and Unallocated sat in one row at one weight. The
income *input* — the only editable thing on the screen — was in the same visual
register as three numbers derived from it. And nothing at the month level
answered the second of PRODUCT.md's two questions, *did I overspend*: with
Transport at −3,200 DKK, you had to read down the Remaining column to find out.

**The carry meter belonged to the wrong row.** It is the design contract's
signature element, and it was rendering 21px below its own row and 22px above
the next one — visually a divider, not a property of a post. There was also no
legend anywhere, so its four segments were unreadable to anyone who had not
read `PostTable.tsx`.

**Phone width was broken, and nothing recorded it.** The five-column table
overflowed its container at 390px: *Spent* and *Remaining*, the two columns
that answer the app's two questions, were off-screen behind a horizontal
scroll, and every figure wrapped its currency onto a second line
("+4,219.61 / DKK"). This is the width at which a grocery trip actually gets
entered.

## The month header

Three zones in reading order, in the one `Section` card, on the paper ground
below the unchanged month `<header>`.

1. **Income** — the field. Unchanged in behaviour: still `type="number"`, still
   base-currency only. Section 6 of TODO.md records the reasoning — a month has
   one income, so making the field parse a currency the way the purchase total
   does is arguably wrong rather than merely undone. It keeps field affordance
   so it stays visibly the one editable thing on the screen.
2. **Allocated and Unallocated**, with the allocation meter beneath them and
   "N% of income allocated" beside it.
3. **Spent**, under a hairline, with the month-level overspend answer beside
   it.

### The allocation meter scales to `max(income, allocated)`

Not to income. Over-budget is always allowed (CLAUDE.md), and allocating past
income is the ordinary way that shows up here, so the meter has to render it
rather than cap at a full bar: the overflow past the income mark paints
`--overspend`, and the label reads past 100%. Capping would make
over-allocation look exactly like allocating income to the last krone.

Edge cases, all of them reachable:

- income ≤ 0 with allocation > 0 — no denominator, so the percentage is
  omitted and the whole track is overflow.
- both zero — an empty track, no percentage.
- allocation ≤ 0 — an empty track; a fixed rule may be negative, and no
  percentage can be below zero-length.

### "1 post overspent" is text, not a link

The Posts table is ~40px below this line. A control that scrolls the page by
less than a viewport is noise, so the line states the answer and stops.

It renders in both directions — *"no posts overspent"* in muted ink, *"1 post
overspent"* in `--overspend` — because a line that appears and disappears
shifts the layout of the block above it, and because "no" is a real answer to
the question rather than an absence of one.

The count is added to `MonthViewModel` as `overspentCount` rather than derived
in the component. It is a count over rows the fold already produced, and
putting it in the domain means it is tested where the rest of the month's
arithmetic is tested, with the UI left dumb.

## Post rows: two markups, one per structure

Below `sm:` each post becomes a two-line block — name and Remaining large on
the first line, the meter full width, then carried / allocated / spent as one
small caption line. Nothing is hidden and nothing scrolls sideways.

This is implemented as two sibling markups, `hidden sm:table` and `sm:hidden`,
not as one reflowing grid.

**Rejected: a single CSS grid carrying `role="table"` and friends.** It
deduplicates the markup, which is the whole of its appeal. But at 390px the
layout genuinely is not a table any more — it is a list of two-line blocks —
and leaving table roles on it would describe a grid of rows and columns to a
screen reader that no longer exists visually. Keeping a real `<table>` at the
width where it is a table, and a real list at the width where it is a list,
means each structure is honest about itself. The cost is that the figures
appear twice in the DOM at any one width; at six to thirty posts that is
nothing, and both markups read their cells from one shared `postRowCells`
helper, so the figures are still derived in exactly one place.

### The currency moves to the header

Every figure in this table is in the dataset's base currency, so repeating the
code on all thirty cells buys nothing and costs the line wrap that made the
phone layout unreadable. The `Section`'s hint carries "All figures in DKK"
once; the cells print `formatAmount`.

This is deliberately not a change to `formatMoney`, which is still right
everywhere an amount can be in some other currency — every purchase row, for
one, where a 27.50 EUR line sits among DKK.

## The carry meter becomes the row divider

One `<tbody>` per post, holding both the figures row and the meter row.
Multiple `<tbody>` elements in one table are valid, and this is what makes
`group-hover` tint a post's figures and its meter as one block; two loose
`<tr>` siblings cannot express that relationship at all.

The meter then sits tight under its own row with that row's hairline removed,
so the meter *is* the divider, and the whitespace moves below it. 3px to 4px.
The ambiguity was never about the meter's design — it was that the gaps above
and below it were within a pixel of each other.

A legend sits beside the hint, once for the table: four swatches, carried in /
spent / unspent / over. The meter itself stays `aria-hidden`; the four figures
beside it carry the same information as text, and a screen reader reading a
gradient twice is worse than not reading it.

Note what the meter still does not show: a *negative* carried-in balance. The
surplus segment is `max(carriedIn, 0)`, so Transport carrying −1,600 forward
shows a meter that starts at the allocation, and only the red Carried-in figure
says why the post is behind. That is existing, documented behaviour and this
sub-project does not change it.

## Where the code goes

The two meters are the same idea rendered at two scales, so the math comes out
of the component into `src/ui/meterSegments.ts` — pure, no DOM:

- `carryMeterSegments(figures)` — the four rollover segments.
- `allocationMeterSegments(income, allocated)` — the header's two or three.
- `gradientFor(segments)` — the hard-stopped `linear-gradient` string.

A thin `<Meter segments>` renders it. The token names stay in TypeScript
source, which is what keeps `src/ui/cssTokens.test.ts` guarding them — that
test exists because renaming `--rule` silently made this exact element paint
nothing, and moving the gradient into a `.css` file would have moved it out of
the guard's reach.

## Testing

- `src/ui/meterSegments.test.ts` (new): zero scale, negative carried-in,
  charges past allocation, over-allocation, income 0 against allocation > 0,
  and the two invariants that hold for every input — stops ascend, and every
  stop lands within [0, 100].
- `src/domain/views.test.ts`: `overspentCount`, including that a post at
  exactly zero is not counted.
- `src/cssPairs.test.ts` and `src/ui/cssTokens.test.ts` keep guarding the
  tokens; no new pair is introduced.
- Both themes at 1280px and 390px through `scripts/screenshot.ts`.

## Not changed

No new validation anywhere: over-allocation still renders, negative figures
still render, and nothing here can block a write. `src/domain/` changes only by
gaining the count. The purchases list, the rule-from-month editor and the month
`<header>` are untouched.

## Verification limits

A screenshot proves the layout exists and is not broken. It cannot say the
month view now reads well, and this container's fonts are not the owner's
fonts. Whether the header answers the two questions faster than four peer
figures did is a judgement only the owner can make.
