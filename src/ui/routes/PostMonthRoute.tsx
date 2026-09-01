import { Link, useParams } from "react-router";
import { useDataset } from "../hooks/useDataset.ts";
import { monthView } from "../../domain/views.ts";
import { chargesForPurchaseInMonth, sliceAmountForMonth } from "../../domain/charges.ts";
import { addMonths, compareMonths } from "../../domain/months.ts";
import { formatMoney, formatSignedMoney } from "../format.ts";

export function PostMonthRoute() {
  const { postId = "", monthId = "" } = useParams();
  const dataset = useDataset();
  const post = dataset.posts.find((p) => p.id === postId);
  if (!post) return <p>That post no longer exists.</p>;

  const base = dataset.settings.baseCurrency;
  const row = monthView(dataset, monthId).rows.find((r) => r.post.id === postId);

  const thisMonth = dataset.purchases.flatMap((purchase) => {
    const charges = chargesForPurchaseInMonth(purchase, monthId, base, dataset.fxRates);
    const mine = charges.find((c) => c.postId === postId);
    return mine ? [{ purchase, amount: mine.amount }] : [];
  });

  // Future finance-plan slices, for purchases split with this post, that have
  // not yet arrived at `monthId`. This is what surfaces a committed plan
  // before it lands. Strictly-after so the current month's slice stays in
  // "This month" rather than also appearing here. Also filtered through
  // sliceAmountForMonth so a cancelled plan's remaining slices (which the
  // fold will never actually charge) do not appear as future obligations —
  // reusing the domain's own cancelledFromMonth rule rather than
  // re-deriving it here.
  const committed = dataset.purchases.flatMap((purchase) => {
    if (!purchase.schedule) return [];
    if (!purchase.splits.some((s) => s.postId === postId)) return [];
    return purchase.schedule.slices
      .filter((slice) => compareMonths(slice.month, monthId) > 0)
      .filter((slice) => sliceAmountForMonth(purchase, slice.month) !== null)
      .map((slice) => ({ purchase, slice }));
  });

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-4">
        <Link to={`/post/${postId}/month/${addMonths(monthId, -1)}`} className="text-sm hover:underline">
          &larr;
        </Link>
        <h1 className="text-2xl font-semibold">
          {post.name} &middot; {monthId}
        </h1>
        <Link to={`/post/${postId}/month/${addMonths(monthId, 1)}`} className="text-sm hover:underline">
          &rarr;
        </Link>
        <Link to={`/post/${postId}/year/${monthId.slice(0, 4)}`} className="ml-auto text-sm hover:underline">
          year view
        </Link>
      </header>

      <dl className="flex gap-6 text-sm">
        <div>
          <dt className="text-muted-foreground">Carried in</dt>
          <dd
            className={`font-money ${
              (row?.figures.carriedIn ?? 0) > 0
                ? "text-surplus"
                : (row?.figures.carriedIn ?? 0) < 0
                  ? "text-overspend"
                  : ""
            }`}
          >
            {formatSignedMoney(row?.figures.carriedIn ?? 0, base)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Allocated</dt>
          <dd className="font-money">{formatMoney(row?.figures.allocation ?? 0, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Spent</dt>
          <dd className="font-money">{formatMoney(row?.figures.charges ?? 0, base)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Remaining</dt>
          <dd
            className={`font-money ${(row?.figures.remaining ?? 0) < 0 ? "text-overspend" : ""}`}
          >
            {formatSignedMoney(row?.figures.remaining ?? 0, base)}
          </dd>
        </div>
      </dl>

      <div>
        <h2 className="mb-2 text-lg font-medium">This month</h2>
        <ul className="divide-y text-sm">
          {thisMonth.map(({ purchase, amount }) => (
            <li key={purchase.id} className="flex gap-3 py-2">
              <span className="flex-1">{purchase.description}</span>
              {purchase.splits.length > 1 && (
                <span className="text-xs text-muted-foreground">split</span>
              )}
              <span className="font-money">{formatMoney(amount, base)}</span>
            </li>
          ))}
          {thisMonth.length === 0 && <li className="py-2 text-muted-foreground">Nothing yet.</li>}
        </ul>
      </div>

      {committed.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-medium">Already committed</h2>
          <ul className="divide-y text-sm text-muted-foreground">
            {committed.map(({ purchase, slice }) => (
              <li key={`${purchase.id}-${slice.month}`} className="flex gap-3 py-2">
                <span className="w-20">{slice.month}</span>
                <span className="flex-1">{purchase.description}</span>
                <span className="font-money">
                  {formatMoney(slice.amount.amount, slice.amount.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
