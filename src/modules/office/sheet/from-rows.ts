import { buildWorkbook } from "./builders";
import type { Workbook } from "./model";
import type { CellValue } from "./model";

/**
 * Build a professionally styled single-sheet workbook from a header row and
 * data rows. Used by workflow actions, e-discovery exports and imports that
 * produce tabular data without going through the grid.
 */
export function workbookFromTable(sheetName: string, header: string[], rows: unknown[][], opts: { totalRow?: boolean; style?: "professional" | "plain" } = {}): Workbook {
  const name = (sheetName || "Sheet1").slice(0, 31);
  const toCell = (v: unknown): CellValue => {
    if (v == null) return null;
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") { const t = v.trim(); if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return Number(t); return v; }
    return JSON.stringify(v);
  };
  const data = rows.map((r) => header.map((_, i) => toCell(r[i])));
  const colWidths: Record<string, number> = {};
  header.forEach((h, i) => {
    const longest = Math.max(h.length, ...data.slice(0, 200).map((r) => String(r[i] ?? "").length));
    colWidths[colLetter(i)] = Math.min(420, Math.max(90, longest * 7 + 24));
  });
  return buildWorkbook([{ name, ops: [{ type: "build_table", anchor: "A1", headers: header, rows: data, style: opts.style ?? "professional", total_row: opts.totalRow ?? false }], colWidths, freeze: { rows: 1, cols: 0 } }]);
}

function colLetter(i: number) {
  let s = "";
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
