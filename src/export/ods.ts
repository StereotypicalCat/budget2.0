import { zipSync, strToU8 } from "fflate";
import { chargesForPurchaseInMonth, sliceAmountForMonth } from "../domain/charges.ts";
import { monthRange } from "../domain/months.ts";
import { roundMoney } from "../domain/money.ts";
import { datasetMonthSpan, monthView, summaryView } from "../domain/views.ts";
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

function summarySheet(dataset: Dataset, months: MonthId[]): Sheet {
  const base = dataset.settings.baseCurrency;
  const rows = [
    [text(`Post (${base})`), ...months.map((m) => text(m)), text("Total")],
  ];

  for (const post of [...dataset.posts].sort((a, b) => a.order - b.order)) {
    const perMonth = months.map(
      (m) => monthView(dataset, m).rows.find((r) => r.post.id === post.id)?.figures.charges ?? 0,
    );
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

function monthsSheet(dataset: Dataset, months: MonthId[]): Sheet {
  const rows = [
    [text("Month"), text("Income"), text("Allocated"), text("Spent"), text("Unallocated")],
  ];
  for (const monthId of months) {
    const view = monthView(dataset, monthId);
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

function postSheet(dataset: Dataset, postId: string, name: string, months: MonthId[]): Sheet {
  const rows = [
    [text("Month"), text("Carried in"), text("Allocated"), text("Spent"), text("Remaining")],
  ];
  for (const monthId of months) {
    const figures = monthView(dataset, monthId).rows.find((r) => r.post.id === postId)?.figures;
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

export function buildWorkbook(dataset: Dataset): Sheet[] {
  const { from, to } = datasetMonthSpan(dataset);
  const months = monthRange(from, to);

  return [
    summarySheet(dataset, months),
    monthsSheet(dataset, months),
    purchasesSheet(dataset, months),
    ...[...dataset.posts]
      .sort((a, b) => a.order - b.order)
      .map((post) => postSheet(dataset, post.id, post.name, months)),
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
