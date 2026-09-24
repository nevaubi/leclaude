import "server-only";
import * as XLSX from "xlsx";
import { colToLetter, toA1 } from "./a1";
import { serialToISO } from "./format";
import { createSheet, DEFAULT_PAGE_SETUP, internStyle, type Cell, type CellStyle, type Sheet, type Workbook } from "./model";

/**
 * Import .xlsx/.xlsm/.xls/.csv/.tsv into the workbook model. Formulas are
 * preserved where the file carries them; number formats become cell styles;
 * column widths, row heights, merges and freeze panes carry over.
 */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const isText = ext === "csv" || ext === "tsv" || ext === "txt";
  const book = isText
    ? XLSX.read(new TextDecoder().decode(bytes), { type: "string", raw: false, FS: ext === "tsv" ? "\t" : undefined, cellDates: false })
    : XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellStyles: true, cellDates: false });
  const workbook = xlsxToWorkbook(book);
  const title = filename.replace(/\.[^.]+$/, "");
  return { title, content: workbook, meta: { importedFrom: filename, sheets: workbook.sheets.length, cells: workbook.sheets.reduce((n, s) => n + Object.keys(s.cells).length, 0) } };
}

export function xlsxToWorkbook(book: XLSX.WorkBook): Workbook {
  const styles: Record<string, CellStyle> = {};
  const sheets: Sheet[] = [];
  for (const name of book.SheetNames) {
    const ws = book.Sheets[name];
    const sheet = createSheet(name, { id: `sh_${sheets.length + 1}` });
    const ref = ws["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const xc = ws[addr] as XLSX.CellObject | undefined;
          if (!xc) continue;
          const cell: Cell = {};
          const fmt = typeof xc.z === "string" ? xc.z : undefined;
          const isDateFmt = fmt ? /(yy|mm+|dd?)/i.test(fmt) && !/[#0]/.test(fmt) : false;
          if (xc.f) cell.f = `=${xc.f}`;
          else if (xc.t === "n" && typeof xc.v === "number") {
            if (isDateFmt) { cell.v = serialToISO(xc.v); cell.t = "d"; }
            else { cell.v = xc.v; cell.t = "n"; }
          } else if (xc.t === "b") { cell.v = Boolean(xc.v); cell.t = "b"; }
          else if (xc.t === "d" && xc.v instanceof Date) { cell.v = xc.v.toISOString().slice(0, 10); cell.t = "d"; }
          else if (xc.t === "e") { cell.v = String(xc.w ?? xc.v ?? "#ERROR!"); cell.t = "s"; }
          else if (xc.v !== undefined && xc.v !== null && String(xc.v) !== "") { cell.v = String(xc.v); cell.t = "s"; }
          const st: CellStyle = {};
          if (fmt && fmt !== "General") st.numFmt = isDateFmt ? normalizeDateFmt(fmt) : fmt === "@" ? "text" : fmt;
          const xs = (xc as unknown as { s?: { font?: { bold?: boolean; italic?: boolean; underline?: boolean; color?: { rgb?: string } }; fill?: { fgColor?: { rgb?: string } }; alignment?: { horizontal?: string; wrapText?: boolean } } }).s;
          if (xs?.font?.bold) st.bold = true;
          if (xs?.font?.italic) st.italic = true;
          if (xs?.font?.underline) st.underline = true;
          if (xs?.font?.color?.rgb && xs.font.color.rgb !== "000000") st.color = `#${xs.font.color.rgb.slice(-6)}`;
          if (xs?.fill?.fgColor?.rgb && xs.fill.fgColor.rgb !== "FFFFFF") st.fill = `#${xs.fill.fgColor.rgb.slice(-6)}`;
          if (xs?.alignment?.horizontal && ["left", "center", "right"].includes(xs.alignment.horizontal)) st.align = xs.alignment.horizontal as CellStyle["align"];
          if (xs?.alignment?.wrapText) st.wrap = true;
          const sid = internStyle(styles, st);
          if (sid) cell.s = sid;
          if (cell.f !== undefined || cell.v !== undefined || cell.s) sheet.cells[toA1(r, c)] = cell;
        }
      }
    }
    (ws["!cols"] ?? []).forEach((col, i) => { if (!col) return; const px = col.wpx ?? (col.wch ? Math.round(col.wch * 7 + 5) : col.width ? Math.round(col.width * 7 + 5) : undefined); if (px) sheet.colWidths[colToLetter(i)] = Math.max(24, Math.min(800, px)); });
    (ws["!rows"] ?? []).forEach((row, i) => { if (!row) return; const px = row.hpx ?? (row.hpt ? Math.round(row.hpt * 1.333) : undefined); if (px) sheet.rowHeights[String(i + 1)] = Math.max(16, Math.min(400, px)); });
    for (const m of ws["!merges"] ?? []) sheet.merges.push(`${toA1(m.s.r, m.s.c)}:${toA1(m.e.r, m.e.c)}`);
    const freeze = (ws as Record<string, unknown>)["!freeze"] as { xSplit?: number; ySplit?: number } | undefined;
    if (freeze) sheet.freeze = { rows: Number(freeze.ySplit ?? 0), cols: Number(freeze.xSplit ?? 0) };
    if (ws["!autofilter"]?.ref) sheet.filters = { range: ws["!autofilter"].ref, criteria: {} };
    sheets.push(sheet);
  }
  const namedRanges: Record<string, string> = {};
  for (const n of book.Workbook?.Names ?? []) if (n.Name && n.Ref && !n.Name.startsWith("_xlnm")) namedRanges[n.Name] = n.Ref.replace(/\$/g, "");
  return { version: 1, activeSheet: 0, sheets: sheets.length ? sheets : [createSheet("Sheet1", { id: "sh_1" })], styles, namedRanges, pageSetup: { ...DEFAULT_PAGE_SETUP } };
}

function normalizeDateFmt(fmt: string): string {
  const f = fmt.toLowerCase().replace(/\\/g, "").replace(/;@$/, "");
  if (/^m+\/d+\/yy(yy)?$/.test(f)) return "m/d/yyyy";
  if (/^yyyy-mm-dd$/.test(f)) return "yyyy-mm-dd";
  if (/mmm/.test(f)) return "mmm d yyyy";
  return "yyyy-mm-dd";
}
