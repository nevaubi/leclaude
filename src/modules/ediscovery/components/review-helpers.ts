/**
 * Pure helpers for the review grid, viewer and rail (no React, no DOM;
 * unit-tested in tests/ediscovery-review-ui.test.ts).
 */
import type { CodingDecision } from "@/lib/types/domain";
import type { DateBucket, DocRow, FacetBucket } from "../types";

// ---------------------------------------------------------------------------
// Logical pages: character spans of each page inside the extracted text
// ---------------------------------------------------------------------------

export interface PageSpan { start: number; end: number }

/**
 * Character spans of the logical pages the viewer and the production renderer
 * show: form feeds split exactly; otherwise paragraphs are dealt out evenly over
 * `pages`. Offsets index the original text, so a redaction range (which is
 * stored against the whole text) can be placed on its page.
 */
export function pageSpans(text: string, pages: number): PageSpan[] {
  if (text.includes("\f")) {
    const out: PageSpan[] = [];
    let cursor = 0;
    for (const part of text.split("\f")) {
      const lead = part.match(/^\n+/)?.[0].length ?? 0;
      out.push({ start: cursor + lead, end: cursor + part.length });
      cursor += part.length + 1;
    }
    return out;
  }
  if (pages <= 1 || !text.length) return [{ start: 0, end: text.length }];
  const paras: PageSpan[] = [];
  const re = /\n\n+/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { paras.push({ start: cursor, end: m.index }); cursor = m.index + m[0].length; }
  paras.push({ start: cursor, end: text.length });
  const per = Math.ceil(paras.length / pages);
  const out: PageSpan[] = [];
  for (let i = 0; i < paras.length; i += per) out.push({ start: paras[i].start, end: paras[Math.min(paras.length, i + per) - 1].end });
  return out;
}

/** Page number (1-based) that contains a character offset. */
export function pageOfOffset(spans: PageSpan[], offset: number): number {
  for (let i = 0; i < spans.length; i++) if (offset <= spans[i].end) return i + 1;
  return spans.length || 1;
}

export interface TextRangeMark<K extends string = string> { start: number; end: number; kind: K; id?: string }
export interface TextPiece<K extends string = string> { text: string; kind: K | "plain"; id?: string }

/**
 * Cut a text into pieces by non-overlapping marked ranges (offsets relative to
 * the text). Ranges are clamped; a later range that overlaps an earlier one is
 * dropped so redaction boxes never split.
 */
export function splitRanges<K extends string>(text: string, ranges: TextRangeMark<K>[]): TextPiece<K>[] {
  const sorted = ranges
    .map((r) => ({ ...r, start: Math.max(0, Math.min(text.length, Math.floor(r.start))), end: Math.max(0, Math.min(text.length, Math.ceil(r.end))) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TextPiece<K>[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor) continue;
    if (r.start > cursor) out.push({ text: text.slice(cursor, r.start), kind: "plain" });
    out.push({ text: text.slice(r.start, r.end), kind: r.kind, id: r.id });
    cursor = r.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), kind: "plain" });
  return out;
}

// ---------------------------------------------------------------------------
// Page-rectangle redactions: normalised to the printable area of the rendered page
// ---------------------------------------------------------------------------

/** Letter page and margin used by the production renderer (pdf-lib); rects are normalised to the area inside the margins. */
export const PAGE_GEOMETRY = { width: 612, height: 792, margin: 54 } as const;

export interface CssRect { left: number; top: number; width: number; height: number }

/** Normalised page rect (0..1 inside the margins) → CSS rect inside a rendered page image of `w` × `h` px. */
export function pageRectToCss(rect: { x: number; y: number; w: number; h: number }, w: number, h: number): CssRect {
  const ix = PAGE_GEOMETRY.margin / PAGE_GEOMETRY.width, iy = PAGE_GEOMETRY.margin / PAGE_GEOMETRY.height;
  const innerW = w * (1 - 2 * ix), innerH = h * (1 - 2 * iy);
  return { left: w * ix + rect.x * innerW, top: h * iy + rect.y * innerH, width: rect.w * innerW, height: rect.h * innerH };
}

/** CSS rect inside a rendered page image → normalised page rect, clamped to the printable area; null when too small to matter. */
export function cssToPageRect(css: CssRect, w: number, h: number, minPx = 6): { x: number; y: number; w: number; h: number } | null {
  if (css.width < minPx || css.height < minPx || w <= 0 || h <= 0) return null;
  const ix = PAGE_GEOMETRY.margin / PAGE_GEOMETRY.width, iy = PAGE_GEOMETRY.margin / PAGE_GEOMETRY.height;
  const innerW = w * (1 - 2 * ix), innerH = h * (1 - 2 * iy);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const x1 = clamp((css.left - w * ix) / innerW), y1 = clamp((css.top - h * iy) / innerH);
  const x2 = clamp((css.left + css.width - w * ix) / innerW), y2 = clamp((css.top + css.height - h * iy) / innerH);
  const out = { x: Number(x1.toFixed(4)), y: Number(y1.toFixed(4)), w: Number((x2 - x1).toFixed(4)), h: Number((y2 - y1).toFixed(4)) };
  return out.w <= 0 || out.h <= 0 ? null : out;
}

/** Drag from (x0, y0) to (x1, y1) as a CSS rect. */
export function dragRect(x0: number, y0: number, x1: number, y1: number): CssRect {
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** Parse the `X-Page-Map` header ("1,1,2,3"): logical page per PDF sheet. */
export function parsePageMap(header: string | null | undefined, sheets: number): number[] {
  const parsed = (header ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (parsed.length === sheets) return parsed;
  return Array.from({ length: sheets }, (_, i) => i + 1);
}

// ---------------------------------------------------------------------------
// Suggested column
// ---------------------------------------------------------------------------

export type SuggestionCall = "R" | "NR" | "?";

/** The call an AI score implies: 70+ responsive, below 40 non-responsive, otherwise uncertain. */
export function suggestionCall(score: number | undefined | null): SuggestionCall | null {
  if (score == null) return null;
  if (score >= 70) return "R";
  if (score < 40) return "NR";
  return "?";
}

/** True when the reviewer's decision matches the suggested call (an agreement signal for the grid). */
export function suggestionAgrees(coding: CodingDecision, score: number | undefined | null): boolean | null {
  const call = suggestionCall(score);
  if (!call || call === "?" || coding.responsive == null) return null;
  return (call === "R") === coding.responsive;
}

// ---------------------------------------------------------------------------
// Keyboard coding
// ---------------------------------------------------------------------------

export type CodingKey = { kind: "responsive"; value: boolean } | { kind: "privileged" } | { kind: "hot" } | { kind: "issue"; index: number } | { kind: "next-uncoded" };

/** Map a bare key press to a coding action (null when the key is not a coding key). */
export function codingKeyAction(key: string): CodingKey | null {
  const k = key.toLowerCase();
  if (k === "r") return { kind: "responsive", value: true };
  if (k === "n") return { kind: "responsive", value: false };
  if (k === "p") return { kind: "privileged" };
  if (k === "h") return { kind: "hot" };
  if (k === "x") return { kind: "next-uncoded" };
  if (/^[1-9]$/.test(k)) return { kind: "issue", index: Number(k) - 1 };
  return null;
}

/** The patch a coding key produces for a document's current coding (toggles for privileged / hot / issue). */
export function applyCodingKey(coding: CodingDecision, action: CodingKey, issueCodes: string[]): Partial<CodingDecision> | null {
  switch (action.kind) {
    case "responsive": return { responsive: coding.responsive === action.value ? null : action.value };
    case "privileged": return coding.privileged ? { privileged: false, privilegeBasis: undefined } : { privileged: true, privilegeBasis: coding.privilegeBasis ?? "attorney-client" };
    case "hot": return { hot: !coding.hot };
    case "issue": {
      const code = issueCodes[action.index];
      if (!code) return null;
      const cur = coding.issues ?? [];
      return { issues: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code] };
    }
    default: return null;
  }
}

/** Next row after `activeId` (wrapping) without a responsiveness decision, or null. */
export function nextUncodedRow(rows: Pick<DocRow, "id" | "coding">[], activeId: string | null): string | null {
  if (!rows.length) return null;
  const start = activeId ? rows.findIndex((r) => r.id === activeId) : -1;
  for (let step = 1; step <= rows.length; step++) {
    const r = rows[(start + step) % rows.length];
    if (r.id === activeId) continue;
    if (r.coding.responsive == null) return r.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

export interface HistogramBar { key: string; label: string; count: number; selected: boolean }

/** Custodian bars for the rail chart: top `max` by count, the rest folded into "Others" (not clickable). */
export function custodianBars(buckets: FacetBucket[], selected: string[], max = 8): (HistogramBar & { others?: boolean })[] {
  const sorted = [...buckets].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sorted.slice(0, max).map((b) => ({ key: b.value, label: b.label, count: b.count, selected: selected.includes(b.value) }));
  const rest = sorted.slice(max);
  if (rest.length) top.push({ key: "__others", label: `Others (${rest.length})`, count: rest.reduce((n, b) => n + b.count, 0), selected: false, others: true });
  return top;
}

/** Whether the date chart shows months (short spans) or years. */
export function dateGranularity(months: DateBucket[], maxMonths = 36): "month" | "year" {
  const keys = months.map((m) => m.year).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  if (keys.length < 2) return "month";
  const [fy, fm] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  return (ly - fy) * 12 + (lm - fm) + 1 <= maxMonths ? "month" : "year";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Bars for the date chart with gaps filled so the axis reads as a timeline. */
export function dateBars(months: DateBucket[], years: DateBucket[], selectedMonths: string[], selectedYears: string[], granularity: "month" | "year"): HistogramBar[] {
  if (granularity === "year") {
    const valid = years.filter((y) => /^\d{4}$/.test(y.year)).sort((a, b) => a.year.localeCompare(b.year));
    if (!valid.length) return [];
    const first = Number(valid[0].year), last = Number(valid[valid.length - 1].year);
    const by = new Map(valid.map((y) => [y.year, y.count]));
    return Array.from({ length: last - first + 1 }, (_, i) => { const y = String(first + i); return { key: y, label: y, count: by.get(y) ?? 0, selected: selectedYears.includes(y) }; });
  }
  const valid = months.filter((m) => /^\d{4}-\d{2}$/.test(m.year)).sort((a, b) => a.year.localeCompare(b.year));
  if (!valid.length) return [];
  const by = new Map(valid.map((m) => [m.year, m.count]));
  const [fy, fm] = valid[0].year.split("-").map(Number);
  const [ly, lm] = valid[valid.length - 1].year.split("-").map(Number);
  const out: HistogramBar[] = [];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m++) {
    if (m > 12) { m = 1; y++; }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ key, label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, count: by.get(key) ?? 0, selected: selectedMonths.includes(key) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Ids of every row sharing the group of `id` (family / thread / near-dup cluster) in a grouped result set. */
export function groupMemberIds(rows: Pick<DocRow, "id" | "groupKey">[], id: string): string[] {
  const key = rows.find((r) => r.id === id)?.groupKey;
  if (!key) return [id];
  return rows.filter((r) => r.groupKey === key).map((r) => r.id);
}

/** Priority for the batches grid sort: high first. */
export const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

export function batchDueTone(dueAt: string | undefined, status: string, today = new Date().toISOString().slice(0, 10)): "destructive" | "warning" | "muted" {
  if (!dueAt || status === "complete") return "muted";
  if (dueAt < today) return "destructive";
  const days = Math.round((new Date(dueAt + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86_400_000);
  return days <= 3 ? "warning" : "muted";
}
