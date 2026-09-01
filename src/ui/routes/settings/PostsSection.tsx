import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import { addPost, movePost, setPostArchived, updatePost } from "../../../store/actions.ts";
import { CURRENCIES, type Currency, type Rule } from "../../../domain/types.ts";

export function PostsSection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const [newName, setNewName] = useState("");
  const ordered = [...dataset.posts].sort((a, b) => a.order - b.order);
  const base = dataset.settings.baseCurrency;

  function ruleEditor(postId: string, rule: Rule) {
    return (
      <div className="flex items-center gap-2">
        <select
          className="h-8 rounded border bg-background px-1 text-xs"
          value={rule.kind}
          onChange={(event) => {
            const kind = event.target.value;
            mutate((draft) =>
              updatePost(draft, postId, {
                standingRule:
                  kind === "fixed"
                    ? { kind: "fixed", amount: { amount: 0, currency: base } }
                    : { kind: "percentOfIncome", percent: 0 },
              }),
            );
          }}
        >
          <option value="fixed">fixed amount</option>
          <option value="percentOfIncome">% of income</option>
        </select>
        <Input
          type="number"
          step="0.01"
          className="font-money h-8 w-28"
          value={rule.kind === "fixed" ? rule.amount.amount : rule.percent}
          onChange={(event) => {
            const value = Number(event.target.value) || 0;
            mutate((draft) =>
              updatePost(draft, postId, {
                standingRule:
                  rule.kind === "fixed"
                    ? { kind: "fixed", amount: { ...rule.amount, amount: value } }
                    : { kind: "percentOfIncome", percent: value },
              }),
            );
          }}
        />
        <span className="w-10 text-xs text-muted-foreground">
          {rule.kind === "fixed" ? rule.amount.currency : "%"}
        </span>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Posts</h2>
      <p className="text-xs text-muted-foreground">
        Standing rules apply to every month automatically. Any single month can
        override its own allocation from the month view. Percentages may total
        more than 100%.
      </p>

      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2">Name</th>
            <th className="py-2">Display currency</th>
            <th className="py-2">Standing rule</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {ordered.map((post, index) => (
            <tr key={post.id} className={`border-b last:border-0 ${post.archived ? "opacity-50" : ""}`}>
              <td className="py-2">
                <Input
                  className="h-8 w-48"
                  value={post.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    mutate((draft) => updatePost(draft, post.id, { name }));
                  }}
                />
              </td>
              <td className="py-2">
                <select
                  className="h-8 rounded border bg-background px-1 text-xs"
                  value={post.currency}
                  onChange={(event) => {
                    const currency = event.target.value as Currency;
                    mutate((draft) => updatePost(draft, post.id, { currency }));
                  }}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2">{ruleEditor(post.id, post.standingRule)}</td>
              <td className="py-2 text-right">
                <Button size="sm" variant="ghost" disabled={index === 0}
                  onClick={() => mutate((draft) => movePost(draft, post.id, -1))}>
                  up
                </Button>
                <Button size="sm" variant="ghost" disabled={index === ordered.length - 1}
                  onClick={() => mutate((draft) => movePost(draft, post.id, 1))}>
                  down
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => mutate((draft) => setPostArchived(draft, post.id, !post.archived))}>
                  {post.archived ? "restore" : "archive"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Archiving hides a post from new purchases while keeping its history. Posts
        are never deleted, because purchases reference them.
      </p>

      <div className="flex items-end gap-2">
        <Input
          className="w-48"
          placeholder="New post name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={newName.trim() === ""}
          onClick={() => {
            mutate((draft) =>
              addPost(draft, newName.trim(), base, {
                kind: "fixed",
                amount: { amount: 0, currency: base },
              }),
            );
            setNewName("");
          }}
        >
          Add post
        </Button>
      </div>
    </section>
  );
}
