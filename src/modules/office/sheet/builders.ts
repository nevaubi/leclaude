/**
 * Small DSL for building workbooks in templates and seeds. Everything goes
 * through SheetOps so the result is exactly what the editor and agent produce.
 */
import { colToLetter, parseA1, toA1 } from "./a1";
import { createSheet, DEFAULT_PAGE_SETUP, type CellStyle, type CellValue, type NumFmt, type Sheet, type Workbook } from "./model";
import { applyOp, BAND_FILL, HEADER_COLOR, HEADER_FILL, TOTAL_FILL, type CellInput, type SheetOp } from "./ops";

export const TITLE_STYLE: CellStyle = { bold: true, fontSize: 16, color: "#1F3A5F" };
export const SUBTITLE_STYLE: CellStyle = { italic: true, color: "#5B6B85" };
export const LABEL_STYLE: CellStyle = { bold: true };
export const INPUT_STYLE: CellStyle = { fill: "#FFF8E1", border: "thin" };
export const SECTION_STYLE: CellStyle = { bold: true, fill: "#E8EEF7", color: "#1F3A5F", border: "bottom" };
export const HEADER_STYLE: CellStyle = { bold: true, fill: HEADER_FILL, color: HEADER_COLOR, border: "thin", align: "left" };
export const TOTAL_STYLE: CellStyle = { bold: true, fill: TOTAL_FILL, border: "top" };
export const NOTE_STYLE: CellStyle = { italic: true, color: "#6B7280", fontSize: 11 };
export { BAND_FILL };

export interface SheetSpec {
  name: string;
  id?: string;
  ops: SheetOp[];
  colWidths?: Record<string, number>;
  freeze?: { rows: number; cols: number };
  color?: string;
}

export function buildWorkbook(sheets: SheetSpec[], opts: { namedRanges?: Record<string, string>; activeSheet?: number; pageSetup?: Partial<Workbook["pageSetup"]> } = {}): Workbook {
  const wbSheets: Sheet[] = sheets.map((s, i) => createSheet(s.name, { id: s.id ?? `sh_${i + 1}`, colWidths: s.colWidths ?? {}, freeze: s.freeze ?? { rows: 0, cols: 0 }, color: s.color }));
  let wb: Workbook = { version: 1, activeSheet: 0, sheets: wbSheets, styles: {}, namedRanges: {}, pageSetup: { ...DEFAULT_PAGE_SETUP, ...(opts.pageSetup ?? {}) } };
  for (const s of sheets) for (const op of s.ops) wb = applyOp(wb, { ...op, sheet: (op as { sheet?: string }).sheet ?? s.name } as SheetOp);
  for (const [name, ref] of Object.entries(opts.namedRanges ?? {})) wb = applyOp(wb, { type: "add_named_range", name, ref });
  wb = { ...wb, activeSheet: opts.activeSheet ?? 0 };
  return wb;
}

/** Cells helper: list of [ref, value|formula, style?] */
export type CellSpec = [string, CellValue | string, (CellStyle | undefined)?];

export function cells(specs: CellSpec[], sheet?: string): SheetOp {
  const list: CellInput[] = specs.map(([ref, v, style]) => {
    const isFormula = typeof v === "string" && v.startsWith("=") && v.length > 1;
    return isFormula ? { ref, formula: v as string, style } : { ref, value: v as CellValue, style };
  });
  return { type: "set_cells", sheet, cells: list };
}

export function title(text: string, subtitle?: string, row = 1, span = 6): SheetOp[] {
  const ops: SheetOp[] = [cells([[`A${row}`, text, TITLE_STYLE]]), { type: "merge_cells", range: `A${row}:${colToLetter(span - 1)}${row}` }, { type: "set_row_height", rows: [row - 1], height: 32 }];
  if (subtitle) ops.push(cells([[`A${row + 1}`, subtitle, SUBTITLE_STYLE]]), { type: "merge_cells", range: `A${row + 1}:${colToLetter(span - 1)}${row + 1}` });
  return ops;
}

export function section(ref: string, text: string, span = 4): SheetOp[] {
  const p = parseA1(ref);
  return [cells([[ref, text, SECTION_STYLE]]), { type: "style_range", range: `${ref}:${toA1(p.row, p.col + span - 1)}`, style: SECTION_STYLE }];
}

/** Labeled inputs block: label in col, value in col+1 (styled as input). Returns ops and the value refs by label. */
export function inputs(anchor: string, items: { label: string; value: CellValue | string; fmt?: NumFmt; note?: string; name?: string }[]): { ops: SheetOp[]; refs: Record<string, string>; named: Record<string, string> } {
  const p = parseA1(anchor);
  const specs: CellSpec[] = [];
  const refs: Record<string, string> = {};
  const named: Record<string, string> = {};
  items.forEach((it, i) => {
    const labelRef = toA1(p.row + i, p.col), valueRef = toA1(p.row + i, p.col + 1);
    specs.push([labelRef, it.label, LABEL_STYLE]);
    specs.push([valueRef, it.value, { ...INPUT_STYLE, ...(it.fmt ? { numFmt: it.fmt } : {}) }]);
    if (it.note) specs.push([toA1(p.row + i, p.col + 2), it.note, NOTE_STYLE]);
    refs[it.label] = valueRef;
    if (it.name) named[it.name] = valueRef;
  });
  return { ops: [cells(specs)], refs, named };
}

export interface TableOpts { anchor: string; headers: string[]; rows: (CellValue | string)[][]; formats?: Record<number, NumFmt>; total?: boolean | { label?: string; columns?: number[]; formulas?: Record<number, string> }; band?: boolean; freeze?: boolean; widths?: number[]; align?: Record<number, "left" | "center" | "right">; sheet?: string }

/** Professional table: header, banded rows, per-column formats, optional total row (SUM by default, or custom formulas keyed by column index). */
export function table(o: TableOpts): SheetOp[] {
  const a = parseA1(o.anchor);
  const ops: SheetOp[] = [];
  const specs: CellSpec[] = [];
  o.headers.forEach((h, j) => specs.push([toA1(a.row, a.col + j), h, { ...HEADER_STYLE, align: o.align?.[j] === "right" ? "right" : "left" }]));
  o.rows.forEach((row, i) => row.forEach((v, j) => {
    const style: CellStyle = { border: "thin" };
    if (o.band !== false && i % 2 === 1) style.fill = BAND_FILL;
    if (o.formats?.[j]) style.numFmt = o.formats[j];
    if (o.align?.[j]) style.align = o.align[j];
    specs.push([toA1(a.row + 1 + i, a.col + j), v, style]);
  }));
  const lastData = a.row + o.rows.length;
  if (o.total && o.rows.length) {
    const t = typeof o.total === "object" ? o.total : {};
    const totalRow = lastData + 1;
    specs.push([toA1(totalRow, a.col), t.label ?? "Total", TOTAL_STYLE]);
    for (let j = 1; j < o.headers.length; j++) {
      const ref = toA1(totalRow, a.col + j);
      const style: CellStyle = { ...TOTAL_STYLE, ...(o.formats?.[j] ? { numFmt: o.formats[j] } : {}) };
      const fmt = o.formats?.[j];
      const summable = t.columns ? t.columns.includes(j) : Boolean(fmt) && !isDateOrPercent(String(fmt));
      if (t.formulas?.[j]) specs.push([ref, t.formulas[j], style]);
      else if (summable) specs.push([ref, `=SUM(${toA1(a.row + 1, a.col + j)}:${toA1(lastData, a.col + j)})`, style]);
      else specs.push([ref, null, style]);
    }
  }
  ops.push(cells(specs, o.sheet));
  if (o.widths) o.widths.forEach((w, j) => ops.push({ type: "set_column_width", sheet: o.sheet, columns: [colToLetter(a.col + j)], width: w }));
  if (o.freeze) ops.push({ type: "freeze_panes", sheet: o.sheet, rows: a.row + 1, cols: 0 });
  return ops;
}

function isDateOrPercent(fmt: string): boolean {
  return /^(yyyy|mmm|m\/d|text)/.test(fmt) || fmt.includes("%");
}

export function widths(map: Record<string, number>, sheet?: string): SheetOp[] {
  return Object.entries(map).map(([col, w]) => ({ type: "set_column_width" as const, sheet, columns: [col], width: w }));
}

/** Row-relative formula helper: build "=B{r}*C{r}" for a given 1-based row. */
export function rf(template: string, row: number): string {
  return template.replace(/\{r\}/g, String(row));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
