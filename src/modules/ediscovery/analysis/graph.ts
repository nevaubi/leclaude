/**
 * Pure graph builder (client + server safe): people/org nodes and weighted
 * edges from Relationship records plus document author/recipient counts.
 */
import type { Person, Relationship } from "@/lib/types/domain";
import type { GraphData, GraphEdge, GraphNode } from "./types";

export interface GraphDocLite { id: string; from?: string; to?: string[]; cc?: string[]; custodianId: string }

const ROLE_COLORS: Record<string, string> = {
  custodian: "chart-1", attorney: "primary", opposing: "chart-5", expert: "chart-2", witness: "chart-3", judge: "muted", client: "chart-4", paralegal: "primary", staff: "primary", other: "chart-3",
};

export function normalizeName(name: string) {
  return name.toLowerCase().replace(/\(.*?\)/g, "").replace(/\b(dr|mr|mrs|ms|cmdr|chief|hon|esq)\.?\s+/g, "").replace(/[^a-z' -]/g, "").replace(/\s+/g, " ").trim();
}

/** Map a free-text name (as it appears in email headers) to a person id. */
export function resolvePersonName(name: string, people: Person[]): Person | undefined {
  const n = normalizeName(name);
  if (!n) return undefined;
  const exact = people.find((p) => normalizeName(p.name) === n);
  if (exact) return exact;
  const last = n.split(" ").pop()!;
  const cands = people.filter((p) => normalizeName(p.name).split(" ").pop() === last);
  if (cands.length === 1) return cands[0];
  return cands.find((p) => normalizeName(p.name).startsWith(n.split(" ")[0]));
}

export function buildGraph(people: Person[], relationships: Relationship[], docs: GraphDocLite[], depositionsByWitness: Map<string, number> = new Map()): GraphData {
  const byId = new Map(people.map((p) => [p.id, p]));
  const authored = new Map<string, number>();
  const received = new Map<string, number>();
  for (const d of docs) {
    const from = d.from ? resolvePersonName(d.from, people) : byId.get(d.custodianId);
    if (from) authored.set(from.id, (authored.get(from.id) ?? 0) + 1);
    for (const r of [...(d.to ?? []), ...(d.cc ?? [])]) { const p = resolvePersonName(r, people); if (p) received.set(p.id, (received.get(p.id) ?? 0) + 1); }
  }

  // Aggregate edges by (from,to,kind).
  const edgeMap = new Map<string, GraphEdge>();
  const degree = new Map<string, number>();
  const involved = new Set<string>();
  for (const r of relationships) {
    if (!byId.has(r.fromId) || !byId.has(r.toId) || r.fromId === r.toId) continue;
    const key = `${r.fromId}|${r.toId}|${r.kind}`;
    const cur = edgeMap.get(key);
    if (cur) { cur.weight += r.weight; cur.evidence.push(...(r.evidence ?? [])); if (r.label && !cur.label) cur.label = r.label; }
    else edgeMap.set(key, { id: r.id, source: r.fromId, target: r.toId, kind: r.kind, weight: r.weight, label: r.label, evidence: [...(r.evidence ?? [])] });
    involved.add(r.fromId); involved.add(r.toId);
    degree.set(r.fromId, (degree.get(r.fromId) ?? 0) + r.weight);
    degree.set(r.toId, (degree.get(r.toId) ?? 0) + r.weight);
  }
  const edges = Array.from(edgeMap.values()).map((e) => ({ ...e, evidence: e.evidence.slice(0, 8) }));

  const nodes: GraphNode[] = [];
  const clusterSizes = new Map<string, number>();
  for (const p of people) {
    const a = authored.get(p.id) ?? 0;
    const r = received.get(p.id) ?? 0;
    if (!involved.has(p.id) && a + r === 0 && !depositionsByWitness.has(p.id)) continue;
    const cluster = p.organization ?? "Unaffiliated";
    clusterSizes.set(cluster, (clusterSizes.get(cluster) ?? 0) + 1);
    nodes.push({ id: p.id, label: p.name, kind: "person", role: p.role, organization: p.organization, title: p.title, docCount: a + r, authored: a, received: r, depositions: depositionsByWitness.get(p.id) ?? 0, cluster, color: ROLE_COLORS[p.role] ?? "chart-3", degree: degree.get(p.id) ?? 0 });
  }
  const clusterPalette = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "primary", "info"];
  const clusters = Array.from(clusterSizes.entries()).sort((a, b) => b[1] - a[1]).map(([id, size], i) => ({ id, label: id, color: clusterPalette[i % clusterPalette.length], size }));
  return { nodes, edges, clusters };
}

export const RELATIONSHIP_LABELS: Record<Relationship["kind"], string> = {
  reports_to: "reports to", emailed: "emailed", cc: "copied", meeting: "met with", same_org: "same organization", supervises: "supervises", retained: "retained", represents: "represents", testified_about: "testified about", authored: "authored", received: "received", other: "related to",
};
