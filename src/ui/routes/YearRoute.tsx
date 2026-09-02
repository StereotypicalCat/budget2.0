import { useState } from "react";
import { Link, useParams } from "react-router";
import { useDataset } from "../hooks/useDataset.ts";
import { yearView } from "../../domain/views.ts";
import { formatMoney } from "../format.ts";
import { YearMatrix } from "../components/YearMatrix.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { Section, Stat } from "../components/Section.tsx";

export function YearRoute() {
  const { year = "" } = useParams();
  const dataset = useDataset();
  const [mode, setMode] = useState<"spend" | "balance">("spend");
  const numericYear = Number(year);
  const view = yearView(dataset, numericYear);
  const base = dataset.settings.baseCurrency;

  return (
    <div className="space-y-5">
      <header className="flex items-baseline gap-3">
        <Link
          to={`/year/${numericYear - 1}`}
          className="font-money shrink-0 rounded-md px-1.5 py-1 text-xs whitespace-nowrap text-budget-ink-muted transition-colors hover:bg-accent hover:text-budget-ink"
        >
          &larr; {numericYear - 1}
        </Link>
        <h1 className="text-2xl">{year}</h1>
        <Link
          to={`/year/${numericYear + 1}`}
          className="font-money shrink-0 rounded-md px-1.5 py-1 text-xs whitespace-nowrap text-budget-ink-muted transition-colors hover:bg-accent hover:text-budget-ink"
        >
          {numericYear + 1} &rarr;
        </Link>
      </header>

      <Section>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Stat label="Income">{formatMoney(view.totalIncome, base)}</Stat>
          <Stat label="Spent">{formatMoney(view.totalCharges, base)}</Stat>
        </dl>
      </Section>

      <Section
        title="Posts by month"
        action={
          <Segmented
            label="Figures to show"
            value={mode}
            onChange={setMode}
            options={[
              { value: "spend", label: "Spent" },
              { value: "balance", label: "Closing balance" },
            ]}
          />
        }
      >
        <YearMatrix view={view} mode={mode} />
      </Section>
    </div>
  );
}
