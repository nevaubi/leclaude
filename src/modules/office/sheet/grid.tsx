"use client";
/**
 * Virtualized spreadsheet grid: rows and columns are virtualized with
 * @tanstack/react-virtual inside one scroll container; column/row headers and
 * frozen panes are sticky bands; selection, fill handle, in-cell editing,
 * formula reference highlighting, charts, filters and page breaks are
 * overlays positioned from prefix-summed row/column offsets.
 */
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Filter, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OfficeComment } from "@/lib/types/domain";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { colToLetter, formulaReferences, normalizeRange, parseRange, rangeToA1, toA1, type RangeRef } from "./a1";
import { conditionalStyles, mergeMap, renderCell } from "./cell-render";
import { COMMON_FUNCTIONS } from "./engine";
import { COL_HEADER_HEIGHT, colWidth, currentRegion, gridDimensions, NUMBER_FORMATS, PAPER_SIZES, ROW_HEADER_WIDTH, rowHeight, usedRange, type DataValidation, type Sheet } from "./model";
import { filteredRows } from "./ops";
import { toNumber, isoToSerial } from "./format";
import { useSheetStore, type CellPos } from "./store";
import { ChartOverlay } from "./charts";
import { FilterPopover } from "./filter-popover";

const REF_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const FN_NAMES = COMMON_FUNCTIONS.map((f) => f.name);

export interface GridProps {
  comments: OfficeComment[];
  onOpenComment: (anchor: string) => void;
  onAddComment: (ref: string) => void;
  onInsertChart: (type: "bar" | "line" | "pie") => void;
  onLayout?: (info: { firstRow: number; lastRow: number; pages: number }) => void;
  onEditChart?: (id: string) => void;
  className?: string;
}

function prefix(count: number, size: (i: number) => number): number[] {
  const out = new Array<number>(count + 1);
  out[0] = 0;
  for (let i = 0; i < count; i++) out[i + 1] = out[i] + size(i);
  return out;
}

function indexAt(starts: number[], pos: number): number {
  let lo = 0, hi = starts.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
  return lo;
}

export function SheetGrid({ comments, onOpenComment, onAddComment, onInsertChart, onLayout, onEditChart, className }: GridProps) {
  const workbook = useSheetStore((s) => s.workbook);
  const computed = useSheetStore((s) => s.computed);
  const selection = useSheetStore((s) => s.selection);
  const editing = useSheetStore((s) => s.editing);
  const preview = useSheetStore((s) => s.preview);
  const highlightRanges = useSheetStore((s) => s.highlightRanges);
  const showFormulas = useSheetStore((s) => s.showFormulas);
  const pageBreaks = useSheetStore((s) => s.pageBreaks);
  const clipboard = useSheetStore((s) => s.clipboard);
  const store = useSheetStore;
  const sheet: Sheet = workbook.sheets[workbook.activeSheet] ?? workbook.sheets[0];

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [extraRows, setExtraRows] = React.useState(0);
  const [extraCols, setExtraCols] = React.useState(0);
  const [resizing, setResizing] = React.useState<{ axis: "col" | "row"; index: number; start: number; size: number; current: number } | null>(null);
  const [fill, setFill] = React.useState<{ source: RangeRef; target: RangeRef | null } | null>(null);
  const fillRef = React.useRef(fill);
  fillRef.current = fill;
  const resizingRef = React.useRef(resizing);
  resizingRef.current = resizing;
  const [filterUI, setFilterUI] = React.useState<{ col: number; x: number; y: number } | null>(null);
  const [validationUI, setValidationUI] = React.useState<{ ref: string; v: DataValidation } | null>(null);
  const [acIndex, setAcIndex] = React.useState(0);
  const dragRef = React.useRef<{ mode: "select" | "fill" | "refInsert"; base?: string; anchor?: CellPos } | null>(null);

  const dims = React.useMemo(() => { const d = gridDimensions(sheet); return { rows: d.rows + extraRows, cols: d.cols + extraCols }; }, [sheet, extraRows, extraCols]);
  const hiddenRows = React.useMemo(() => filteredRows(sheet, (ref) => computed[sheet.id]?.[ref]?.v ?? undefined), [sheet, computed]);
  const colSize = React.useCallback((i: number) => (resizing?.axis === "col" && resizing.index === i ? resizing.current : colWidth(sheet, i)), [sheet, resizing]);
  const rowSize = React.useCallback((i: number) => (hiddenRows.has(i) ? 0 : resizing?.axis === "row" && resizing.index === i ? resizing.current : rowHeight(sheet, i)), [sheet, hiddenRows, resizing]);
  const colStarts = React.useMemo(() => prefix(dims.cols, colSize), [dims.cols, colSize]);
  const rowStarts = React.useMemo(() => prefix(dims.rows, rowSize), [dims.rows, rowSize]);
  const totalW = colStarts[dims.cols], totalH = rowStarts[dims.rows];
  const fr = Math.min(sheet.freeze.rows, dims.rows - 1), fc = Math.min(sheet.freeze.cols, dims.cols - 1);
  const Hf = rowStarts[fr], Wf = colStarts[fc];

  const rowVirt = useVirtualizer({ count: dims.rows, getScrollElement: () => scrollRef.current, estimateSize: rowSize, overscan: 8, paddingStart: COL_HEADER_HEIGHT });
  const colVirt = useVirtualizer({ horizontal: true, count: dims.cols, getScrollElement: () => scrollRef.current, estimateSize: colSize, overscan: 3, paddingStart: ROW_HEADER_WIDTH });
  React.useEffect(() => { rowVirt.measure(); }, [rowSize, rowVirt]);
  React.useEffect(() => { colVirt.measure(); }, [colSize, colVirt]);

  const rowItems = rowVirt.getVirtualItems();
  const colItems = colVirt.getVirtualItems();
  const cfStyles = React.useMemo(() => conditionalStyles(sheet, computed), [sheet, computed]);
  const merges = React.useMemo(() => mergeMap(sheet), [sheet]);
  const commentAnchors = React.useMemo(() => { const m = new Map<string, number>(); for (const c of comments) { if (c.resolved) continue; const bang = c.anchor.indexOf("!"); const sn = bang > 0 ? c.anchor.slice(0, bang) : sheet.name; const ref = bang > 0 ? c.anchor.slice(bang + 1) : c.anchor; if (sn === sheet.name) m.set(ref, (m.get(ref) ?? 0) + 1); } return m; }, [comments, sheet.name]);
  const validationAt = React.useCallback((row: number, col: number): DataValidation | null => { for (const v of sheet.validations ?? []) { try { const r = normalizeRange(parseRange(v.range)); if (row >= r.start.row && row <= r.end.row && col >= r.start.col && col <= r.end.col) return v; } catch { /* ignore */ } } return null; }, [sheet.validations]);
  const filterHeader = React.useMemo(() => { if (!sheet.filters) return null; try { return normalizeRange(parseRange(sheet.filters.range)); } catch { return null; } }, [sheet.filters]);

  // grow the grid when scrolling near the edge
  React.useEffect(() => {
    const last = rowItems[rowItems.length - 1]?.index ?? 0;
    if (last > dims.rows - 30) setExtraRows((e) => e + 200);
    const lastCol = colItems[colItems.length - 1]?.index ?? 0;
    if (lastCol > dims.cols - 5) setExtraCols((e) => e + 10);
  }, [rowItems, colItems, dims.rows, dims.cols]);
  React.useEffect(() => { setExtraRows(0); setExtraCols(0); }, [sheet.id]);

  // page breaks
  const pageInfo = React.useMemo(() => {
    const ps = workbook.pageSetup;
    if (!ps) return { xs: [] as number[], ys: [] as number[], pages: 1 };
    const paper = PAPER_SIZES[ps.paper] ?? PAPER_SIZES.letter;
    const pw = ((ps.orientation === "landscape" ? paper.h : paper.w) - ps.margins.left - ps.margins.right) * 96;
    const ph = ((ps.orientation === "landscape" ? paper.w : paper.h) - ps.margins.top - ps.margins.bottom) * 96;
    const ur = usedRange(sheet);
    const xs: number[] = [], ys: number[] = [];
    if (!ur) return { xs, ys, pages: 1 };
    let acc = 0;
    for (let c = 0; c <= ur.end.col; c++) { const w = colSize(c); if (acc + w > pw && acc > 0) { xs.push(colStarts[c]); acc = 0; } acc += w; }
    acc = 0;
    for (let r = 0; r <= ur.end.row; r++) { const h = rowSize(r); if (acc + h > ph && acc > 0) { ys.push(rowStarts[r]); acc = 0; } acc += h; }
    return { xs, ys, pages: (xs.length + 1) * (ys.length + 1) };
  }, [workbook.pageSetup, sheet, colSize, rowSize, colStarts, rowStarts]);

  const layoutRef = React.useRef("");
  React.useEffect(() => {
    const visible = rowItems.filter((r) => r.size > 0 && r.index >= fr);
    const info = { firstRow: (visible[0]?.index ?? 0) + 1, lastRow: (visible[visible.length - 1]?.index ?? 0) + 1, pages: pageInfo.pages };
    const key = `${info.firstRow}-${info.lastRow}-${info.pages}`;
    if (key === layoutRef.current) return;
    layoutRef.current = key;
    onLayout?.(info);
  }, [rowItems, fr, pageInfo.pages, onLayout]);

  // ---------------------------------------------------------------- geometry helpers
  const cellRect = React.useCallback((row: number, col: number) => {
    const span = merges.anchors.get(toA1(row, col));
    const x = ROW_HEADER_WIDTH + colStarts[col], y = COL_HEADER_HEIGHT + rowStarts[row];
    const w = span ? colStarts[Math.min(dims.cols, col + span.cols)] - colStarts[col] : colSize(col);
    const h = span ? rowStarts[Math.min(dims.rows, row + span.rows)] - rowStarts[row] : rowSize(row);
    return { x, y, w, h };
  }, [merges, colStarts, rowStarts, colSize, rowSize, dims]);

  const rangeRect = React.useCallback((r: RangeRef) => {
    const n = normalizeRange(r);
    const c1 = Math.min(dims.cols - 1, n.end.col), r1 = Math.min(dims.rows - 1, n.end.row);
    const x = ROW_HEADER_WIDTH + colStarts[n.start.col], y = COL_HEADER_HEIGHT + rowStarts[n.start.row];
    return { x, y, w: colStarts[c1 + 1] - colStarts[n.start.col], h: rowStarts[r1 + 1] - rowStarts[n.start.row] };
  }, [colStarts, rowStarts, dims]);

  const hitTest = React.useCallback((clientX: number, clientY: number): CellPos | null => {
    const el = scrollRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const lx = clientX - rect.left, ly = clientY - rect.top;
    const inFrozenX = lx < ROW_HEADER_WIDTH + Wf + 0 && fc > 0 && lx >= ROW_HEADER_WIDTH;
    const inFrozenY = ly < COL_HEADER_HEIGHT + Hf && fr > 0 && ly >= COL_HEADER_HEIGHT;
    const x = (inFrozenX ? lx : lx + el.scrollLeft) - ROW_HEADER_WIDTH;
    const y = (inFrozenY ? ly : ly + el.scrollTop) - COL_HEADER_HEIGHT;
    if (x < 0 || y < 0) return null;
    const col = Math.min(dims.cols - 1, indexAt(colStarts, x));
    const row = Math.min(dims.rows - 1, indexAt(rowStarts, y));
    const anchor = merges.covered.get(toA1(row, col));
    if (anchor) { const m = /^([A-Z]+)(\d+)$/.exec(anchor)!; return { row: Number(m[2]) - 1, col: colToLetterIndex(m[1]) }; }
    return { row, col };
  }, [colStarts, rowStarts, dims, merges, Wf, Hf, fc, fr]);

  const scrollIntoView = React.useCallback((row: number, col: number) => {
    const el = scrollRef.current; if (!el) return;
    const { x, y, w, h } = cellRect(row, col);
    const viewL = el.scrollLeft + ROW_HEADER_WIDTH + Wf, viewT = el.scrollTop + COL_HEADER_HEIGHT + Hf;
    const viewR = el.scrollLeft + el.clientWidth, viewB = el.scrollTop + el.clientHeight;
    if (col >= fc) { if (x < viewL) el.scrollLeft = x - ROW_HEADER_WIDTH - Wf; else if (x + w > viewR) el.scrollLeft = x + w - el.clientWidth; }
    if (row >= fr) { if (y < viewT) el.scrollTop = y - COL_HEADER_HEIGHT - Hf; else if (y + h > viewB) el.scrollTop = y + h - el.clientHeight; }
  }, [cellRect, Wf, Hf, fc, fr]);

  React.useEffect(() => { scrollIntoView(selection.active.row, selection.active.col); }, [selection.active, scrollIntoView]);

  // ---------------------------------------------------------------- formula reference highlighting
  React.useEffect(() => {
    if (!editing || !editing.value.startsWith("=")) { if (highlightRanges.length) store.getState().setHighlightRanges([]); return; }
    const refs = formulaReferences(editing.value).filter((r) => !r.sheet || r.sheet === sheet.name);
    store.getState().setHighlightRanges(refs.map((r, i) => ({ range: r, color: REF_COLORS[i % REF_COLORS.length] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.value, sheet.name]);

  // ---------------------------------------------------------------- mouse
  const isRefInsertable = (value: string) => value.startsWith("=") && /[=(,+\-*/:<>&^]\s*$/.test(value);

  const onCellMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) { const pos = hitTest(e.clientX, e.clientY); if (pos && !selection.ranges.some((r) => pos.row >= r.start.row && pos.row <= r.end.row && pos.col >= r.start.col && pos.col <= r.end.col)) store.getState().selectCell(pos.row, pos.col); return; }
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-chart]") || target.closest("[data-filter-btn]") || target.closest("[data-validation-btn]") || target.closest("[data-fill-handle]") || target.closest("[data-editor]")) return;
    const pos = hitTest(e.clientX, e.clientY);
    if (!pos) return;
    const st = store.getState();
    if (st.editing && isRefInsertable(st.editing.value)) {
      e.preventDefault();
      dragRef.current = { mode: "refInsert", base: st.editing.value, anchor: pos };
      st.updateEdit(st.editing.value + toA1(pos.row, pos.col));
      return;
    }
    if (st.editing) st.commitEdit(null);
    e.preventDefault();
    scrollRef.current?.focus();
    if (e.shiftKey) st.selectCell(pos.row, pos.col, { extend: true });
    else if (e.ctrlKey || e.metaKey) st.selectCell(pos.row, pos.col, { add: true });
    else st.selectCell(pos.row, pos.col);
    dragRef.current = { mode: "select" };
  };

  const onCellDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-chart]") || target.closest("[data-editor]")) return;
    const pos = hitTest(e.clientX, e.clientY);
    if (!pos) return;
    store.getState().selectCell(pos.row, pos.col);
    store.getState().startEdit({ source: "dblclick" });
  };

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const pos = hitTest(e.clientX, e.clientY);
      if (!pos) return;
      const st = store.getState();
      if (d.mode === "select") st.selectCell(pos.row, pos.col, { extend: true });
      else if (d.mode === "refInsert" && d.anchor && d.base !== undefined) { const r = normalizeRange({ start: d.anchor, end: pos }); st.updateEdit(d.base + rangeToA1(r)); }
      else if (d.mode === "fill") {
        setFill((f) => {
          if (!f) return f;
          const s = f.source;
          const dRow = pos.row > s.end.row ? pos.row - s.end.row : pos.row < s.start.row ? pos.row - s.start.row : 0;
          const dCol = pos.col > s.end.col ? pos.col - s.end.col : pos.col < s.start.col ? pos.col - s.start.col : 0;
          if (!dRow && !dCol) return { ...f, target: null };
          if (Math.abs(dRow) >= Math.abs(dCol)) return { ...f, target: dRow > 0 ? { start: { row: s.end.row + 1, col: s.start.col }, end: { row: pos.row, col: s.end.col } } : { start: { row: pos.row, col: s.start.col }, end: { row: s.start.row - 1, col: s.end.col } } };
          return { ...f, target: dCol > 0 ? { start: { row: s.start.row, col: s.end.col + 1 }, end: { row: s.end.row, col: pos.col } } : { start: { row: s.start.row, col: pos.col }, end: { row: s.end.row, col: s.start.col - 1 } } };
        });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.mode === "fill") {
        const f = fillRef.current;
        setFill(null);
        if (f?.target) {
          const st = store.getState();
          try { st.apply({ type: "autofill", sheet: sheet.id, source: rangeToA1(f.source), target: rangeToA1(f.target) }); } catch (err) { toast.error((err as Error).message); }
          const all = normalizeRange({ start: { row: Math.min(f.source.start.row, f.target.start.row), col: Math.min(f.source.start.col, f.target.start.col) }, end: { row: Math.max(f.source.end.row, f.target.end.row), col: Math.max(f.source.end.col, f.target.end.col) } });
          st.selectRange(all, { active: f.source.start });
        }
      }
      if (d?.mode === "refInsert") inputRef.current?.focus();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [hitTest, store, sheet.id]);

  // header interactions
  const onColHeaderMouseDown = (e: React.MouseEvent, col: number) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.dataset.resize) { setResizing({ axis: "col", index: col, start: e.clientX, size: colWidth(sheet, col), current: colWidth(sheet, col) }); e.preventDefault(); return; }
    const st = store.getState();
    st.commitEdit(null);
    if (e.shiftKey) { const a = st.selection.anchor.col; st.selectCols(Math.min(a, col), Math.max(a, col)); }
    else st.selectCols(col, col);
    dragRef.current = { mode: "select" };
    scrollRef.current?.focus();
  };
  const onRowHeaderMouseDown = (e: React.MouseEvent, row: number) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.dataset.resize) { setResizing({ axis: "row", index: row, start: e.clientY, size: rowHeight(sheet, row), current: rowHeight(sheet, row) }); e.preventDefault(); return; }
    const st = store.getState();
    st.commitEdit(null);
    if (e.shiftKey) { const a = st.selection.anchor.row; st.selectRows(Math.min(a, row), Math.max(a, row)); }
    else st.selectRows(row, row);
    dragRef.current = { mode: "select" };
    scrollRef.current?.focus();
  };
  React.useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => setResizing((r) => (r ? { ...r, current: Math.max(r.axis === "col" ? 24 : 16, r.size + ((r.axis === "col" ? e.clientX : e.clientY) - r.start)) } : r));
    const onUp = () => {
      const r = resizingRef.current;
      setResizing(null);
      if (!r) return;
      const st = store.getState();
      if (r.axis === "col") { const sel = st.selection.ranges[0]; const cols = sel && sel.start.col <= r.index && sel.end.col >= r.index && sel.end.row - sel.start.row >= dims.rows - 2 ? Array.from({ length: sel.end.col - sel.start.col + 1 }, (_, i) => colToLetter(sel.start.col + i)) : [colToLetter(r.index)]; st.apply({ type: "set_column_width", sheet: sheet.id, columns: cols, width: r.current }); }
      else st.apply({ type: "set_row_height", sheet: sheet.id, rows: [r.index], height: r.current });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing, store, sheet.id, dims.rows]);

  // ---------------------------------------------------------------- keyboard
  const validateCommit = (): boolean => {
    const st = store.getState();
    if (!st.editing) return true;
    const pos = st.selection.active;
    const v = validationAt(pos.row, pos.col);
    if (!v) return true;
    const raw = st.editing.value.trim();
    if (raw === "" || raw.startsWith("=")) return true;
    if (v.kind === "list" && v.list && !v.list.some((x) => x.toLowerCase() === raw.toLowerCase())) { toast.error(`Value must be one of: ${v.list.join(", ")}`); return false; }
    if (v.kind === "number") { const n = toNumber(raw); if (n === null || (v.min != null && n < v.min) || (v.max != null && n > v.max)) { toast.error(v.message ?? `Enter a number${v.min != null ? ` ≥ ${v.min}` : ""}${v.max != null ? ` ≤ ${v.max}` : ""}`); return false; } }
    if (v.kind === "date") { const s = isoToSerial(raw); if (s === null) { toast.error("Enter a date as yyyy-mm-dd"); return false; } }
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const st = store.getState();
    const mod = e.ctrlKey || e.metaKey;
    if (st.editing) return; // the editor textarea handles its own keys
    const key = e.key;
    if (mod && key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); st.undo(); return; }
    if ((mod && key.toLowerCase() === "y") || (mod && e.shiftKey && key.toLowerCase() === "z")) { e.preventDefault(); st.redo(); return; }
    if (mod && key.toLowerCase() === "a") { e.preventDefault(); st.selectAll(); return; }
    if (mod && key.toLowerCase() === "b") { e.preventDefault(); toggleStyle("bold"); return; }
    if (mod && key.toLowerCase() === "i") { e.preventDefault(); toggleStyle("italic"); return; }
    if (mod && key.toLowerCase() === "u") { e.preventDefault(); toggleStyle("underline"); return; }
    if (mod && key === "Enter") { e.preventDefault(); fillSelectionWithActive(); return; }
    if (mod && key.toLowerCase() === "d") { e.preventDefault(); fillDown(); return; }
    if (mod && key.toLowerCase() === "r") { e.preventDefault(); fillRight(); return; }
    if (mod && key === ";") { e.preventDefault(); st.startEdit({ source: "type", initial: new Date().toISOString().slice(0, 10) }); st.commitEdit(null); return; }
    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      const dRow = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0, dCol = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
      st.moveActive(dRow, dCol, { extend: e.shiftKey, jump: mod });
      return;
    }
    if (key === "Tab") { e.preventDefault(); st.moveActive(0, e.shiftKey ? -1 : 1, { wrapSelection: true }); return; }
    if (key === "Enter") { e.preventDefault(); if (e.altKey) { st.startEdit({ source: "f2" }); return; } st.moveActive(e.shiftKey ? -1 : 1, 0, { wrapSelection: true }); return; }
    if (key === "Home") { e.preventDefault(); if (mod) st.selectCell(0, 0, { extend: e.shiftKey }); else st.selectCell(st.selection.active.row, 0, { extend: e.shiftKey }); return; }
    if (key === "End") { e.preventDefault(); const ur = usedRange(sheet); if (mod) st.selectCell(ur?.end.row ?? 0, ur?.end.col ?? 0, { extend: e.shiftKey }); else st.selectCell(st.selection.active.row, ur?.end.col ?? 0, { extend: e.shiftKey }); return; }
    if (key === "PageDown" || key === "PageUp") { e.preventDefault(); const el = scrollRef.current; const vis = Math.max(1, Math.floor(((el?.clientHeight ?? 600) - COL_HEADER_HEIGHT) / 24) - 1); st.moveActive(key === "PageDown" ? vis : -vis, 0, { extend: e.shiftKey }); return; }
    if (key === "Delete" || key === "Backspace") { e.preventDefault(); st.clearSelection("contents"); return; }
    if (key === "F2") { e.preventDefault(); st.startEdit({ source: "f2" }); return; }
    if (key === "Escape") { st.setPreview(null); return; }
    if (key === " " && e.shiftKey) { e.preventDefault(); st.selectRows(st.selectionRange().start.row, st.selectionRange().end.row); return; }
    if (key === " " && mod) { e.preventDefault(); st.selectCols(st.selectionRange().start.col, st.selectionRange().end.col); return; }
    if (mod && key === "+") { e.preventDefault(); insertRows("above"); return; }
    if (mod && key === "-") { e.preventDefault(); deleteRows(); return; }
    if (!mod && !e.altKey && key.length === 1) { e.preventDefault(); st.startEdit({ source: "type", initial: key }); return; }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    const st = store.getState();
    if (st.editing) return;
    const clip = st.copy(false);
    if (!clip) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", clip.tsv);
    e.clipboardData.setData("application/x-leclaude-sheet", JSON.stringify({ tsv: clip.tsv }));
  };
  const onCut = (e: React.ClipboardEvent) => {
    const st = store.getState();
    if (st.editing) return;
    const clip = st.copy(true);
    if (!clip) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", clip.tsv);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const st = store.getState();
    if (st.editing) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    try { st.paste({ text }); } catch (err) { toast.error((err as Error).message); }
  };

  // ---------------------------------------------------------------- helpers used by keys + context menu
  const styleOf = (ref: string) => { const c = sheet.cells[ref]; return c?.s ? workbook.styles[c.s] ?? {} : {}; };
  const toggleStyle = (key: "bold" | "italic" | "underline") => {
    const st = store.getState();
    const active = toA1(st.selection.active.row, st.selection.active.col);
    const cur = Boolean(styleOf(active)[key]);
    st.apply({ type: "batch", ops: st.selection.ranges.map((r) => ({ type: "style_range" as const, sheet: sheet.id, range: rangeToA1(r), style: { [key]: cur ? null : true } })) });
  };
  const fillSelectionWithActive = () => {
    const st = store.getState();
    const r = st.selectionRange();
    const active = sheet.cells[toA1(st.selection.active.row, st.selection.active.col)];
    const pattern = active?.f ?? (active?.v == null ? "" : String(active.v));
    st.apply({ type: "fill_range", sheet: sheet.id, range: rangeToA1(r), pattern: active?.f ? active.f : pattern });
  };
  const fillDown = () => { const st = store.getState(); const r = st.selectionRange(); if (r.end.row === r.start.row) return; st.apply({ type: "autofill", sheet: sheet.id, source: rangeToA1({ start: r.start, end: { row: r.start.row, col: r.end.col } }), target: rangeToA1({ start: { row: r.start.row + 1, col: r.start.col }, end: r.end }) }); };
  const fillRight = () => { const st = store.getState(); const r = st.selectionRange(); if (r.end.col === r.start.col) return; st.apply({ type: "autofill", sheet: sheet.id, source: rangeToA1({ start: r.start, end: { row: r.end.row, col: r.start.col } }), target: rangeToA1({ start: { row: r.start.row, col: r.start.col + 1 }, end: r.end }) }); };
  const insertRows = (where: "above" | "below") => { const st = store.getState(); const r = st.selectionRange(); const n = r.end.row - r.start.row + 1; st.apply({ type: "insert_rows", sheet: sheet.id, index: where === "above" ? r.start.row : r.end.row + 1, count: n }); };
  const insertCols = (where: "left" | "right") => { const st = store.getState(); const r = st.selectionRange(); const n = r.end.col - r.start.col + 1; st.apply({ type: "insert_cols", sheet: sheet.id, index: where === "left" ? r.start.col : r.end.col + 1, count: n }); };
  const deleteRows = () => { const st = store.getState(); const r = st.selectionRange(); st.apply({ type: "delete_rows", sheet: sheet.id, index: r.start.row, count: r.end.row - r.start.row + 1 }); };
  const deleteCols = () => { const st = store.getState(); const r = st.selectionRange(); st.apply({ type: "delete_cols", sheet: sheet.id, index: r.start.col, count: r.end.col - r.start.col + 1 }); };
  const sortSelection = (order: "asc" | "desc") => {
    const st = store.getState();
    let r = st.selectionRange();
    const single = r.start.row === r.end.row && r.start.col === r.end.col;
    if (single) r = currentRegion(sheet, r.start.row, r.start.col);
    const by = colToLetter(st.selection.active.col);
    const headerLike = (() => { const c = sheet.cells[toA1(r.start.row, st.selection.active.col)]; const below = sheet.cells[toA1(r.start.row + 1, st.selection.active.col)]; return typeof c?.v === "string" && !c.f && below && (typeof below.v === "number" || Boolean(below.f) || below.t === "d"); })();
    st.apply({ type: "sort_range", sheet: sheet.id, range: rangeToA1(r), by, order, has_header: headerLike });
    st.selectRange(r);
  };
  const toggleFilter = () => {
    const st = store.getState();
    if (sheet.filters) { st.apply({ type: "clear_filter", sheet: sheet.id }); return; }
    let r = st.selectionRange();
    if (r.start.row === r.end.row && r.start.col === r.end.col) r = currentRegion(sheet, r.start.row, r.start.col);
    st.apply({ type: "add_filter", sheet: sheet.id, range: rangeToA1(r) });
  };
  const mergeSelection = (un: boolean) => { const st = store.getState(); st.apply({ type: un ? "unmerge_cells" : "merge_cells", sheet: sheet.id, range: st.selectionA1() }); };
  const freezeHere = () => { const st = store.getState(); const a = st.selection.active; st.apply({ type: "freeze_panes", sheet: sheet.id, rows: a.row, cols: a.col }); };
  const setNumFmt = (fmt: string) => { const st = store.getState(); st.apply({ type: "batch", ops: st.selection.ranges.map((r) => ({ type: "set_number_format" as const, sheet: sheet.id, range: rangeToA1(r), numFmt: fmt })) }); };
  const autofitSelectedCols = () => { const st = store.getState(); const r = st.selectionRange(); st.apply({ type: "autofit_columns", sheet: sheet.id, columns: Array.from({ length: r.end.col - r.start.col + 1 }, (_, i) => colToLetter(r.start.col + i)) }); };

  // ---------------------------------------------------------------- editor overlay
  const editorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const st = store.getState();
    const ed = st.editing; if (!ed) return;
    const ac = autocomplete;
    if (ac.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setAcIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + ac.length) % ac.length); return; }
    if (ac.length && (e.key === "Tab" || (e.key === "Enter" && ac.length && acPrefix.length >= 2))) { e.preventDefault(); acceptAutocomplete(ac[acIndex] ?? ac[0]); return; }
    if (e.key === "Enter" && !e.altKey) { e.preventDefault(); if (!validateCommit()) return; st.commitEdit({ dRow: e.shiftKey ? -1 : 1, dCol: 0 }); scrollRef.current?.focus(); return; }
    if (e.key === "Enter" && e.altKey) { e.preventDefault(); const ta = e.currentTarget; const pos = ta.selectionStart; st.updateEdit(ed.value.slice(0, pos) + "\n" + ed.value.slice(pos)); return; }
    if (e.key === "Tab") { e.preventDefault(); if (!validateCommit()) return; st.commitEdit({ dRow: 0, dCol: e.shiftKey ? -1 : 1 }); scrollRef.current?.focus(); return; }
    if (e.key === "Escape") { e.preventDefault(); st.cancelEdit(); scrollRef.current?.focus(); return; }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") && ed.source === "type" && !ed.value.startsWith("=")) {
      e.preventDefault();
      if (!validateCommit()) return;
      st.commitEdit({ dRow: e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0, dCol: e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0 });
      scrollRef.current?.focus();
    }
  };
  const acPrefix = React.useMemo(() => { if (!editing || !editing.value.startsWith("=")) return ""; const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(editing.value); return m ? m[1].toUpperCase() : ""; }, [editing]);
  const autocomplete = React.useMemo(() => { if (!acPrefix) return [] as string[]; const all = Array.from(new Set([...FN_NAMES, ...store.getState().engine.functionNames()])); return all.filter((n) => n.startsWith(acPrefix) && n !== acPrefix).sort((a, b) => (FN_NAMES.includes(a) ? 0 : 1) - (FN_NAMES.includes(b) ? 0 : 1) || a.length - b.length).slice(0, 8); }, [acPrefix, store]);
  React.useEffect(() => setAcIndex(0), [acPrefix]);
  const acceptAutocomplete = (name: string) => { const st = store.getState(); const ed = st.editing; if (!ed) return; st.updateEdit(ed.value.slice(0, ed.value.length - acPrefix.length) + name + "("); inputRef.current?.focus(); };
  React.useEffect(() => { if (editing && inputRef.current) { const el = inputRef.current; el.focus(); if (editing.caretAtEnd) { const n = el.value.length; el.setSelectionRange(n, n); } } }, [editing?.ref, editing?.source]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- render helpers
  const renderCellDiv = (row: number, col: number, x: number, y: number, key?: string) => {
    const ref = toA1(row, col);
    if (merges.covered.has(ref)) return null;
    const span = merges.anchors.get(ref);
    const w = span ? colStarts[Math.min(dims.cols, col + span.cols)] - colStarts[col] : colSize(col);
    const h = span ? rowStarts[Math.min(dims.rows, row + span.rows)] - rowStarts[row] : rowSize(row);
    if (h === 0) return null;
    const cell = sheet.cells[ref];
    const rc = cell ? renderCell(workbook, sheet, ref, computed, cfStyles.get(ref)) : null;
    const text = rc ? (showFormulas && cell?.f ? cell.f : rc.text) : "";
    const align = rc ? (showFormulas && cell?.f ? "left" : rc.align) : "left";
    const commentCount = commentAnchors.get(ref);
    const isFilterHeader = filterHeader && row === filterHeader.start.row && col >= filterHeader.start.col && col <= filterHeader.end.col;
    const filterActive = isFilterHeader && sheet.filters?.criteria[colToLetter(col)];
    const isActive = selection.active.row === row && selection.active.col === col;
    const validation = isActive ? validationAt(row, col) : null;
    return (
      <div key={key ?? ref} data-ref={ref} className={cn("sheet-cell absolute flex items-center overflow-hidden px-1.5 text-[12.5px] leading-tight", rc?.className, rc?.style.wrap ? "items-start py-0.5" : "whitespace-nowrap")} style={{ left: x, top: y, width: w, height: h, justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start", ...(rc?.css ?? {}), ...(span ? { zIndex: 1 } : {}) }}>
        <span className={cn("min-w-0", !rc?.style.wrap && "truncate", rc?.isNumber && "tabular")} title={text.length > 24 ? text : undefined}>{text}</span>
        {commentCount ? <button data-comment-btn="1" onClick={(ev) => { ev.stopPropagation(); onOpenComment(`${sheet.name}!${ref}`); }} className="absolute right-0 top-0 size-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-destructive cursor-pointer" aria-label="Open comment" /> : null}
        {isFilterHeader ? <button data-filter-btn="1" onClick={(ev) => { ev.stopPropagation(); const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setFilterUI({ col, x: r.left, y: r.bottom + 2 }); }} className={cn("absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 cursor-pointer", filterActive ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted-foreground hover:text-foreground border")} aria-label="Filter"><Filter className="size-2.5" /></button> : null}
        {validation?.kind === "list" ? <button data-validation-btn="1" onClick={(ev) => { ev.stopPropagation(); setValidationUI((v) => (v ? null : { ref, v: validation })); }} className="absolute -right-0 top-1/2 -translate-y-1/2 rounded border bg-background p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Choose value"><ChevronDown className="size-3" /></button> : null}
      </div>
    );
  };

  const onFillStart = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); const p = selection.ranges[selection.ranges.length - 1]; if (!p) return; dragRef.current = { mode: "fill" }; setFill({ source: p, target: null }); };
  const visibleRows = rowItems.filter((r) => r.size > 0);
  const bodyRows = visibleRows.filter((r) => r.index >= fr);
  const bodyCols = colItems.filter((c) => c.index >= fc);
  const frozenRowIdx = Array.from({ length: fr }, (_, i) => i);
  const frozenColIdx = Array.from({ length: fc }, (_, i) => i);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cellsLayer = React.useMemo(() => bodyRows.flatMap((r) => bodyCols.map((c) => renderCellDiv(r.index, c.index, c.start, r.start))), [sheet, computed, bodyRows, bodyCols, cfStyles, showFormulas, commentAnchors, selection.active, merges, colStarts, rowStarts, workbook.styles]);

  const editRect = editing ? cellRect(...(() => { const m = /^([A-Z]+)(\d+)$/.exec(editing.ref)!; return [Number(m[2]) - 1, colToLetterIndex(m[1])] as const; })()) : null;
  const primary = selection.ranges[selection.ranges.length - 1];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={scrollRef}
          tabIndex={0}
          role="grid"
          aria-label={`Sheet ${sheet.name}`}
          className={cn("sheet-grid relative h-full w-full overflow-auto bg-background outline-none scrollbar-thin select-none", className)}
          onKeyDown={onKeyDown}
          onMouseDown={onCellMouseDown}
          onDoubleClick={onCellDoubleClick}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
          onScroll={() => { if (filterUI) setFilterUI(null); if (validationUI) setValidationUI(null); }}
        >
          <div className="relative" style={{ width: totalW + ROW_HEADER_WIDTH, height: totalH + COL_HEADER_HEIGHT }}>
            {/* column headers */}
            <div className="sticky top-0 z-40 bg-muted" style={{ height: COL_HEADER_HEIGHT, width: totalW + ROW_HEADER_WIDTH }}>
              <div className="sticky left-0 z-50 border-b border-r bg-muted" style={{ width: ROW_HEADER_WIDTH, height: COL_HEADER_HEIGHT, position: "sticky" }}>
                <button className="size-full cursor-pointer hover:bg-accent" aria-label="Select all" onMouseDown={(e) => { e.preventDefault(); store.getState().selectAll(); }}><span className="absolute bottom-0.5 right-0.5 size-0 border-b-[9px] border-l-[9px] border-b-muted-foreground/40 border-l-transparent" /></button>
              </div>
              {frozenColIdx.length > 0 && (
                <div className="sticky z-50 bg-muted" style={{ left: ROW_HEADER_WIDTH, top: 0, marginTop: -COL_HEADER_HEIGHT, width: Wf, height: COL_HEADER_HEIGHT, position: "sticky" }}>
                  {frozenColIdx.map((c) => <ColHeader key={c} col={c} x={colStarts[c]} w={colSize(c)} selected={selection.ranges.some((r) => c >= r.start.col && c <= r.end.col)} full={selection.ranges.some((r) => c >= r.start.col && c <= r.end.col && r.end.row - r.start.row >= dims.rows - 2)} onMouseDown={onColHeaderMouseDown} onAutofit={() => store.getState().apply({ type: "autofit_columns", sheet: sheet.id, columns: [colToLetter(c)] })} />)}
                </div>
              )}
              <div className="absolute top-0" style={{ left: 0 }}>
                {colItems.filter((c) => c.index >= fc).map((c) => <ColHeader key={c.index} col={c.index} x={c.start} w={c.size} selected={selection.ranges.some((r) => c.index >= r.start.col && c.index <= r.end.col)} full={selection.ranges.some((r) => c.index >= r.start.col && c.index <= r.end.col && r.end.row - r.start.row >= dims.rows - 2)} onMouseDown={onColHeaderMouseDown} onAutofit={() => store.getState().apply({ type: "autofit_columns", sheet: sheet.id, columns: [colToLetter(c.index)] })} />)}
              </div>
            </div>

            {/* frozen rows band */}
            {fr > 0 && (
              <div className="sticky z-30 bg-background shadow-[0_1px_0_var(--sheet-border-strong)]" style={{ top: COL_HEADER_HEIGHT, height: Hf, width: totalW + ROW_HEADER_WIDTH }}>
                <div className="sticky left-0 z-40 bg-background" style={{ width: ROW_HEADER_WIDTH + Wf, height: Hf, position: "sticky" }}>
                  {frozenRowIdx.map((r) => <RowHeader key={r} row={r} y={rowStarts[r]} h={rowSize(r)} selected={selection.ranges.some((x) => r >= x.start.row && r <= x.end.row)} full={selection.ranges.some((x) => r >= x.start.row && r <= x.end.row && x.end.col - x.start.col >= dims.cols - 2)} onMouseDown={onRowHeaderMouseDown} />)}
                  {frozenRowIdx.flatMap((r) => frozenColIdx.map((c) => renderCellDiv(r, c, ROW_HEADER_WIDTH + colStarts[c], rowStarts[r], `fz-${r}-${c}`)))}
                  <SelectionLayer ranges={selection.ranges} active={selection.active} preview={preview?.sheetId === sheet.id ? preview.range : null} highlight={highlightRanges} clipboard={clipboard?.sheetId === sheet.id ? clipboard.range : null} fill={fill} rangeRect={rangeRect} cellRect={cellRect} offsetX={0} offsetY={-COL_HEADER_HEIGHT} clip={{ rows: [0, fr - 1], cols: [0, fc - 1] }} showHandle onFillStart={onFillStart} />
                </div>
                <div className="absolute top-0 left-0" style={{ marginTop: 0 }}>
                  {frozenRowIdx.flatMap((r) => bodyCols.map((c) => renderCellDiv(r, c.index, c.start, rowStarts[r], `fr-${r}-${c.index}`)))}
                  <SelectionLayer ranges={selection.ranges} active={selection.active} preview={preview?.sheetId === sheet.id ? preview.range : null} highlight={highlightRanges} clipboard={clipboard?.sheetId === sheet.id ? clipboard.range : null} fill={fill} rangeRect={rangeRect} cellRect={cellRect} offsetX={0} offsetY={-COL_HEADER_HEIGHT} clip={{ rows: [0, fr - 1], cols: [fc, dims.cols - 1] }} showHandle onFillStart={onFillStart} />
                </div>
              </div>
            )}

            {/* left band: row headers + frozen columns */}
            <div className="sticky left-0 z-20 bg-background" style={{ width: ROW_HEADER_WIDTH + Wf, height: totalH - Hf, position: "sticky" }}>
              {bodyRows.map((r) => <RowHeader key={r.index} row={r.index} y={r.start - COL_HEADER_HEIGHT - Hf} h={r.size} selected={selection.ranges.some((x) => r.index >= x.start.row && r.index <= x.end.row)} full={selection.ranges.some((x) => r.index >= x.start.row && r.index <= x.end.row && x.end.col - x.start.col >= dims.cols - 2)} onMouseDown={onRowHeaderMouseDown} />)}
              {fc > 0 && <div className="absolute inset-y-0 border-r" style={{ left: ROW_HEADER_WIDTH + Wf - 1, width: 1, borderColor: "var(--sheet-border-strong)" }} />}
              {bodyRows.flatMap((r) => frozenColIdx.map((c) => renderCellDiv(r.index, c, ROW_HEADER_WIDTH + colStarts[c], r.start - COL_HEADER_HEIGHT - Hf, `fc-${r.index}-${c}`)))}
              {fc > 0 && <SelectionLayer ranges={selection.ranges} active={selection.active} preview={preview?.sheetId === sheet.id ? preview.range : null} highlight={highlightRanges} clipboard={clipboard?.sheetId === sheet.id ? clipboard.range : null} fill={fill} rangeRect={rangeRect} cellRect={cellRect} offsetX={0} offsetY={-COL_HEADER_HEIGHT - Hf} clip={{ rows: [fr, dims.rows - 1], cols: [0, fc - 1] }} showHandle onFillStart={onFillStart} />}
            </div>

            {/* main cells layer */}
            <div className="absolute z-10" style={{ left: 0, top: 0, width: totalW + ROW_HEADER_WIDTH, height: totalH + COL_HEADER_HEIGHT, pointerEvents: "none" }}>
              <div className="absolute inset-0" style={{ pointerEvents: "auto" }}>
                {cellsLayer}
                {pageBreaks && pageInfo.xs.map((x) => <div key={`px${x}`} className="absolute top-0 border-l border-dashed border-primary/60" style={{ left: ROW_HEADER_WIDTH + x, height: totalH + COL_HEADER_HEIGHT }} />)}
                {pageBreaks && pageInfo.ys.map((y) => <div key={`py${y}`} className="absolute left-0 border-t border-dashed border-primary/60" style={{ top: COL_HEADER_HEIGHT + y, width: totalW + ROW_HEADER_WIDTH }} />)}
                <SelectionLayer ranges={selection.ranges} active={selection.active} preview={preview?.sheetId === sheet.id ? preview.range : null} highlight={highlightRanges} clipboard={clipboard?.sheetId === sheet.id ? clipboard.range : null} fill={fill} rangeRect={rangeRect} cellRect={cellRect} offsetX={0} offsetY={0} clip={{ rows: [fr, dims.rows - 1], cols: [fc, dims.cols - 1] }} showHandle onFillStart={onFillStart} />
                {sheet.charts.map((ch) => <ChartOverlay key={ch.id} chart={ch} sheet={sheet} workbook={workbook} computed={computed} offset={{ x: ROW_HEADER_WIDTH, y: COL_HEADER_HEIGHT }} onChange={(patch) => store.getState().apply({ type: "update_chart", sheet: sheet.id, id: ch.id, patch })} onRemove={() => store.getState().apply({ type: "remove_chart", sheet: sheet.id, id: ch.id })} onEdit={() => onEditChart?.(ch.id)} />)}
                {editing && editRect && (
                  <div data-editor="1" className="absolute z-30" style={{ left: editRect.x, top: editRect.y, minWidth: editRect.w, minHeight: editRect.h }}>
                    <textarea
                      ref={inputRef}
                      value={editing.value}
                      onChange={(e) => store.getState().updateEdit(e.target.value)}
                      onKeyDown={editorKeyDown}
                      onBlur={() => { const d = dragRef.current; if (d?.mode === "refInsert") return; setTimeout(() => { const st = store.getState(); if (st.editing && document.activeElement !== inputRef.current && !document.activeElement?.closest?.("[data-formula-bar]")) st.commitEdit(null); }, 0); }}
                      rows={1}
                      spellCheck={false}
                      className={cn("block resize-none border-2 border-primary bg-background px-1 py-0.5 font-sans text-[12.5px] leading-tight text-foreground shadow-lg outline-none", editing.value.startsWith("=") && "font-mono text-[12px]")}
                      style={{ width: Math.max(editRect.w, Math.min(520, editing.value.length * 7.5 + 24)), height: Math.max(editRect.h, editing.value.split("\n").length * 18 + 8) }}
                    />
                    {autocomplete.length > 0 && (
                      <div className="absolute left-0 top-full mt-0.5 w-72 rounded-md border bg-popover p-1 text-xs shadow-xl">
                        {autocomplete.map((n, i) => { const meta = COMMON_FUNCTIONS.find((f) => f.name === n); return <button key={n} onMouseDown={(e) => { e.preventDefault(); acceptAutocomplete(n); }} className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left cursor-pointer", i === acIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}><span className="font-mono font-medium">{meta?.sig ?? `${n}(…)`}</span>{meta && <span className="ml-auto truncate text-[11px] text-muted-foreground">{meta.hint}</span>}</button>; })}
                        <div className="px-2 pt-1 text-[10px] text-muted-foreground">Tab to insert · ↑↓ to choose</div>
                      </div>
                    )}
                  </div>
                )}
                {validationUI && (() => { const m = /^([A-Z]+)(\d+)$/.exec(validationUI.ref)!; const rct = cellRect(Number(m[2]) - 1, colToLetterIndex(m[1])); return (
                  <div className="absolute z-40 max-h-56 w-56 overflow-auto rounded-md border bg-popover p-1 text-xs shadow-xl scrollbar-thin" style={{ left: rct.x, top: rct.y + rct.h + 2 }}>
                    {(validationUI.v.list ?? []).map((opt) => <button key={opt} onMouseDown={(e) => { e.preventDefault(); store.getState().apply({ type: "set_cells", sheet: sheet.id, cells: [{ ref: validationUI.ref, value: opt }] }); setValidationUI(null); scrollRef.current?.focus(); }} className="block w-full rounded px-2 py-1 text-left hover:bg-accent cursor-pointer">{opt}</button>)}
                  </div>
                ); })()}
              </div>
            </div>
          </div>
          {filterUI && sheet.filters && filterHeader && <FilterPopover sheet={sheet} computed={computed} col={filterUI.col} header={filterHeader} x={filterUI.x} y={filterUI.y} onClose={() => { setFilterUI(null); scrollRef.current?.focus(); }} onApply={(criteria) => store.getState().apply({ type: "set_filter_criteria", sheet: sheet.id, column: colToLetter(filterUI.col), criteria })} onSort={(order) => { store.getState().apply({ type: "sort_range", sheet: sheet.id, range: sheet.filters!.range, by: colToLetter(filterUI.col), order, has_header: true }); setFilterUI(null); }} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={() => { const st = store.getState(); const clip = st.copy(true); if (clip) void navigator.clipboard?.writeText(clip.tsv).catch(() => {}); }}>Cut <span className="ml-auto text-[10px] text-muted-foreground">⌘X</span></ContextMenuItem>
        <ContextMenuItem onSelect={() => { const st = store.getState(); const clip = st.copy(false); if (clip) void navigator.clipboard?.writeText(clip.tsv).catch(() => {}); }}>Copy <span className="ml-auto text-[10px] text-muted-foreground">⌘C</span></ContextMenuItem>
        <ContextMenuItem onSelect={() => { const st = store.getState(); if (st.clipboard) st.paste(); else void navigator.clipboard?.readText().then((t) => st.paste({ text: t })).catch(() => toast.error("Clipboard unavailable — use ⌘V")); }}>Paste <span className="ml-auto text-[10px] text-muted-foreground">⌘V</span></ContextMenuItem>
        <ContextMenuItem onSelect={() => store.getState().paste({ valuesOnly: true })} disabled={!clipboard}>Paste values only</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => insertRows("above")}>Insert row{primary && primary.end.row > primary.start.row ? "s" : ""} above</ContextMenuItem>
        <ContextMenuItem onSelect={() => insertRows("below")}>Insert row{primary && primary.end.row > primary.start.row ? "s" : ""} below</ContextMenuItem>
        <ContextMenuItem onSelect={() => insertCols("left")}>Insert column{primary && primary.end.col > primary.start.col ? "s" : ""} left</ContextMenuItem>
        <ContextMenuItem onSelect={() => insertCols("right")}>Insert column{primary && primary.end.col > primary.start.col ? "s" : ""} right</ContextMenuItem>
        <ContextMenuItem onSelect={deleteRows} className="text-destructive">Delete row{primary && primary.end.row > primary.start.row ? "s" : ""}</ContextMenuItem>
        <ContextMenuItem onSelect={deleteCols} className="text-destructive">Delete column{primary && primary.end.col > primary.start.col ? "s" : ""}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => store.getState().clearSelection("contents")}>Clear contents</ContextMenuItem>
        <ContextMenuItem onSelect={() => store.getState().clearSelection("formats")}>Clear formats</ContextMenuItem>
        <ContextMenuItem onSelect={autofitSelectedCols}>Autofit column width</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Number format</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">{NUMBER_FORMATS.map((f) => <ContextMenuItem key={f.id} onSelect={() => setNumFmt(f.id)}>{f.label}<span className="ml-auto text-[10px] text-muted-foreground tabular">{f.example}</span></ContextMenuItem>)}</ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={() => mergeSelection(false)}>Merge cells</ContextMenuItem>
        <ContextMenuItem onSelect={() => mergeSelection(true)}>Unmerge</ContextMenuItem>
        <ContextMenuItem onSelect={freezeHere}>Freeze panes here</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => sortSelection("asc")}>Sort A → Z</ContextMenuItem>
        <ContextMenuItem onSelect={() => sortSelection("desc")}>Sort Z → A</ContextMenuItem>
        <ContextMenuItem onSelect={toggleFilter}>{sheet.filters ? "Remove filter" : "Filter this range"}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Insert chart</ContextMenuSubTrigger>
          <ContextMenuSubContent><ContextMenuItem onSelect={() => onInsertChart("bar")}>Bar chart</ContextMenuItem><ContextMenuItem onSelect={() => onInsertChart("line")}>Line chart</ContextMenuItem><ContextMenuItem onSelect={() => onInsertChart("pie")}>Pie chart</ContextMenuItem></ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={() => onAddComment(toA1(selection.active.row, selection.active.col))}><MessageSquare className="size-3.5" /> Add comment</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function colToLetterIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

const ColHeader = React.memo(function ColHeader({ col, x, w, selected, full, onMouseDown, onAutofit }: { col: number; x: number; w: number; selected: boolean; full: boolean; onMouseDown: (e: React.MouseEvent, col: number) => void; onAutofit: () => void }) {
  return (
    <div onMouseDown={(e) => onMouseDown(e, col)} className={cn("absolute top-0 flex items-center justify-center border-b border-r text-[11px] font-medium select-none cursor-pointer", full ? "bg-primary text-primary-foreground" : selected ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent")} style={{ left: x, width: w, height: COL_HEADER_HEIGHT }}>
      {colToLetter(col)}
      <div data-resize="1" onDoubleClick={(e) => { e.stopPropagation(); onAutofit(); }} className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize hover:bg-primary/60" />
    </div>
  );
});

const RowHeader = React.memo(function RowHeader({ row, y, h, selected, full, onMouseDown }: { row: number; y: number; h: number; selected: boolean; full: boolean; onMouseDown: (e: React.MouseEvent, row: number) => void }) {
  return (
    <div onMouseDown={(e) => onMouseDown(e, row)} className={cn("absolute left-0 flex items-center justify-center border-b border-r text-[11px] tabular select-none cursor-pointer", full ? "bg-primary text-primary-foreground" : selected ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-accent")} style={{ top: y, width: ROW_HEADER_WIDTH, height: h }}>
      {row + 1}
      <div data-resize="1" className="absolute -bottom-[3px] left-0 z-10 h-[6px] w-full cursor-row-resize hover:bg-primary/60" />
    </div>
  );
});

interface SelectionLayerProps {
  ranges: RangeRef[]; active: CellPos; preview: RangeRef | null; highlight: { range: RangeRef; color: string }[]; clipboard: RangeRef | null; fill: { source: RangeRef; target: RangeRef | null } | null;
  rangeRect: (r: RangeRef) => { x: number; y: number; w: number; h: number }; cellRect: (row: number, col: number) => { x: number; y: number; w: number; h: number };
  offsetX: number; offsetY: number; clip: { rows: [number, number]; cols: [number, number] }; showHandle?: boolean; onFillStart: (e: React.MouseEvent) => void;
}

function SelectionLayer({ ranges, active, preview, highlight, clipboard, fill, rangeRect, cellRect, offsetX, offsetY, clip, showHandle, onFillStart }: SelectionLayerProps) {
  const clipRange = (r: RangeRef): RangeRef | null => {
    const n = normalizeRange(r);
    const s = { row: Math.max(n.start.row, clip.rows[0]), col: Math.max(n.start.col, clip.cols[0]) };
    const e = { row: Math.min(n.end.row, clip.rows[1]), col: Math.min(n.end.col, clip.cols[1]) };
    if (s.row > e.row || s.col > e.col) return null;
    return { start: s, end: e };
  };
  const box = (r: RangeRef, cls: string, style?: React.CSSProperties, key?: string) => {
    const c = clipRange(r); if (!c) return null;
    const rect = rangeRect(c);
    const n = normalizeRange(r);
    const edges = { t: n.start.row >= clip.rows[0], b: n.end.row <= clip.rows[1], l: n.start.col >= clip.cols[0], r: n.end.col <= clip.cols[1] };
    return <div key={key} className={cn("absolute pointer-events-none", cls)} style={{ left: rect.x + offsetX, top: rect.y + offsetY, width: rect.w, height: rect.h, borderTopWidth: edges.t ? undefined : 0, borderBottomWidth: edges.b ? undefined : 0, borderLeftWidth: edges.l ? undefined : 0, borderRightWidth: edges.r ? undefined : 0, ...style }} />;
  };
  const activeIn = active.row >= clip.rows[0] && active.row <= clip.rows[1] && active.col >= clip.cols[0] && active.col <= clip.cols[1];
  const ar = cellRect(active.row, active.col);
  const last = ranges[ranges.length - 1];
  const lastClipped = last ? clipRange(last) : null;
  const handleAt = last && lastClipped && last.end.row === lastClipped.end.row && last.end.col === lastClipped.end.col ? rangeRect(last) : null;
  return (
    <>
      {ranges.map((r, i) => box(r, "border border-primary/70 bg-primary/10 z-20", undefined, `sel${i}`))}
      {preview && box(preview, "border-2 border-dashed border-warning bg-warning/15 z-20", undefined, "preview")}
      {clipboard && box(clipboard, "border border-dashed z-20", { borderColor: "var(--primary)", animation: "sheet-marquee 1s linear infinite" }, "clip")}
      {highlight.map((h, i) => box(h.range, "border-2 rounded-[2px] z-20", { borderColor: h.color, backgroundColor: `color-mix(in oklab, ${h.color} 12%, transparent)` }, `hl${i}`))}
      {fill?.target && box(fill.target, "border border-dashed border-foreground/60 z-20", undefined, "fill")}
      {activeIn && <div className="absolute z-20 border-2 border-primary pointer-events-none" style={{ left: ar.x + offsetX, top: ar.y + offsetY, width: ar.w, height: ar.h }} />}
      {showHandle && handleAt && <div data-fill-handle="1" onMouseDown={onFillStart} className="absolute z-30 size-[7px] cursor-crosshair border border-background bg-primary" style={{ left: handleAt.x + handleAt.w - 4 + offsetX, top: handleAt.y + handleAt.h - 4 + offsetY }} />}
    </>
  );
}
