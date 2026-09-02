import { Fragment } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatSignedMoney } from "../format.ts";
import { ruleAt } from "../../domain/allocation.ts";
import type { MonthPostRow } from "../../domain/views.ts";
import type { PostMonthFigures } from "../../domain/fold.ts";
import type { Currency, MonthId } from "../../domain/types.ts";

interface Props {
  monthId: MonthId;
  baseCurrency: Currency;
  rows: MonthPostRow[];
  /** Omitted on read-only mounts; only the month view offers rule editing. */
  onChangeRule?: (postId: string) => void;
}

/**
 * Carry meter: the design contract's signature element. A 3px rule beneath
 * each post row, encoding the rollover fold's four numbers as a single
 * hard-stopped gradient so envelope rollover is visible without reading
 * digits.
 *
 * Segments, left to right, sized against a per-row scale of
 * (carried-in surplus + max(allocation, charges)):
 *   - --surplus       : carried-in surplus (omitted when carriedIn <= 0)
 *   - --budget-accent : spend within this month's allocation, filled from
 *                       the track's left edge
 *   - --budget-rule   : the unspent remainder of the allocation track
 *   - --overspend     : spend beyond the allocation, past the track's end
 */
function carryMeterBackground(figures: PostMonthFigures): string {
  const surplus = Math.max(figures.carriedIn, 0);
  const scale = surplus + Math.max(figures.allocation, figures.charges);

  if (scale <= 0) {
    return "var(--budget-rule)";
  }

  const pSurplus = (surplus / scale) * 100;
  const pFillEnd = pSurplus + (Math.min(figures.charges, figures.allocation) / scale) * 100;
  const pTrackEnd = pSurplus + (figures.allocation / scale) * 100;

  return (
    `linear-gradient(to right, ` +
    `var(--surplus) 0%, var(--surplus) ${pSurplus}%, ` +
    `var(--budget-accent) ${pSurplus}%, var(--budget-accent) ${pFillEnd}%, ` +
    `var(--budget-rule) ${pFillEnd}%, var(--budget-rule) ${pTrackEnd}%, ` +
    `var(--overspend) ${pTrackEnd}%, var(--overspend) 100%)`
  );
}

function CarryMeter({ figures }: { figures: PostMonthFigures }) {
  return (
    <div
      aria-hidden="true"
      className="h-[3px] w-full"
      style={{ background: carryMeterBackground(figures) }}
    />
  );
}

export function PostTable({ monthId, baseCurrency, rows, onChangeRule }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
            <th className="py-2 font-medium">Post</th>
            <th className="py-2 pl-6 text-right font-medium">Carried in</th>
            <th className="py-2 pl-6 text-right font-medium">Allocated</th>
            <th className="py-2 pl-6 text-right font-medium">Spent</th>
            <th className="py-2 pl-6 text-right font-medium">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ post, figures, overridden }) => (
            <Fragment key={post.id}>
              <tr className="group transition-colors hover:bg-accent/60">
                <td className="py-2.5">
                  <Link to={`/post/${post.id}/month/${monthId}`} className="hover:underline">
                    {post.name}
                  </Link>
                  {post.archived && (
                    <Badge variant="outline" className="ml-2">
                      archived
                    </Badge>
                  )}
                  {overridden && (
                    <Badge
                      variant="secondary"
                      className="ml-2"
                      title="This month overrides the rule otherwise in effect"
                    >
                      overridden
                    </Badge>
                  )}
                  {/* A month can carry BOTH badges: a version starting in a
                      month the user also overrode is unusual but legal, and
                      hiding either would obscure why the number is what it
                      is. The override still wins the allocation. */}
                  {ruleAt(post, monthId)?.from === monthId && (
                    <Badge
                      variant="outline"
                      className="ml-2"
                      title="This post's allocation rule changes from this month"
                    >
                      rule changes here
                    </Badge>
                  )}
                  {onChangeRule && (
                    <button
                      type="button"
                      className="ml-2 rounded text-xs text-budget-ink-muted underline decoration-dotted underline-offset-2 opacity-0 transition-opacity hover:text-budget-accent focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => onChangeRule(post.id)}
                    >
                      change from here
                    </button>
                  )}
                </td>
                <td
                  className={`font-money py-2.5 pl-6 text-right ${
                    figures.carriedIn > 0
                      ? "text-surplus"
                      : figures.carriedIn < 0
                        ? "text-overspend"
                        : ""
                  }`}
                >
                  {formatSignedMoney(figures.carriedIn, baseCurrency)}
                </td>
                <td className="font-money py-2.5 pl-6 text-right">
                  {formatMoney(figures.allocation, baseCurrency)}
                </td>
                <td className="font-money py-2.5 pl-6 text-right">
                  {formatMoney(figures.charges, baseCurrency)}
                </td>
                <td
                  className={`font-money py-2.5 pl-6 text-right font-medium ${
                    figures.remaining < 0 ? "text-overspend" : ""
                  }`}
                >
                  {formatSignedMoney(figures.remaining, baseCurrency)}
                </td>
              </tr>
              <tr>
                <td colSpan={5} className="p-0">
                  <CarryMeter figures={figures} />
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
