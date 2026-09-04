import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { useMoneyFormat, type MoneyFormat } from "../hooks/useMoneyFormat.ts";
import { ruleAt } from "../../domain/allocation.ts";
import { carryMeterSegments, type MeterSegment } from "../meterSegments.ts";
import { Meter } from "./Meter.tsx";
import type { MonthPostRow } from "../../domain/views.ts";
import type { Currency, MonthId } from "../../domain/types.ts";

interface Props {
  monthId: MonthId;
  rows: MonthPostRow[];
  /** Omitted on read-only mounts; only the month view offers rule editing. */
  onChangeRule?: (postId: string) => void;
}

/**
 * The month's posts, in two markups: a real table from `sm:` up, a list of
 * two-line blocks below it.
 *
 * NOT one reflowing grid with `role="table"`. At 390px the layout genuinely
 * stops being a table — it is a stack of two-line blocks — and leaving table
 * roles on it would describe rows and columns to a screen reader that no
 * longer exist on screen. Each structure is honest about itself instead. The
 * figures appear twice in the DOM at any one width, which at six to thirty
 * posts costs nothing, and both markups read their cells from `postRowCells`
 * so the numbers are still derived in exactly one place.
 *
 * The currency is deliberately absent from every cell: it is stated once, in
 * the legend, because every figure here is in the dataset's base currency.
 * Repeating it bought nothing and wrapped "+4,219.61 DKK" onto two lines on a
 * phone, which is the width a grocery trip is actually entered at.
 */
interface RowCells {
  carriedIn: string;
  carriedInTone: string;
  allocation: string;
  charges: string;
  remaining: string;
  remainingTone: string;
  /** What is left once unconfirmed recurring bills are counted too. Always
   *  rendered in the muted ink token, never toned, so `remaining` stays the
   *  one figure the eye lands on first. */
  projected: string;
  segments: MeterSegment[];
}

/**
 * Takes the formatter as an argument rather than calling the hook: this is a
 * plain function, not a component, and both table markups call it from inside
 * a map.
 */
function postRowCells({ figures }: MonthPostRow, fmt: MoneyFormat): RowCells {
  return {
    carriedIn: fmt.signedAmount(figures.carriedIn),
    carriedInTone:
      figures.carriedIn > 0
        ? "text-surplus"
        : figures.carriedIn < 0
          ? "text-overspend"
          : "",
    allocation: fmt.amount(figures.allocation),
    charges: fmt.amount(figures.charges),
    remaining: fmt.signedAmount(figures.remaining),
    remainingTone: figures.remaining < 0 ? "text-overspend" : "",
    projected: fmt.signedAmount(figures.projected),
    segments: carryMeterSegments(figures),
  };
}

/**
 * The four colours of the carry meter, named once for the whole table. Sits in
 * the Section's hint, so it renders inside a `<p>` — spans only, no divs.
 */
export function PostTableLegend({ baseCurrency }: { baseCurrency: Currency }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        All figures in {baseCurrency}. Projected subtracts bills not yet confirmed.
      </span>
      <Swatch token="--surplus" label="carried in" />
      <Swatch token="--budget-accent" label="spent" />
      <Swatch token="--budget-rule" label="unspent" />
      <Swatch token="--overspend" label="over" />
    </span>
  );
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-sm"
        style={{ background: `var(${token})` }}
      />
      {label}
    </span>
  );
}

function PostName({
  row: { post, overridden },
  monthId,
}: {
  row: MonthPostRow;
  monthId: MonthId;
}) {
  return (
    <>
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
      {/* A month can carry BOTH badges: a version starting in a month the user
          also overrode is unusual but legal, and hiding either would obscure
          why the number is what it is. The override still wins. */}
      {ruleAt(post, monthId)?.from === monthId && (
        <Badge
          variant="outline"
          className="ml-2"
          title="This post's allocation rule changes from this month"
        >
          rule changes here
        </Badge>
      )}
    </>
  );
}

/**
 * Placed differently in each markup, which is why it is not part of PostName.
 * In the table it is revealed on hover, beside the name. On a phone there is
 * no hover, so it has to be permanently visible — and beside the name at that
 * size it competes with the name itself, so it goes at the end of the quiet
 * caption line instead.
 */
function ChangeRuleButton({
  postId,
  onChangeRule,
  className = "",
}: {
  postId: string;
  onChangeRule: (postId: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      // `-my-1 py-1 -mx-1 px-1` is a hit area, not spacing: the label is a
      // single line of 11px text, so untouched it is a 15px-tall target. The
      // negative margins cancel the padding, so nothing moves and the row's
      // baselines are unchanged.
      className={`-mx-1 -my-1 rounded-sm px-1 py-1 text-budget-ink-muted underline decoration-dotted underline-offset-2 transition-opacity hover:text-budget-accent ${className}`}
      onClick={() => onChangeRule(postId)}
    >
      change from here
    </button>
  );
}

export function PostTable({ monthId, rows, onChangeRule }: Props) {
  const fmt = useMoneyFormat();
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
              <th className="py-2 font-medium">Post</th>
              <th className="py-2 pl-6 text-right font-medium">Carried in</th>
              <th className="py-2 pl-6 text-right font-medium">Allocated</th>
              <th className="py-2 pl-6 text-right font-medium">Spent</th>
              <th className="py-2 pl-6 text-right font-medium">Remaining</th>
              <th className="py-2 pl-6 text-right font-medium">Projected</th>
            </tr>
          </thead>
          {/* One tbody per post, holding the figures AND their meter. Multiple
              tbodies are valid, and this is the only way to hover the pair as
              one block — two loose sibling <tr>s cannot express that they
              belong together, which is exactly how the meter came to look like
              a divider between two rows rather than part of one. */}
          {rows.map((row) => {
            const cells = postRowCells(row, fmt);
            return (
              <tbody key={row.post.id} className="group">
                <tr className="transition-colors group-hover:bg-accent/60">
                  <td className="pb-0 pt-3">
                    <PostName row={row} monthId={monthId} />
                    {onChangeRule && (
                      <ChangeRuleButton
                        postId={row.post.id}
                        onChangeRule={onChangeRule}
                        className="ml-2 text-xs opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      />
                    )}
                  </td>
                  <td
                    className={`font-money pb-0 pl-6 pt-3 text-right ${cells.carriedInTone}`}
                  >
                    {cells.carriedIn}
                  </td>
                  <td className="font-money pb-0 pl-6 pt-3 text-right">
                    {cells.allocation}
                  </td>
                  <td className="font-money pb-0 pl-6 pt-3 text-right">{cells.charges}</td>
                  <td
                    className={`font-money pb-0 pl-6 pt-3 text-right font-medium ${cells.remainingTone}`}
                  >
                    {cells.remaining}
                  </td>
                  <td className="font-money pb-0 pl-6 pt-3 text-right text-budget-ink-muted">
                    {cells.projected}
                  </td>
                </tr>
                {/* The meter IS the row divider: tight under its own figures,
                    with the gap below it. */}
                <tr className="transition-colors group-hover:bg-accent/60">
                  <td colSpan={6} className="px-0 pb-4 pt-1.5">
                    <Meter segments={cells.segments} className="h-1" />
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      <ul className="space-y-4 sm:hidden">
        {rows.map((row) => {
          const cells = postRowCells(row, fmt);
          return (
            <li key={row.post.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <PostName row={row} monthId={monthId} />
                </span>
                <span
                  className={`font-money shrink-0 text-base font-medium ${cells.remainingTone}`}
                >
                  {cells.remaining}
                </span>
              </div>
              <Meter segments={cells.segments} className="h-1" />
              <p className="flex flex-wrap gap-x-3 text-[0.6875rem] text-budget-ink-muted">
                <span>
                  carried{" "}
                  <span className={`font-money ${cells.carriedInTone}`}>{cells.carriedIn}</span>
                </span>
                <span>
                  allocated <span className="font-money">{cells.allocation}</span>
                </span>
                <span>
                  spent <span className="font-money">{cells.charges}</span>
                </span>
                <span>
                  projected <span className="font-money">{cells.projected}</span>
                </span>
                {/* Pushed to the right end of the line it wraps onto, so six
                    of these down a phone screen read as a quiet affordance
                    rather than as each row's primary action. */}
                {onChangeRule && (
                  <ChangeRuleButton
                    postId={row.post.id}
                    onChangeRule={onChangeRule}
                    className="ml-auto"
                  />
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
