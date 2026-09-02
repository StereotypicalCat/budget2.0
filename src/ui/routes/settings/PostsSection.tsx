import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useDataset } from "../../hooks/useDataset.ts";
import { useMutate } from "../../hooks/useMutate.ts";
import { addPost, movePost, setPostArchived, updatePost } from "../../../store/actions.ts";
import type { Currency, Post } from "../../../domain/types.ts";
import { ruleAt } from "../../../domain/allocation.ts";
import { currentMonth } from "../../../store/index.ts";
import { RuleHistory } from "../../components/RuleHistory.tsx";
import { Section } from "../../components/Section.tsx";

export function PostsSection() {
  const dataset = useDataset();
  const { mutate } = useMutate();
  const [newName, setNewName] = useState("");
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const ordered = [...dataset.posts].sort((a, b) => a.order - b.order);
  const base = dataset.settings.baseCurrency;

  function ruleSummary(post: Post) {
    const effective = ruleAt(post, currentMonth);
    if (!effective) {
      return <span className="text-xs text-muted-foreground">not budgeted</span>;
    }
    const { rule } = effective;
    return (
      <span className="text-xs">
        {rule.kind === "fixed"
          ? `${rule.amount.amount} ${rule.amount.currency}`
          : `${rule.percent}% of income`}
        <span className="ml-1 text-muted-foreground">from {effective.from}</span>
      </span>
    );
  }

  return (
    <Section
      title="Posts"
      hint="A post's allocation is a dated series: each rule applies from its own month onward until the next one takes over, so changing it never rewrites what earlier months got. Click a rule to see and edit that history. A single month can still override its own allocation from the month view, and percentages may total more than 100%."
    >
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b border-budget-rule text-[0.6875rem] uppercase tracking-wider text-budget-ink-muted">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Display currency</th>
            <th className="py-2 font-medium">Rule</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {ordered.map((post, index) => (
            <Fragment key={post.id}>
              <tr className={`border-b last:border-0 ${post.archived ? "opacity-50" : ""}`}>
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
                  <NativeSelect
                    className="h-8 w-auto text-xs md:text-xs"
                    aria-label={`Display currency for ${post.name}`}
                    value={post.currency}
                    onChange={(event) => {
                      const currency = event.target.value as Currency;
                      mutate((draft) => updatePost(draft, post.id, { currency }));
                    }}
                  >
                    {dataset.currencies.map(({ code: currency }) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="py-2">
                  {/* Was a bare button: 20px tall, no padding, and the only
                      way into a post's rule history. `size="xs"` gives it a
                      24px hit box and the row's own hover wash, and the
                      negative margin keeps the text aligned with the column
                      heading above it. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="-mx-2 max-w-full font-normal underline decoration-dotted underline-offset-2"
                    aria-expanded={openHistory === post.id}
                    onClick={() =>
                      setOpenHistory((id) => (id === post.id ? null : post.id))
                    }
                  >
                    {ruleSummary(post)}
                  </Button>
                </td>
                <td className="py-2">
                  {/* Three inline-flex siblings with nothing between them: the
                      hover backgrounds touched, so the row read as one wide
                      slab rather than three actions. */}
                  <div className="flex items-center justify-end gap-1">
                    <Button size="xs" variant="ghost" disabled={index === 0}
                      onClick={() => mutate((draft) => movePost(draft, post.id, -1))}>
                      up
                    </Button>
                    <Button size="xs" variant="ghost" disabled={index === ordered.length - 1}
                      onClick={() => mutate((draft) => movePost(draft, post.id, 1))}>
                      down
                    </Button>
                    <Button size="xs" variant="ghost" className="-mr-2"
                      onClick={() => mutate((draft) => setPostArchived(draft, post.id, !post.archived))}>
                      {post.archived ? "restore" : "archive"}
                    </Button>
                  </div>
                </td>
              </tr>
              {openHistory === post.id && (
                <tr className="border-b last:border-0">
                  <td colSpan={4} className="pb-3">
                    <RuleHistory post={post} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-budget-ink-muted">
        Archiving hides a post from new purchases while keeping its history. Posts
        are never deleted, because purchases reference them.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-budget-rule pt-5">
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
            mutate((draft) => addPost(draft, newName.trim(), base));
            setNewName("");
          }}
        >
          Add post
        </Button>
      </div>
    </Section>
  );
}
