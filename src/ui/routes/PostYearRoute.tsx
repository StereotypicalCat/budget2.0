import { Link, useParams } from "react-router";
import { useDataset } from "../hooks/useDataset.ts";
import { yearView } from "../../domain/views.ts";
import { useMoneyFormat } from "../hooks/useMoneyFormat.ts";

export function PostYearRoute() {
  const fmt = useMoneyFormat();
  const { postId = "", year = "" } = useParams();
  const dataset = useDataset();
  const post = dataset.posts.find((p) => p.id === postId);
  if (!post) return <p>That post no longer exists.</p>;

  const base = dataset.settings.baseCurrency;
  const view = yearView(dataset, Number(year));
  const row = view.rows.find((r) => r.post.id === postId);
  if (!row) return <p>No data for this post in {year}.</p>;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {post.name} &middot; {year}
      </h1>
      <p className="text-sm text-muted-foreground">
        Allocated {fmt.money(row.totalAllocation, base)} &middot; spent{" "}
        {fmt.money(row.totalCharges, base)} &middot; closing balance{" "}
        {fmt.signedMoney(row.closingBalance, base)}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="py-2">Month</th>
              <th className="py-2 text-right">Carried in</th>
              <th className="py-2 text-right">Allocated</th>
              <th className="py-2 text-right">Spent</th>
              <th className="py-2 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {view.months.map((month, i) => {
              const figures = row.byMonth[i]!;
              return (
                <tr key={month} className="border-b last:border-0">
                  <td className="py-2">
                    <Link to={`/post/${postId}/month/${month}`} className="hover:underline">
                      {month}
                    </Link>
                  </td>
                  <td
                    className={`font-money py-2 text-right ${
                      figures.carriedIn > 0
                        ? "text-surplus"
                        : figures.carriedIn < 0
                          ? "text-overspend"
                          : ""
                    }`}
                  >
                    {fmt.signedMoney(figures.carriedIn, base)}
                  </td>
                  <td className="font-money py-2 text-right">{fmt.amount(figures.allocation)}</td>
                  <td className="font-money py-2 text-right">{fmt.amount(figures.charges)}</td>
                  <td
                    className={`font-money py-2 text-right font-medium ${
                      figures.remaining < 0 ? "text-overspend" : ""
                    }`}
                  >
                    {fmt.signedMoney(figures.remaining, base)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
