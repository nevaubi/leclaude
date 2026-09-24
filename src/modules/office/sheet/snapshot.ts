/**
 * The spreadsheet agent's snapshot: the workbook model plus computed values,
 * the active sheet and selection. Built on the client when a message is sent;
 * on the server it is normalized, recomputed with the formula engine and then
 * mutated by the edit tools so later reads see the proposed state.
 */
import { colToLetter, normalizeRange, parseA1, parseRange, rangeToA1, toA1, type RangeRef } from "./a1";
import { computeWorkbook, type Computed } from "./engine";
import { formatValue } from "./format";
import { detectHeaderRow, getStyle, normalizeWorkbook, usedRange, type CellValue, type Sheet, type Workbook } from "./model";
import type { OfficeScope } from "@/modules/office/shared/types";

export interface SheetSnapshot {
  title: string;
  workbook: Workbook;
  computed: Computed;
  /** Active sheet name. */
  activeSheet: string;
  selection?: { sheet: string; range: string } | null;
  comments?: { id: string; anchor: string; body: string; author: string; resolved?: boolean }[];
  matterId?: string | null;
}

export const RENDER_CELL_CAP = 2000;

export function buildSnapshot(workbook: Workbook, computed: Computed, opts: { title: string; selection?: SheetSnapshot["selection"]; comments?: SheetSnapshot["comments"]; matterId?: string | null }): SheetSnapshot {
  return { title: opts.title, workbook, computed, activeSheet: workbook.sheets[workbook.activeSheet]?.name ?? workbook.sheets[0].name, selection: opts.selection ?? null, comments: opts.comments ?? [], matterId: opts.matterId ?? null };
}

/** Server: normalize the client payload and recompute values authoritatively. */
export function parseSnapshot(raw: unknown): SheetSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("snapshot must be an object");
  const s = raw as Partial<SheetSnapshot>;
  if (!s.workbook || typeof s.workbook !== "object") throw new Error("snapshot.workbook is required");
  const workbook = normalizeWorkbook(s.workbook);
  const computed = computeWorkbook(workbook);
  const active = typeof s.activeSheet === "string" && workbook.sheets.some((x) => x.name === s.activeSheet) ? s.activeSheet : workbook.sheets[workbook.activeSheet]?.name ?? workbook.sheets[0].name;
  return { title: String(s.title ?? "Untitled workbook"), workbook, computed, activeSheet: active, selection: s.selection ?? null, comments: Array.isArray(s.comments) ? s.comments : [], matterId: s.matterId ?? null };
}

export function recompute(snapshot: SheetSnapshot) {
  snapshot.computed = computeWorkbook(snapshot.workbook);
}

export function cellValue(snapshot: SheetSnapshot, sheet: Sheet, ref: string): CellValue {
  const cell = sheet.cells[ref];
  if (!cell) return null;
  if (cell.f) return snapshot.computed[sheet.id]?.[ref]?.v ?? null;
  return cell.v ?? null;
}

export function displayValue(snapshot: SheetSnapshot, sheet: Sheet, ref: string): string {
  const cell = sheet.cells[ref];
  if (!cell) return "";
  const v = cellValue(snapshot, sheet, ref);
  const style = getStyle(snapshot.workbook, cell);
  const t = cell.f ? snapshot.computed[sheet.id]?.[ref]?.t : cell.t;
  return formatValue(v, style, t === "d" ? "d" : cell.t).text;
}

function fmtRaw(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

export function headerInfo(snapshot: SheetSnapshot, sheet: Sheet): { row: number; headers: { col: string; name: string }[] } | null {
  const ur = usedRange(sheet);
  if (!ur) return null;
  const hr = detectHeaderRow(sheet, ur);
  if (hr === null) return null;
  const headers: { col: string; name: string }[] = [];
  for (let c = ur.start.col; c <= ur.end.col; c++) {
    const v = cellValue(snapshot, sheet, toA1(hr, c));
    if (v !== null && v !== "") headers.push({ col: colToLetter(c), name: String(v) });
  }
  return { row: hr + 1, headers };
}

/** Compact per-sheet rendering: used range as rows of `A="x" B=12 C=30{=A1*2}`; capped so the prompt stays small. */
export function renderSheet(snapshot: SheetSnapshot, sheet: Sheet, cap = RENDER_CELL_CAP, only?: RangeRef): string {
  const wb = snapshot.workbook;
  const ur = only ? normalizeRange(only) : usedRange(sheet);
  const lines: string[] = [];
  const styledCount = Object.values(sheet.cells).filter((c) => c.s).length;
  const formulaCount = Object.values(sheet.cells).filter((c) => c.f).length;
  lines.push(`## Sheet "${sheet.name}"${sheet.id === wb.sheets[wb.activeSheet]?.id ? " (active)" : ""} — used range ${ur ? rangeToA1(ur) : "(empty)"}, ${Object.keys(sheet.cells).length} cells, ${formulaCount} formulas, ${styledCount} styled; freeze rows=${sheet.freeze.rows} cols=${sheet.freeze.cols}${sheet.merges.length ? `; merges ${sheet.merges.join(",")}` : ""}${sheet.filters ? `; filter on ${sheet.filters.range}` : ""}`);
  const hi = headerInfo(snapshot, sheet);
  if (hi) lines.push(`headers (row ${hi.row}): ${hi.headers.map((h) => `${h.col}=${JSON.stringify(h.name)}`).join(" ")}`);
  if (sheet.charts.length) lines.push(`charts: ${sheet.charts.map((c) => `${c.id} ${c.type} "${c.title}" data=${c.range}${c.categoryRange ? ` cats=${c.categoryRange}` : ""}`).join("; ")}`);
  if (sheet.conditionalFormats.length) lines.push(`conditional formats: ${sheet.conditionalFormats.map((c) => `${c.id} ${c.range} ${JSON.stringify(c.rule)}`).join("; ")}`);
  if (!ur) return lines.join("\n");
  let count = 0;
  let truncated = false;
  for (let r = ur.start.row; r <= ur.end.row; r++) {
    const parts: string[] = [];
    for (let c = ur.start.col; c <= ur.end.col; c++) {
      const ref = toA1(r, c);
      const cell = sheet.cells[ref];
      if (!cell || (cell.v === undefined && !cell.f)) continue;
      count++;
      if (count > cap) { truncated = true; break; }
      const v = cellValue(snapshot, sheet, ref);
      const st = getStyle(wb, cell);
      const flags = [st.bold ? "b" : "", st.numFmt ? `fmt:${st.numFmt}` : "", st.fill ? "fill" : ""].filter(Boolean).join(",");
      parts.push(`${colToLetter(c)}=${fmtRaw(v)}${cell.f ? `{${cell.f}}` : ""}${flags ? `[${flags}]` : ""}`);
    }
    if (parts.length) lines.push(`r${r + 1}: ${parts.join(" ")}`);
    if (truncated) { lines.push(`… truncated at ${cap} cells; use get_range to read more (used range ${rangeToA1(ur)}).`); break; }
  }
  return lines.join("\n");
}

export function renderSnapshot(snapshot: SheetSnapshot, scope: OfficeScope | null): string {
  const wb = snapshot.workbook;
  const out: string[] = [];
  out.push(`WORKBOOK "${snapshot.title}": ${wb.sheets.length} sheet(s): ${wb.sheets.map((s) => `"${s.name}" [id ${s.id}]`).join(", ")}. Active: "${snapshot.activeSheet}".`);
  if (snapshot.selection) out.push(`SELECTION: ${snapshot.selection.sheet}!${snapshot.selection.range}`);
  const named = Object.entries(wb.namedRanges);
  if (named.length) out.push(`NAMED RANGES: ${named.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const styles = Object.entries(wb.styles);
  if (styles.length) out.push(`STYLES (${styles.length}): ${styles.slice(0, 12).map(([id, s]) => `${id}:${JSON.stringify(s)}`).join(" ")}${styles.length > 12 ? " …" : ""}`);
  if (snapshot.comments?.length) out.push(`COMMENTS: ${snapshot.comments.slice(0, 20).map((c) => `[${c.anchor}] ${c.author}: ${c.body.slice(0, 120)}${c.resolved ? " (resolved)" : ""}`).join(" | ")}`);
  const scopedSheet = scope?.kind === "sheet" ? wb.sheets.find((s) => s.name === scope.ref || s.id === scope.ref) : null;
  const scopedRange = scope?.kind === "range" && scope.ref ? scope.ref : null;
  if (scopedRange) {
    const bang = scopedRange.indexOf("!");
    const sheetName = bang > 0 ? scopedRange.slice(0, bang).replace(/^'|'$/g, "") : snapshot.activeSheet;
    const sheet = wb.sheets.find((s) => s.name === sheetName) ?? wb.sheets[wb.activeSheet];
    try { out.push(renderSheet(snapshot, sheet, RENDER_CELL_CAP, parseRange(bang > 0 ? scopedRange.slice(bang + 1) : scopedRange))); }
    catch { out.push(renderSheet(snapshot, sheet)); }
    for (const s of wb.sheets) if (s.id !== sheet.id) out.push(`## Sheet "${s.name}" — ${Object.keys(s.cells).length} cells (not in scope; use get_range to read)`);
    return out.join("\n\n");
  }
  const sheets = scopedSheet ? [scopedSheet] : wb.sheets;
  let budget = RENDER_CELL_CAP * 2;
  for (const s of sheets) {
    const cap = Math.max(200, Math.min(RENDER_CELL_CAP, budget));
    out.push(renderSheet(snapshot, s, cap));
    budget -= Math.min(cap, Object.keys(s.cells).length);
  }
  if (scopedSheet) for (const s of wb.sheets) if (s.id !== scopedSheet.id) out.push(`## Sheet "${s.name}" — ${Object.keys(s.cells).length} cells (not in scope; use get_range to read)`);
  return out.join("\n\n");
}

/** Basic statistics for a set of values. */
export function describeValues(values: CellValue[]): { count: number; numbers: number; blanks: number; texts: number; dates: number; booleans: number; sum?: number; avg?: number; min?: number; max?: number; distinct: number; sample: CellValue[] } {
  let numbers = 0, blanks = 0, texts = 0, dates = 0, booleans = 0, sum = 0, min = Infinity, max = -Infinity;
  const distinct = new Set<string>();
  for (const v of values) {
    if (v === null || v === undefined || v === "") { blanks++; continue; }
    distinct.add(String(v));
    if (typeof v === "number") { numbers++; sum += v; min = Math.min(min, v); max = Math.max(max, v); }
    else if (typeof v === "boolean") booleans++;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) dates++;
    else texts++;
  }
  return { count: values.length, numbers, blanks, texts, dates, booleans, sum: numbers ? sum : undefined, avg: numbers ? sum / numbers : undefined, min: numbers ? min : undefined, max: numbers ? max : undefined, distinct: distinct.size, sample: values.filter((v) => v !== null && v !== "").slice(0, 5) };
}

export { parseA1 };
