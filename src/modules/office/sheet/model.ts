/**
 * Workbook content model for the Excel editor. Persisted as OfficeDocument.content
 * (kind "sheet"). Isomorphic: used by the grid, the agent tools, templates,
 * seeds and import/export.
 */
import { nanoid } from "nanoid";
import { boundingRange, colToLetter, iterateRange, letterToCol, normalizeRange, parseA1, parseRange, rangeToA1, toA1, type RangeRef } from "./a1";

export type CellValue = string | number | boolean | null;
export type CellType = "n" | "s" | "b" | "d";
export type StyleId = string;

export interface Cell {
  /** Literal value (for formula cells the last computed value may be cached here). */
  v?: CellValue;
  /** Formula, with or without a leading "=". */
  f?: string;
  /** Style id into Workbook.styles. */
  s?: StyleId;
  /** Type hint: number, string, boolean, date (ISO yyyy-mm-dd string in v). */
  t?: CellType;
}

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type BorderSpec = "none" | "thin" | "medium" | "thick" | "bottom" | "top" | "outline" | "all";

export type NumFmt = "General" | "0" | "0.00" | "#,##0" | "#,##0.00" | "$#,##0.00" | "$#,##0" | "0%" | "0.00%" | "yyyy-mm-dd" | "mmm d yyyy" | "m/d/yyyy" | "text" | (string & {});

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: HAlign;
  valign?: VAlign;
  wrap?: boolean;
  numFmt?: NumFmt;
  /** Background color (hex) — document data, not UI chrome. */
  fill?: string;
  /** Text color (hex). */
  color?: string;
  border?: BorderSpec;
  fontSize?: number;
  fontFamily?: string;
}

export type ChartType = "bar" | "line" | "pie" | "area" | "scatter";

export interface SheetChart {
  id: string;
  type: ChartType;
  title: string;
  /** Data range (one or more series columns, optional header row). */
  range: string;
  /** Category labels range (usually the first column of the table). */
  categoryRange?: string;
  /** Pixel position relative to the grid's cell area (A1 origin). */
  position: { x: number; y: number; w: number; h: number };
  hasHeader?: boolean;
  stacked?: boolean;
}

export type CFRule =
  | { kind: "gt"; value: number }
  | { kind: "lt"; value: number }
  | { kind: "between"; min: number; max: number }
  | { kind: "eq"; value: CellValue }
  | { kind: "contains"; text: string }
  | { kind: "dueBefore"; date: string /* yyyy-mm-dd or "today" */; days?: number }
  | { kind: "top"; count: number; bottom?: boolean }
  | { kind: "blank" }
  | { kind: "duplicate" };

export interface ConditionalFormat {
  id: string;
  range: string;
  rule: CFRule;
  style: CellStyle;
}

export interface FilterCriteria {
  /** Column letter → allowed values (null = all). */
  values?: string[] | null;
  /** Optional text/number condition. */
  condition?: { op: "contains" | "notContains" | "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "startsWith" | "blank" | "notBlank"; value?: string | number };
}

export interface SheetFilter {
  range: string;
  criteria: Record<string, FilterCriteria>;
}

export interface DataValidation {
  id: string;
  range: string;
  kind: "list" | "number" | "date";
  list?: string[];
  min?: number;
  max?: number;
  allowBlank?: boolean;
  message?: string;
}

export interface Sheet {
  id: string;
  name: string;
  cells: Record<string, Cell>;
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: string[];
  freeze: { rows: number; cols: number };
  charts: SheetChart[];
  conditionalFormats: ConditionalFormat[];
  filters?: SheetFilter | null;
  validations?: DataValidation[];
  /** Tab color (hex). */
  color?: string;
  hidden?: boolean;
}

export interface PageSetup {
  orientation: "portrait" | "landscape";
  paper: "letter" | "legal" | "a4" | "tabloid";
  margins: { top: number; right: number; bottom: number; left: number };
  printArea?: string;
  header?: string;
  footer?: string;
  fitToPage?: boolean;
  gridlines?: boolean;
  repeatHeaderRows?: number;
}

export interface Workbook {
  version: 1;
  activeSheet: number;
  sheets: Sheet[];
  styles: Record<StyleId, CellStyle>;
  namedRanges: Record<string, string>;
  pageSetup?: PageSetup;
}

export const DEFAULT_COL_WIDTH = 104;
export const DEFAULT_ROW_HEIGHT = 24;
export const ROW_HEADER_WIDTH = 44;
export const COL_HEADER_HEIGHT = 24;
export const MIN_ROWS = 200;
export const MIN_COLS = 30;

export const PAPER_SIZES: Record<PageSetup["paper"], { w: number; h: number; label: string }> = {
  letter: { w: 8.5, h: 11, label: "Letter (8.5 × 11 in)" },
  legal: { w: 8.5, h: 14, label: "Legal (8.5 × 14 in)" },
  a4: { w: 8.27, h: 11.69, label: "A4 (210 × 297 mm)" },
  tabloid: { w: 11, h: 17, label: "Tabloid (11 × 17 in)" },
};

export const DEFAULT_PAGE_SETUP: PageSetup = { orientation: "portrait", paper: "letter", margins: { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 }, fitToPage: false, gridlines: false, header: "&[Title]", footer: "Page &[Page] of &[Pages]", repeatHeaderRows: 1 };

export const NUMBER_FORMATS: { id: NumFmt; label: string; example: string }[] = [
  { id: "General", label: "General", example: "1234.5" },
  { id: "0", label: "Number", example: "1235" },
  { id: "0.00", label: "Number (2 dp)", example: "1234.50" },
  { id: "#,##0", label: "Number (thousands)", example: "1,235" },
  { id: "#,##0.00", label: "Number (thousands, 2 dp)", example: "1,234.50" },
  { id: "$#,##0.00", label: "Currency", example: "$1,234.50" },
  { id: "$#,##0", label: "Currency (whole)", example: "$1,235" },
  { id: "0%", label: "Percent", example: "12%" },
  { id: "0.00%", label: "Percent (2 dp)", example: "12.35%" },
  { id: "yyyy-mm-dd", label: "Date (ISO)", example: "2026-09-24" },
  { id: "mmm d yyyy", label: "Date (long)", example: "Sep 24 2026" },
  { id: "m/d/yyyy", label: "Date (US)", example: "9/24/2026" },
  { id: "text", label: "Text", example: "as typed" },
];

// ------------------------------------------------------------- factories

export function newSheetId() { return `sh_${nanoid(6)}`; }

export function createSheet(name: string, partial: Partial<Sheet> = {}): Sheet {
  return { id: partial.id ?? newSheetId(), name, cells: {}, colWidths: {}, rowHeights: {}, merges: [], freeze: { rows: 0, cols: 0 }, charts: [], conditionalFormats: [], validations: [], ...partial };
}

export function emptyWorkbook(): Workbook {
  return { version: 1, activeSheet: 0, sheets: [createSheet("Sheet1", { id: "sh_1" })], styles: {}, namedRanges: {}, pageSetup: { ...DEFAULT_PAGE_SETUP } };
}

/** Normalize an untyped content payload into a well-formed Workbook (tolerant of older/partial shapes). */
export function normalizeWorkbook(raw: unknown): Workbook {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Workbook>;
  const sheetsIn = Array.isArray(r.sheets) && r.sheets.length ? r.sheets : [createSheet("Sheet1", { id: "sh_1" })];
  const sheets: Sheet[] = sheetsIn.map((s, i) => {
    const p = (s ?? {}) as Partial<Sheet>;
    const cells: Record<string, Cell> = {};
    for (const [k, c] of Object.entries(p.cells ?? {})) {
      if (!c || typeof c !== "object") continue;
      const cell: Cell = {};
      const cc = c as Cell;
      if (cc.f != null && String(cc.f).trim() !== "") cell.f = String(cc.f).startsWith("=") ? String(cc.f) : `=${cc.f}`;
      if (cc.v !== undefined) cell.v = cc.v;
      if (cc.s) cell.s = cc.s;
      if (cc.t) cell.t = cc.t;
      if (cell.f === undefined && (cell.v === undefined || cell.v === null) && !cell.s) continue;
      try { cells[toA1(parseA1(k).row, parseA1(k).col)] = cell; } catch { /* skip malformed key */ }
    }
    return {
      id: p.id ?? `sh_${i + 1}`,
      name: p.name ?? `Sheet${i + 1}`,
      cells,
      colWidths: p.colWidths ?? {},
      rowHeights: p.rowHeights ?? {},
      merges: Array.isArray(p.merges) ? p.merges.filter((m) => typeof m === "string") : [],
      freeze: { rows: Number(p.freeze?.rows ?? 0), cols: Number(p.freeze?.cols ?? 0) },
      charts: Array.isArray(p.charts) ? p.charts : [],
      conditionalFormats: Array.isArray(p.conditionalFormats) ? p.conditionalFormats : [],
      filters: p.filters ?? null,
      validations: Array.isArray(p.validations) ? p.validations : [],
      color: p.color,
      hidden: p.hidden,
    };
  });
  return {
    version: 1,
    activeSheet: Math.min(Math.max(0, Number(r.activeSheet ?? 0)), sheets.length - 1),
    sheets,
    styles: r.styles && typeof r.styles === "object" ? r.styles : {},
    namedRanges: r.namedRanges && typeof r.namedRanges === "object" ? r.namedRanges : {},
    pageSetup: { ...DEFAULT_PAGE_SETUP, ...(r.pageSetup ?? {}) },
  };
}

// ------------------------------------------------------------- styles

const STYLE_KEYS: (keyof CellStyle)[] = ["bold", "italic", "underline", "strike", "align", "valign", "wrap", "numFmt", "fill", "color", "border", "fontSize", "fontFamily"];

export function styleKey(st: CellStyle): string {
  const parts: string[] = [];
  for (const k of STYLE_KEYS) { const v = st[k]; if (v !== undefined && v !== null && v !== false && v !== "") parts.push(`${k}=${String(v)}`); }
  return parts.join("|");
}

export function isEmptyStyle(st: CellStyle): boolean { return styleKey(st) === ""; }

/** Return the id of an existing identical style or register a new one. Mutates `styles`. Returns undefined for an empty style. */
export function internStyle(styles: Record<StyleId, CellStyle>, st: CellStyle): StyleId | undefined {
  const key = styleKey(st);
  if (!key) return undefined;
  for (const [id, s] of Object.entries(styles)) if (styleKey(s) === key) return id;
  let n = Object.keys(styles).length + 1;
  let id = `s${n}`;
  while (styles[id]) { n++; id = `s${n}`; }
  const clean: CellStyle = {};
  for (const k of STYLE_KEYS) { const v = st[k]; if (v !== undefined && v !== null && v !== false && v !== "") (clean as Record<string, unknown>)[k] = v; }
  styles[id] = clean;
  return id;
}

export function getStyle(wb: Workbook, cell: Cell | undefined): CellStyle {
  return cell?.s ? (wb.styles[cell.s] ?? {}) : {};
}

/** Merge a style patch into the cell's current style (null values clear a property). */
export function mergeStyle(base: CellStyle, patch: Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>>): CellStyle {
  const out: CellStyle = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete (out as Record<string, unknown>)[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ------------------------------------------------------------- lookups

export function getSheet(wb: Workbook, key: string | number | undefined | null): Sheet {
  if (key === undefined || key === null || key === "") return wb.sheets[wb.activeSheet] ?? wb.sheets[0];
  if (typeof key === "number") { const s = wb.sheets[key]; if (!s) throw new Error(`No sheet at index ${key}`); return s; }
  const s = wb.sheets.find((x) => x.id === key) ?? wb.sheets.find((x) => x.name.toLowerCase() === key.toLowerCase());
  if (!s) throw new Error(`No sheet named "${key}". Sheets: ${wb.sheets.map((x) => x.name).join(", ")}`);
  return s;
}

export function sheetIndex(wb: Workbook, key: string | number | undefined | null): number {
  const s = getSheet(wb, key);
  return wb.sheets.indexOf(s);
}

/** Used range of a sheet (cells with a value, formula or style), or null when empty. */
export function usedRange(sheet: Sheet): RangeRef | null {
  return boundingRange(Object.keys(sheet.cells));
}

export function usedDimensions(sheet: Sheet): { rows: number; cols: number } {
  const r = usedRange(sheet);
  return r ? { rows: r.end.row + 1, cols: r.end.col + 1 } : { rows: 0, cols: 0 };
}

export function gridDimensions(sheet: Sheet): { rows: number; cols: number } {
  const u = usedDimensions(sheet);
  let maxChartRow = 0, maxChartCol = 0;
  for (const c of sheet.charts) { maxChartRow = Math.max(maxChartRow, Math.ceil((c.position.y + c.position.h) / DEFAULT_ROW_HEIGHT)); maxChartCol = Math.max(maxChartCol, Math.ceil((c.position.x + c.position.w) / DEFAULT_COL_WIDTH)); }
  return { rows: Math.max(MIN_ROWS, u.rows + 100, maxChartRow + 20), cols: Math.max(MIN_COLS, u.cols + 10, maxChartCol + 4) };
}

export function colWidth(sheet: Sheet, col: number): number { return sheet.colWidths[colToLetter(col)] ?? DEFAULT_COL_WIDTH; }
export function rowHeight(sheet: Sheet, row: number): number { return sheet.rowHeights[String(row + 1)] ?? DEFAULT_ROW_HEIGHT; }

/** Resolve a range string on a sheet, allowing named ranges and sheet prefixes. Returns the sheet the range lives on. */
export function resolveRange(wb: Workbook, range: string, defaultSheet?: Sheet): { sheet: Sheet; range: RangeRef } {
  let ref = range.trim();
  const named = wb.namedRanges[ref] ?? Object.entries(wb.namedRanges).find(([k]) => k.toLowerCase() === ref.toLowerCase())?.[1];
  if (named) ref = named;
  const dims = defaultSheet ? usedDimensions(defaultSheet) : { rows: 0, cols: 0 };
  const parsed = parseRange(ref, { maxRow: Math.max(dims.rows, 1), maxCol: Math.max(dims.cols, 1) });
  const sheet = parsed.sheet ? getSheet(wb, parsed.sheet) : (defaultSheet ?? getSheet(wb, null));
  if (parsed.sheet) {
    const d = usedDimensions(sheet);
    if (/^[A-Za-z$]+:[A-Za-z$]+$/.test(ref.split("!").pop() ?? "")) parsed.end.row = Math.max(d.rows, 1) - 1;
    if (/^[\d$]+:[\d$]+$/.test(ref.split("!").pop() ?? "")) parsed.end.col = Math.max(d.cols, 1) - 1;
  }
  return { sheet, range: normalizeRange(parsed) };
}

export function cellDisplayRef(sheetName: string, ref: string): string {
  return `${sheetName}!${ref}`;
}

/** Detect a header row in a range: first row that is all non-empty strings and differs in type from the row below. */
export function detectHeaderRow(sheet: Sheet, range: RangeRef): number | null {
  const n = normalizeRange(range);
  const rowIsStrings = (row: number) => {
    let any = false;
    for (let c = n.start.col; c <= n.end.col; c++) {
      const cell = sheet.cells[toA1(row, c)];
      if (!cell) continue;
      if (cell.f) return false;
      if (typeof cell.v !== "string" || cell.v.trim() === "") return false;
      any = true;
    }
    return any;
  };
  const rowHasNonString = (row: number) => {
    for (let c = n.start.col; c <= n.end.col; c++) {
      const cell = sheet.cells[toA1(row, c)];
      if (cell && (cell.f || typeof cell.v === "number" || typeof cell.v === "boolean" || cell.t === "d")) return true;
    }
    return false;
  };
  for (let r = n.start.row; r <= Math.min(n.end.row, n.start.row + 5); r++) {
    if (rowIsStrings(r) && (r === n.end.row || rowHasNonString(r + 1) || rowIsStrings(r + 1) === false)) return r;
  }
  return null;
}

/** Contiguous block of data around a cell (like Ctrl+A / Ctrl+T in Excel). */
export function currentRegion(sheet: Sheet, row: number, col: number): RangeRef {
  const has = (r: number, c: number) => { const cell = sheet.cells[toA1(r, c)]; return Boolean(cell && (cell.f || (cell.v !== undefined && cell.v !== null && cell.v !== ""))); };
  if (!has(row, col)) return { start: { row, col }, end: { row, col } };
  let r0 = row, r1 = row, c0 = col, c1 = col;
  let grew = true;
  const dims = usedDimensions(sheet);
  while (grew) {
    grew = false;
    const rowHas = (r: number) => { for (let c = c0; c <= c1; c++) if (has(r, c)) return true; return false; };
    const colHas = (c: number) => { for (let r = r0; r <= r1; r++) if (has(r, c)) return true; return false; };
    if (r0 > 0 && rowHas(r0 - 1)) { r0--; grew = true; }
    if (r1 < dims.rows - 1 && rowHas(r1 + 1)) { r1++; grew = true; }
    if (c0 > 0 && colHas(c0 - 1)) { c0--; grew = true; }
    if (c1 < dims.cols - 1 && colHas(c1 + 1)) { c1++; grew = true; }
  }
  return { start: { row: r0, col: c0 }, end: { row: r1, col: c1 } };
}

export function cellIsEmpty(cell: Cell | undefined): boolean {
  return !cell || (!cell.f && (cell.v === undefined || cell.v === null || cell.v === ""));
}

/** Cells inside a range, as [ref, cell] pairs (only existing cells). */
export function cellsInRange(sheet: Sheet, range: RangeRef): { ref: string; row: number; col: number; cell: Cell }[] {
  const out: { ref: string; row: number; col: number; cell: Cell }[] = [];
  const size = (normalizeRange(range).end.row - normalizeRange(range).start.row + 1) * (normalizeRange(range).end.col - normalizeRange(range).start.col + 1);
  if (size > Object.keys(sheet.cells).length * 4 && size > 5000) {
    // sparse path: iterate existing cells
    const n = normalizeRange(range);
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const p = parseA1(ref);
      if (p.row >= n.start.row && p.row <= n.end.row && p.col >= n.start.col && p.col <= n.end.col) out.push({ ref, row: p.row, col: p.col, cell });
    }
    out.sort((a, b) => a.row - b.row || a.col - b.col);
    return out;
  }
  for (const c of iterateRange(range)) { const cell = sheet.cells[c.ref]; if (cell) out.push({ ...c, cell }); }
  return out;
}

export function rangeLabel(sheet: Sheet, range: RangeRef): string {
  return `${sheet.name}!${rangeToA1(range)}`;
}

/** Parse a user-typed value into a typed cell (numbers, booleans, ISO dates, percentages, currency). */
export function parseInput(raw: string): Cell {
  const s = raw;
  const t = s.trim();
  if (t === "") return {};
  if (t.startsWith("=") && t.length > 1) return { f: t };
  if (/^(true|false)$/i.test(t)) return { v: t.toLowerCase() === "true", t: "b" };
  if (/^-?\$?-?[\d,]+(\.\d+)?$/.test(t) && /\d/.test(t)) {
    const neg = t.includes("-");
    const num = Number(t.replace(/[$,\-]/g, ""));
    if (Number.isFinite(num)) return { v: neg ? -num : num, t: "n" };
  }
  if (/^-?\d+(\.\d+)?%$/.test(t)) { const num = Number(t.slice(0, -1)); if (Number.isFinite(num)) return { v: num / 100, t: "n" }; }
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t)) { const num = Number(t); if (Number.isFinite(num)) return { v: num, t: "n" }; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t))) return { v: t, t: "d" };
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) { const iso = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`; if (!Number.isNaN(Date.parse(iso))) return { v: iso, t: "d" }; }
  const long = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (long) { const d = new Date(`${long[1]} ${long[2]}, ${long[3]} UTC`); if (!Number.isNaN(d.getTime())) return { v: d.toISOString().slice(0, 10), t: "d" }; }
  return { v: s, t: "s" };
}

export { colToLetter, letterToCol };
