import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { yearView } from "../../domain/views.ts";
import { formatMoney } from "../format.ts";
import { YearMatrix } from "../components/YearMatrix.tsx";

export function YearRoute() {
  const { year = "" } = useParams();
  const dataset = useDataset();
  const [mode, setMode] = useState<"spend" | "balance">("spend");
  const numericYear = Number(year);
  const view = yearView(dataset, numericYear);
  const base = dataset.settings.baseCurrency;

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-4">
        <Link to={`/year/${numericYear - 1}`} className="text-sm hover:underline">
          &larr; {numericYear - 1}
        </Link>
        <h1 className="text-2xl font-semibold">{year}</h1>
        <Link to={`/year/${numericYear + 1}`} className="text-sm hover:underline">
          {numericYear + 1} &rarr;
        </Link>
        <div className="ml-auto flex gap-1">
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
      </header>

      <p className="text-sm text-muted-foreground">
        Income {formatMoney(view.totalIncome, base)} &middot; spent{" "}
        {formatMoney(view.totalCharges, base)}
      </p>

      <YearMatrix view={view} mode={mode} />
    </section>
  );
}
