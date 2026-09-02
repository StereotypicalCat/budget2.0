import { zipSync, strToU8 } from "fflate";
import { chargesForPurchaseInMonth, sliceAmountForMonth } from "../domain/charges.ts";
import { monthRange } from "../domain/months.ts";
import { roundMoney } from "../domain/money.ts";
import { datasetMonthSpan, monthView, summaryView } from "../domain/views.ts";
import type { MonthViewModel } from "../domain/views.ts";
import type { PostMonthFigures } from "../domain/fold.ts";
import type { Dataset, MonthId } from "../domain/types.ts";
import {
  buildContentXml,
  buildManifestXml,
  buildStylesXml,
  num,
  text,
  ODS_MIMETYPE,
  type Sheet,
} from "./odsXml.ts";

export function odsFilename(monthId: MonthId): string {
  return `budget-${monthId}.ods`;
}

function summarySheet(dataset: Dataset, months: MonthId[], byMonth: FiguresByMonth): Sheet {
  const base = dataset.settings.baseCurrency;
  const rows = [
    [text(`Post (${base})`), ...months.map((m) => text(m)), text("Total")],
  ];

  for (const post of [...dataset.posts].sort((a, b) => a.order - b.order)) {
    const perMonth = months.map((m) => byMonth.get(m)?.get(post.id)?.charges ?? 0);
    rows.push([
      text(post.name),
      ...perMonth.map(num),
      num(roundMoney(perMonth.reduce((a, b) => a + b, 0), base)),
    ]);
  }

  const summary = summaryView(dataset, months[0]!, months[months.length - 1]!);
  rows.push([
    text("Total"),
    ...summary.byMonth.map((m) => num(m.charges)),
    num(summary.totalCharges),
  ]);
  return { name: "Summary", rows };
}

function monthsSheet(months: MonthId[], views: Map<MonthId, MonthViewModel>): Sheet {
  const rows = [
    [text("Month"), text("Income"), text("Allocated"), text("Spent"), text("Unallocated")],
  ];
  for (const monthId of months) {
    const view = views.get(monthId)!;
    rows.push([
      text(monthId),
      num(view.income),
      num(view.totalAllocation),
      num(view.totalCharges),
      num(view.unallocated),
    ]);
  }
  return { name: "Months", rows };
}

/** One row per split-slice, so the sheet pivots cleanly. */
function purchasesSheet(dataset: Dataset, months: MonthId[]): Sheet {
  const base = dataset.settings.baseCurrency;
  const postName = new Map(dataset.posts.map((p) => [p.id, p.name]));
  const rows = [
    [
      text("Month"),
      text("Date"),
      text("Description"),
      text("Post"),
      text(`Amount (${base})`),
      text("Original amount"),
      text("Original currency"),
      text("Financed"),
    ],
  ];

  for (const monthId of months) {
    for (const purchase of dataset.purchases) {
      const slice = sliceAmountForMonth(purchase, monthId);
      if (!slice) continue;
      const charges = chargesForPurchaseInMonth(purchase, monthId, base, dataset.fxRates);
      for (const charge of charges) {
        rows.push([
          text(monthId),
          text(purchase.date),
          text(purchase.description),
          text(postName.get(charge.postId) ?? charge.postId),
          num(charge.amount),
          num(slice.amount),
          text(slice.currency),
          text(purchase.schedule ? "yes" : "no"),
        ]);
      }
    }
  }
  return { name: "Purchases", rows };
}

function postSheet(
  postId: string,
  name: string,
  months: MonthId[],
  byMonth: FiguresByMonth,
): Sheet {
  const rows = [
    [text("Month"), text("Carried in"), text("Allocated"), text("Spent"), text("Remaining")],
  ];
  for (const monthId of months) {
    const figures = byMonth.get(monthId)?.get(postId);
    rows.push([
      text(monthId),
      num(figures?.carriedIn ?? 0),
      num(figures?.allocation ?? 0),
      num(figures?.charges ?? 0),
      num(figures?.remaining ?? 0),
    ]);
  }
  return { name, rows };
}

/** Every post's figures for one month, keyed by post id. */
type FiguresByMonth = Map<MonthId, Map<string, PostMonthFigures>>;

export function buildWorkbook(dataset: Dataset): Sheet[] {
  const { from, to } = datasetMonthSpan(dataset);
  const months = monthRange(from, to);

  // monthView folds from the start of the dataset, so it is O(months) each
  // time. Calling it once per (post, month) — as the summary and per-post
  // sheets each used to — made a full export O(posts x months^2). One pass
  // here, indexed by post, leaves the whole workbook O(months^2) with the
  // sheets doing map lookups. Output is unchanged.
  const views = new Map(months.map((m) => [m, monthView(dataset, m)]));
  const byMonth: FiguresByMonth = new Map(
    months.map((m) => [m, new Map(views.get(m)!.rows.map((r) => [r.post.id, r.figures]))]),
  );

  return [
    summarySheet(dataset, months, byMonth),
    monthsSheet(months, views),
    purchasesSheet(dataset, months),
    ...[...dataset.posts]
      .sort((a, b) => a.order - b.order)
      .map((post) => postSheet(post.id, post.name, months, byMonth)),
  ];
}

export function buildOds(dataset: Dataset): Uint8Array {
  // Insertion order matters: `mimetype` must be the first entry and stored
  // uncompressed (level 0) so the archive can be type-sniffed.
  return zipSync(
    {
      mimetype: [strToU8(ODS_MIMETYPE), { level: 0 }],
      "META-INF/manifest.xml": strToU8(buildManifestXml()),
      "content.xml": strToU8(buildContentXml(buildWorkbook(dataset))),
      "styles.xml": strToU8(buildStylesXml()),
    },
    { level: 6 },
  );
}
