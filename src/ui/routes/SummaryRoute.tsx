import { useState } from "react";
import { Link } from "react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { datasetMonthSpan, summaryView } from "../../domain/views.ts";
import { formatAmount, formatMoney } from "../format.ts";
import { Section, Stat } from "../components/Section.tsx";
import { Segmented } from "../components/Segmented.tsx";

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
    <div className="space-y-5">
      <h1 className="text-2xl">Summary</h1>

      <Section>
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
            onClick={() => {
              setFrom(span.from);
              setTo(span.to);
            }}
          >
            All time
          </Button>
        </div>

        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4 border-t border-budget-rule pt-5">
        <Stat label="Income">{formatMoney(view.totalIncome, base)}</Stat>
        <Stat label="Spent">{formatMoney(view.totalCharges, base)}</Stat>
          <Stat label="Difference" tone={difference < 0 ? "overspend" : "default"}>
            {formatMoney(difference, base)}
          </Stat>
        </dl>
      </Section>

      <Section
        title={groupBy === "post" ? "By post" : "By month"}
        action={
          <Segmented
            label="Group rows by"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "post", label: "By post" },
              { value: "month", label: "By month" },
            ]}
          />
        }
      >
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
              <th className="py-2 font-medium">{groupBy === "post" ? "Post" : "Month"}</th>
              <th className="py-2 pl-6 text-right font-medium">Spent</th>
              <th className="py-2 pl-6 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {groupBy === "post"
              ? view.byPost.map((entry) => (
                  <tr key={entry.post.id} className="border-b border-budget-rule transition-colors last:border-0 hover:bg-accent/60">
                    <td className="py-2.5">{entry.post.name}</td>
                    <td className="font-money py-2.5 pl-6 text-right">{formatAmount(entry.charges)}</td>
                    <td className="font-money py-2.5 pl-6 text-right text-budget-ink-muted">
                      {view.totalCharges === 0
                        ? "—"
                        : `${((entry.charges / view.totalCharges) * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))
              : view.byMonth.map((entry) => (
                  <tr key={entry.monthId} className="border-b border-budget-rule transition-colors last:border-0 hover:bg-accent/60">
                    <td className="py-2.5">
                      <Link to={`/month/${entry.monthId}`} className="hover:underline">
                        {entry.monthId}
                      </Link>
                    </td>
                    <td className="font-money py-2.5 pl-6 text-right">{formatAmount(entry.charges)}</td>
                    <td className="font-money py-2.5 pl-6 text-right text-budget-ink-muted">
                      {view.totalCharges === 0
                        ? "—"
                        : `${((entry.charges / view.totalCharges) * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
