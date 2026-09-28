import "server-only";
import * as XLSX from "xlsx";
import { sha256 } from "@/lib/integrity/hash";
import { colToLetter, toA1 } from "./a1";
import { serialToISO } from "./format";
import { createSheet, DEFAULT_PAGE_SETUP, internStyle, type Cell, type CellStyle, type Sheet, type Workbook } from "./model";
import { readXlsx } from "./xlsx/reader";

const OOXML_EXT = new Set(["xlsx", "xlsm", "xltx", "xltm"]);

function isZip(bytes: Uint8Array) { return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; }

/**
 * Import a spreadsheet into the workbook model.
 * - .xlsx/.xlsm (OOXML): the direct reader (styles, formulas, number formats, merges, freeze panes, validation,
 *   conditional formatting, hyperlinks, notes, print settings, charts…) with an XlsxSource so export can keep the
 *   original package and rewrite only what changed (the import route stores the bytes as doc.meta.originalBlobId).
 * - .xls / .csv / .tsv, or an OOXML file the direct reader rejects: SheetJS (values, formulas, number formats).
 */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const title = filename.replace(/\.[^.]+$/, "");
  const isText = ext === "csv" || ext === "tsv" || ext === "txt";
  let workbook: Workbook | null = null;
  let reader = "sheetjs";
  let fallbackReason: string | undefined;
  if (!isText && (OOXML_EXT.has(ext) || isZip(bytes)) && isZip(bytes)) {
    try { workbook = readXlsx(bytes, { sha256: sha256(bytes) }); reader = "ooxml"; }
    catch (e) { fallbackReason = (e as Error).message; workbook = null; }
  }
  if (!workbook) {
    const book = isText
      ? XLSX.read(new TextDecoder().decode(bytes), { type: "string", raw: false, FS: ext === "tsv" ? "\t" : undefined, cellDates: false })
      : XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellStyles: true, cellDates: false });
    workbook = xlsxToWorkbook(book);
  }
  const meta: Record<string, unknown> = { importedFrom: filename, reader, sheets: workbook.sheets.length, cells: workbook.sheets.reduce((n, s) => n + Object.keys(s.cells).length, 0) };
  if (fallbackReason) meta.readerFallback = fallbackReason;
  return { title, content: workbook, meta };
}

/** SheetJS fallback reader (legacy .xls, CSV/TSV). */
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
