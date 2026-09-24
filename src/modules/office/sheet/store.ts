"use client";
/**
 * Editor state (zustand). Owns the workbook, keeps the formula engine in sync,
 * records undo/redo history (whole-workbook snapshots with structural
 * sharing), and holds selection / editing / clipboard state for the grid.
 */
import { create } from "zustand";
import { normalizeRange, parseA1, parseRange, rangeToA1, shiftFormula, toA1, type RangeRef } from "./a1";
import { SheetEngine, type Computed } from "./engine";
import { currentRegion, emptyWorkbook, getSheet, gridDimensions, normalizeWorkbook, type Cell, type Sheet, type Workbook } from "./model";
import { applyOp, type SheetOp } from "./ops";

export interface CellPos { row: number; col: number }
export interface Selection { ranges: RangeRef[]; active: CellPos; anchor: CellPos }
export interface EditingState { ref: string; value: string; initial: string; source: "type" | "dblclick" | "formulaBar" | "f2"; caretAtEnd?: boolean }
export interface ClipboardState { sheetId: string; range: RangeRef; block: (Cell | null)[][]; tsv: string; cut: boolean }
export interface PreviewHighlight { sheetId: string; range: RangeRef; kind: "proposal" | "find" }

const HISTORY_LIMIT = 120;

export interface SheetStore {
  workbook: Workbook;
  computed: Computed;
  engine: SheetEngine;
  past: Workbook[];
  future: Workbook[];
  /** Incremented on every workbook change so effects can react cheaply. */
  revision: number;
  selection: Selection;
  editing: EditingState | null;
  clipboard: ClipboardState | null;
  preview: PreviewHighlight | null;
  highlightRanges: { range: RangeRef; color: string; sheetId?: string }[];
  pageBreaks: boolean;
  showFormulas: boolean;
  zoom: number;
  onChange: ((wb: Workbook) => void) | null;

  load: (wb: Workbook | unknown) => void;
  setOnChange: (cb: ((wb: Workbook) => void) | null) => void;
  apply: (op: SheetOp, opts?: { undoable?: boolean; silent?: boolean }) => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  activeSheet: () => Sheet;
  setActiveSheet: (key: string | number) => void;
  setSelection: (sel: Selection) => void;
  selectCell: (row: number, col: number, opts?: { extend?: boolean; add?: boolean }) => void;
  selectRange: (range: RangeRef, opts?: { active?: CellPos }) => void;
  selectRows: (from: number, to: number) => void;
  selectCols: (from: number, to: number) => void;
  selectAll: () => void;
  moveActive: (dRow: number, dCol: number, opts?: { extend?: boolean; jump?: boolean; wrapSelection?: boolean }) => void;
  startEdit: (opts: { source: EditingState["source"]; initial?: string; ref?: string }) => void;
  updateEdit: (value: string) => void;
  commitEdit: (move?: { dRow: number; dCol: number } | null) => boolean;
  cancelEdit: () => void;
  copy: (cut?: boolean) => ClipboardState | null;
  paste: (opts?: { text?: string; valuesOnly?: boolean }) => boolean;
  clearSelection: (what?: "all" | "contents" | "formats") => void;
  setPreview: (p: PreviewHighlight | null) => void;
  setHighlightRanges: (r: SheetStore["highlightRanges"]) => void;
  setPageBreaks: (v: boolean) => void;
  setShowFormulas: (v: boolean) => void;
  setZoom: (z: number) => void;
  selectionRange: () => RangeRef;
  selectionA1: () => string;
}

function primaryRange(sel: Selection): RangeRef {
  return sel.ranges[sel.ranges.length - 1] ?? { start: sel.active, end: sel.active };
}

function makeSelection(a: CellPos, b: CellPos, active?: CellPos): Selection {
  return { ranges: [normalizeRange({ start: a, end: b })], active: active ?? a, anchor: a };
}

export const useSheetStore = create<SheetStore>((set, get) => ({
  workbook: emptyWorkbook(),
  computed: {},
  engine: new SheetEngine(),
  past: [],
  future: [],
  revision: 0,
  selection: makeSelection({ row: 0, col: 0 }, { row: 0, col: 0 }),
  editing: null,
  clipboard: null,
  preview: null,
  highlightRanges: [],
  pageBreaks: false,
  showFormulas: false,
  zoom: 1,
  onChange: null,

  load: (raw) => {
    const wb = normalizeWorkbook(raw);
    const engine = get().engine;
    const computed = engine.sync(wb);
    set({ workbook: wb, computed, past: [], future: [], revision: get().revision + 1, selection: makeSelection({ row: 0, col: 0 }, { row: 0, col: 0 }), editing: null, preview: null });
  },
  setOnChange: (cb) => set({ onChange: cb }),

  apply: (op, opts = {}) => {
    const { workbook, engine, past, onChange } = get();
    let next: Workbook;
    try { next = applyOp(workbook, op); } catch (e) { console.warn("[sheet] op failed", op.type, (e as Error).message); throw e; }
    if (next === workbook) return false;
    const computed = engine.sync(next);
    const undoable = opts.undoable !== false;
    set({ workbook: next, computed, past: undoable ? [...past.slice(-HISTORY_LIMIT + 1), workbook] : past, future: undoable ? [] : get().future, revision: get().revision + 1 });
    if (!opts.silent) onChange?.(next);
    // keep selection valid when sheets change
    const s = get();
    if (s.workbook.activeSheet !== workbook.activeSheet || s.workbook.sheets.length !== workbook.sheets.length) set({ selection: makeSelection({ row: 0, col: 0 }, { row: 0, col: 0 }), editing: null });
    return true;
  },
  undo: () => {
    const { past, workbook, engine, onChange } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const computed = engine.sync(prev);
    set({ workbook: prev, computed, past: past.slice(0, -1), future: [workbook, ...get().future].slice(0, HISTORY_LIMIT), revision: get().revision + 1, editing: null });
    onChange?.(prev);
  },
  redo: () => {
    const { future, workbook, engine, onChange } = get();
    if (!future.length) return;
    const next = future[0];
    const computed = engine.sync(next);
    set({ workbook: next, computed, future: future.slice(1), past: [...get().past, workbook].slice(-HISTORY_LIMIT), revision: get().revision + 1, editing: null });
    onChange?.(next);
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  activeSheet: () => { const wb = get().workbook; return wb.sheets[wb.activeSheet] ?? wb.sheets[0]; },
  setActiveSheet: (key) => {
    const wb = get().workbook;
    const idx = typeof key === "number" ? key : wb.sheets.findIndex((s) => s.id === key || s.name === key);
    if (idx < 0 || idx === wb.activeSheet) return;
    get().commitEdit(null);
    const next = { ...wb, activeSheet: idx };
    set({ workbook: next, selection: makeSelection({ row: 0, col: 0 }, { row: 0, col: 0 }), editing: null, revision: get().revision + 1 });
    get().onChange?.(next);
  },

  setSelection: (sel) => set({ selection: sel }),
  selectCell: (row, col, opts = {}) => {
    const sel = get().selection;
    const dims = gridDimensions(get().activeSheet());
    row = Math.max(0, Math.min(dims.rows - 1, row)); col = Math.max(0, Math.min(dims.cols - 1, col));
    if (opts.extend) { const r = normalizeRange({ start: sel.anchor, end: { row, col } }); set({ selection: { ...sel, ranges: [...sel.ranges.slice(0, -1), r], active: { row, col } } }); return; }
    if (opts.add) { set({ selection: { ranges: [...sel.ranges, { start: { row, col }, end: { row, col } }], active: { row, col }, anchor: { row, col } } }); return; }
    set({ selection: makeSelection({ row, col }, { row, col }) });
  },
  selectRange: (range, opts = {}) => { const n = normalizeRange(range); set({ selection: { ranges: [n], active: opts.active ?? n.start, anchor: n.start } }); },
  selectRows: (from, to) => { const dims = gridDimensions(get().activeSheet()); const r = normalizeRange({ start: { row: from, col: 0 }, end: { row: to, col: dims.cols - 1 } }); set({ selection: { ranges: [r], active: { row: Math.min(from, to), col: 0 }, anchor: { row: from, col: 0 } } }); },
  selectCols: (from, to) => { const dims = gridDimensions(get().activeSheet()); const r = normalizeRange({ start: { row: 0, col: from }, end: { row: dims.rows - 1, col: to } }); set({ selection: { ranges: [r], active: { row: 0, col: Math.min(from, to) }, anchor: { row: 0, col: from } } }); },
  selectAll: () => {
    const sheet = get().activeSheet();
    const sel = get().selection;
    const region = currentRegion(sheet, sel.active.row, sel.active.col);
    const cur = primaryRange(sel);
    const isRegion = cur.start.row === region.start.row && cur.end.row === region.end.row && cur.start.col === region.start.col && cur.end.col === region.end.col;
    const dims = gridDimensions(sheet);
    const all = { start: { row: 0, col: 0 }, end: { row: dims.rows - 1, col: dims.cols - 1 } };
    const single = region.start.row === region.end.row && region.start.col === region.end.col;
    set({ selection: { ...sel, ranges: [isRegion || single ? all : region] } });
  },
  moveActive: (dRow, dCol, opts = {}) => {
    const { selection, activeSheet } = get();
    const sheet = activeSheet();
    const dims = gridDimensions(sheet);
    const from = opts.extend ? selection.active : selection.active;
    let row = from.row, col = from.col;
    if (opts.jump) {
      const has = (r: number, c: number) => { const cell = sheet.cells[toA1(r, c)]; return Boolean(cell && (cell.f || (cell.v !== undefined && cell.v !== null && cell.v !== ""))); };
      const stepR = Math.sign(dRow), stepC = Math.sign(dCol);
      const startHas = has(row, col);
      const nextHas = has(row + stepR, col + stepC);
      let r = row + stepR, c = col + stepC;
      const inBounds = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < dims.rows && cc < dims.cols;
      if (startHas && nextHas) { while (inBounds(r + stepR, c + stepC) && has(r + stepR, c + stepC)) { r += stepR; c += stepC; } }
      else { while (inBounds(r, c) && !has(r, c)) { r += stepR; c += stepC; } if (!inBounds(r, c)) { r = stepR > 0 ? dims.rows - 1 : stepR < 0 ? 0 : row; c = stepC > 0 ? dims.cols - 1 : stepC < 0 ? 0 : col; } }
      row = r; col = c;
    } else if (opts.wrapSelection && selection.ranges.length === 1 && (primaryRange(selection).start.row !== primaryRange(selection).end.row || primaryRange(selection).start.col !== primaryRange(selection).end.col)) {
      // Enter/Tab inside a multi-cell selection walks through it
      const r = primaryRange(selection);
      if (dRow) { row += dRow; if (row > r.end.row) { row = r.start.row; col = col + 1 > r.end.col ? r.start.col : col + 1; } if (row < r.start.row) { row = r.end.row; col = col - 1 < r.start.col ? r.end.col : col - 1; } }
      else { col += dCol; if (col > r.end.col) { col = r.start.col; row = row + 1 > r.end.row ? r.start.row : row + 1; } if (col < r.start.col) { col = r.end.col; row = row - 1 < r.start.row ? r.end.row : row - 1; } }
      set({ selection: { ...selection, active: { row, col } } });
      return;
    } else { row += dRow; col += dCol; }
    row = Math.max(0, Math.min(dims.rows - 1, row)); col = Math.max(0, Math.min(dims.cols - 1, col));
    if (opts.extend) { const r = normalizeRange({ start: selection.anchor, end: { row, col } }); set({ selection: { ...selection, ranges: [...selection.ranges.slice(0, -1), r], active: { row, col } } }); }
    else set({ selection: makeSelection({ row, col }, { row, col }) });
  },

  startEdit: ({ source, initial, ref }) => {
    const { selection, activeSheet } = get();
    const sheet = activeSheet();
    const target = ref ?? toA1(selection.active.row, selection.active.col);
    const cell = sheet.cells[target];
    const current = cell?.f ? cell.f : cell?.v === undefined || cell?.v === null ? "" : typeof cell.v === "boolean" ? (cell.v ? "TRUE" : "FALSE") : String(cell.v);
    const value = initial !== undefined ? initial : current;
    set({ editing: { ref: target, value, initial: current, source, caretAtEnd: true } });
  },
  updateEdit: (value) => { const e = get().editing; if (e) set({ editing: { ...e, value } }); },
  commitEdit: (move) => {
    const { editing, activeSheet, apply } = get();
    if (!editing) return false;
    const sheet = activeSheet();
    set({ editing: null, highlightRanges: [] });
    if (editing.value !== editing.initial) {
      const v = editing.value;
      try { apply({ type: "set_cells", sheet: sheet.id, cells: [{ ref: editing.ref, value: v, formula: v.startsWith("=") && v.length > 1 ? v : null }], parse: !(v.startsWith("=") && v.length > 1) }); }
      catch { return false; }
    }
    if (move) get().moveActive(move.dRow, move.dCol, { wrapSelection: true });
    return true;
  },
  cancelEdit: () => set({ editing: null, highlightRanges: [] }),

  copy: (cut = false) => {
    const { selection, activeSheet, computed } = get();
    const sheet = activeSheet();
    const r = primaryRange(selection);
    const rows = r.end.row - r.start.row + 1, cols = r.end.col - r.start.col + 1;
    if (rows * cols > 200_000) return null;
    const block: (Cell | null)[][] = [];
    const tsvRows: string[] = [];
    for (let i = 0; i < rows; i++) {
      const row: (Cell | null)[] = [];
      const t: string[] = [];
      for (let j = 0; j < cols; j++) {
        const ref = toA1(r.start.row + i, r.start.col + j);
        const cell = sheet.cells[ref] ?? null;
        row.push(cell ? { ...cell } : null);
        const v = cell?.f ? computed[sheet.id]?.[ref]?.v : cell?.v;
        t.push(v == null ? "" : String(v));
      }
      block.push(row);
      tsvRows.push(t.join("\t"));
    }
    const clip: ClipboardState = { sheetId: sheet.id, range: r, block, tsv: tsvRows.join("\n"), cut };
    set({ clipboard: clip });
    return clip;
  },
  paste: (opts = {}) => {
    const { selection, activeSheet, clipboard, apply } = get();
    const sheet = activeSheet();
    const anchor = selection.active;
    const useInternal = clipboard && (opts.text === undefined || opts.text === clipboard.tsv);
    if (useInternal && clipboard) {
      const block = opts.valuesOnly ? clipboard.block.map((row, i) => row.map((c, j) => { if (!c) return null; if (!c.f) return c; const ref = toA1(clipboard.range.start.row + i, clipboard.range.start.col + j); const v = get().computed[clipboard.sheetId]?.[ref]?.v ?? null; return { v, t: typeof v === "number" ? "n" as const : typeof v === "boolean" ? "b" as const : "s" as const, ...(c.s ? { s: c.s } : {}) }; })) : clipboard.block;
      const ops: SheetOp[] = [];
      if (clipboard.cut) ops.push({ type: "clear_range", sheet: clipboard.sheetId, range: rangeToA1(clipboard.range), what: "all" });
      // Fill the selection when it is a multiple of the block (Excel behaviour)
      const sel = primaryRange(selection);
      const selRows = sel.end.row - sel.start.row + 1, selCols = sel.end.col - sel.start.col + 1;
      const bRows = block.length, bCols = block[0]?.length ?? 0;
      const repeatR = selRows > 1 && selRows % bRows === 0 ? selRows / bRows : 1;
      const repeatC = selCols > 1 && selCols % bCols === 0 ? selCols / bCols : 1;
      for (let ri = 0; ri < repeatR; ri++) for (let ci = 0; ci < repeatC; ci++) ops.push({ type: "paste_block", sheet: sheet.id, anchor: toA1(sel.start.row + ri * bRows, sel.start.col + ci * bCols), block, origin: clipboard.range.start });
      const ok = apply({ type: "batch", ops });
      if (clipboard.cut) set({ clipboard: null });
      const end = { row: sel.start.row + repeatR * bRows - 1, col: sel.start.col + repeatC * bCols - 1 };
      set({ selection: { ranges: [{ start: sel.start, end }], active: sel.start, anchor: sel.start } });
      return ok;
    }
    const text = opts.text ?? "";
    if (!text) return false;
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const cells = [] as { ref: string; value: string }[];
    lines.forEach((line, i) => line.split("\t").forEach((v, j) => cells.push({ ref: toA1(anchor.row + i, anchor.col + j), value: v })));
    if (!cells.length) return false;
    const ok = apply({ type: "set_cells", sheet: sheet.id, cells, parse: true });
    const end = { row: anchor.row + lines.length - 1, col: anchor.col + Math.max(0, (lines[0]?.split("\t").length ?? 1) - 1) };
    set({ selection: { ranges: [{ start: anchor, end }], active: anchor, anchor } });
    return ok;
  },
  clearSelection: (what = "contents") => {
    const { selection, activeSheet, apply } = get();
    const sheet = activeSheet();
    const ops: SheetOp[] = selection.ranges.map((r) => ({ type: "clear_range", sheet: sheet.id, range: rangeToA1(r), what }));
    apply(ops.length === 1 ? ops[0] : { type: "batch", ops });
  },
  setPreview: (p) => set({ preview: p }),
  setHighlightRanges: (r) => set({ highlightRanges: r }),
  setPageBreaks: (v) => set({ pageBreaks: v }),
  setShowFormulas: (v) => set({ showFormulas: v }),
  setZoom: (z) => set({ zoom: Math.max(0.5, Math.min(2, z)) }),
  selectionRange: () => primaryRange(get().selection),
  selectionA1: () => rangeToA1(primaryRange(get().selection)),
}));

export { parseA1, parseRange, rangeToA1, shiftFormula, getSheet };
