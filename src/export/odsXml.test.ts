import { test, expect, describe } from "bun:test";
import {
  buildContentXml,
  buildManifestXml,
  buildStylesXml,
  escapeXml,
  text,
  num,
  empty,
  ODS_MIMETYPE,
} from "./odsXml.ts";

test("the ODS mimetype is the spreadsheet one", () => {
  expect(ODS_MIMETYPE).toBe("application/vnd.oasis.opendocument.spreadsheet");
});

describe("escapeXml", () => {
  test("escapes the five XML entities", () => {
    expect(escapeXml(`<a & b> "c" 'd'`)).toBe(
      "&lt;a &amp; b&gt; &quot;c&quot; &apos;d&apos;",
    );
  });

  test("leaves ordinary text alone", () => {
    expect(escapeXml("Events and Social")).toBe("Events and Social");
  });
});

describe("buildContentXml", () => {
  const xml = buildContentXml([
    {
      name: "Summary",
      rows: [
        [text("Post"), text("Spent")],
        [text("Food"), num(1234.56)],
        [text("Empty"), empty()],
      ],
    },
  ]);

  test("declares the spreadsheet document namespaces", () => {
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("office:document-content");
    expect(xml).toContain("urn:oasis:names:tc:opendocument:xmlns:office:1.0");
  });

  test("names the table", () => {
    expect(xml).toContain('table:name="Summary"');
  });

  test("writes numbers as float cells with office:value, not text", () => {
    expect(xml).toContain('office:value-type="float" office:value="1234.56"');
    expect(xml).not.toContain('office:value-type="string"><text:p>1234.56');
  });

  test("writes text cells as strings", () => {
    expect(xml).toContain('office:value-type="string"><text:p>Food</text:p>');
  });

  test("writes empty cells with no value type", () => {
    expect(xml).toContain("<table:table-cell/>");
  });

  test("escapes sheet names and cell text", () => {
    const nasty = buildContentXml([
      { name: 'Food & "drink"', rows: [[text("<script>")]] },
    ]);
    expect(nasty).toContain('table:name="Food &amp; &quot;drink&quot;"');
    expect(nasty).toContain("&lt;script&gt;");
  });

  test("emits one table per sheet", () => {
    const two = buildContentXml([
      { name: "A", rows: [[text("x")]] },
      { name: "B", rows: [[text("y")]] },
    ]);
    expect(two.match(/<table:table /g)).toHaveLength(2);
  });

  test("handles a sheet with no rows", () => {
    expect(buildContentXml([{ name: "Blank", rows: [] }])).toContain('table:name="Blank"');
  });
});

test("buildManifestXml lists all four parts", () => {
  const manifest = buildManifestXml();
  for (const path of ["/", "content.xml", "styles.xml"]) {
    expect(manifest).toContain(path);
  }
  expect(manifest).toContain(ODS_MIMETYPE);
});

test("buildStylesXml is a well-formed styles document", () => {
  expect(buildStylesXml()).toContain("office:document-styles");
});
