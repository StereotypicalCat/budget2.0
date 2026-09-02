import { gradientFor, type MeterSegment } from "../meterSegments.ts";

/**
 * Draws a segment list as one hard-stopped gradient. Geometry and edge cases
 * live in src/ui/meterSegments.ts; this is only the paint.
 *
 * `aria-hidden` because every meter in the app sits beside the same numbers
 * as text. A screen reader announcing a gradient it cannot describe is worse
 * than one skipping a decoration of figures it has already read.
 */
export function Meter({
  segments,
  className = "",
}: {
  segments: MeterSegment[];
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`w-full ${className}`}
      style={{ background: gradientFor(segments) }}
    />
  );
}
