import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import { setBaseCurrency, setFxRate, removeFxRate } from "../../../store/actions.ts";
import { DEFAULT_FX_API_URL, fetchFxRates } from "../../../store/fxApi.ts";
import { CURRENCIES, type Currency } from "../../../domain/types.ts";

export function CurrencySection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const base = dataset.settings.baseCurrency;
  const apiUrl = dataset.settings.fxApiUrl ?? DEFAULT_FX_API_URL;
  const [status, setStatus] = useState<string | null>(null);
  const targets = CURRENCIES.filter((c) => c !== base);

  async function refresh() {
    setStatus("Fetching…");
    try {
      const rates = await fetchFxRates(apiUrl, base, targets);
      mutate((draft) => {
        for (const rate of rates) setFxRate(draft, rate);
      });
      setStatus(`Updated ${rates.length} rate(s).`);
    } catch (error) {
      // Fails soft: the cached rates are still in place, never cleared.
      setStatus(
        `Could not fetch rates (${
          error instanceof Error ? error.message : String(error)
        }). Your saved rates are unchanged.`,
      );
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Currency</h2>

      <div className="space-y-1">
        <Label htmlFor="base-currency">Base currency (all totals use this)</Label>
        <select
          id="base-currency"
          className="h-9 w-32 rounded border bg-background px-2 text-sm"
          value={base}
          onChange={(event) => {
            const currency = event.target.value as Currency;
            mutate((draft) => setBaseCurrency(draft, currency));
          }}
        >
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full max-w-md text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">Currency</th>
            <th className="py-2 text-right">1 unit = ? {base}</th>
            <th className="py-2 text-right">Source</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((currency) => {
            const rate = dataset.fxRates.find((r) => r.currency === currency);
            return (
              <tr key={currency} className="border-b last:border-0">
                <td className="py-2">{currency}</td>
                <td className="py-2 text-right">
                  <Input
                    type="number"
                    step="0.000001"
                    className="font-money ml-auto h-8 w-32"
                    value={rate?.baseUnitsPerOne ?? ""}
                    onChange={(event) => {
                      // A cleared or non-positive field MUST remove the rate
                      // row rather than store 0: toBase() converts a stored 0
                      // silently to a 0-value conversion, while an absent row
                      // correctly throws MissingRateError. Storing 0 here
                      // would turn a loud, correct error into wrong numbers
                      // presented as fact.
                      const parsed = Number(event.target.value);
                      mutate((draft) => {
                        if (Number.isFinite(parsed) && parsed > 0) {
                          setFxRate(draft, {
                            currency,
                            baseUnitsPerOne: parsed,
                            updatedAt: new Date().toISOString(),
                            source: "manual",
                          });
                        } else {
                          removeFxRate(draft, currency);
                        }
                      });
                    }}
                  />
                </td>
                <td className="py-2 text-right text-xs text-muted-foreground">
                  {rate ? `${rate.source} · ${rate.updatedAt.slice(0, 10)}` : "not set"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="fx-url">Rate service URL</Label>
          <Input
            id="fx-url"
            className="max-w-xl"
            value={apiUrl}
            onChange={(event) => {
              const url = event.target.value;
              mutate((draft) => {
                draft.settings.fxApiUrl = url;
              });
            }}
          />
          <p className="text-xs text-muted-foreground">
            {"{base}"} and {"{targets}"} are substituted. Fetching is optional — the app
            works offline with the rates you type in above.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Fetch rates now
        </Button>
        {status && <p className="text-xs">{status}</p>}
      </div>
    </section>
  );
}
