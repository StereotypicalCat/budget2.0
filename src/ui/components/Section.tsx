import type { ReactNode } from "react";

interface Props {
  /** Omitted when the card's contents are self-explanatory (a toolbar). */
  title?: string;
  /** Sits opposite the title: a primary action, a mode switch. */
  action?: ReactNode;
  /** One line under the title. Long explanations belong in the body. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The one card in the app. Every screen is a stack of these on the paper
 * ground, which is what stops elevation, radius and padding drifting apart
 * screen by screen — the previous design defined a card treatment in a
 * contract document and then never applied it anywhere.
 *
 * The `.budget-card` class carries the visual treatment (see src/index.css) so
 * light and dark elevation differ where they must: a drop shadow is invisible
 * on a dark ground, where a lighter surface plus a hairline does the work.
 */
export function Section({ title, action, hint, children, className = "" }: Props) {
  return (
    <section className={`budget-card p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base leading-tight">{title}</h2>}
            {/* Capped measure. Uncapped, the Currencies and Posts hints ran
                the full 1140px of the card at 12px — about 160 characters a
                line, more than twice a readable measure, and both wrapped to
                three lines that read as a wall rather than as one aside. */}
            {hint && (
              <p className="mt-1 max-w-[75ch] text-xs leading-relaxed text-budget-ink-muted">
                {hint}
              </p>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A single figure with its label. Used for the month's totals, where the
 * numbers matter more than the words: the label is small and quiet, the figure
 * is large and mono so a column of them lines up.
 */
export function Stat({
  label,
  children,
  tone = "default",
  title,
}: {
  label: string;
  children: ReactNode;
  tone?: "default" | "surplus" | "overspend";
  title?: string;
}) {
  const toneClass =
    tone === "overspend" ? "text-overspend" : tone === "surplus" ? "text-surplus" : "";
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted">
        {label}
      </dt>
      <dd className={`font-money mt-0.5 text-lg leading-tight ${toneClass}`}>{children}</dd>
    </div>
  );
}
