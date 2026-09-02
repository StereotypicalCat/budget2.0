import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>`, styled to Input's exact metrics.
 *
 * Native on purpose. This app is a fast-entry tool, and a real `<select>` gets
 * the platform picker on a phone, type-to-select on a keyboard and the OS's own
 * accessibility affordances for free — a Radix listbox would trade all of that
 * for a nicer-looking menu. `src/components/ui/select.tsx` is still there for
 * anywhere that genuinely needs a rich menu; nothing does yet.
 *
 * It exists because eight call sites had each hand-rolled the same control and
 * arrived at four different answers: `h-8 rounded border px-1 text-xs`,
 * `h-9 rounded border px-2 text-sm`, `h-9 flex-1 rounded ...` and one correct
 * `h-9 rounded-md border-input px-2`. So a select and the Input beside it in
 * the same row disagreed on radius (4px vs 6px), on border colour (the row
 * hairline vs the 3:1 field border) and on text indent (4 or 8px vs 12px).
 *
 * `className` lands on the `<select>` itself and there is no wrapper element,
 * so every layout class a call site already used — `w-full`, `flex-1`, `h-8`,
 * `w-40` — keeps behaving exactly as it did. That is also why the chevron is a
 * background image from `--budget-select-chevron` rather than an absolutely
 * positioned icon: no wrapper to position it against.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        // Matches Input line for line, except for the right padding that keeps
        // the longest option clear of the chevron.
        "h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent bg-no-repeat py-1 pr-8 pl-3 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm dark:bg-input/30",
        "bg-[image:var(--budget-select-chevron)] bg-[length:0.875rem] bg-[position:right_0.625rem_center]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
