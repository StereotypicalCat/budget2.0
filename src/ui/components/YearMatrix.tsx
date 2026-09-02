import { Link } from "react-router";
import { formatAmount } from "../format.ts";
import type { YearViewModel } from "../../domain/views.ts";

interface Props {
  view: YearViewModel;
  mode: "spend" | "balance";
}

/**
 * Posts x 12 months, plus a total column. A quiet table by design-contract
 * rule: the carry meter is the month view's signature element and does not
 * belong here. Every figure comes from `yearView`'s rows; nothing here
 * recomputes rollover.
 */
export function YearMatrix({ view, mode }: Props) {
  return (
    // Thirteen columns of figures cannot fit any realistic card, so the table
    // scrolls. The fade tells you that: without it the matrix just appears to
    // end mid-number, which reads as clipping rather than as more to come.
    <div className="relative">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[84rem] text-sm">
          <thead className="text-left">
            <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
              <th className="py-2 font-medium">Post</th>
              {view.months.map((month) => (
                <th key={month} className="py-2 pl-4 text-right font-medium whitespace-nowrap">
                  {month.slice(5)}
                </th>
              ))}
              <th className="py-2 pl-4 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-budget-rule text-budget-ink-muted">
              <td className="py-2">Income</td>
              {view.incomeByMonth.map((income, i) => (
                <td key={i} className="font-money py-2 pl-4 text-right whitespace-nowrap">
                  {formatAmount(income)}
                </td>
              ))}
              <td className="font-money py-2 pl-4 text-right whitespace-nowrap">
                {formatAmount(view.totalIncome)}
              </td>
            </tr>

            {view.rows.map((row) => (
              <tr key={row.post.id} className="border-b border-budget-rule transition-colors last:border-0 hover:bg-accent/60">
                <td className="py-2">
                  <Link to={`/post/${row.post.id}/year/${view.year}`} className="hover:underline">
                    {row.post.name}
                  </Link>
                </td>
                {row.byMonth.map((figures, i) => {
                  const value = mode === "spend" ? figures.charges : figures.remaining;
                  return (
                    <td
                      key={i}
                      className={`font-money py-2 pl-4 text-right whitespace-nowrap ${
                        mode === "balance" && value < 0 ? "text-overspend" : ""
                      }`}
                    >
                      {formatAmount(value)}
                    </td>
                  );
                })}
                <td
                  className={`font-money py-2 pl-4 text-right font-medium whitespace-nowrap ${
                    mode === "balance" && row.closingBalance < 0 ? "text-overspend" : ""
                  }`}
                >
                  {formatAmount(mode === "spend" ? row.totalCharges : row.closingBalance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-budget-raised to-transparent"
      />
    </div>
  );
}
