interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * A two-or-three-way view switch: spend/balance, by post/by month, one/many,
 * percentages/amounts.
 *
 * Four screens had each built this from two loose `<Button>`s — the selected
 * one `variant="default"`, the other `variant="outline"`, separated by
 * `gap-1`. Rendered, that reads as one filled button sitting next to one
 * unrelated outline button, not as two states of a single control: the gap
 * says "these are separate", and the filled teal says "this is the primary
 * action on the card" when it only means "this is the view you are on".
 *
 * One track, one border, no gap, and `aria-pressed` per segment, so the thing
 * on screen and the thing a screen reader hears are the same control.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly Option<T>[];
  onChange: (next: T) => void;
  /** Names the group for a screen reader; there is no visible legend. */
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      // `w-fit justify-self-start` because this also sits as a direct child of
      // the purchase dialog's grid, where the default `stretch` alignment
      // pulled the track across the whole dialog. Both are inert in the flex
      // rows it sits in elsewhere.
      className="inline-flex w-fit shrink-0 justify-self-start rounded-md border border-input p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={[
              // The inner radius is one step tighter than the track's, so the
              // selected segment nests inside it instead of overhanging.
              "h-7 rounded-[0.25rem] px-3 text-xs font-medium whitespace-nowrap transition-colors",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-budget-ink-muted hover:bg-accent hover:text-accent-foreground",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
