export const ODS_MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet";

export type Cell =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "empty" };

export function text(value: string): Cell {
  return { kind: "text", value };
}

export function num(value: number): Cell {
  return { kind: "number", value };
}

export function empty(): Cell {
  return { kind: "empty" };
}

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderCell(cell: Cell): string {
  switch (cell.kind) {
    case "empty":
      return "<table:table-cell/>";
    case "number":
      // office:value is what makes spreadsheets treat this as a number, so the
      // export can be summed and pivoted rather than just read.
      return `<table:table-cell office:value-type="float" office:value="${cell.value}"><text:p>${cell.value}</text:p></table:table-cell>`;
    case "text":
      return `<table:table-cell office:value-type="string"><text:p>${escapeXml(cell.value)}</text:p></table:table-cell>`;
  }
}

function renderRow(row: Cell[]): string {
  return `<table:table-row>${row.map(renderCell).join("")}</table:table-row>`;
}

function renderSheet(sheet: Sheet): string {
  return `<table:table table:name="${escapeXml(sheet.name)}">${sheet.rows
    .map(renderRow)
    .join("")}</table:table>`;
}

const CONTENT_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'office:version="1.3"',
].join(" ");

export function buildContentXml(sheets: Sheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${CONTENT_NS}><office:body><office:spreadsheet>${sheets
    .map(renderSheet)
    .join("")}</office:spreadsheet></office:body></office:document-content>`;
}

export function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:styles/></office:document-styles>`;
}

export function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODS_MIMETYPE}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
}
