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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">Post</th>
            {view.months.map((month) => (
              <th key={month} className="py-2 text-right font-normal">
                {month.slice(5)}
              </th>
            ))}
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b text-muted-foreground">
            <td className="py-2">Income</td>
            {view.incomeByMonth.map((income, i) => (
              <td key={i} className="font-money py-2 text-right">
                {formatAmount(income)}
              </td>
            ))}
            <td className="font-money py-2 text-right">{formatAmount(view.totalIncome)}</td>
          </tr>

          {view.rows.map((row) => (
            <tr key={row.post.id} className="border-b last:border-0">
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
                    className={`font-money py-2 text-right ${
                      mode === "balance" && value < 0 ? "text-overspend" : ""
                    }`}
                  >
                    {formatAmount(value)}
                  </td>
                );
              })}
              <td
                className={`font-money py-2 text-right font-medium ${
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
  );
}
