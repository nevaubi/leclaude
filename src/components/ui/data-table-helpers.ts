/**
 * Pure helpers behind <DataTable>: sorting, selection ranges, the keyboard
 * reducer and column geometry. No React, no DOM, unit-tested directly.
 */

export type SortDir = "asc" | "desc";
export interface SortState { columnId: string; dir: SortDir }
export type Density = "compact" | "comfortable";
export type SelectionMode = "none" | "single" | "multi";

/** Row heights per density (px). Compact sits inside the 24–28px grid rhythm. */
export const ROW_HEIGHT: Record<Density, number> = { compact: 26, comfortable: 32 };
export const HEADER_HEIGHT = 28;
export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 1200;
export const SELECT_COLUMN_WIDTH = 32;
export const ACTIONS_COLUMN_WIDTH = 36;

export interface ColumnLike { id: string; width?: number; minWidth?: number; sortable?: boolean; defaultHidden?: boolean; locked?: boolean }

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Click on a header: new column sorts ascending (or `defaultDir`); the same column flips. */
export function toggleSort(current: SortState | null | undefined, columnId: string, defaultDir: SortDir = "asc"): SortState {
  if (!current || current.columnId !== columnId) return { columnId, dir: defaultDir };
  return { columnId, dir: current.dir === "asc" ? "desc" : "asc" };
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Null/undefined sort last regardless of direction; numbers, dates, booleans and strings compare naturally. */
export function compareValues(a: unknown, b: unknown): number {
  const an = a == null || a === "", bn = b == null || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "string") return -1;
  if (typeof a === "string" && typeof b === "number") return 1;
  return collator.compare(String(a), String(b));
}

/** Stable sort by an accessor; returns the input array untouched when there is no sort. */
export function sortRows<T>(rows: T[], sort: SortState | null | undefined, accessor: (row: T, columnId: string) => unknown): T[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  const keyed = rows.map((row, i) => ({ row, i, v: accessor(row, sort.columnId) }));
  keyed.sort((x, y) => {
    const c = compareValues(x.v, y.v);
    // Empty values stay last in both directions; only real values flip.
    if (c !== 0 && (x.v == null || x.v === "" || y.v == null || y.v === "")) return c;
    return (c || 0) * dir || x.i - y.i;
  });
  return keyed.map((k) => k.row);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Ids between the anchor and the target (inclusive, in row order). A missing anchor selects only the target. */
export function selectRange(ids: string[], anchorId: string | null | undefined, targetId: string): string[] {
  const b = ids.indexOf(targetId);
  if (b < 0) return [];
  const a = anchorId ? ids.indexOf(anchorId) : -1;
  if (a < 0) return [targetId];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return ids.slice(lo, hi + 1);
}

export interface SelectionState { selected: string[]; anchorId: string | null }

/**
 * Pointer selection model. Plain click selects one row; ⌘/Ctrl toggles; Shift
 * selects the range from the anchor (added to the current selection when ⌘ is
 * also held). Single mode ignores modifiers and always selects one row.
 */
export function applyRowClick(state: SelectionState, ids: string[], targetId: string, modifiers: { shift?: boolean; meta?: boolean } = {}, mode: SelectionMode = "multi"): SelectionState {
  if (mode === "none") return state;
  if (mode === "single") return { selected: [targetId], anchorId: targetId };
  if (modifiers.shift) {
    const range = selectRange(ids, state.anchorId ?? targetId, targetId);
    const base = modifiers.meta ? state.selected : [];
    return { selected: unique([...base, ...range]), anchorId: state.anchorId ?? targetId };
  }
  if (modifiers.meta) {
    const has = state.selected.includes(targetId);
    return { selected: has ? state.selected.filter((id) => id !== targetId) : [...state.selected, targetId], anchorId: targetId };
  }
  return { selected: [targetId], anchorId: targetId };
}

export function toggleSelected(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

export function selectionSummary(selectedCount: number, total: number, noun = "row"): string {
  const plural = (n: number) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
  if (selectedCount <= 0) return plural(total);
  return `${selectedCount.toLocaleString()} of ${plural(total)} selected`;
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// ---------------------------------------------------------------------------
// Keyboard reducer
// ---------------------------------------------------------------------------

export interface NavState extends SelectionState { activeIndex: number }
export type NavAction = "activate" | "clear" | "select-all" | "none";
export interface NavContext { ids: string[]; shift?: boolean; meta?: boolean; pageSize?: number; mode?: SelectionMode }

/**
 * j/k and the arrows move the active row (Shift extends the selection, otherwise
 * the active row becomes the selection); Home/End and PageUp/PageDown jump;
 * Space toggles the active row; Enter activates; Escape clears; ⌘A selects all.
 */
export function keyboardNav(state: NavState, key: string, ctx: NavContext): { next: NavState; action: NavAction } {
  const { ids } = ctx;
  const mode = ctx.mode ?? "multi";
  const page = Math.max(1, ctx.pageSize ?? 10);
  const last = ids.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const cur = state.activeIndex;
  const move = (to: number): { next: NavState; action: NavAction } => {
    if (last < 0) return { next: state, action: "none" };
    const idx = clamp(to);
    const id = ids[idx];
    if (mode === "none") return { next: { ...state, activeIndex: idx }, action: "none" };
    if (mode === "multi" && ctx.shift) {
      const anchor = state.anchorId ?? ids[clamp(cur)] ?? id;
      return { next: { activeIndex: idx, anchorId: anchor, selected: selectRange(ids, anchor, id) }, action: "none" };
    }
    return { next: { activeIndex: idx, anchorId: id, selected: [id] }, action: "none" };
  };
  switch (key) {
    case "j": case "ArrowDown": return move(cur < 0 ? 0 : cur + 1);
    case "k": case "ArrowUp": return move(cur < 0 ? 0 : cur - 1);
    case "Home": return move(0);
    case "End": return move(last);
    case "PageDown": return move((cur < 0 ? 0 : cur) + page);
    case "PageUp": return move((cur < 0 ? 0 : cur) - page);
    case " ": {
      if (cur < 0 || cur > last || mode === "none") return { next: state, action: "none" };
      const id = ids[cur];
      if (mode === "single") return { next: { ...state, selected: [id], anchorId: id }, action: "none" };
      return { next: { ...state, selected: toggleSelected(state.selected, id), anchorId: id }, action: "none" };
    }
    case "Enter": return { next: state, action: cur >= 0 && cur <= last ? "activate" : "none" };
    case "Escape": return { next: { ...state, selected: [] }, action: "clear" };
    case "a": case "A":
      if (ctx.meta && mode === "multi") return { next: { ...state, selected: [...ids] }, action: "select-all" };
      return { next: state, action: "none" };
    default: return { next: state, action: "none" };
  }
}

/** Keys the table handles itself (used to decide whether to preventDefault). */
export const NAV_KEYS = new Set(["j", "k", "ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", " ", "Enter", "Escape"]);

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export function visibleColumns<C extends ColumnLike>(columns: C[], hidden: Iterable<string>): C[] {
  const h = new Set(hidden);
  return columns.filter((c) => c.locked || !h.has(c.id));
}

export function defaultHiddenColumns<C extends ColumnLike>(columns: C[]): string[] {
  return columns.filter((c) => c.defaultHidden && !c.locked).map((c) => c.id);
}

export function clampWidth(width: number, min = MIN_COLUMN_WIDTH, max = MAX_COLUMN_WIDTH): number {
  if (!Number.isFinite(width)) return min;
  return Math.round(Math.max(min, Math.min(max, width)));
}

export function columnWidth<C extends ColumnLike>(column: C, widths: Record<string, number> | undefined, fallback = 160): number {
  const w = widths?.[column.id] ?? column.width ?? fallback;
  return clampWidth(w, column.minWidth ?? MIN_COLUMN_WIDTH);
}

/** Drag-resize: the new width for `id` from the pointer delta, honouring the column's minimum. */
export function resizeColumn<C extends ColumnLike>(widths: Record<string, number>, column: C, startWidth: number, deltaX: number): Record<string, number> {
  return { ...widths, [column.id]: clampWidth(startWidth + deltaX, column.minWidth ?? MIN_COLUMN_WIDTH) };
}

export function totalWidth<C extends ColumnLike>(columns: C[], widths: Record<string, number> | undefined, extra = 0): number {
  return columns.reduce((n, c) => n + columnWidth(c, widths), extra);
}

/** Toggle a column in the hidden set; locked columns cannot be hidden. */
export function toggleColumn<C extends ColumnLike>(columns: C[], hidden: string[], id: string): string[] {
  const col = columns.find((c) => c.id === id);
  if (!col || col.locked) return hidden;
  return hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
}
