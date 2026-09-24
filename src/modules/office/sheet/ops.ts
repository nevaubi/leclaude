/**
 * Workbook operations. Every mutation (toolbar, keyboard, context menu, agent
 * proposal) is expressed as a SheetOp and applied with `applyOp`, which returns
 * a new Workbook (structural sharing: only touched sheets are cloned). The
 * client store records ops for undo/redo; the agent tools apply the same ops
 * to the snapshot on the server, so proposals carry exactly what will run.
 */
import { nanoid } from "nanoid";
import { adjustFormulaForStructure, colToLetter, iterateRange, letterToCol, normalizeRange, parseA1, parseRange, rangeToA1, renameSheetInFormula, shiftFormula, toA1, type RangeRef } from "./a1";
import { autofillCell } from "./autofill";
import { toNumber } from "./format";
import { cellIsEmpty, createSheet, DEFAULT_COL_WIDTH, getSheet, getStyle, internStyle, mergeStyle, parseInput, resolveRange, type Cell, type CellStyle, type CellValue, type CFRule, type ChartType, type ConditionalFormat, type DataValidation, type FilterCriteria, type NumFmt, type PageSetup, type Sheet, type SheetChart, type Workbook } from "./model";

export interface CellInput { ref: string; value?: CellValue; formula?: string | null; style?: Partial<CellStyle> | null; type?: Cell["t"] }

export type SheetOp =
  | { type: "set_cells"; sheet?: string; cells: CellInput[]; /** parse strings like "12%" or "=A1" into typed values (user typing) */ parse?: boolean }
  | { type: "clear_range"; sheet?: string; range: string; what?: "all" | "contents" | "formats" }
  | { type: "fill_range"; sheet?: string; range: string; pattern: string }
  | { type: "set_formula_column"; sheet?: string; column: string; from_row: number; to_row: number; template: string }
  | { type: "autofill"; sheet?: string; source: string; target: string }
  | { type: "insert_rows"; sheet?: string; index: number; count?: number }
  | { type: "delete_rows"; sheet?: string; index: number; count?: number }
  | { type: "insert_cols"; sheet?: string; index: number; count?: number }
  | { type: "delete_cols"; sheet?: string; index: number; count?: number }
  | { type: "style_range"; sheet?: string; range: string; style: Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>> }
  | { type: "set_number_format"; sheet?: string; range: string; numFmt: NumFmt }
  | { type: "set_column_width"; sheet?: string; columns: string[]; width: number }
  | { type: "autofit_columns"; sheet?: string; columns?: string[] }
  | { type: "set_row_height"; sheet?: string; rows: number[]; height: number }
  | { type: "merge_cells"; sheet?: string; range: string }
  | { type: "unmerge_cells"; sheet?: string; range: string }
  | { type: "freeze_panes"; sheet?: string; rows: number; cols: number }
  | { type: "sort_range"; sheet?: string; range: string; by: string; order?: "asc" | "desc"; has_header?: boolean; then_by?: string }
  | { type: "add_filter"; sheet?: string; range: string }
  | { type: "set_filter_criteria"; sheet?: string; column: string; criteria: FilterCriteria | null }
  | { type: "clear_filter"; sheet?: string }
  | { type: "conditional_format"; sheet?: string; range: string; rule: CFRule; style: CellStyle; id?: string }
  | { type: "remove_conditional_format"; sheet?: string; id: string }
  | { type: "add_chart"; sheet?: string; chart: Omit<SheetChart, "id" | "position"> & { id?: string; position?: Partial<SheetChart["position"]> } }
  | { type: "update_chart"; sheet?: string; id: string; patch: Partial<SheetChart> }
  | { type: "remove_chart"; sheet?: string; id: string }
  | { type: "add_sheet"; name: string; index?: number; id?: string }
  | { type: "rename_sheet"; sheet?: string; name: string }
  | { type: "delete_sheet"; sheet: string }
  | { type: "reorder_sheet"; sheet: string; index: number }
  | { type: "set_sheet_color"; sheet?: string; color: string | null }
  | { type: "set_active_sheet"; sheet: string }
  | { type: "add_named_range"; name: string; ref: string }
  | { type: "remove_named_range"; name: string }
  | { type: "add_validation"; sheet?: string; range: string; kind: DataValidation["kind"]; list?: string[]; min?: number; max?: number; message?: string; id?: string }
  | { type: "remove_validation"; sheet?: string; id: string }
  | { type: "set_page_setup"; patch: Partial<PageSetup> }
  | { type: "build_table"; sheet?: string; anchor: string; headers: string[]; rows: CellValue[][]; style?: "professional" | "plain"; total_row?: boolean; number_format?: NumFmt }
  | { type: "paste_block"; sheet?: string; anchor: string; block: (Cell | null)[][]; /** origin of the copied block for relative-formula shifting */ origin?: { row: number; col: number } }
  | { type: "replace_workbook"; workbook: Workbook }
  | { type: "batch"; ops: SheetOp[] };

export const HEADER_FILL = "#1F3A5F";
export const HEADER_COLOR = "#FFFFFF";
export const TOTAL_FILL = "#EEF2F7";
export const BAND_FILL = "#F7F9FC";

function cloneSheet(s: Sheet): Sheet {
  return { ...s, cells: { ...s.cells }, colWidths: { ...s.colWidths }, rowHeights: { ...s.rowHeights }, merges: [...s.merges], charts: s.charts.map((c) => ({ ...c, position: { ...c.position } })), conditionalFormats: [...s.conditionalFormats], validations: [...(s.validations ?? [])], freeze: { ...s.freeze }, filters: s.filters ? { ...s.filters, criteria: { ...s.filters.criteria } } : s.filters };
}

function withSheet(wb: Workbook, sheet: Sheet, next: Sheet): Workbook {
  return { ...wb, sheets: wb.sheets.map((s) => (s.id === sheet.id ? next : s)) };
}

function withStyles(wb: Workbook): Workbook { return { ...wb, styles: { ...wb.styles } }; }

function cellFromInput(wb: Workbook, sheet: Sheet, input: CellInput, parse: boolean): Cell | undefined {
  const existing = sheet.cells[input.ref];
  let next: Cell = existing ? { ...existing } : {};
  if (input.formula !== undefined) {
    if (input.formula === null || input.formula === "") { delete next.f; }
    else next = { ...next, f: input.formula.startsWith("=") ? input.formula : `=${input.formula}` };
    if (next.f) { delete next.v; delete next.t; }
  }
  // A formula wins over a value sent alongside it (the grid editor sends both), otherwise the
  // typed "=SUM(...)" would be stored back as plain text.
  if (input.value !== undefined && !(input.formula && next.f)) {
    if (typeof input.value === "string" && parse) {
      const parsed = parseInput(input.value);
      next = { ...(next.s ? { s: next.s } : {}), ...parsed };
    } else if (typeof input.value === "string" && input.value.startsWith("=") && input.value.length > 1 && input.formula === undefined) {
      next = { ...(next.s ? { s: next.s } : {}), f: input.value };
    } else {
      delete next.f;
      next.v = input.value;
      if (input.type) next.t = input.type;
      else if (typeof input.value === "number") next.t = "n";
      else if (typeof input.value === "boolean") next.t = "b";
      else if (typeof input.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.value)) next.t = "d";
      else if (input.value === null) { delete next.v; delete next.t; }
      else next.t = "s";
    }
  }
  if (input.style !== undefined) {
    if (input.style === null) delete next.s;
    else {
      const merged = mergeStyle(getStyle(wb, existing), input.style);
      const id = internStyle(wb.styles, merged);
      if (id) next.s = id; else delete next.s;
    }
  }
  if (cellIsEmpty(next) && !next.s) return undefined;
  return next;
}

function estimateTextWidth(text: string, style: CellStyle): number {
  const size = style.fontSize ?? 12;
  const perChar = size * 0.58 * (style.bold ? 1.08 : 1);
  return Math.ceil(text.length * perChar) + 16;
}

function compareValues(a: CellValue | undefined, b: CellValue | undefined, order: "asc" | "desc"): number {
  const dir = order === "desc" ? -1 : 1;
  const ea = a === undefined || a === null || a === "", eb = b === undefined || b === null || b === "";
  if (ea && eb) return 0;
  if (ea) return 1; // blanks last regardless of order
  if (eb) return -1;
  const na = toNumber(a), nb = toNumber(b);
  if (na !== null && nb !== null) return (na - nb) * dir;
  if (na !== null) return -1 * dir;
  if (nb !== null) return 1 * dir;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true }) * dir;
}

/** Shift every cell key at/after index along an axis (insert when count>0, delete when count<0). Cells in a deleted block are dropped. */
function shiftCells(sheet: Sheet, axis: "row" | "col", index: number, count: number, sheetNames: string[]): Sheet {
  const next = cloneSheet(sheet);
  const cells: Record<string, Cell> = {};
  const del = count < 0 ? -count : 0;
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const p = parseA1(ref);
    const v = axis === "row" ? p.row : p.col;
    let nv = v;
    if (count > 0 && v >= index) nv = v + count;
    if (count < 0) { if (v >= index && v < index + del) continue; if (v >= index + del) nv = v - del; }
    const key = axis === "row" ? toA1(nv, p.col) : toA1(p.row, nv);
    cells[key] = cell.f ? { ...cell, f: adjustFormulaForStructure(cell.f, { axis, index, count, sheetName: sheet.name, formulaSheet: sheet.name }) } : cell;
  }
  next.cells = cells;
  const shiftIdx = (v: number) => { if (count > 0 && v >= index) return v + count; if (count < 0) { if (v >= index && v < index + del) return null; if (v >= index + del) return v - del; } return v; };
  const shiftRange = (r: string): string | null => {
    try {
      const pr = normalizeRange(parseRange(r));
      const s = axis === "row" ? shiftIdx(pr.start.row) : shiftIdx(pr.start.col);
      const e = axis === "row" ? shiftIdx(pr.end.row) : shiftIdx(pr.end.col);
      const s2 = s ?? (count < 0 ? index : pr.start[axis]);
      const e2 = e ?? (count < 0 ? index - 1 : pr.end[axis]);
      if (e2 < s2) return null;
      return rangeToA1({ start: axis === "row" ? { row: s2, col: pr.start.col } : { row: pr.start.row, col: s2 }, end: axis === "row" ? { row: e2, col: pr.end.col } : { row: pr.end.row, col: e2 } });
    } catch { return r; }
  };
  next.merges = sheet.merges.map(shiftRange).filter((m): m is string => Boolean(m));
  next.conditionalFormats = sheet.conditionalFormats.map((cf) => ({ ...cf, range: shiftRange(cf.range) ?? cf.range }));
  next.validations = (sheet.validations ?? []).map((v) => ({ ...v, range: shiftRange(v.range) ?? v.range }));
  next.charts = sheet.charts.map((c) => ({ ...c, range: shiftRange(c.range) ?? c.range, categoryRange: c.categoryRange ? shiftRange(c.categoryRange) ?? c.categoryRange : c.categoryRange }));
  if (sheet.filters) next.filters = { ...sheet.filters, range: shiftRange(sheet.filters.range) ?? sheet.filters.range };
  if (axis === "row") {
    const rh: Record<string, number> = {};
    for (const [k, h] of Object.entries(sheet.rowHeights)) { const nv = shiftIdx(Number(k) - 1); if (nv !== null) rh[String(nv + 1)] = h; }
    next.rowHeights = rh;
    if (sheet.freeze.rows > index) next.freeze = { ...sheet.freeze, rows: Math.max(0, sheet.freeze.rows + count) };
  } else {
    const cw: Record<string, number> = {};
    for (const [k, w] of Object.entries(sheet.colWidths)) { const nv = shiftIdx(letterToCol(k)); if (nv !== null) cw[colToLetter(nv)] = w; }
    next.colWidths = cw;
    if (sheet.freeze.cols > index) next.freeze = { ...sheet.freeze, cols: Math.max(0, sheet.freeze.cols + count) };
  }
  void sheetNames;
  return next;
}

/** Adjust formulas on OTHER sheets that reference `sheetName` after a structural change. */
function adjustOtherSheets(wb: Workbook, sheetName: string, axis: "row" | "col", index: number, count: number): Workbook {
  return { ...wb, sheets: wb.sheets.map((s) => {
    if (s.name === sheetName) return s;
    let changed = false;
    const cells: Record<string, Cell> = {};
    for (const [ref, cell] of Object.entries(s.cells)) {
      if (cell.f && cell.f.includes("!")) {
        const f = adjustFormulaForStructure(cell.f, { axis, index, count, sheetName, formulaSheet: s.name });
        if (f !== cell.f) { changed = true; cells[ref] = { ...cell, f }; continue; }
      }
      cells[ref] = cell;
    }
    return changed ? { ...s, cells } : s;
  }) };
}

export function applyOp(wbIn: Workbook, op: SheetOp): Workbook {
  const wb = withStyles(wbIn);
  switch (op.type) {
    case "batch": return op.ops.reduce((acc, o) => applyOp(acc, o), wb);
    case "replace_workbook": return op.workbook;

    case "set_cells": {
      const sheet = getSheet(wb, op.sheet);
      const next = cloneSheet(sheet);
      for (const input of op.cells) {
        const ref = toA1(parseA1(input.ref).row, parseA1(input.ref).col);
        const cell = cellFromInput(wb, next, { ...input, ref }, op.parse ?? false);
        if (cell) next.cells[ref] = cell; else delete next.cells[ref];
      }
      return withSheet(wb, sheet, next);
    }

    case "clear_range": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const next = cloneSheet(sheet);
      for (const c of iterateRange(range)) {
        const cell = next.cells[c.ref];
        if (!cell) continue;
        if (op.what === "formats") { const { s: _s, ...rest } = cell; void _s; if (cellIsEmpty(rest)) delete next.cells[c.ref]; else next.cells[c.ref] = rest; }
        else if (op.what === "contents") { if (cell.s) next.cells[c.ref] = { s: cell.s }; else delete next.cells[c.ref]; }
        else delete next.cells[c.ref];
      }
      return withSheet(wb, sheet, next);
    }

    case "fill_range": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const next = cloneSheet(sheet);
      const origin = range.start;
      const isFormula = op.pattern.trim().startsWith("=");
      for (const c of iterateRange(range)) {
        const existing = next.cells[c.ref];
        const keep = existing?.s ? { s: existing.s } : {};
        if (isFormula) next.cells[c.ref] = { ...keep, f: shiftFormula(op.pattern.trim(), c.row - origin.row, c.col - origin.col) };
        else { const parsed = parseInput(op.pattern); if (cellIsEmpty(parsed)) { if (existing?.s) next.cells[c.ref] = keep; else delete next.cells[c.ref]; } else next.cells[c.ref] = { ...keep, ...parsed }; }
      }
      return withSheet(wb, sheet, next);
    }

    case "set_formula_column": {
      const sheet = getSheet(wb, op.sheet);
      const next = cloneSheet(sheet);
      const col = letterToCol(op.column);
      for (let r = op.from_row; r <= op.to_row; r++) {
        const ref = toA1(r - 1, col);
        const f = op.template.replace(/\{row\}/g, String(r));
        const keep = next.cells[ref]?.s ? { s: next.cells[ref].s } : {};
        next.cells[ref] = { ...keep, f: f.startsWith("=") ? f : `=${f}` };
      }
      return withSheet(wb, sheet, next);
    }

    case "autofill": {
      const sheet = getSheet(wb, op.sheet);
      const src = normalizeRange(parseRange(op.source));
      const tgt = normalizeRange(parseRange(op.target));
      const next = cloneSheet(sheet);
      const vertical = tgt.start.col === src.start.col && tgt.end.col === src.end.col && (tgt.start.row > src.end.row || tgt.end.row < src.start.row);
      const horizontal = !vertical && tgt.start.row === src.start.row && tgt.end.row === src.end.row;
      if (!vertical && !horizontal) return wb;
      if (vertical) {
        const down = tgt.start.row > src.end.row;
        for (let c = src.start.col; c <= src.end.col; c++) {
          const source: (Cell | undefined)[] = [];
          for (let r = src.start.row; r <= src.end.row; r++) source.push(sheet.cells[toA1(r, c)]);
          const count = tgt.end.row - tgt.start.row + 1;
          for (let k = 0; k < count; k++) {
            const row = down ? tgt.start.row + k : tgt.end.row - k;
            const cell = autofillCell(source, k, "row", down ? 1 : -1);
            if (cell) next.cells[toA1(row, c)] = cell; else delete next.cells[toA1(row, c)];
          }
        }
      } else {
        const right = tgt.start.col > src.end.col;
        for (let r = src.start.row; r <= src.end.row; r++) {
          const source: (Cell | undefined)[] = [];
          for (let c = src.start.col; c <= src.end.col; c++) source.push(sheet.cells[toA1(r, c)]);
          const count = tgt.end.col - tgt.start.col + 1;
          for (let k = 0; k < count; k++) {
            const col = right ? tgt.start.col + k : tgt.end.col - k;
            const cell = autofillCell(source, k, "col", right ? 1 : -1);
            if (cell) next.cells[toA1(r, col)] = cell; else delete next.cells[toA1(r, col)];
          }
        }
      }
      return withSheet(wb, sheet, next);
    }

    case "insert_rows": case "delete_rows": case "insert_cols": case "delete_cols": {
      const sheet = getSheet(wb, op.sheet);
      const count = Math.max(1, op.count ?? 1);
      const axis = op.type.endsWith("rows") ? "row" : "col";
      const signed = op.type.startsWith("insert") ? count : -count;
      const next = shiftCells(sheet, axis, op.index, signed, wb.sheets.map((s) => s.name));
      const namedRanges: Record<string, string> = {};
      for (const [k, v] of Object.entries(wb.namedRanges)) namedRanges[k] = adjustFormulaForStructure(`=${v}`, { axis, index: op.index, count: signed, sheetName: sheet.name, formulaSheet: sheet.name }).slice(1);
      return adjustOtherSheets({ ...withSheet(wb, sheet, next), namedRanges }, sheet.name, axis, op.index, signed);
    }

    case "style_range": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const next = cloneSheet(sheet);
      for (const c of iterateRange(range)) {
        const cell = next.cells[c.ref];
        const merged = mergeStyle(getStyle(wb, cell), op.style);
        const id = internStyle(wb.styles, merged);
        if (id) next.cells[c.ref] = { ...(cell ?? {}), s: id };
        else if (cell) { const { s: _s, ...rest } = cell; void _s; if (cellIsEmpty(rest)) delete next.cells[c.ref]; else next.cells[c.ref] = rest; }
      }
      return withSheet(wb, sheet, next);
    }

    case "set_number_format":
      return applyOp(wb, { type: "style_range", sheet: op.sheet, range: op.range, style: { numFmt: op.numFmt === "General" ? null : op.numFmt } });

    case "set_column_width": {
      const sheet = getSheet(wb, op.sheet);
      const next = cloneSheet(sheet);
      for (const c of op.columns) next.colWidths[c.toUpperCase()] = Math.max(24, Math.min(800, Math.round(op.width)));
      return withSheet(wb, sheet, next);
    }

    case "autofit_columns": {
      const sheet = getSheet(wb, op.sheet);
      const next = cloneSheet(sheet);
      const widths: Record<string, number> = {};
      const only = op.columns ? new Set(op.columns.map((c) => c.toUpperCase())) : null;
      for (const [ref, cell] of Object.entries(sheet.cells)) {
        const p = parseA1(ref);
        const letter = colToLetter(p.col);
        if (only && !only.has(letter)) continue;
        const style = getStyle(wb, cell);
        const text = cell.f ? String(cell.v ?? "0000000") : String(cell.v ?? "");
        const w = estimateTextWidth(text, style);
        widths[letter] = Math.max(widths[letter] ?? 0, w);
      }
      for (const [letter, w] of Object.entries(widths)) next.colWidths[letter] = Math.max(48, Math.min(420, w));
      if (only) for (const c of only) if (!widths[c]) next.colWidths[c] = DEFAULT_COL_WIDTH;
      return withSheet(wb, sheet, next);
    }

    case "set_row_height": {
      const sheet = getSheet(wb, op.sheet);
      const next = cloneSheet(sheet);
      for (const r of op.rows) next.rowHeights[String(r + 1)] = Math.max(16, Math.min(400, Math.round(op.height)));
      return withSheet(wb, sheet, next);
    }

    case "merge_cells": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const next = cloneSheet(sheet);
      const a1 = rangeToA1(range);
      if (a1.includes(":") && !next.merges.includes(a1)) {
        next.merges = next.merges.filter((m) => { const r = parseRange(m); return !(r.start.row <= range.end.row && r.end.row >= range.start.row && r.start.col <= range.end.col && r.end.col >= range.start.col); });
        next.merges.push(a1);
      }
      return withSheet(wb, sheet, next);
    }

    case "unmerge_cells": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const next = cloneSheet(sheet);
      next.merges = next.merges.filter((m) => { const r = parseRange(m); return !(r.start.row <= range.end.row && r.end.row >= range.start.row && r.start.col <= range.end.col && r.end.col >= range.start.col); });
      return withSheet(wb, sheet, next);
    }

    case "freeze_panes": {
      const sheet = getSheet(wb, op.sheet);
      return withSheet(wb, sheet, { ...sheet, freeze: { rows: Math.max(0, Math.min(10, op.rows)), cols: Math.max(0, Math.min(6, op.cols)) } });
    }

    case "sort_range": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const next = cloneSheet(sheet);
      const keyCol = /^[A-Za-z]{1,3}$/.test(op.by) ? letterToCol(op.by) : range.start.col + (Number(op.by) || 0);
      const thenCol = op.then_by ? (/^[A-Za-z]{1,3}$/.test(op.then_by) ? letterToCol(op.then_by) : range.start.col + (Number(op.then_by) || 0)) : null;
      const firstRow = range.start.row + (op.has_header ? 1 : 0);
      const rows: { row: number; cells: (Cell | undefined)[] }[] = [];
      for (let r = firstRow; r <= range.end.row; r++) {
        const cells: (Cell | undefined)[] = [];
        for (let c = range.start.col; c <= range.end.col; c++) cells.push(sheet.cells[toA1(r, c)]);
        rows.push({ row: r, cells });
      }
      const valueOf = (cells: (Cell | undefined)[], col: number) => cells[col - range.start.col]?.v;
      const order = op.order ?? "asc";
      const sorted = [...rows].sort((a, b) => compareValues(valueOf(a.cells, keyCol), valueOf(b.cells, keyCol), order) || (thenCol !== null ? compareValues(valueOf(a.cells, thenCol), valueOf(b.cells, thenCol), order) : 0) || a.row - b.row);
      sorted.forEach((src, i) => {
        const targetRow = firstRow + i;
        const delta = targetRow - src.row;
        src.cells.forEach((cell, j) => {
          const ref = toA1(targetRow, range.start.col + j);
          if (!cell) { delete next.cells[ref]; return; }
          next.cells[ref] = cell.f && delta !== 0 ? { ...cell, f: shiftFormula(cell.f, delta, 0) } : cell;
        });
      });
      return withSheet(wb, sheet, next);
    }

    case "add_filter": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      return withSheet(wb, sheet, { ...sheet, filters: { range: rangeToA1(range), criteria: {} } });
    }
    case "set_filter_criteria": {
      const sheet = getSheet(wb, op.sheet);
      if (!sheet.filters) return wb;
      const criteria = { ...sheet.filters.criteria };
      if (op.criteria) criteria[op.column.toUpperCase()] = op.criteria; else delete criteria[op.column.toUpperCase()];
      return withSheet(wb, sheet, { ...sheet, filters: { ...sheet.filters, criteria } });
    }
    case "clear_filter": {
      const sheet = getSheet(wb, op.sheet);
      return withSheet(wb, sheet, { ...sheet, filters: null });
    }

    case "conditional_format": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const cf: ConditionalFormat = { id: op.id ?? `cf_${nanoid(6)}`, range: rangeToA1(range), rule: op.rule, style: op.style };
      const next = cloneSheet(sheet);
      next.conditionalFormats = [...next.conditionalFormats.filter((x) => x.id !== cf.id), cf];
      return withSheet(wb, sheet, next);
    }
    case "remove_conditional_format": {
      const sheet = getSheet(wb, op.sheet);
      return withSheet(wb, sheet, { ...sheet, conditionalFormats: sheet.conditionalFormats.filter((x) => x.id !== op.id) });
    }

    case "add_chart": {
      const sheet = getSheet(wb, op.sheet);
      const { range } = resolveRange(wb, op.chart.range, sheet);
      const n = sheet.charts.length;
      const defaultPos = { x: Math.min(1200, (range.end.col + 2) * DEFAULT_COL_WIDTH + 8), y: 8 + n * 40, w: 480, h: 300 };
      const chart: SheetChart = { id: op.chart.id ?? `ch_${nanoid(6)}`, type: op.chart.type, title: op.chart.title, range: rangeToA1(range), categoryRange: op.chart.categoryRange ? rangeToA1(resolveRange(wb, op.chart.categoryRange, sheet).range) : undefined, hasHeader: op.chart.hasHeader ?? true, stacked: op.chart.stacked, position: { ...defaultPos, ...(op.chart.position ?? {}) } };
      const next = cloneSheet(sheet);
      next.charts = [...next.charts.filter((c) => c.id !== chart.id), chart];
      return withSheet(wb, sheet, next);
    }
    case "update_chart": {
      const sheet = getSheet(wb, op.sheet);
      return withSheet(wb, sheet, { ...sheet, charts: sheet.charts.map((c) => (c.id === op.id ? { ...c, ...op.patch, position: { ...c.position, ...(op.patch.position ?? {}) } } : c)) });
    }
    case "remove_chart": {
      const sheet = getSheet(wb, op.sheet);
      return withSheet(wb, sheet, { ...sheet, charts: sheet.charts.filter((c) => c.id !== op.id) });
    }

    case "add_sheet": {
      let name = op.name.trim() || `Sheet${wb.sheets.length + 1}`;
      let i = 2;
      const base = name;
      while (wb.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) name = `${base} (${i++})`;
      const sheet = createSheet(name, op.id ? { id: op.id } : {});
      const sheets = [...wb.sheets];
      const index = op.index ?? sheets.length;
      sheets.splice(index, 0, sheet);
      return { ...wb, sheets, activeSheet: index };
    }
    case "rename_sheet": {
      const sheet = getSheet(wb, op.sheet);
      const name = op.name.trim().replace(/[\[\]:*?/\\]/g, "").slice(0, 31);
      if (!name || wb.sheets.some((s) => s.id !== sheet.id && s.name.toLowerCase() === name.toLowerCase())) throw new Error(`Sheet name "${op.name}" is invalid or already used`);
      const from = sheet.name;
      const sheets = wb.sheets.map((s) => {
        const cells: Record<string, Cell> = {};
        let changed = false;
        for (const [ref, cell] of Object.entries(s.cells)) { if (cell.f && cell.f.includes("!")) { const f = renameSheetInFormula(cell.f, from, name); if (f !== cell.f) { changed = true; cells[ref] = { ...cell, f }; continue; } } cells[ref] = cell; }
        const base = changed ? { ...s, cells } : s;
        return s.id === sheet.id ? { ...base, name } : base;
      });
      const namedRanges: Record<string, string> = {};
      for (const [k, v] of Object.entries(wb.namedRanges)) namedRanges[k] = renameSheetInFormula(`=${v}`, from, name).slice(1);
      return { ...wb, sheets, namedRanges };
    }
    case "delete_sheet": {
      const sheet = getSheet(wb, op.sheet);
      if (wb.sheets.length <= 1) throw new Error("A workbook needs at least one sheet");
      const idx = wb.sheets.indexOf(sheet);
      const sheets = wb.sheets.filter((s) => s.id !== sheet.id);
      return { ...wb, sheets, activeSheet: Math.min(Math.max(0, idx - (idx >= sheets.length ? 1 : 0)), sheets.length - 1) };
    }
    case "reorder_sheet": {
      const sheet = getSheet(wb, op.sheet);
      const sheets = wb.sheets.filter((s) => s.id !== sheet.id);
      const index = Math.max(0, Math.min(sheets.length, op.index));
      sheets.splice(index, 0, sheet);
      return { ...wb, sheets, activeSheet: index };
    }
    case "set_sheet_color": {
      const sheet = getSheet(wb, op.sheet);
      return withSheet(wb, sheet, { ...sheet, color: op.color ?? undefined });
    }
    case "set_active_sheet": {
      const idx = wb.sheets.indexOf(getSheet(wb, op.sheet));
      return { ...wb, activeSheet: idx };
    }

    case "add_named_range": {
      const name = op.name.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) || /^[A-Za-z]+\d+$/.test(name)) throw new Error(`"${op.name}" is not a valid range name (letters, digits, underscore; must not look like a cell)`);
      const { sheet, range } = resolveRange(wb, op.ref, getSheet(wb, null));
      return { ...wb, namedRanges: { ...wb.namedRanges, [name]: `${/^[A-Za-z0-9_.]+$/.test(sheet.name) ? sheet.name : `'${sheet.name}'`}!${rangeToA1(range)}` } };
    }
    case "remove_named_range": {
      const namedRanges = { ...wb.namedRanges };
      delete namedRanges[op.name];
      return { ...wb, namedRanges };
    }

    case "add_validation": {
      const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet));
      const v: DataValidation = { id: op.id ?? `dv_${nanoid(6)}`, range: rangeToA1(range), kind: op.kind, list: op.list, min: op.min, max: op.max, message: op.message, allowBlank: true };
      return withSheet(wb, sheet, { ...sheet, validations: [...(sheet.validations ?? []), v] });
    }
    case "remove_validation": {
      const sheet = getSheet(wb, op.sheet);
      return withSheet(wb, sheet, { ...sheet, validations: (sheet.validations ?? []).filter((v) => v.id !== op.id) });
    }

    case "set_page_setup":
      return { ...wb, pageSetup: { ...(wb.pageSetup ?? {} as PageSetup), ...op.patch, margins: { ...(wb.pageSetup?.margins ?? { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 }), ...(op.patch.margins ?? {}) } } as PageSetup };

    case "build_table": {
      const sheet = getSheet(wb, op.sheet);
      const anchor = parseA1(op.anchor);
      const cells: CellInput[] = [];
      const professional = (op.style ?? "professional") === "professional";
      const headerStyle: Partial<CellStyle> = professional ? { bold: true, fill: HEADER_FILL, color: HEADER_COLOR, border: "thin", align: "left" } : { bold: true, border: "bottom" };
      op.headers.forEach((h, j) => cells.push({ ref: toA1(anchor.row, anchor.col + j), value: h, style: headerStyle }));
      const numericCols = new Set<number>();
      op.rows.forEach((row, i) => row.forEach((v, j) => {
        const ref = toA1(anchor.row + 1 + i, anchor.col + j);
        const isFormula = typeof v === "string" && v.startsWith("=") && v.length > 1;
        if (typeof v === "number" || isFormula) numericCols.add(j);
        const style: Partial<CellStyle> = professional ? { border: "thin", ...(i % 2 === 1 ? { fill: BAND_FILL } : {}) } : {};
        if (typeof v === "number" && op.number_format) style.numFmt = op.number_format;
        cells.push(isFormula ? { ref, formula: v as string, style } : { ref, value: v, style });
      }));
      if (op.total_row && op.rows.length) {
        const totalRow = anchor.row + 1 + op.rows.length;
        cells.push({ ref: toA1(totalRow, anchor.col), value: "Total", style: { bold: true, fill: professional ? TOTAL_FILL : undefined, border: "top" } });
        for (let j = 1; j < op.headers.length; j++) {
          const ref = toA1(totalRow, anchor.col + j);
          if (numericCols.has(j)) cells.push({ ref, formula: `=SUM(${toA1(anchor.row + 1, anchor.col + j)}:${toA1(anchor.row + op.rows.length, anchor.col + j)})`, style: { bold: true, fill: professional ? TOTAL_FILL : undefined, border: "top", ...(op.number_format ? { numFmt: op.number_format } : {}) } });
          else cells.push({ ref, value: null, style: { bold: true, fill: professional ? TOTAL_FILL : undefined, border: "top" } });
        }
      }
      let out = applyOp(wb, { type: "set_cells", sheet: sheet.id, cells });
      if (professional && anchor.row === 0) out = applyOp(out, { type: "freeze_panes", sheet: sheet.id, rows: 1, cols: 0 });
      out = applyOp(out, { type: "autofit_columns", sheet: sheet.id, columns: op.headers.map((_, j) => colToLetter(anchor.col + j)) });
      return out;
    }

    case "paste_block": {
      const sheet = getSheet(wb, op.sheet);
      const anchor = parseA1(op.anchor);
      const next = cloneSheet(sheet);
      op.block.forEach((row, i) => row.forEach((cell, j) => {
        const ref = toA1(anchor.row + i, anchor.col + j);
        if (!cell) { delete next.cells[ref]; return; }
        if (cell.f && op.origin) next.cells[ref] = { ...cell, f: shiftFormula(cell.f, anchor.row - op.origin.row, anchor.col - op.origin.col) };
        else next.cells[ref] = { ...cell };
      }));
      return withSheet(wb, sheet, next);
    }
  }
  return wb;
}

/** Sheet + A1 range an op touches, for previews and "locate". */
export function opTarget(wb: Workbook, op: SheetOp): { sheet: string; range: string } | null {
  try {
    switch (op.type) {
      case "set_cells": { const s = getSheet(wb, op.sheet); const refs = op.cells.map((c) => c.ref); if (!refs.length) return null; let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1; for (const r of refs) { const p = parseA1(r); r0 = Math.min(r0, p.row); r1 = Math.max(r1, p.row); c0 = Math.min(c0, p.col); c1 = Math.max(c1, p.col); } return { sheet: s.name, range: rangeToA1({ start: { row: r0, col: c0 }, end: { row: r1, col: c1 } }) }; }
      case "clear_range": case "fill_range": case "style_range": case "set_number_format": case "merge_cells": case "unmerge_cells": case "sort_range": case "add_filter": case "conditional_format": case "add_validation": { const { sheet, range } = resolveRange(wb, op.range, getSheet(wb, op.sheet)); return { sheet: sheet.name, range: rangeToA1(range) }; }
      case "set_formula_column": { const s = getSheet(wb, op.sheet); return { sheet: s.name, range: `${op.column}${op.from_row}:${op.column}${op.to_row}` }; }
      case "autofill": { const s = getSheet(wb, op.sheet); return { sheet: s.name, range: op.target }; }
      case "insert_rows": case "delete_rows": { const s = getSheet(wb, op.sheet); return { sheet: s.name, range: `${op.index + 1}:${op.index + (op.count ?? 1)}` }; }
      case "insert_cols": case "delete_cols": { const s = getSheet(wb, op.sheet); return { sheet: s.name, range: `${colToLetter(op.index)}:${colToLetter(op.index + (op.count ?? 1) - 1)}` }; }
      case "set_column_width": case "autofit_columns": { const s = getSheet(wb, op.sheet); const cols = op.columns ?? []; return cols.length ? { sheet: s.name, range: `${cols[0]}:${cols[cols.length - 1]}` } : { sheet: s.name, range: "A1" }; }
      case "add_chart": { const s = getSheet(wb, op.sheet); return { sheet: s.name, range: op.chart.range }; }
      case "build_table": { const s = getSheet(wb, op.sheet); const a = parseA1(op.anchor); return { sheet: s.name, range: rangeToA1({ start: a, end: { row: a.row + op.rows.length + (op.total_row ? 1 : 0), col: a.col + Math.max(0, op.headers.length - 1) } }) }; }
      case "paste_block": { const s = getSheet(wb, op.sheet); const a = parseA1(op.anchor); return { sheet: s.name, range: rangeToA1({ start: a, end: { row: a.row + op.block.length - 1, col: a.col + Math.max(0, (op.block[0]?.length ?? 1) - 1) } }) }; }
      case "freeze_panes": case "set_row_height": case "rename_sheet": case "set_sheet_color": case "clear_filter": case "set_filter_criteria": case "remove_conditional_format": case "update_chart": case "remove_chart": case "remove_validation": { const s = getSheet(wb, op.sheet); return { sheet: s.name, range: "A1" }; }
      default: return null;
    }
  } catch { return null; }
}

export function describeOp(op: SheetOp): string {
  switch (op.type) {
    case "set_cells": return `Set ${op.cells.length} cell${op.cells.length === 1 ? "" : "s"}`;
    case "clear_range": return `Clear ${op.range}`;
    case "fill_range": return `Fill ${op.range} with ${op.pattern}`;
    case "set_formula_column": return `Formula column ${op.column}${op.from_row}:${op.column}${op.to_row}`;
    case "autofill": return `Autofill ${op.target}`;
    case "insert_rows": return `Insert ${op.count ?? 1} row${(op.count ?? 1) === 1 ? "" : "s"} at ${op.index + 1}`;
    case "delete_rows": return `Delete ${op.count ?? 1} row${(op.count ?? 1) === 1 ? "" : "s"} at ${op.index + 1}`;
    case "insert_cols": return `Insert ${op.count ?? 1} column${(op.count ?? 1) === 1 ? "" : "s"} at ${colToLetter(op.index)}`;
    case "delete_cols": return `Delete ${op.count ?? 1} column${(op.count ?? 1) === 1 ? "" : "s"} at ${colToLetter(op.index)}`;
    case "style_range": return `Style ${op.range}`;
    case "set_number_format": return `Format ${op.range} as ${op.numFmt}`;
    case "set_column_width": return `Column width ${op.columns.join(", ")} → ${op.width}px`;
    case "autofit_columns": return `Autofit ${op.columns?.join(", ") ?? "all columns"}`;
    case "set_row_height": return `Row height → ${op.height}px`;
    case "merge_cells": return `Merge ${op.range}`;
    case "unmerge_cells": return `Unmerge ${op.range}`;
    case "freeze_panes": return `Freeze ${op.rows} row${op.rows === 1 ? "" : "s"}, ${op.cols} column${op.cols === 1 ? "" : "s"}`;
    case "sort_range": return `Sort ${op.range} by ${op.by} ${op.order === "desc" ? "Z→A" : "A→Z"}`;
    case "add_filter": return `Filter ${op.range}`;
    case "set_filter_criteria": return `Filter column ${op.column}`;
    case "clear_filter": return "Clear filter";
    case "conditional_format": return `Conditional format ${op.range} (${op.rule.kind})`;
    case "remove_conditional_format": return "Remove conditional format";
    case "add_chart": return `Add ${op.chart.type} chart "${op.chart.title}"`;
    case "update_chart": return "Update chart";
    case "remove_chart": return "Remove chart";
    case "add_sheet": return `Add sheet "${op.name}"`;
    case "rename_sheet": return `Rename sheet to "${op.name}"`;
    case "delete_sheet": return `Delete sheet "${op.sheet}"`;
    case "reorder_sheet": return "Reorder sheets";
    case "set_sheet_color": return "Sheet tab color";
    case "set_active_sheet": return `Switch to ${op.sheet}`;
    case "add_named_range": return `Name ${op.ref} as ${op.name}`;
    case "remove_named_range": return `Remove name ${op.name}`;
    case "add_validation": return `Data validation on ${op.range}`;
    case "remove_validation": return "Remove validation";
    case "set_page_setup": return "Page setup";
    case "build_table": return `Build table at ${op.anchor} (${op.headers.length} columns, ${op.rows.length} rows)`;
    case "paste_block": return `Paste at ${op.anchor}`;
    case "replace_workbook": return "Replace workbook";
    case "batch": return `${op.ops.length} operations`;
  }
}

/** Number of rows currently hidden by the sheet's filter. */
export function filteredRows(sheet: Sheet, computed: (ref: string) => CellValue | undefined): Set<number> {
  const hidden = new Set<number>();
  if (!sheet.filters) return hidden;
  const range = normalizeRange(parseRange(sheet.filters.range));
  const entries = Object.entries(sheet.filters.criteria);
  if (!entries.length) return hidden;
  for (let r = range.start.row + 1; r <= range.end.row; r++) {
    for (const [colLetter, crit] of entries) {
      const ref = toA1(r, letterToCol(colLetter));
      const cell = sheet.cells[ref];
      const value = cell?.f ? computed(ref) : cell?.v;
      const text = value === undefined || value === null ? "" : String(value);
      if (crit.values && !crit.values.includes(text)) { hidden.add(r); break; }
      if (crit.condition) {
        const { op, value: cv } = crit.condition;
        const num = toNumber(value), cnum = typeof cv === "number" ? cv : toNumber(cv ?? null);
        const lower = text.toLowerCase(), clower = String(cv ?? "").toLowerCase();
        let ok = true;
        switch (op) {
          case "contains": ok = lower.includes(clower); break;
          case "notContains": ok = !lower.includes(clower); break;
          case "startsWith": ok = lower.startsWith(clower); break;
          case "eq": ok = num !== null && cnum !== null ? num === cnum : lower === clower; break;
          case "neq": ok = num !== null && cnum !== null ? num !== cnum : lower !== clower; break;
          case "gt": ok = num !== null && cnum !== null && num > cnum; break;
          case "gte": ok = num !== null && cnum !== null && num >= cnum; break;
          case "lt": ok = num !== null && cnum !== null && num < cnum; break;
          case "lte": ok = num !== null && cnum !== null && num <= cnum; break;
          case "blank": ok = text === ""; break;
          case "notBlank": ok = text !== ""; break;
        }
        if (!ok) { hidden.add(r); break; }
      }
    }
  }
  return hidden;
}

export type { RangeRef, ChartType };
