import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutate } from "../hooks/useMutate.ts";
import { removeRuleFrom, setRuleFrom } from "../../store/actions.ts";
import { currentMonth } from "../../store/index.ts";
import type { Post, Rule } from "../../domain/types.ts";

interface Props {
  post: Post;
}

/**
 * Shape AND range, matching the import validator. `setRuleFrom` sorts the
 * series with `compareMonths`, which THROWS on a malformed MonthId; useMutate
 * would catch it and show an error, but a disabled button is the better
 * answer, and AGENTS.md requires guarding a throwing domain call at the site
 * that invokes it from a handler.
 */
const MONTH_ID = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * A post's allocation over time. Each row is "from this month, this rule",
 * effective until the next row takes over. Adding a row for a month that
 * already has one replaces it — `setRuleFrom` enforces that, and the form says
 * so rather than letting it look like an append.
 */
export function RuleHistory({ post }: Props) {
  const { mutate } = useMutate();
  const [from, setFrom] = useState<string>(currentMonth);
  const [kind, setKind] = useState<Rule["kind"]>("percentOfIncome");
  // Held as text, not a number, so the field can be cleared and can hold a
  // half-typed "12." mid-entry. Parsed once, on submit.
  const [value, setValue] = useState<string>("");

  const replaces = post.rules.some((v) => v.from === from);
  const monthOk = MONTH_ID.test(from);
  const amount = Number(value);
  const valueOk = value.trim() !== "" && Number.isFinite(amount);

  function add() {
    const rule: Rule =
      kind === "fixed"
        ? { kind: "fixed", amount: { amount, currency: post.currency } }
        : { kind: "percentOfIncome", percent: amount };
    mutate((draft) => setRuleFrom(draft, post.id, from, rule));
  }

  return (
    <div className="space-y-2 rounded border p-3">
      {post.rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Not budgeted. Until a rule starts, this post is allocated nothing —
          spending still records, and shows as overspend.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">From</th>
              <th className="py-1">Rule</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {post.rules.map((version) => (
              <tr key={version.from} className="border-t">
                <td className="py-1 font-money">{version.from}</td>
                <td className="py-1">
                  {version.rule.kind === "fixed"
                    ? `${version.rule.amount.amount} ${version.rule.amount.currency}`
                    : `${version.rule.percent}% of income`}
                </td>
                <td className="py-1 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      mutate((draft) => removeRuleFrom(draft, post.id, version.from))
                    }
                  >
                    remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="font-money h-8 w-28"
          placeholder="YYYY-MM"
          aria-label="Rule starts from month"
          value={from}
          onChange={(event) => {
            const next = event.target.value;
            setFrom(next);
          }}
        />
        <select
          className="h-8 rounded border bg-background px-1 text-xs"
          aria-label="Rule kind"
          value={kind}
          onChange={(event) => {
            const next = event.target.value as Rule["kind"];
            setKind(next);
          }}
        >
          <option value="percentOfIncome">% of income</option>
          <option value="fixed">fixed amount</option>
        </select>
        <Input
          className="font-money h-8 w-24"
          type="number"
          step="0.01"
          aria-label={kind === "fixed" ? `Amount in ${post.currency}` : "Percent of income"}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
          }}
        />
        <Button size="sm" variant="outline" disabled={!monthOk || !valueOk} onClick={add}>
          {replaces ? "Replace" : "Add"}
        </Button>
        {!monthOk && from.trim() !== "" && (
          <span className="text-xs text-muted-foreground">
            Needs a month as YYYY-MM, 01 to 12.
          </span>
        )}
        {monthOk && replaces && (
          <span className="text-xs text-muted-foreground">
            {from} already has a rule; this replaces it.
          </span>
        )}
      </div>
    </div>
  );
}
