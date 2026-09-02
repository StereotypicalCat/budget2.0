import { useState } from "react";
import { Link, useParams } from "react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useDataset } from "../hooks/useDataset.ts";
import { useMutate } from "../hooks/useMutate.ts";
import { monthView } from "../../domain/views.ts";
import { addMonths } from "../../domain/months.ts";
import { setIncome, deletePurchase, setRuleFrom } from "../../store/actions.ts";
import { ruleAt } from "../../domain/allocation.ts";
import type { MonthId, Post, Purchase, Rule } from "../../domain/types.ts";
import { sliceAmountForMonth } from "../../domain/charges.ts";
import { formatMoney, formatSignedMoney } from "../format.ts";
import { PostTable } from "../components/PostTable.tsx";
import { PurchaseDialog } from "../components/PurchaseDialog.tsx";
import { Section, Stat } from "../components/Section.tsx";
import { groupPurchasesByDate } from "../purchaseGroups.ts";

export function MonthRoute() {
  const { monthId = "" } = useParams();
  const dataset = useDataset();
  const { mutate, error, clearError } = useMutate();
  const view = monthView(dataset, monthId);
  const base = dataset.settings.baseCurrency;
  const [changingRuleFor, setChangingRuleFor] = useState<string | null>(null);
  const monthPurchases = dataset.purchases.filter(
    (purchase) => sliceAmountForMonth(purchase, monthId) !== null,
  );
  const groups = groupPurchasesByDate(monthPurchases, monthId);
  const changingPost = changingRuleFor
    ? (dataset.posts.find((p) => p.id === changingRuleFor) ?? null)
    : null;

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <span>Could not save: {error}</span>
          <button onClick={clearError} className="underline underline-offset-2">
            dismiss
          </button>
        </div>
      )}

      {/* The month is the app's primary coordinate, so it gets the largest
          type on the page and the two ways of moving sit either side of it. */}
      <header className="flex items-baseline gap-3">
        <MonthStep to={`/month/${addMonths(monthId, -1)}`} label={addMonths(monthId, -1)} back />
        <h1 className="text-2xl">{monthLabel(monthId)}</h1>
        <MonthStep to={`/month/${addMonths(monthId, 1)}`} label={addMonths(monthId, 1)} />
      </header>

      <Section>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="income" className="text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted">
              Income this month ({base})
            </Label>
            <Input
              id="income"
              type="number"
              step="0.01"
              className="font-money h-10 w-44 text-lg"
              value={view.income}
              onChange={(event) => {
                // Read the DOM value NOW: mutate() defers behind the write queue,
                // by which time React has reset this input to the committed value.
                const amount = Number(event.target.value) || 0;
                mutate((draft) => setIncome(draft, monthId, { amount, currency: base }));
              }}
            />
          </div>
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <Stat label="Allocated">{formatMoney(view.totalAllocation, base)}</Stat>
            <Stat label="Spent">{formatMoney(view.totalCharges, base)}</Stat>
            <Stat
              label="Unallocated"
              tone={view.unallocated < 0 ? "overspend" : "default"}
              title={
                view.unallocated < 0
                  ? "Allocations exceed this month's income. This is allowed."
                  : undefined
              }
            >
              {formatSignedMoney(view.unallocated, base)}
            </Stat>
          </dl>
        </div>
      </Section>

      <Section title="Posts" className="overflow-hidden">
      <PostTable
        monthId={monthId}
        baseCurrency={base}
        rows={view.rows}
        onChangeRule={setChangingRuleFor}
      />
      </Section>

      {changingPost && (
        <RuleFromMonth
          // Keyed so switching posts (or months) remounts the editor. Without
          // it React reuses the instance and useState keeps the PREVIOUS
          // post's kind and value, silently pre-filling the wrong rule.
          key={`${changingPost.id}:${monthId}`}
          post={changingPost}
          monthId={monthId}
          initial={ruleAt(changingPost, monthId)?.rule}
          onDone={() => setChangingRuleFor(null)}
        />
      )}

      <Section
        title="Purchases"
        action={<PurchaseDialog monthId={monthId} trigger={<Button>Add purchase</Button>} />}
      >
        {groups.length === 0 ? (
          <p className="py-1 text-sm text-budget-ink-muted">
            Nothing recorded for this month yet.
          </p>
        ) : (
          <div className="space-y-3.5">
            {groups.map((group) => (
              <div key={group.key}>
                <h3 className="mb-0.5 text-[0.6875rem] font-medium uppercase tracking-wider text-budget-ink-muted">
                  {group.label}
                </h3>
                <ul className="divide-y divide-budget-rule text-sm">
                  {group.purchases.map((purchase) => (
                    <PurchaseRow
                      key={purchase.id}
                      purchase={purchase}
                      monthId={monthId}
                      onDelete={() =>
                        mutate((data) => deletePurchase(data, purchase.id))
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function PurchaseRow({
  purchase,
  monthId,
  onDelete,
}: {
  purchase: Purchase;
  monthId: MonthId;
  onDelete: () => void;
}) {
  const slice = sliceAmountForMonth(purchase, monthId)!;
  return (
    <li className="group flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-accent/60">
      <span className="min-w-0 flex-1 truncate">
        {purchase.description}
        {purchase.note && (
          <span className="ml-2 text-xs text-budget-ink-muted">{purchase.note}</span>
        )}
      </span>
      {purchase.schedule && (
        <span className="shrink-0 rounded-full border border-budget-rule px-1.5 py-px text-[0.625rem] uppercase tracking-wide text-budget-ink-muted">
          financed
        </span>
      )}
      <span className="font-money shrink-0 tabular-nums">
        {formatMoney(slice.amount, slice.currency)}
      </span>
      {/* Held at a fixed width so revealing the actions on hover cannot shift
          the amounts, which are the column being read down. */}
      <span className="flex w-[7.5rem] shrink-0 justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <PurchaseDialog
          monthId={monthId}
          purchase={purchase}
          trigger={
            <Button size="sm" variant="ghost">
              edit
            </Button>
          }
        />
        <Button
          size="sm"
          variant="ghost"
          className="text-overspend hover:text-overspend"
          onClick={onDelete}
        >
          delete
        </Button>
      </span>
    </li>
  );
}

/** "2026-09" reads as a key; "September 2026" reads as a month. */
function monthLabel(monthId: MonthId): string {
  const [year, month] = monthId.split("-");
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const name = names[Number(month) - 1];
  return name ? `${name} ${year}` : monthId;
}

function MonthStep({ to, label, back = false }: { to: string; label: string; back?: boolean }) {
  return (
    <Link
      to={to}
      className="font-money rounded-md px-1.5 py-0.5 text-xs text-budget-ink-muted transition-colors hover:bg-accent hover:text-budget-ink"
    >
      {back ? `\u2190 ${label}` : `${label} \u2192`}
    </Link>
  );
}

/**
 * "15% from July" is a decision made while looking at July. This writes the
 * same `setRuleFrom` action the Settings history editor uses, so the two
 * surfaces cannot drift apart.
 */
function RuleFromMonth({
  post,
  monthId,
  initial,
  onDone,
}: {
  post: Post;
  monthId: MonthId;
  initial: Rule | undefined;
  onDone: () => void;
}) {
  const { mutate } = useMutate();
  // Pre-filled with what is currently in effect, so nudging 10% to 15% is an
  // edit rather than re-entry. Empty when the post has no rule yet. Held as
  // text so the field can be cleared mid-edit; parsed once, on apply.
  const [kind, setKind] = useState<Rule["kind"]>(initial?.kind ?? "percentOfIncome");
  const [value, setValue] = useState<string>(
    initial === undefined
      ? ""
      : String(initial.kind === "fixed" ? initial.amount.amount : initial.percent),
  );

  const amount = Number(value);
  const valueOk = value.trim() !== "" && Number.isFinite(amount);

  function apply() {
    const rule: Rule =
      kind === "fixed"
        ? { kind: "fixed", amount: { amount, currency: post.currency } }
        : { kind: "percentOfIncome", percent: amount };
    mutate((draft) => setRuleFrom(draft, post.id, monthId, rule));
    onDone();
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm">
      <span>
        {post.name}: allocate from <span className="font-money">{monthId}</span> onward
      </span>
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
      <Button size="sm" disabled={!valueOk} onClick={apply}>
        Apply
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}
