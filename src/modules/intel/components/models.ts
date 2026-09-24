/**
 * Pure, client-safe view models for the /intel pages and the Home/Settings
 * panels: filter application, URL param parsing, chart data shaping, graph
 * colours and grouping helpers. Unit-tested without React.
 */
import type { FilterValues } from "@/components/ui/filterbar-helpers";
import type { IntelEntityType, IntelInsight, IntelRelationType, IntelSeries, IntelTimelineEntry } from "../types";
import type { EntityListItem, TrendGroupBy, TrendQuery, TrendResult } from "../analysis/types";
import { ENTITY_TYPES, monthLabel } from "../analysis/pure";

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface IntelNavItem { href: string; label: string; match: (pathname: string) => boolean }

export const INTEL_NAV: IntelNavItem[] = [
  { href: "/intel", label: "Explorer", match: (p) => p === "/intel" || /^\/intel\/(judge|attorney|firm|party|court|mdl|product|agency|regulation|statute|expert|documents)(\/|$)/.test(p) },
  { href: "/intel/trends", label: "Trends", match: (p) => p.startsWith("/intel/trends") },
  { href: "/intel/clusters", label: "Clusters", match: (p) => p.startsWith("/intel/clusters") },
  { href: "/intel/graph", label: "Graph", match: (p) => p.startsWith("/intel/graph") },
  { href: "/intel/chronologies", label: "Chronologies", match: (p) => p.startsWith("/intel/chronologies") },
  { href: "/intel/insights", label: "Insights", match: (p) => p.startsWith("/intel/insights") },
  { href: "/intel/watches", label: "Watches", match: (p) => p.startsWith("/intel/watches") },
];

export function activeNav(pathname: string): IntelNavItem | undefined {
  return INTEL_NAV.find((n) => n.match(pathname));
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

export interface ExplorerFilters { types: IntelEntityType[]; watched: boolean; flagged: boolean; query: string }

export function explorerFiltersFrom(values: FilterValues, query = ""): ExplorerFilters {
  const raw = values.type;
  const types = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((t): t is IntelEntityType => ENTITY_TYPES.includes(t as IntelEntityType));
  return { types, watched: values.watched === "1", flagged: values.flagged === "1", query: query.trim().toLowerCase() };
}

export function explorerFiltersToParams(f: ExplorerFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.types.length) sp.set("type", f.types.join(","));
  if (f.watched) sp.set("watched", "1");
  if (f.flagged) sp.set("flagged", "1");
  if (f.query) sp.set("q", f.query);
  return sp;
}

export function explorerFiltersFromParams(sp: URLSearchParams): { values: FilterValues; query: string } {
  const types = (sp.get("type") ?? "").split(",").map((s) => s.trim()).filter((t): t is IntelEntityType => ENTITY_TYPES.includes(t as IntelEntityType));
  const values: FilterValues = {};
  if (types.length) values.type = types;
  if (sp.get("watched") === "1") values.watched = "1";
  if (sp.get("flagged") === "1") values.flagged = "1";
  return { values, query: sp.get("q") ?? "" };
}

/** Client-side application of the explorer filters over the full entity list. */
export function applyExplorerFilters(items: EntityListItem[], f: ExplorerFilters): EntityListItem[] {
  return items.filter((e) => (!f.types.length || f.types.includes(e.type)) && (!f.watched || e.watched) && (!f.flagged || e.flags.length > 0) && (!f.query || e.name.toLowerCase().includes(f.query) || e.aliases.some((a) => a.toLowerCase().includes(f.query)) || (e.detail ?? "").toLowerCase().includes(f.query)));
}

export function countByType(items: EntityListItem[]): Partial<Record<IntelEntityType, number>> {
  const out: Partial<Record<IntelEntityType, number>> = {};
  for (const e of items) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export type TrendPeriod = "1y" | "2y" | "3y" | "5y" | "all";
export const TREND_PERIODS: { value: TrendPeriod; label: string }[] = [{ value: "1y", label: "Last year" }, { value: "2y", label: "2 years" }, { value: "3y", label: "3 years" }, { value: "5y", label: "5 years" }, { value: "all", label: "All time" }];

export function periodFrom(period: TrendPeriod, now: Date): string | undefined {
  const years = period === "all" ? 0 : Number(period.replace("y", ""));
  if (!years) return undefined;
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), 1));
  return d.toISOString().slice(0, 7);
}

export function trendQueryFromParams(sp: URLSearchParams, now: Date): TrendQuery & { period: TrendPeriod; compareMode: boolean } {
  const groupBy = (sp.get("groupBy") ?? "court") as TrendGroupBy;
  const period = (["1y", "2y", "3y", "5y", "all"].includes(sp.get("period") ?? "") ? sp.get("period") : "3y") as TrendPeriod;
  const compare = (sp.get("compare") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  return {
    groupBy,
    kinds: (sp.get("kinds") ?? "").split(",").map((s) => s.trim()).filter(Boolean) as TrendQuery["kinds"],
    jurisdiction: sp.get("jurisdiction") ?? undefined,
    court: sp.get("court") ?? undefined,
    judgeId: sp.get("judgeId") ?? undefined,
    matterId: sp.get("matterId") ?? undefined,
    from: periodFrom(period, now),
    compare: compare.length ? compare : undefined,
    period,
    compareMode: sp.get("mode") === "compare",
  };
}

export function trendQueryToParams(q: TrendQuery & { period?: TrendPeriod; compareMode?: boolean }): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("groupBy", q.groupBy);
  if (q.kinds?.length) sp.set("kinds", q.kinds.join(","));
  if (q.jurisdiction) sp.set("jurisdiction", q.jurisdiction);
  if (q.court) sp.set("court", q.court);
  if (q.judgeId) sp.set("judgeId", q.judgeId);
  if (q.matterId) sp.set("matterId", q.matterId);
  if (q.period && q.period !== "3y") sp.set("period", q.period);
  if (q.compareMode) sp.set("mode", "compare");
  if (q.compare?.length) sp.set("compare", q.compare.join("|"));
  return sp;
}

export function trendApiParams(q: TrendQuery): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("groupBy", q.groupBy);
  if (q.kinds?.length) sp.set("kinds", q.kinds.join(","));
  if (q.jurisdiction) sp.set("jurisdiction", q.jurisdiction);
  if (q.court) sp.set("court", q.court);
  if (q.judgeId) sp.set("judgeId", q.judgeId);
  if (q.entityId) sp.set("entityId", q.entityId);
  if (q.matterId) sp.set("matterId", q.matterId);
  if (q.motion) sp.set("motion", q.motion);
  if (q.from) sp.set("from", q.from);
  if (q.to) sp.set("to", q.to);
  if (q.top) sp.set("top", String(q.top));
  if (q.compare?.length) sp.set("compare", q.compare.join(","));
  return sp;
}

/** Recharts rows: one object per month with a key per series. */
export function chartRows(months: string[], series: IntelSeries[]): Record<string, string | number>[] {
  return months.map((m) => { const row: Record<string, string | number> = { t: m, label: monthLabel(m) }; for (const s of series) row[s.label] = s.points.find((p) => p.t === m)?.v ?? 0; return row; });
}

/**
 * Fixed categorical order (never cycled). The order chart-1, chart-4, chart-3, chart-2, chart-5 keeps red and green
 * non-adjacent (validated for CVD separation in light mode); series beyond five fold into "Other". Every chart also
 * carries a legend, direct end labels and a table view, so identity is never colour alone.
 */
export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-4)", "var(--chart-3)", "var(--chart-2)", "var(--chart-5)"] as const;
export const MAX_SERIES = SERIES_COLORS.length;

export function foldSeries(series: IntelSeries[], max = MAX_SERIES): IntelSeries[] {
  if (series.length <= max) return series;
  const keep = series.slice(0, max - 1);
  const rest = series.slice(max - 1);
  const months = series[0]?.points.map((p) => p.t) ?? [];
  return [...keep, { label: "Other", points: months.map((t, i) => ({ t, v: rest.reduce((n, s) => n + (s.points[i]?.v ?? 0), 0) })) }];
}

export function seriesColor(index: number): string {
  return SERIES_COLORS[Math.min(index, SERIES_COLORS.length - 1)];
}

/** Compact "Δ" text for a series trend. */
export function trendDelta(t: TrendResult["trends"][string] | undefined): string {
  if (!t) return "—";
  if (t.changePct == null) return t.last > t.first ? "new" : "—";
  return `${t.changePct > 0 ? "+" : ""}${t.changePct}%`;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/** Entity type → chart token class (fill) in a fixed order so identity never changes with the filter. */
export const GRAPH_TYPE_FILL: Record<IntelEntityType, string> = {
  judge: "fill-chart-1", court: "fill-chart-1", attorney: "fill-chart-2", firm: "fill-chart-2", party: "fill-chart-5", mdl: "fill-primary", product: "fill-chart-3", agency: "fill-chart-4", regulation: "fill-chart-4", statute: "fill-chart-4", expert: "fill-muted-foreground",
};
export const GRAPH_TYPE_DOT: Record<IntelEntityType, string> = {
  judge: "bg-chart-1", court: "bg-chart-1", attorney: "bg-chart-2", firm: "bg-chart-2", party: "bg-chart-5", mdl: "bg-primary", product: "bg-chart-3", agency: "bg-chart-4", regulation: "bg-chart-4", statute: "bg-chart-4", expert: "bg-muted-foreground",
};
export const GRAPH_EDGE_DASH: Partial<Record<IntelRelationType, string>> = { cites: "3 3", mentions: "1 3", opposes: "5 3", co_counsel: "2 3" };

export function graphRadius(n: { degree: number; documents: number }): number {
  return Math.min(22, 6 + Math.sqrt(n.documents + n.degree * 2) * 2.2);
}

// ---------------------------------------------------------------------------
// Chronology
// ---------------------------------------------------------------------------

export function groupByMonth(entries: IntelTimelineEntry[]): { month: string; label: string; entries: IntelTimelineEntry[] }[] {
  const map = new Map<string, IntelTimelineEntry[]>();
  for (const e of entries) { const k = e.at.slice(0, 7); map.set(k, [...(map.get(k) ?? []), e]); }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, list]) => ({ month, label: monthLabel(month), entries: list }));
}

export const CHRONOLOGY_KIND_LABEL: Record<string, string> = { docket: "Docket", opinion: "Opinion", regulatory: "Regulatory", recall: "Recall", mdl: "MDL", news: "News" };

export function chronologyKindLabel(kind: string | undefined): string {
  if (!kind) return "Event";
  if (kind.startsWith("ediscovery:")) return `E-discovery · ${kind.slice("ediscovery:".length)}`;
  return CHRONOLOGY_KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface InsightFilters { kinds: IntelInsight["kind"][]; statuses: IntelInsight["status"][]; matterId?: string; query: string }

export function insightFiltersFrom(values: FilterValues, query = ""): InsightFilters {
  const list = (v: FilterValues[string]) => (Array.isArray(v) ? v : v ? [v] : []);
  return { kinds: list(values.kind) as IntelInsight["kind"][], statuses: list(values.status) as IntelInsight["status"][], matterId: typeof values.matter === "string" ? values.matter : undefined, query: query.trim().toLowerCase() };
}

export function applyInsightFilters(items: IntelInsight[], f: InsightFilters): IntelInsight[] {
  return items.filter((i) => (!f.kinds.length || f.kinds.includes(i.kind)) && (!f.statuses.length || f.statuses.includes(i.status)) && (!f.matterId || i.scope.matterId === f.matterId) && (!f.query || i.title.toLowerCase().includes(f.query) || i.summary.toLowerCase().includes(f.query)));
}

/** Which chart/table an insight's `data` payload can render. */
export function insightDataKind(i: Pick<IntelInsight, "data">): "series" | "timeline" | "table" | "clusters" | "profile" | "none" {
  const d = i.data ?? {};
  if (Array.isArray(d.series) && d.series.length) return "series";
  if (Array.isArray(d.timeline) && d.timeline.length) return "timeline";
  if (Array.isArray(d.clusters) && d.clusters.length) return "clusters";
  if (d.profile && typeof d.profile === "object") return "profile";
  if (Array.isArray(d.table) && d.table.length) return "table";
  return "none";
}

export function scopeLabel(i: Pick<IntelInsight, "scope">, matterName: (id: string) => string | undefined): string {
  if (i.scope.matterId) return matterName(i.scope.matterId) ?? i.scope.matterId;
  if (i.scope.userId) return "For you";
  if (i.scope.teamId) return "Team";
  return "Firm-wide";
}

// ---------------------------------------------------------------------------
// Settings → Data & automation
// ---------------------------------------------------------------------------

export function describeHealth(h: { ok: boolean; lastError?: string; consecutiveFailures: number }, enabled: boolean, status: string): { label: string; tone: "muted" | "success" | "warning" | "destructive" } {
  if (!enabled) return { label: "Disabled", tone: "muted" };
  if (status === "running") return { label: "Running", tone: "success" };
  if (!h.ok) return { label: h.consecutiveFailures >= 5 ? "Failing" : "Error", tone: h.consecutiveFailures >= 3 ? "destructive" : "warning" };
  if (h.lastError) return { label: "Needs attention", tone: "warning" };
  return { label: "Healthy", tone: "success" };
}

export const JOB_STATUS_TONE: Record<string, "muted" | "success" | "warning" | "destructive" | "primary"> = { queued: "muted", running: "primary", succeeded: "success", failed: "destructive", fixed: "warning", escalated: "destructive", cancelled: "muted" };

/** Compact "3 fixes · escalated" text for a job row. */
export function jobRepairText(j: { fixes: { by: string; action: string }[]; escalation?: { reason: string } }): string {
  const auto = j.fixes.filter((f) => f.by !== "human");
  const parts: string[] = [];
  if (auto.length) parts.push(`${auto.length} steward fix${auto.length === 1 ? "" : "es"} (${Array.from(new Set(auto.map((f) => f.action))).join(", ")})`);
  if (j.escalation) parts.push("escalated");
  return parts.join(" · ") || "—";
}
