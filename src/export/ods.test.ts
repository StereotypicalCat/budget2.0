import { test, expect, describe } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { buildOds, buildWorkbook, odsFilename } from "./ods.ts";
import { createSeedDataset } from "../domain/seed.ts";
import { ODS_MIMETYPE } from "./odsXml.ts";
import type { Dataset } from "../domain/types.ts";

function populated(): Dataset {
  const data = createSeedDataset("2026-01");
  data.months[0]!.income = { amount: 20000, currency: "DKK" };
  data.posts[1]!.standingRule = { kind: "percentOfIncome", percent: 25 };
  data.purchases.push({
    id: "p1",
    date: "2026-01-15",
    description: "Dinner & drinks",
    total: { amount: 400, currency: "DKK" },
    splitMode: "percent",
    splits: [
      { postId: data.posts[1]!.id, value: 60, absorbsRemainder: true },
      { postId: data.posts[2]!.id, value: 40, absorbsRemainder: false },
    ],
    schedule: null,
  });
  return data;
}

describe("buildWorkbook", () => {
  test("includes Summary, Months, Purchases, and one sheet per post", () => {
    const names = buildWorkbook(populated()).map((s) => s.name);
    expect(names.slice(0, 3)).toEqual(["Summary", "Months", "Purchases"]);
    expect(names).toContain("Video Games");
    expect(names).toContain("Food");
    expect(names).toContain("Events and Social");
    expect(names).toHaveLength(6);
  });

  test("the Purchases sheet has one row per split, plus a header", () => {
    const purchases = buildWorkbook(populated()).find((s) => s.name === "Purchases")!;
    expect(purchases.rows).toHaveLength(3);
    expect(purchases.rows[0]!.every((c) => c.kind === "text")).toBe(true);
  });

  test("split amounts on the Purchases sheet are numeric cells", () => {
    const purchases = buildWorkbook(populated()).find((s) => s.name === "Purchases")!;
    const numbers = purchases.rows
      .slice(1)
      .flatMap((row) => row.filter((cell) => cell.kind === "number"))
      .map((cell) => (cell as { value: number }).value);
    // 400 DKK split 60/40 across two posts.
    expect(numbers).toContain(240);
    expect(numbers).toContain(160);
  });
});

describe("buildOds", () => {
  const bytes = buildOds(populated());
  const entries = unzipSync(bytes);

  test("produces a non-empty byte array", () => {
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test("contains the four required parts", () => {
    expect(Object.keys(entries).sort()).toEqual([
      "META-INF/manifest.xml",
      "content.xml",
      "mimetype",
      "styles.xml",
    ]);
  });

  test("the mimetype entry holds the spreadsheet mimetype", () => {
    expect(strFromU8(entries["mimetype"]!)).toBe(ODS_MIMETYPE);
  });

  test("mimetype is the first entry and stored uncompressed", () => {
    // The ODS spec requires this so file(1) and spreadsheet apps can sniff the
    // type from the first bytes of the archive. The zip local-file header for
    // "mimetype" is 38 bytes (30-byte fixed header + 8-byte filename), and
    // ODS_MIMETYPE is 46 characters, so 96 bytes comfortably covers both.
    const header = strFromU8(bytes.slice(0, 96));
    expect(header).toContain("mimetype");
    expect(header).toContain(ODS_MIMETYPE);
  });

  test("content.xml carries every sheet", () => {
    const content = strFromU8(entries["content.xml"]!);
    expect(content).toContain('table:name="Summary"');
    expect(content).toContain('table:name="Events and Social"');
  });

  test("escapes an ampersand in a purchase description", () => {
    const content = strFromU8(entries["content.xml"]!);
    expect(content).toContain("Dinner &amp; drinks");
  });

  test("exports a seed dataset with no purchases without throwing", () => {
    expect(() => buildOds(createSeedDataset("2026-01"))).not.toThrow();
  });
});

test("odsFilename is stable and sortable", () => {
  expect(odsFilename("2026-09")).toBe("budget-2026-09.ods");
});
