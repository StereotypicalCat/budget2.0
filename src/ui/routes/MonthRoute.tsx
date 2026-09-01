import { Link, useParams } from "react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { monthView } from "../../domain/views.ts";
import { addMonths } from "../../domain/months.ts";
import { setIncome } from "../../store/actions.ts";
import { formatMoney, formatSignedMoney } from "../format.ts";
import { PostTable } from "../components/PostTable.tsx";

export function MonthRoute() {
  const { monthId = "" } = useParams();
  const dataset = useDataset();
  const { mutate, error, clearError } = useMutate();
  const view = monthView(dataset, monthId);
  const base = dataset.settings.baseCurrency;

  return (
    <section className="space-y-6">
      {error && (
        <div className="flex items-center justify-between rounded border border-destructive p-3 text-sm">
          <span>Could not save: {error}</span>
          <button onClick={clearError} className="underline">
            dismiss
          </button>
        </div>
      )}

      <header className="flex items-center gap-4">
        <Link to={`/month/${addMonths(monthId, -1)}`} className="text-sm hover:underline">
          &larr; {addMonths(monthId, -1)}
        </Link>
        <h1 className="text-2xl font-semibold">{monthId}</h1>
        <Link to={`/month/${addMonths(monthId, 1)}`} className="text-sm hover:underline">
          {addMonths(monthId, 1)} &rarr;
        </Link>
      </header>

      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-1">
          <Label htmlFor="income">Income this month ({base})</Label>
          <Input
            id="income"
            type="number"
            step="0.01"
            className="font-money w-40"
            value={view.income}
            onChange={(event) =>
              mutate((draft) =>
                setIncome(draft, monthId, {
                  amount: Number(event.target.value) || 0,
                  currency: base,
                }),
              )
            }
          />
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-muted-foreground">Allocated</dt>
            <dd className="font-money">{formatMoney(view.totalAllocation, base)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Spent</dt>
            <dd className="font-money">{formatMoney(view.totalCharges, base)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Unallocated</dt>
            <dd
              className={`font-money ${view.unallocated < 0 ? "text-overspend" : ""}`}
              title={
                view.unallocated < 0
                  ? "Allocations exceed this month's income. This is allowed."
                  : undefined
              }
            >
              {formatSignedMoney(view.unallocated, base)}
            </dd>
          </div>
        </dl>
      </div>

      <PostTable monthId={monthId} baseCurrency={base} rows={view.rows} />
    </section>
  );
}
