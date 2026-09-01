import { useState } from "react";
import { Link } from "react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { datasetMonthSpan, summaryView } from "../../domain/views.ts";
import { formatAmount, formatMoney } from "../format.ts";

export function SummaryRoute() {
  const dataset = useDataset();
  const span = datasetMonthSpan(dataset);
  const [from, setFrom] = useState(span.from);
  const [to, setTo] = useState(span.to);
  const [groupBy, setGroupBy] = useState<"post" | "month">("post");

  const view = summaryView(dataset, from, to);
  const base = dataset.settings.baseCurrency;
  const difference = Number((view.totalIncome - view.totalCharges).toFixed(2));

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Summary</h1>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input id="from" className="w-32" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <Input id="to" className="w-32" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFrom(span.from);
            setTo(span.to);
          }}
        >
          All time
        </Button>
        <div className="ml-auto flex gap-1">
          {(["post", "month"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={groupBy === option ? "default" : "outline"}
              onClick={() => setGroupBy(option)}
            >
              by {option}
            </Button>
          ))}
        </div>
      </div>

      <dl className="flex gap-6 text-sm">
        <div>
          <dt className="text-muted-foreground">Income</dt>
          <dd className="font-money">{formatMoney(view.totalIncome, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Spent</dt>
          <dd className="font-money">{formatMoney(view.totalCharges, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Difference</dt>
          <dd className={`font-money ${difference < 0 ? "text-overspend" : ""}`}>
            {formatMoney(difference, base)}
          </dd>
        </div>
      </dl>

      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">{groupBy === "post" ? "Post" : "Month"}</th>
            <th className="py-2 text-right">Spent</th>
            <th className="py-2 text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {groupBy === "post"
            ? view.byPost.map((entry) => (
                <tr key={entry.post.id} className="border-b last:border-0">
                  <td className="py-2">{entry.post.name}</td>
                  <td className="py-2 text-right font-money">{formatAmount(entry.charges)}</td>
                  <td className="py-2 text-right font-money text-muted-foreground">
                    {view.totalCharges === 0
                      ? "—"
                      : `${((entry.charges / view.totalCharges) * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))
            : view.byMonth.map((entry) => (
                <tr key={entry.monthId} className="border-b last:border-0">
                  <td className="py-2">
                    <Link to={`/month/${entry.monthId}`} className="hover:underline">
                      {entry.monthId}
                    </Link>
                  </td>
                  <td className="py-2 text-right font-money">{formatAmount(entry.charges)}</td>
                  <td className="py-2 text-right font-money text-muted-foreground">
                    {view.totalCharges === 0
                      ? "—"
                      : `${((entry.charges / view.totalCharges) * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </section>
  );
}
