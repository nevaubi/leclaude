/**
 * Formula engine: a thin, isomorphic wrapper around HyperFormula (GPL v3
 * license key — see README limitations). One instance is kept in sync with the
 * workbook model through `sync(workbook)`, which diffs cell contents against
 * the previously synced model and pushes changes in a single batch. Structural
 * changes (sheet set, sheet names, named ranges) trigger a rebuild.
 *
 * The same class runs on the server so agent tools can read computed values
 * after they mutate the snapshot.
 */
import { HyperFormula, DetailedCellError, type CellValue as HFCellValue, type RawCellContent, type SimpleCellAddress } from "hyperformula";
import { parseA1, toA1 } from "./a1";
import type { Cell, CellValue, Sheet, Workbook } from "./model";

export interface ComputedCell { v: CellValue; /** "d" when the engine says the number is a date; "e" on error */ t?: "d" | "e" }
export type ComputedSheet = Record<string, ComputedCell>;
/** Keyed by sheet id. Only formula cells are present. */
export type Computed = Record<string, ComputedSheet>;

const HF_CONFIG = {
  licenseKey: "gpl-v3",
  dateFormats: ["YYYY-MM-DD", "MM/DD/YYYY", "MM/DD/YY", "DD/MM/YYYY"],
  evaluateNullToZero: true,
  useArrayArithmetic: true,
  smartRounding: true,
  useColumnIndex: false,
  nullDate: { year: 1899, month: 12, day: 30 },
  leapYear1900: false,
  maxRows: 200_000,
  maxColumns: 2_000,
};

function rawContent(cell: Cell | undefined): RawCellContent {
  if (!cell) return null;
  if (cell.f) return cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
  const v = cell.v;
  if (v === undefined || v === null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  if (cell.t === "d") return s;
  if (cell.t === "s") {
    // keep text that looks like a number/formula/date as text
    if (/^[=+\-'@]/.test(s) || /^-?[\d,.]+%?$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return `'${s}`;
    return s;
  }
  return s.startsWith("=") ? `'${s}` : s;
}

/** HyperFormula only accepts absolute references in named expressions. */
export function absolutizeRef(ref: string): string {
  const bang = ref.lastIndexOf("!");
  const prefix = bang >= 0 ? ref.slice(0, bang + 1) : "";
  const body = bang >= 0 ? ref.slice(bang + 1) : ref;
  return prefix + body.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g, (_m, _a, col, _b, row) => `$${col}$${row}`);
}

function contentKey(cell: Cell | undefined): string {
  const r = rawContent(cell);
  return r === null ? "" : typeof r === "string" ? `s:${r}` : typeof r === "number" ? `n:${r}` : `b:${r}`;
}

function toGrid(sheet: Sheet): RawCellContent[][] {
  const rows: RawCellContent[][] = [];
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const p = parseA1(ref);
    while (rows.length <= p.row) rows.push([]);
    const row = rows[p.row];
    while (row.length <= p.col) row.push(null);
    row[p.col] = rawContent(cell);
  }
  return rows;
}

export function hfValueToCell(v: HFCellValue): ComputedCell {
  if (v instanceof DetailedCellError) return { v: v.value, t: "e" };
  if (v === undefined) return { v: null };
  return { v: v as CellValue };
}

export class SheetEngine {
  private hf: HyperFormula | null = null;
  private last: Workbook | null = null;
  private sheetIds = new Map<string, number>(); // model sheet id → hf sheet id
  private lastComputed: Computed = {};

  get instance() { return this.hf; }

  private needsRebuild(wb: Workbook): boolean {
    if (!this.hf || !this.last) return true;
    if (this.last.sheets.length !== wb.sheets.length) return true;
    for (let i = 0; i < wb.sheets.length; i++) if (this.last.sheets[i].id !== wb.sheets[i].id || this.last.sheets[i].name !== wb.sheets[i].name) return true;
    const a = Object.entries(this.last.namedRanges), b = Object.entries(wb.namedRanges);
    if (a.length !== b.length) return true;
    for (const [k, v] of b) if (this.last.namedRanges[k] !== v) return true;
    return false;
  }

  private rebuild(wb: Workbook) {
    this.hf?.destroy();
    const sheets: Record<string, RawCellContent[][]> = {};
    for (const s of wb.sheets) sheets[s.name] = toGrid(s);
    const named = Object.entries(wb.namedRanges).map(([name, ref]) => ({ name, expression: `=${absolutizeRef(ref)}` }));
    let hf: HyperFormula;
    try { hf = HyperFormula.buildFromSheets(sheets, HF_CONFIG, named); }
    catch { hf = HyperFormula.buildFromSheets(sheets, HF_CONFIG); for (const n of named) { try { hf.addNamedExpression(n.name, n.expression); } catch { /* invalid name: formulas show #NAME? */ } } }
    this.sheetIds.clear();
    for (const s of wb.sheets) { const id = hf.getSheetId(s.name); if (id !== undefined) this.sheetIds.set(s.id, id); }
    this.hf = hf;
  }

  private diffApply(wb: Workbook) {
    const hf = this.hf!;
    const last = this.last!;
    hf.batch(() => {
      for (let i = 0; i < wb.sheets.length; i++) {
        const next = wb.sheets[i], prev = last.sheets[i];
        if (next.cells === prev.cells) continue;
        const sheetId = this.sheetIds.get(next.id);
        if (sheetId === undefined) continue;
        const keys = new Set([...Object.keys(prev.cells), ...Object.keys(next.cells)]);
        for (const ref of keys) {
          const a = prev.cells[ref], b = next.cells[ref];
          if (a === b) continue;
          if (contentKey(a) === contentKey(b)) continue;
          const p = parseA1(ref);
          hf.setCellContents({ sheet: sheetId, row: p.row, col: p.col }, [[rawContent(b)]]);
        }
      }
    });
  }

  /** Bring the engine in line with `wb` and return computed values for every formula cell. */
  sync(wb: Workbook): Computed {
    if (this.last === wb && this.hf) return this.lastComputed;
    if (this.needsRebuild(wb)) this.rebuild(wb);
    else this.diffApply(wb);
    this.last = wb;
    const computed: Computed = {};
    const hf = this.hf!;
    for (const s of wb.sheets) {
      const sheetId = this.sheetIds.get(s.id);
      if (sheetId === undefined) continue;
      const out: ComputedSheet = {};
      for (const [ref, cell] of Object.entries(s.cells)) {
        if (!cell.f) continue;
        const p = parseA1(ref);
        const addr: SimpleCellAddress = { sheet: sheetId, row: p.row, col: p.col };
        let cc: ComputedCell;
        try {
          cc = hfValueToCell(hf.getCellValue(addr));
          if (typeof cc.v === "number") { const dt = hf.getCellValueDetailedType(addr); if (dt === "NUMBER_DATE" || dt === "NUMBER_DATETIME") cc.t = "d"; }
        } catch (e) { cc = { v: `#ERROR!`, t: "e" }; void e; }
        out[ref] = cc;
      }
      computed[s.id] = out;
    }
    this.lastComputed = computed;
    return computed;
  }

  /** Evaluate a formula in the context of a sheet without storing it. */
  evaluate(sheetKey: string, formula: string): ComputedCell {
    if (!this.hf || !this.last) throw new Error("Engine not synced");
    const sheet = this.last.sheets.find((s) => s.id === sheetKey || s.name === sheetKey) ?? this.last.sheets[0];
    const id = this.sheetIds.get(sheet.id) ?? 0;
    const f = formula.startsWith("=") ? formula : `=${formula}`;
    if (!this.hf.validateFormula(f)) return { v: "#ERROR!", t: "e" };
    try {
      const v = this.hf.calculateFormula(f, id);
      if (Array.isArray(v)) return hfValueToCell(v[0]?.[0] ?? null);
      return hfValueToCell(v);
    } catch (e) { return { v: `#ERROR! ${(e as Error).message}`.trim(), t: "e" }; }
  }

  /** Value of any cell (literal or computed). */
  valueAt(wb: Workbook, sheetId: string, ref: string): CellValue {
    const sheet = wb.sheets.find((s) => s.id === sheetId);
    const cell = sheet?.cells[ref];
    if (!cell) return null;
    if (cell.f) return this.lastComputed[sheetId]?.[ref]?.v ?? null;
    return cell.v ?? null;
  }

  functionNames(): string[] {
    return (this.hf ?? HyperFormula.buildEmpty(HF_CONFIG)).getRegisteredFunctionNames();
  }

  destroy() { this.hf?.destroy(); this.hf = null; this.last = null; this.sheetIds.clear(); }
}

/** One-shot computation (server-side tools, tests, export). */
export function computeWorkbook(wb: Workbook): Computed {
  const engine = new SheetEngine();
  try { return engine.sync(wb); } finally { engine.destroy(); }
}

/** Value getter helper over a workbook + computed map. */
export function valueGetter(wb: Workbook, computed: Computed) {
  return (sheet: Sheet, ref: string): CellValue => {
    const cell = sheet.cells[ref];
    if (!cell) return null;
    if (cell.f) return computed[sheet.id]?.[ref]?.v ?? null;
    return cell.v ?? null;
  };
}

/** Cells whose computed value is an error. */
export function formulaErrors(wb: Workbook, computed: Computed, sheetId?: string): { sheet: string; ref: string; formula: string; error: string }[] {
  const out: { sheet: string; ref: string; formula: string; error: string }[] = [];
  for (const s of wb.sheets) {
    if (sheetId && s.id !== sheetId) continue;
    for (const [ref, cc] of Object.entries(computed[s.id] ?? {})) if (cc.t === "e") out.push({ sheet: s.name, ref, formula: s.cells[ref]?.f ?? "", error: String(cc.v) });
  }
  return out;
}

/** Common function list for autocomplete (subset of HyperFormula's ~400 functions, ordered by relevance to legal finance work). */
export const COMMON_FUNCTIONS: { name: string; sig: string; hint: string }[] = [
  { name: "SUM", sig: "SUM(range, …)", hint: "Adds numbers" },
  { name: "AVERAGE", sig: "AVERAGE(range, …)", hint: "Arithmetic mean" },
  { name: "COUNT", sig: "COUNT(range)", hint: "Count numeric cells" },
  { name: "COUNTA", sig: "COUNTA(range)", hint: "Count non-empty cells" },
  { name: "COUNTIF", sig: "COUNTIF(range, criteria)", hint: "Count cells matching a criterion" },
  { name: "COUNTIFS", sig: "COUNTIFS(range1, crit1, …)", hint: "Count with multiple criteria" },
  { name: "SUMIF", sig: "SUMIF(range, criteria, [sum_range])", hint: "Conditional sum" },
  { name: "SUMIFS", sig: "SUMIFS(sum_range, range1, crit1, …)", hint: "Sum with multiple criteria" },
  { name: "SUMPRODUCT", sig: "SUMPRODUCT(range1, range2)", hint: "Sum of products" },
  { name: "MIN", sig: "MIN(range)", hint: "Smallest value" },
  { name: "MAX", sig: "MAX(range)", hint: "Largest value" },
  { name: "ROUND", sig: "ROUND(number, digits)", hint: "Round to digits" },
  { name: "IF", sig: "IF(test, then, else)", hint: "Conditional value" },
  { name: "IFS", sig: "IFS(test1, value1, …)", hint: "Multiple conditions" },
  { name: "IFERROR", sig: "IFERROR(value, fallback)", hint: "Fallback on error" },
  { name: "AND", sig: "AND(test1, test2, …)", hint: "All true" },
  { name: "OR", sig: "OR(test1, test2, …)", hint: "Any true" },
  { name: "NOT", sig: "NOT(test)", hint: "Negate" },
  { name: "VLOOKUP", sig: "VLOOKUP(key, table, col, [exact])", hint: "Vertical lookup" },
  { name: "XLOOKUP", sig: "XLOOKUP(key, lookup_range, return_range)", hint: "Flexible lookup" },
  { name: "INDEX", sig: "INDEX(range, row, [col])", hint: "Value at position" },
  { name: "MATCH", sig: "MATCH(key, range, [type])", hint: "Position of a value" },
  { name: "TODAY", sig: "TODAY()", hint: "Current date" },
  { name: "DATE", sig: "DATE(year, month, day)", hint: "Build a date" },
  { name: "DATEDIF", sig: "DATEDIF(start, end, \"D\")", hint: "Difference between dates" },
  { name: "EDATE", sig: "EDATE(start, months)", hint: "Shift by months" },
  { name: "WORKDAY", sig: "WORKDAY(start, days, [holidays])", hint: "Add business days" },
  { name: "NETWORKDAYS", sig: "NETWORKDAYS(start, end, [holidays])", hint: "Business days between" },
  { name: "YEARFRAC", sig: "YEARFRAC(start, end)", hint: "Fraction of a year" },
  { name: "PV", sig: "PV(rate, nper, pmt)", hint: "Present value" },
  { name: "FV", sig: "FV(rate, nper, pmt, [pv])", hint: "Future value" },
  { name: "NPV", sig: "NPV(rate, cashflows)", hint: "Net present value" },
  { name: "PMT", sig: "PMT(rate, nper, pv)", hint: "Payment" },
  { name: "TEXT", sig: "TEXT(value, format)", hint: "Format as text" },
  { name: "CONCAT", sig: "CONCAT(text1, text2, …)", hint: "Join text" },
  { name: "TEXTJOIN", sig: "TEXTJOIN(sep, ignore_empty, range)", hint: "Join with separator" },
  { name: "LEFT", sig: "LEFT(text, n)", hint: "Leading characters" },
  { name: "RIGHT", sig: "RIGHT(text, n)", hint: "Trailing characters" },
  { name: "MID", sig: "MID(text, start, n)", hint: "Substring" },
  { name: "LEN", sig: "LEN(text)", hint: "Length" },
  { name: "TRIM", sig: "TRIM(text)", hint: "Strip spaces" },
  { name: "UPPER", sig: "UPPER(text)", hint: "Uppercase" },
  { name: "LOWER", sig: "LOWER(text)", hint: "Lowercase" },
  { name: "PROPER", sig: "PROPER(text)", hint: "Title case" },
  { name: "SUBSTITUTE", sig: "SUBSTITUTE(text, old, new)", hint: "Replace text" },
  { name: "ABS", sig: "ABS(number)", hint: "Absolute value" },
  { name: "MEDIAN", sig: "MEDIAN(range)", hint: "Median" },
  { name: "STDEV", sig: "STDEV(range)", hint: "Standard deviation" },
  { name: "RANK", sig: "RANK(value, range, [order])", hint: "Rank" },
  { name: "LARGE", sig: "LARGE(range, k)", hint: "k-th largest" },
  { name: "SMALL", sig: "SMALL(range, k)", hint: "k-th smallest" },
  { name: "ISBLANK", sig: "ISBLANK(cell)", hint: "Is empty" },
  { name: "ISNUMBER", sig: "ISNUMBER(value)", hint: "Is numeric" },
  { name: "CHOOSE", sig: "CHOOSE(index, v1, v2, …)", hint: "Pick by index" },
  { name: "MOD", sig: "MOD(number, divisor)", hint: "Remainder" },
  { name: "POWER", sig: "POWER(base, exp)", hint: "Exponent" },
  { name: "SQRT", sig: "SQRT(number)", hint: "Square root" },
  { name: "EOMONTH", sig: "EOMONTH(start, months)", hint: "End of month" },
  { name: "YEAR", sig: "YEAR(date)", hint: "Year part" },
  { name: "MONTH", sig: "MONTH(date)", hint: "Month part" },
  { name: "DAY", sig: "DAY(date)", hint: "Day part" },
];

export { toA1 };
