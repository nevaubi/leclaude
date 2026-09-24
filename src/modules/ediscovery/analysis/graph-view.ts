/**
 * Pure helpers for the people graph view (client + server safe, unit-tested):
 * the focused neighborhood around a selected person or organization, the
 * relationship-kind and date filters, curved edge geometry and CSV export.
 */
import type { Relationship } from "@/lib/types/domain";
import type { GraphData, GraphEdge, GraphNode, GraphOrg } from "./types";
import { RELATIONSHIP_LABELS } from "./graph";

export type RelationshipKind = Relationship["kind"];

export const KIND_GROUPS: { id: string; label: string; kinds: RelationshipKind[] }[] = [
  { id: "email", label: "Email", kinds: ["emailed", "cc"] },
  { id: "org", label: "Org chart", kinds: ["reports_to", "supervises", "same_org"] },
  { id: "engagement", label: "Engagements", kinds: ["retained", "represents"] },
  { id: "testimony", label: "Testimony", kinds: ["testified_about", "meeting"] },
  { id: "other", label: "Other", kinds: ["authored", "received", "other"] },
];

export const ALL_KINDS: RelationshipKind[] = Object.keys(RELATIONSHIP_LABELS) as RelationshipKind[];

export interface GraphFilters {
  kinds: Set<RelationshipKind>;
  from?: string;
  to?: string;
  /** Keep edges without any dated evidence when a date range is set (default false). */
  keepUndated?: boolean;
}

/** An edge passes when its kind is on and, with a date range, when any evidence date falls inside it. */
export function edgePasses(e: GraphEdge, f: GraphFilters): boolean {
  if (!f.kinds.has(e.kind)) return false;
  if (!f.from && !f.to) return true;
  const dates = e.evidence.map((x) => x.date).filter((x): x is string => !!x);
  if (!dates.length) return !!f.keepUndated;
  return dates.some((d) => (!f.from || d >= f.from) && (!f.to || d <= f.to));
}

export interface Neighborhood {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Node ids at each depth from the center (depth 0 = the center itself). */
  depth: Map<string, number>;
  truncated: boolean;
}

/**
 * The subgraph shown in the focused view: the center plus its neighbors up to
 * `depth` hops (edges that pass the filters only), or an organization's members
 * and the edges among them. `limit` caps the node count so a hub never floods
 * the canvas; the highest-weight neighbors win.
 */
export function neighborhood(data: GraphData, opts: { centerId?: string | null; org?: GraphOrg | null; depth?: 1 | 2; filters: GraphFilters; limit?: number }): Neighborhood {
  const limit = opts.limit ?? 40;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const edges = data.edges.filter((e) => edgePasses(e, opts.filters) && byId.has(e.source) && byId.has(e.target));
  const depth = new Map<string, number>();
  if (opts.org) {
    for (const id of opts.org.memberIds) if (byId.has(id)) depth.set(id, 0);
    const keep = edges.filter((e) => depth.has(e.source) && depth.has(e.target));
    const ids = Array.from(depth.keys());
    const truncated = ids.length > limit;
    const nodes = ids.slice(0, limit).map((id) => byId.get(id)!);
    const set = new Set(nodes.map((n) => n.id));
    return { nodes, edges: keep.filter((e) => set.has(e.source) && set.has(e.target)), depth, truncated };
  }
  if (!opts.centerId || !byId.has(opts.centerId)) return { nodes: [], edges: [], depth, truncated: false };
  depth.set(opts.centerId, 0);
  let frontier = [opts.centerId];
  const maxDepth = opts.depth ?? 1;
  for (let d = 1; d <= maxDepth; d++) {
    const next: { id: string; w: number }[] = [];
    for (const id of frontier) for (const e of edges) {
      const other = e.source === id ? e.target : e.target === id ? e.source : null;
      if (!other || depth.has(other)) continue;
      const cur = next.find((x) => x.id === other);
      if (cur) cur.w += e.weight; else next.push({ id: other, w: e.weight });
    }
    next.sort((a, b) => b.w - a.w);
    for (const n of next) if (!depth.has(n.id)) depth.set(n.id, d);
    frontier = next.map((n) => n.id);
  }
  const ids = Array.from(depth.entries()).sort((a, b) => a[1] - b[1] || weightOf(b[0], edges) - weightOf(a[0], edges)).map(([id]) => id);
  const truncated = ids.length > limit;
  const kept = new Set(ids.slice(0, limit));
  const nodes = Array.from(kept).map((id) => byId.get(id)!);
  const keep = edges.filter((e) => kept.has(e.source) && kept.has(e.target) && (maxDepth === 2 || e.source === opts.centerId || e.target === opts.centerId || (depth.get(e.source) === 1 && depth.get(e.target) === 1)));
  return { nodes, edges: keep, depth, truncated };
}

function weightOf(id: string, edges: GraphEdge[]) {
  let w = 0;
  for (const e of edges) if (e.source === id || e.target === id) w += e.weight;
  return w;
}

/** Neighbors of a node in a neighborhood, strongest first (for keyboard navigation). */
export function neighborsOf(id: string, edges: GraphEdge[]): { id: string; weight: number; edgeIds: string[] }[] {
  const m = new Map<string, { id: string; weight: number; edgeIds: string[] }>();
  for (const e of edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (!other) continue;
    const cur = m.get(other) ?? { id: other, weight: 0, edgeIds: [] };
    cur.weight += e.weight; cur.edgeIds.push(e.id);
    m.set(other, cur);
  }
  return Array.from(m.values()).sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

/** Node radius: evidence-weighted (documents authored/received plus testimony), 7–22px. */
export function nodeRadius(n: Pick<GraphNode, "docCount" | "testimony" | "depositions">) {
  const evidence = n.docCount + (n.testimony ?? 0) * 0.5 + n.depositions * 4;
  return Math.max(7, Math.min(22, 6 + Math.sqrt(evidence) * 1.6));
}

/** Quadratic curve between two points; parallel edges get increasing offsets so they never overlap. */
export function curvedPath(x1: number, y1: number, x2: number, y2: number, lane = 0): { d: string; mx: number; my: number } {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len, ny = dx / len;
  const bend = (lane === 0 ? 0.12 : 0.12 + lane * 0.16) * len * (lane % 2 === 0 ? 1 : -1);
  const cx = (x1 + x2) / 2 + nx * bend, cy = (y1 + y2) / 2 + ny * bend;
  // midpoint of the quadratic curve at t = 0.5
  const mx = (x1 + 2 * cx + x2) / 4, my = (y1 + 2 * cy + y2) / 4;
  return { d: `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`, mx, my };
}

/** Lane index for each edge so parallel edges between the same pair curve differently. */
export function edgeLanes(edges: GraphEdge[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const e of edges) {
    const key = [e.source, e.target].sort().join("|");
    const lane = seen.get(key) ?? 0;
    out.set(e.id, lane);
    seen.set(key, lane + 1);
  }
  return out;
}

export function kindLabel(kind: RelationshipKind) {
  return RELATIONSHIP_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Edges as a CSV (source, target, kind, weight, dates, evidence cites). */
export function edgesCsv(nodes: GraphNode[], edges: GraphEdge[]): string {
  const name = new Map(nodes.map((n) => [n.id, n.label]));
  const header = ["From", "To", "Relationship", "Weight", "Label", "First evidence", "Last evidence", "Evidence"];
  const lines = [header.join(",")];
  for (const e of edges) lines.push([name.get(e.source) ?? e.source, name.get(e.target) ?? e.target, kindLabel(e.kind), e.weight, e.label ?? "", e.firstDate ?? "", e.lastDate ?? "", e.evidence.map((x) => x.cite ?? x.bates ?? x.excerpt ?? "").filter(Boolean).join("; ")].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** People and organizations as a CSV (the left list). */
export function nodesCsv(nodes: GraphNode[], orgs: GraphOrg[] = []): string {
  const header = ["Name", "Kind", "Role", "Organization", "Title", "Documents", "Testimony", "Depositions", "Links"];
  const lines = [header.join(",")];
  for (const n of nodes) lines.push([n.label, "person", n.role ?? "", n.organization ?? "", n.title ?? "", n.docCount, n.testimony ?? 0, n.depositions, n.degree].map(csvCell).join(","));
  for (const o of orgs) lines.push([o.label, "organization", "", "", `${o.memberIds.length} people`, o.docCount, o.testimony, "", ""].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Rows for the timeline strip: dated edges of the neighborhood, strongest first, capped. */
export function timelineRows(edges: GraphEdge[], nodes: GraphNode[], centerId: string | null, max = 10): { edge: GraphEdge; label: string; dates: string[]; first: string; last: string }[] {
  const name = new Map(nodes.map((n) => [n.id, n.label]));
  return edges
    .filter((e) => e.firstDate && e.lastDate)
    .sort((a, b) => b.weight - a.weight || a.firstDate!.localeCompare(b.firstDate!))
    .slice(0, max)
    .map((e) => {
      const other = centerId && e.source === centerId ? e.target : centerId && e.target === centerId ? e.source : null;
      const label = other ? `${name.get(other) ?? other} · ${kindLabel(e.kind)}` : `${name.get(e.source) ?? e.source} → ${name.get(e.target) ?? e.target} · ${kindLabel(e.kind)}`;
      return { edge: e, label, dates: Array.from(new Set(e.evidence.map((x) => x.date).filter((x): x is string => !!x))).sort(), first: e.firstDate!, last: e.lastDate! };
    });
}
