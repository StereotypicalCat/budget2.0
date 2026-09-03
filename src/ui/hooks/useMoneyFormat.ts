import { useMemo } from "react";
import { useDataset } from "./useDataset.ts";
import {
  formatAmount,
  formatMoney,
  formatSignedAmount,
  formatSignedMoney,
} from "../format.ts";
import type { Currency } from "../../domain/types.ts";

/**
 * The four money formatters, bound to the dataset's decimals setting.
 *
 * A hook rather than digits threaded through props: display is needed at every
 * depth — a table cell, a hint under an input, a stat tile — and `settings.digits`
 * is one value for the whole dataset, so a component deep in a tree asking for
 * it directly is honest rather than a shortcut. The underlying functions in
 * `../format.ts` still take digits explicitly, which is what keeps them
 * testable without a React tree.
 */
export function useMoneyFormat() {
  const digits = useDataset().settings.digits;
  return useMemo(
    () => ({
      digits,
      amount: (amount: number) => formatAmount(amount, digits),
      money: (amount: number, currency: Currency) => formatMoney(amount, currency, digits),
      signedAmount: (amount: number) => formatSignedAmount(amount, digits),
      signedMoney: (amount: number, currency: Currency) =>
        formatSignedMoney(amount, currency, digits),
    }),
    [digits],
  );
}

/** What `useMoneyFormat` returns, for a component that takes it as a prop. */
export type MoneyFormat = ReturnType<typeof useMoneyFormat>;
