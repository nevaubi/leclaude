import "server-only";
import { db } from "@/lib/db";
import type { IntelDocument, IntelDocumentKind } from "../types";
import { getDocumentText, intelDocuments, intelEntities } from "../store";
import { dateOf } from "./entities";
import { bucketByMonth, classifyMotion, classifyOutcome, monthKey, seriesTrend, sum, zScoreAnomalies, MOTION_LABEL, OUTCOME_LABEL, type MotionType } from "./pure";
import type { TrendGroupBy, TrendQuery, TrendResult } from "./types";

/**
 * Month-bucketed time series over the intel corpus grouped by jurisdiction,
 * court, judge, record kind, motion type, outcome, MDL, counsel, firm, state,
 * agency, product or matter, with rolling z-score anomalies and a compare
 * mode that aligns any set of labels on one month axis.
 */

const DEFAULT_KINDS: Record<TrendGroupBy, IntelDocumentKind[] | undefined> = {
  jurisdiction: ["opinion", "docket_entry", "docket", "court_rule"],
  court: ["opinion", "docket_entry", "docket", "court_rule"],
  judge: ["opinion", "docket_entry", "docket"],
  kind: undefined,
  motion: ["docket_entry", "opinion"],
  outcome: ["docket_entry", "opinion"],
  mdl: ["docket_entry", "docket", "opinion", "mdl", "news"],
  attorney: ["docket_entry", "docket", "opinion"],
  firm: ["docket_entry", "docket", "opinion"],
  state: ["opinion", "docket_entry", "docket", "court_rule"],
  agency: ["regulation", "register_notice", "recall", "adverse_event", "news"],
  product: ["recall", "adverse_event", "regulation", "register_notice", "docket_entry", "news"],
  matter: undefined,
};

const COURT_STATE: Record<string, string> = { dsc: "South Carolina", flnd: "Florida", flmd: "Florida", flsd: "Florida", cand: "California", cacd: "California", casd: "California", caed: "California", nysd: "New York", nyed: "New York", ilnd: "Illinois", ilsd: "Illinois", ohnd: "Ohio", ohsd: "Ohio", njd: "New Jersey", ded: "Delaware", paed: "Pennsylvania", azd: "Arizona", mowd: "Missouri", txnd: "Texas", ncwd: "North Carolina", scotus: "Federal (Supreme Court)", jpml: "Federal (JPML)", ca4: "Federal (4th Cir.)", ca9: "Federal (9th Cir.)", ca11: "Federal (11th Cir.)" };

const STATE_NAMES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia", "Puerto Rico"];

export function stateOf(doc: Pick<IntelDocument, "courtId" | "court" | "jurisdiction">): string | undefined {
  if (doc.courtId && COURT_STATE[doc.courtId]) return COURT_STATE[doc.courtId];
  const hay = `${doc.court ?? ""} ${doc.jurisdiction ?? ""}`;
  for (const s of STATE_NAMES) if (hay.includes(s)) return s;
  return doc.courtId?.startsWith("ca") ? "Federal (appellate)" : undefined;
}

export function matchesTrendFilters(doc: IntelDocument, q: TrendQuery): boolean {
  if (q.kinds?.length && !q.kinds.includes(doc.kind)) return false;
  if (q.jurisdiction && !(doc.jurisdiction ?? "").toLowerCase().includes(q.jurisdiction.toLowerCase()) && stateOf(doc)?.toLowerCase() !== q.jurisdiction.toLowerCase()) return false;
  if (q.court && doc.courtId !== q.court && !(doc.court ?? "").toLowerCase().includes(q.court.toLowerCase())) return false;
  if (q.judgeId && !doc.judgeIds.includes(q.judgeId)) return false;
  if (q.matterId && !doc.matterIds.includes(q.matterId)) return false;
  if (q.entityId && !docEntityIds(doc).includes(q.entityId)) return false;
  if (q.motion && classifyMotion(doc.title, doc.summary) !== q.motion) return false;
  const mk = monthKey(dateOf(doc));
  if (!mk) return false;
  if (q.from && mk < q.from.slice(0, 7)) return false;
  if (q.to && mk > q.to.slice(0, 7)) return false;
  return true;
}

function docEntityIds(doc: IntelDocument): string[] {
  return Array.from(new Set([...doc.judgeIds, ...doc.attorneyIds, ...doc.firmIds, ...doc.partyIds, ...doc.productIds, ...(doc.mdlId ? [doc.mdlId] : []), ...(((doc.meta?.entityIds as string[] | undefined) ?? []))]));
}

/** Label(s) for a document under a grouping dimension; entity dimensions return `id|name` pairs. */
export function groupLabels(doc: IntelDocument, groupBy: TrendGroupBy, names: (id: string) => string | undefined, matterName: (id: string) => string | undefined): { label: string; id?: string }[] {
  const byIds = (ids: string[]) => ids.map((id) => ({ label: names(id) ?? id, id })).filter((x) => x.label);
  switch (groupBy) {
    case "jurisdiction": return doc.jurisdiction ? [{ label: doc.jurisdiction }] : [];
    case "court": return doc.court ? [{ label: doc.court, id: doc.courtId }] : doc.courtId ? [{ label: doc.courtId, id: doc.courtId }] : [];
    case "judge": return byIds(doc.judgeIds);
    case "kind": return [{ label: doc.kind }];
    case "motion": { const m = classifyMotion(doc.title, doc.summary); return m ? [{ label: MOTION_LABEL[m], id: m }] : []; }
    case "outcome": { const o = classifyOutcome(doc.title, doc.summary); return o ? [{ label: OUTCOME_LABEL[o], id: o }] : []; }
    case "mdl": return doc.mdlId ? byIds([doc.mdlId]) : [];
    case "attorney": return byIds(doc.attorneyIds);
    case "firm": return byIds(doc.firmIds);
    case "state": { const s = stateOf(doc); return s ? [{ label: s }] : []; }
    case "agency": return doc.agencies.map((a) => ({ label: a }));
    case "product": return byIds(doc.productIds);
    case "matter": return doc.matterIds.map((id) => ({ label: matterName(id) ?? id, id }));
  }
}

/** Build the series for a query. Pure over the given documents when `docs` is supplied (tests). */
export function buildTrends(q: TrendQuery, docs?: IntelDocument[]): TrendResult {
  const query: TrendQuery = { ...q, kinds: q.kinds?.length ? q.kinds : DEFAULT_KINDS[q.groupBy] };
  const source = docs ?? intelDocuments().all();
  const entityName = (id: string) => intelEntities().get(id)?.name;
  const matterName = (id: string) => db().matters.get(id)?.shortName;
  const rows = source.filter((d) => matchesTrendFilters(d, query));
  const labelIds: Record<string, string> = {};
  const labelsOf = (d: IntelDocument) => groupLabels(d, query.groupBy, entityName, matterName).map((x) => { if (x.id) labelIds[x.label] = x.id; return x.label; });
  const from = query.from ? query.from.slice(0, 7) : undefined;
  const to = query.to ? query.to.slice(0, 7) : undefined;
  const { months, series: all } = bucketByMonth(rows, { date: dateOf, group: labelsOf, from, to });
  let series = all;
  if (query.compare?.length) {
    const wanted = query.compare.map((c) => c.toLowerCase());
    series = all.filter((s) => wanted.includes(s.label.toLowerCase()) || (labelIds[s.label] && wanted.includes(labelIds[s.label].toLowerCase())));
  } else {
    series = all.slice(0, Math.max(1, query.top ?? 8));
  }
  const totals = all.map((s) => ({ label: s.label, count: sum(s.points), id: labelIds[s.label] }));
  const anomalies = series.flatMap((s) => zScoreAnomalies(s.points, { window: 6, threshold: 2 }).map((anomaly) => ({ series: s.label, anomaly })));
  const trends: TrendResult["trends"] = {};
  for (const s of series) trends[s.label] = seriesTrend(s.points);
  return { query, months, series, totals, anomalies, trends, sample: rows.length, labelIds };
}

/** Motion outcome table for a set of documents (judges, MDLs, counsel). */
export function motionOutcomes(docs: IntelDocument[], opts: { withText?: boolean } = {}): { motion: MotionType; total: number; granted: number; denied: number; partial: number; other: number; docs: { doc: IntelDocument; outcome: ReturnType<typeof classifyOutcome> }[] }[] {
  const table = new Map<MotionType, { motion: MotionType; total: number; granted: number; denied: number; partial: number; other: number; docs: { doc: IntelDocument; outcome: ReturnType<typeof classifyOutcome> }[] }>();
  for (const doc of docs) {
    if (doc.kind !== "docket_entry" && doc.kind !== "opinion") continue;
    const text = opts.withText ? getDocumentText(doc.id) ?? undefined : doc.summary;
    const motion = classifyMotion(doc.title, text);
    if (!motion) continue;
    const outcome = classifyOutcome(doc.title, text);
    const row = table.get(motion) ?? { motion, total: 0, granted: 0, denied: 0, partial: 0, other: 0, docs: [] };
    row.total++;
    if (outcome === "granted" || outcome === "affirmed") row.granted++;
    else if (outcome === "denied" || outcome === "reversed") row.denied++;
    else if (outcome === "partial") row.partial++;
    else row.other++;
    row.docs.push({ doc, outcome });
    table.set(motion, row);
  }
  return Array.from(table.values()).sort((a, b) => b.total - a.total);
}

/** Convenience for the trends page: which values exist for a dimension (for filter chips). */
export function trendOptions(): { courts: { value: string; label: string }[]; jurisdictions: string[]; judges: { value: string; label: string }[]; kinds: IntelDocumentKind[]; matters: { value: string; label: string }[]; states: string[] } {
  const docs = intelDocuments().all();
  const courts = new Map<string, string>();
  const jurisdictions = new Set<string>();
  const kinds = new Set<IntelDocumentKind>();
  const states = new Set<string>();
  for (const d of docs) {
    if (d.courtId && d.court) courts.set(d.courtId, d.court);
    if (d.jurisdiction) jurisdictions.add(d.jurisdiction);
    kinds.add(d.kind);
    const s = stateOf(d);
    if (s) states.add(s);
  }
  const judges = intelEntities().find((e) => e.type === "judge").sort((a, b) => b.docIds.length - a.docIds.length).map((e) => ({ value: e.id, label: e.name }));
  const matters = db().matters.all().map((m) => ({ value: m.id, label: m.shortName }));
  return { courts: Array.from(courts.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), jurisdictions: Array.from(jurisdictions).sort(), judges, kinds: Array.from(kinds).sort(), matters, states: Array.from(states).sort() };
}
