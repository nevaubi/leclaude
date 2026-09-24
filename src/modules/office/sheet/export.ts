/**
 * XLSX / CSV export with the `xlsx` package. Values, formulas, number formats,
 * column widths, row heights, merges and freeze panes are written; charts and
 * conditional formats are not (the community build of xlsx cannot write them).
 */
import * as XLSX from "xlsx";
import { colToLetter, letterToCol, parseA1, parseRange, toA1 } from "./a1";
import { computeWorkbook, type Computed } from "./engine";
import { isDateFormat, isoToSerial } from "./format";
import { getStyle, usedRange, type Sheet, type Workbook } from "./model";

function cellFor(wb: Workbook, sheet: Sheet, ref: string, computed: Computed): XLSX.CellObject | null {
  const cell = sheet.cells[ref];
  if (!cell) return null;
  const style = getStyle(wb, cell);
  const out: XLSX.CellObject = { t: "z" };
  if (cell.f) {
    out.f = cell.f.startsWith("=") ? cell.f.slice(1) : cell.f;
    const cv = computed[sheet.id]?.[ref]?.v;
    if (typeof cv === "number") { out.t = "n"; out.v = cv; }
    else if (typeof cv === "boolean") { out.t = "b"; out.v = cv; }
    else if (typeof cv === "string" && cv.startsWith("#")) { out.t = "e"; out.v = cv; }
    else if (cv !== null && cv !== undefined) { out.t = "s"; out.v = String(cv); }
    else { out.t = "n"; }
  } else if (cell.v === undefined || cell.v === null) {
    if (!cell.s) return null;
    out.t = "z";
  } else if (typeof cell.v === "number") { out.t = "n"; out.v = cell.v; }
  else if (typeof cell.v === "boolean") { out.t = "b"; out.v = cell.v; }
  else if (cell.t === "d" || (isDateFormat(style.numFmt) && /^\d{4}-\d{2}-\d{2}$/.test(cell.v))) {
    const serial = isoToSerial(cell.v);
    if (serial !== null) { out.t = "n"; out.v = serial; if (!style.numFmt) out.z = "yyyy-mm-dd"; }
    else { out.t = "s"; out.v = cell.v; }
  } else { out.t = "s"; out.v = cell.v; }
  if (style.numFmt && style.numFmt !== "General" && style.numFmt !== "text") out.z = style.numFmt;
  else if (style.numFmt === "text") out.z = "@";
  return out;
}

export function workbookToXlsx(wb: Workbook, opts: { computed?: Computed } = {}): XLSX.WorkBook {
  const computed = opts.computed ?? computeWorkbook(wb);
  const book = XLSX.utils.book_new();
  for (const sheet of wb.sheets) {
    const ws: XLSX.WorkSheet = {};
    const ur = usedRange(sheet);
    let maxRow = 0, maxCol = 0;
    for (const ref of Object.keys(sheet.cells)) {
      const c = cellFor(wb, sheet, ref, computed);
      if (!c) continue;
      ws[ref] = c;
      const p = parseA1(ref);
      maxRow = Math.max(maxRow, p.row); maxCol = Math.max(maxCol, p.col);
    }
    ws["!ref"] = ur ? `A1:${toA1(maxRow, maxCol)}` : "A1:A1";
    const cols: XLSX.ColInfo[] = [];
    for (let c = 0; c <= maxCol; c++) { const w = sheet.colWidths[colToLetter(c)]; cols.push(w ? { wpx: w } : {}); }
    if (Object.keys(sheet.colWidths).length) ws["!cols"] = cols;
    const rows: XLSX.RowInfo[] = [];
    for (const [k, h] of Object.entries(sheet.rowHeights)) rows[Number(k) - 1] = { hpx: h };
    if (rows.length) ws["!rows"] = rows;
    if (sheet.merges.length) ws["!merges"] = sheet.merges.map((m) => { const r = parseRange(m); return { s: { r: r.start.row, c: r.start.col }, e: { r: r.end.row, c: r.end.col } }; });
    if (sheet.freeze.rows || sheet.freeze.cols) (ws as Record<string, unknown>)["!freeze"] = { xSplit: sheet.freeze.cols, ySplit: sheet.freeze.rows, topLeftCell: toA1(sheet.freeze.rows, sheet.freeze.cols) };
    if (sheet.filters) ws["!autofilter"] = { ref: sheet.filters.range };
    XLSX.utils.book_append_sheet(book, ws, sheet.name.slice(0, 31));
  }
  if (Object.keys(wb.namedRanges).length) {
    book.Workbook = book.Workbook ?? {};
    book.Workbook.Names = Object.entries(wb.namedRanges).map(([Name, ref]) => ({ Name, Ref: ref.includes("!") ? ref.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_m, _a, c, _b, r) => `$${c}$${r}`) : ref }));
  }
  return book;
}

export function exportXlsx(wb: Workbook, opts: { computed?: Computed } = {}): Uint8Array {
  const book = workbookToXlsx(wb, opts);
  const out = XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

/** CSV of one sheet using computed values (formulas resolved) and raw literals. */
export function exportCsv(wb: Workbook, sheetKey?: string, opts: { computed?: Computed } = {}): string {
  const computed = opts.computed ?? computeWorkbook(wb);
  const sheet = sheetKey ? wb.sheets.find((s) => s.id === sheetKey || s.name === sheetKey) ?? wb.sheets[wb.activeSheet] : wb.sheets[wb.activeSheet];
  const ur = usedRange(sheet);
  if (!ur) return "";
  const lines: string[] = [];
  for (let r = 0; r <= ur.end.row; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= ur.end.col; c++) {
      const ref = toA1(r, c);
      const cell = sheet.cells[ref];
      let v: unknown = cell?.f ? computed[sheet.id]?.[ref]?.v : cell?.v;
      if (v === undefined || v === null) v = "";
      const s = String(v);
      cells.push(/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export { letterToCol };
