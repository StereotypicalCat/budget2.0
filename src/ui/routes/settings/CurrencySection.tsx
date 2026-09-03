import { useState } from "react";
import { Section } from "../../components/Section.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import {
  addCurrency,
  removeCurrency,
  setBaseCurrency,
  setDigits,
  setFxRate,
  removeFxRate,
  updateCurrency,
} from "../../../store/actions.ts";
import { DEFAULT_FX_API_URL, fetchFxRates } from "../../../store/fxApi.ts";
import { currencyUsage } from "../../../domain/currencies.ts";
import type { Currency } from "../../../domain/types.ts";

export function CurrencySection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const base = dataset.settings.baseCurrency;
  const apiUrl = dataset.settings.fxApiUrl ?? DEFAULT_FX_API_URL;
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targets = dataset.currencies.map((c) => c.code).filter((c) => c !== base);

  async function refresh() {
    setStatus("Fetching…");
    try {
      const rates = await fetchFxRates(apiUrl, base, targets);
      mutate((draft) => {
        for (const rate of rates) setFxRate(draft, rate);
      });
      const missing = targets.filter((t) => !rates.some((r) => r.currency === t));
      setStatus(
        `Updated ${rates.length} rate(s).` +
          (missing.length > 0
            ? ` The service returned nothing for ${missing.join(", ")} — type those in by hand.`
            : ""),
      );
    } catch (cause) {
      // Fails soft: the cached rates are still in place, never cleared.
      setStatus(
        `Could not fetch rates (${
          cause instanceof Error ? cause.message : String(cause)
        }). Your saved rates are unchanged.`,
      );
    }
  }

  /** Currency edits throw on bad input, and a throw from a handler is invisible. */
  function tryEdit(change: () => void) {
    try {
      setError(null);
      change();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Section
      title="Currencies"
      hint="Add any currency you spend in. The code is how it is identified, so it cannot be changed later — and everything is converted to the base currency for totals."
    >
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="space-y-1.5">
          <Label
            htmlFor="base-currency"
            className="text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted"
          >
            Base currency (all totals use this)
          </Label>
          <NativeSelect
            id="base-currency"
            className="w-40"
            value={base}
            onChange={(event) => {
              const currency = event.target.value;
              mutate((draft) => setBaseCurrency(draft, currency));
            }}
          >
            {dataset.currencies.map(({ code }) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="digits"
            className="text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted"
          >
            Decimals (all amounts)
          </Label>
          <Input
            id="digits"
            type="number"
            min="0"
            max="4"
            step="1"
            className="font-money h-9 w-20"
            value={dataset.settings.digits}
            onChange={(event) => {
              // Captured before mutate, which defers behind the write queue —
              // React resets the DOM value first, so reading it inside the
              // callback commits the OLD one. AGENTS.md §2.
              const digits = Number(event.target.value);
              // Guarded here rather than letting setDigits throw: this is an
              // event handler, and no error boundary catches a throw from one.
              if (!Number.isInteger(digits) || digits < 0 || digits > 4) return;
              mutate((draft) => setDigits(draft, digits));
            }}
          />
        </div>
      </div>

      <p className="mb-5 max-w-[70ch] text-xs leading-relaxed text-budget-ink-muted">
        Every currency rounds to this. Changing it does not rewrite amounts you
        have already recorded — they keep the precision they were entered with,
        and totals recompute at the new setting.
      </p>

      {/* `-mr-2 pr-2`, not a bare `overflow-x-auto`: the row's remove button
          carries `-mr-2` so its label sits flush with the card's content edge
          rather than 8px inside it. That overhang is 8px of overflow to a
          scroll container, and since the table is `w-full` it scaled with the
          column — so the horizontal scrollbar appeared at every width and no
          amount of widening removed it. Bleeding the scroll box 8px right and
          padding it back puts the overhang inside the padding box: same table
          width, same button position, no scrollbar. */}
      <div className="-mr-2 overflow-x-auto pr-2">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="text-left">
            <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
              <th className="py-2 font-medium">Code</th>
              <th className="py-2 pl-4 font-medium">Name</th>
              <th className="py-2 pl-4 font-medium">Symbol</th>
              <th className="py-2 pl-4 text-right font-medium">1 unit = ? {base}</th>
              <th className="py-2 pl-4 text-right font-medium">Source</th>
              <th className="py-2 pl-4" />
            </tr>
          </thead>
          <tbody>
            {dataset.currencies.map((currency) => {
              const isBase = currency.code === base;
              const rate = dataset.fxRates.find((r) => r.currency === currency.code);
              const used = currencyUsage(dataset, currency.code);
              return (
                <tr
                  key={currency.code}
                  className="group border-b border-budget-rule transition-colors last:border-0 hover:bg-accent/60"
                >
                  <td className="font-money py-2 font-medium">{currency.code}</td>
                  <td className="py-2 pl-4">
                    <Input
                      className="h-8 w-40"
                      aria-label={`Name for ${currency.code}`}
                      value={currency.name ?? ""}
                      onChange={(event) => {
                        const name = event.target.value;
                        mutate((draft) => updateCurrency(draft, currency.code, { name }));
                      }}
                    />
                  </td>
                  <td className="py-2 pl-4">
                    <Input
                      className="font-money h-8 w-16"
                      aria-label={`Symbol for ${currency.code}`}
                      value={currency.symbol ?? ""}
                      onChange={(event) => {
                        const symbol = event.target.value;
                        mutate((draft) => updateCurrency(draft, currency.code, { symbol }));
                      }}
                    />
                  </td>
                  <td className="py-2 pl-4 text-right">
                    {isBase ? (
                      <span className="font-money text-budget-ink-muted">1</span>
                    ) : (
                      <Input
                        type="number"
                        step="0.000001"
                        className="font-money ml-auto h-8 w-32 text-right"
                        aria-label={`Rate for ${currency.code}`}
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
                                currency: currency.code,
                                baseUnitsPerOne: parsed,
                                updatedAt: new Date().toISOString(),
                                source: "manual",
                              });
                            } else {
                              removeFxRate(draft, currency.code);
                            }
                          });
                        }}
                      />
                    )}
                  </td>
                  <td className="py-2 pl-4 text-right text-xs text-budget-ink-muted">
                    {isBase ? "—" : rate ? `${rate.source} · ${rate.updatedAt.slice(0, 10)}` : "not set"}
                  </td>
                  <td className="py-2 pl-4 text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="-mr-2 text-overspend hover:text-overspend disabled:opacity-40"
                      disabled={used.length > 0}
                      title={
                        used.length > 0
                          ? `In use by ${used.slice(0, 3).join(", ")}${used.length > 3 ? ` and ${used.length - 3} more` : ""}`
                          : `Remove ${currency.code}`
                      }
                      onClick={() =>
                        tryEdit(() => mutate((draft) => removeCurrency(draft, currency.code)))
                      }
                    >
                      remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AddCurrency onAdd={(def) => tryEdit(() => mutate((draft) => addCurrency(draft, def)))} />

      <div className="mt-6 border-t border-budget-rule pt-5">
        <div className="space-y-1.5">
          <Label
            htmlFor="fx-url"
            className="text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted"
          >
            Rate service URL
          </Label>
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
          <p className="max-w-[70ch] text-xs leading-relaxed text-budget-ink-muted">
            {"{base}"} and {"{targets}"} are substituted. Fetching is optional — the app
            works offline with the rates you type in above, and a currency the service
            does not know can always be maintained by hand.
          </p>
        </div>
        <Button variant="outline" className="mt-4" onClick={() => void refresh()}>
          Fetch rates now
        </Button>
        {status && (
          <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-budget-ink-muted">
            {status}
          </p>
        )}
      </div>
    </Section>
  );
}

/**
 * No decimals field: they are one setting for the whole dataset now, edited
 * above the table rather than per currency.
 */
function AddCurrency({ onAdd }: { onAdd: (def: { code: Currency; symbol?: string; name?: string }) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  const canAdd = /^[A-Za-z]{2,8}$/.test(code.trim());

  function add() {
    onAdd({ code: code.trim(), symbol, name });
    setCode("");
    setName("");
    setSymbol("");
  }

  return (
    <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-budget-rule pt-5">
      <Input
        className="font-money h-9 w-24 uppercase"
        placeholder="JPY"
        aria-label="New currency code"
        value={code}
        onChange={(event) => {
          const next = event.target.value;
          setCode(next);
        }}
      />
      <Input
        className="h-9 w-44"
        placeholder="Japanese yen"
        aria-label="New currency name"
        value={name}
        onChange={(event) => {
          const next = event.target.value;
          setName(next);
        }}
      />
      <Input
        className="font-money h-9 w-16"
        placeholder="¥"
        aria-label="New currency symbol"
        value={symbol}
        onChange={(event) => {
          const next = event.target.value;
          setSymbol(next);
        }}
      />
      <Button variant="outline" disabled={!canAdd} onClick={add}>
        Add currency
      </Button>
    </div>
  );
}
