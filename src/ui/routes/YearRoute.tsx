import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { yearView } from "../../domain/views.ts";
import { formatMoney } from "../format.ts";
import { YearMatrix } from "../components/YearMatrix.tsx";
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
          className="font-money rounded-md px-1.5 py-0.5 text-xs text-budget-ink-muted transition-colors hover:bg-accent hover:text-budget-ink"
        >
          &larr; {numericYear - 1}
        </Link>
        <h1 className="text-2xl">{year}</h1>
        <Link
          to={`/year/${numericYear + 1}`}
          className="font-money rounded-md px-1.5 py-0.5 text-xs text-budget-ink-muted transition-colors hover:bg-accent hover:text-budget-ink"
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
          <div className="flex gap-1">
            {(["spend", "balance"] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={mode === option ? "default" : "outline"}
                onClick={() => setMode(option)}
              >
                {option === "spend" ? "Spent" : "Closing balance"}
              </Button>
            ))}
          </div>
        }
      >
        <YearMatrix view={view} mode={mode} />
      </Section>
    </div>
  );
}
