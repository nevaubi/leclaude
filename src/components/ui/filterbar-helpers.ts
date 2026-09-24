/**
 * Pure helpers behind <Filterbar>: filter values, chip labels, quick search
 * matching and saved views. No React; unit-tested directly.
 */

export type FilterValue = string | string[] | null | undefined;
export type FilterValues = Record<string, FilterValue>;

export interface FilterOption { value: string; label: string; count?: number }

export interface SavedView {
  id: string;
  name: string;
  values: FilterValues;
  query?: string;
  /** Opaque extra state (sort, view mode) the owner wants restored with the view. */
  extra?: Record<string, unknown>;
  createdAt: string;
}

/** Drop empty entries and sort multi-values so two snapshots compare structurally. */
export function normalizeValues(values: FilterValues | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    if (v == null) continue;
    if (Array.isArray(v)) { const arr = Array.from(new Set(v.filter((x) => x !== ""))).sort(); if (arr.length) out[k] = arr; }
    else if (v !== "") out[k] = v;
  }
  return out;
}

export function activeFilters(values: FilterValues | undefined): { id: string; value: string | string[] }[] {
  return Object.entries(normalizeValues(values)).map(([id, value]) => ({ id, value }));
}

export function activeFilterCount(values: FilterValues | undefined): number {
  return activeFilters(values).length;
}

/** Clear every filter, or only the listed ids. */
export function clearFilters(values: FilterValues, ids?: string[]): FilterValues {
  if (!ids) return Object.fromEntries(Object.keys(values).map((k) => [k, undefined]));
  const out = { ...values };
  for (const id of ids) out[id] = undefined;
  return out;
}

/** Set a single-value filter (empty clears) or toggle a value inside a multi-value filter. */
export function toggleFilterValue(values: FilterValues, id: string, value: string, opts: { multi?: boolean } = {}): FilterValues {
  if (!opts.multi) return { ...values, [id]: values[id] === value || value === "" ? undefined : value };
  const cur = Array.isArray(values[id]) ? (values[id] as string[]) : values[id] ? [String(values[id])] : [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  return { ...values, [id]: next.length ? next : undefined };
}

/** "Type: PDF", "Matter: 2 selected"; falls back to the raw value when no option label matches. */
export function chipLabel(label: string, value: FilterValue, optionLabel?: (v: string) => string | undefined): string {
  const name = (v: string) => optionLabel?.(v) ?? v;
  if (Array.isArray(value)) {
    if (value.length === 0) return label;
    if (value.length === 1) return `${label}: ${name(value[0])}`;
    return `${label}: ${value.length} selected`;
  }
  if (value == null || value === "") return label;
  return `${label}: ${name(value)}`;
}

/** Every whitespace-separated token must appear (case-insensitive); an empty query matches everything. */
export function matchesQuickSearch(text: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = text.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export function viewId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `view_${slug || "untitled"}`;
}

export interface ViewSnapshot { values: FilterValues; query?: string; extra?: Record<string, unknown> }

/** Save or replace (same name) a view; the list stays sorted by name. */
export function saveView(views: SavedView[], name: string, snapshot: ViewSnapshot, now = new Date().toISOString()): { views: SavedView[]; view: SavedView } {
  const trimmed = name.trim().slice(0, 60) || "Untitled view";
  const view: SavedView = { id: viewId(trimmed), name: trimmed, values: normalizeValues(snapshot.values), query: snapshot.query?.trim() || undefined, extra: snapshot.extra, createdAt: now };
  const next = [...views.filter((v) => v.id !== view.id), view].sort((a, b) => a.name.localeCompare(b.name));
  return { views: next, view };
}

export function deleteView(views: SavedView[], id: string): SavedView[] {
  return views.filter((v) => v.id !== id);
}

/** True when the current filters + query equal the view's (extra state is ignored). */
export function viewMatches(view: SavedView, snapshot: ViewSnapshot): boolean {
  const a = JSON.stringify(sortedEntries(normalizeValues(view.values)));
  const b = JSON.stringify(sortedEntries(normalizeValues(snapshot.values)));
  return a === b && (view.query ?? "") === (snapshot.query?.trim() ?? "");
}

/** The saved view matching the current state, if any (drives the "active view" label). */
export function findMatchingView(views: SavedView[], snapshot: ViewSnapshot): SavedView | undefined {
  return views.find((v) => viewMatches(v, snapshot));
}

function sortedEntries(o: Record<string, unknown>): [string, unknown][] {
  return Object.entries(o).sort(([a], [b]) => a.localeCompare(b));
}

/** localStorage persistence (best-effort; storage may be unavailable). */
export function loadViews(storage: Pick<Storage, "getItem"> | undefined, key: string): SavedView[] {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedView[]).filter((v) => v && typeof v.id === "string" && typeof v.name === "string") : [];
  } catch { return []; }
}

export function storeViews(storage: Pick<Storage, "setItem"> | undefined, key: string, views: SavedView[]): void {
  try { storage?.setItem(key, JSON.stringify(views)); } catch { /* storage unavailable */ }
}
