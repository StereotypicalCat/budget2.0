import type { PostMonthFigures } from "../domain/fold.ts";

/**
 * Meter geometry, kept out of the components that draw it.
 *
 * Two meters in the app encode money as a hard-stopped gradient: the carry
 * meter under every post row, and the allocation meter in the month header.
 * They are the same idea at two scales, so the arithmetic lives here — pure,
 * no DOM — where every edge case it has to survive can be asserted directly.
 *
 * The token names stay in TypeScript on purpose. `src/ui/cssTokens.test.ts`
 * fails if a token referenced here is not one `src/index.css` defines, and
 * that guard exists because renaming `--rule` silently made this exact element
 * paint nothing: an undefined custom property inside `linear-gradient()`
 * invalidates the whole declaration without warning. (That test reads source
 * text, so it will flag a token named in a comment too — as this one was.)
 */
export interface MeterSegment {
  /** A custom property defined in src/index.css, e.g. "--surplus". */
  token: string;
  /** Width as a percentage of the track. Always > 0; the list sums to 100. */
  percent: number;
}

/** An empty track: the same hairline colour as an unspent remainder. */
const EMPTY_TRACK: MeterSegment[] = [{ token: "--budget-rule", percent: 100 }];

function scaled(parts: [string, number][], scale: number): MeterSegment[] {
  const segments: MeterSegment[] = [];
  for (const [token, size] of parts) {
    if (size <= 0) continue;
    segments.push({ token, percent: (size / scale) * 100 });
  }
  return segments.length > 0 ? segments : EMPTY_TRACK;
}

/**
 * The rollover fold's four numbers as one track, left to right:
 *
 *   --surplus       carried-in surplus
 *   --budget-accent spend within this month's allocation
 *   --budget-rule   the unspent remainder of the allocation
 *   --overspend     spend beyond the allocation
 *
 * Negatives are clamped rather than inverted. A carried-in *debt* therefore
 * does not appear here at all — only the red Carried-in figure beside the
 * meter says why the post is behind — and a net refund reads as no spend.
 * Both are deliberate: a segment of negative width would put the gradient's
 * stops out of order, which paints something arbitrary instead of failing.
 */
export function carryMeterSegments(figures: PostMonthFigures): MeterSegment[] {
  const surplus = Math.max(figures.carriedIn, 0);
  const allocation = Math.max(figures.allocation, 0);
  const charges = Math.max(figures.charges, 0);
  const scale = surplus + Math.max(allocation, charges);

  if (scale <= 0) return EMPTY_TRACK;

  return scaled(
    [
      ["--surplus", surplus],
      ["--budget-accent", Math.min(charges, allocation)],
      ["--budget-rule", allocation - Math.min(charges, allocation)],
      ["--overspend", charges - Math.min(charges, allocation)],
    ],
    scale,
  );
}

/**
 * The month header's meter: how much of this month's income is allocated.
 *
 * Scaled to `max(income, allocated)`, NOT to income. Over-budget is always
 * allowed, and allocating past income is the ordinary way that shows up here,
 * so the overflow has to be drawable: capping at a full bar would make
 * over-allocation look identical to allocating income to the last krone.
 */
export function allocationMeterSegments(income: number, allocated: number): MeterSegment[] {
  const earned = Math.max(income, 0);
  const spent = Math.max(allocated, 0);
  const scale = Math.max(earned, spent);

  if (scale <= 0) return EMPTY_TRACK;

  return scaled(
    [
      ["--budget-accent", Math.min(spent, earned)],
      ["--budget-rule", earned - Math.min(spent, earned)],
      ["--overspend", spent - Math.min(spent, earned)],
    ],
    scale,
  );
}

/** Null when there is no income for the allocation to be a share of. */
export function allocatedPercentOfIncome(income: number, allocated: number): number | null {
  if (income <= 0) return null;
  return Math.round((allocated / income) * 100);
}

/** Trimmed so a stop reads `25%` rather than `25.0000%`. */
function stop(percent: number): string {
  return `${Number(percent.toFixed(4))}%`;
}

/**
 * Hard stops, so the track reads as discrete quantities rather than a blend:
 * each segment ends and the next begins at the same position.
 */
export function gradientFor(segments: MeterSegment[]): string {
  const stops: string[] = [];
  let at = 0;
  segments.forEach((segment, index) => {
    const from = at;
    at += segment.percent;
    // The last segment closes on a literal 100% so accumulated float error
    // can never leave a hairline of unpainted track at the right edge.
    const to = index === segments.length - 1 ? 100 : at;
    stops.push(`var(${segment.token}) ${stop(from)}`, `var(${segment.token}) ${stop(to)}`);
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
