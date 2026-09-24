import "server-only";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import { currentUser } from "@/lib/current-user";
import { audit } from "@/lib/integrity/audit";
import { sha256 } from "@/lib/integrity/hash";
import { makeProvenance } from "@/lib/integrity/provenance";
import { CONFIDENCE_GATE, type ProvenanceSource } from "@/lib/integrity/types";
import type { IntelDocument, IntelEvidence, IntelFlag, IntelInsight, IntelInsightKind, IntelInsightScope } from "../types";
import { enqueueJob } from "../jobs";
import { intelDocuments, intelEntities, intelInsights, intelRelations, intelWatches, listChunks, listDocuments } from "../store";
import { buildChronology } from "./chronology";
import { clusterScope } from "./clusters";
import { dateOf, entityDocuments, rebuildEntities } from "./entities";
import { buildRelations } from "./graph";
import { profileSummary } from "./profiles";
import { addMonths, clip, documentHref, fmtDate, monthKey, monthLabel, rankInsightsPure, MOTION_LABEL, type RankContext } from "./pure";
import { buildTrends, motionOutcomes } from "./trends";
import { listWatches, watchedTargets } from "./watches";
import type { AnalysisRunResult, AnalysisStatus, InsightListResult } from "./types";

/**
 * Insights: composed records (trend, cluster, pattern, chronology, profile,
 * anomaly, alert, digest) with provenance, confidence, flags and a status
 * lifecycle (draft → verified/published, flagged, dismissed). Computed insights
 * are derived deterministically from the cited records, so they carry a
 * schema verification at creation; the steward's sweep re-verifies them with
 * the claims method when a model key exists. Ranking for a user, team or
 * matter is recency × relevance × confidence × watches.
 */

const LAST_RUN_KEY = "intel:analysis:lastRun";
const MAX_EVIDENCE = 24;

export interface ComposeInput {
  kind: IntelInsightKind;
  scope: Partial<IntelInsightScope>;
  /** Stable key within (kind, scope) so re-runs update the same record. */
  key: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  evidence: IntelEvidence[];
  confidence: number;
  flags?: IntelFlag[];
  now?: string;
}

export function insightIdFor(kind: IntelInsightKind, scope: Partial<IntelInsightScope>, key: string): string {
  return `iins_${sha256(`${kind}|${scope.matterId ?? ""}|${scope.userId ?? ""}|${scope.teamId ?? ""}|${key}`).slice(0, 16)}`;
}

function provenanceSourceFor(ev: IntelEvidence): ProvenanceSource {
  const doc = intelDocuments().get(ev.docId);
  const kind: ProvenanceSource["kind"] = !doc ? "internal" : doc.kind === "opinion" ? "case-law" : doc.kind === "docket" || doc.kind === "docket_entry" || doc.kind === "mdl" ? "docket" : doc.kind === "regulation" || doc.kind === "register_notice" || doc.kind === "statute" ? "regulation" : doc.kind === "news" || doc.kind === "web_page" ? "web" : "document";
  return { kind, id: ev.docId, title: doc?.title ?? ev.docId, cite: doc?.citation ?? doc?.docketNumber, url: ev.url ?? doc?.url };
}

/** Evidence reference for a document: first chunk plus a short quote. */
export function evidenceForDoc(doc: IntelDocument, quote?: string): IntelEvidence {
  const chunk = listChunks(doc.id)[0];
  return { docId: doc.id, chunkId: chunk?.id, quote: clip(quote ?? doc.summary ?? chunk?.text ?? doc.title, 200), url: doc.url, href: documentHref(doc.id) };
}

/** Build (but do not store) an insight with computed provenance. */
export function composeInsight(input: ComposeInput): IntelInsight {
  const now = input.now ?? new Date().toISOString();
  const scope: IntelInsightScope = { ...input.scope, entityIds: Array.from(new Set(input.scope.entityIds ?? [])) };
  const evidence = dedupeEvidence(input.evidence).slice(0, MAX_EVIDENCE);
  const confidence = Math.max(0, Math.min(1, Number(input.confidence.toFixed(2))));
  const provenance = makeProvenance({ surface: "intel.analysis", model: "analysis", confidence, sources: evidence.map(provenanceSourceFor) });
  provenance.generatedAt = now;
  provenance.verification = { status: "verified", checkedAt: now, method: "schema", supported: evidence.length, unsupported: 0, contradicted: 0, notes: "Computed deterministically from the cited records; re-verified by the sweep when a model key exists." };
  const flags: IntelFlag[] = [...(input.flags ?? [])];
  const unverifiedDocs = evidence.filter((ev) => intelDocuments().get(ev.docId)?.flags.some((f) => f.kind === "unverified" || f.kind === "low_confidence")).length;
  if (unverifiedDocs && !flags.some((f) => f.kind === "unverified")) flags.push({ kind: "unverified", note: `${unverifiedDocs} of ${evidence.length} cited records carry an unverified or low-confidence flag`, at: now, by: "analysis" });
  if (confidence < CONFIDENCE_GATE && !flags.some((f) => f.kind === "low_confidence")) flags.push({ kind: "low_confidence", note: `Confidence ${(confidence * 100).toFixed(0)}% is below the ${(CONFIDENCE_GATE * 100).toFixed(0)}% gate`, at: now, by: "analysis" });
  const publishable = confidence >= CONFIDENCE_GATE && evidence.length > 0;
  return {
    id: insightIdFor(input.kind, scope, input.key),
    kind: input.kind,
    scope,
    title: input.title.trim().slice(0, 200),
    summary: input.summary.trim().slice(0, 1200),
    data: input.data,
    evidence,
    provenance,
    confidence,
    status: publishable ? "published" : "draft",
    flags,
    createdAt: now,
    updatedAt: now,
  };
}

function dedupeEvidence(list: IntelEvidence[]): IntelEvidence[] {
  const seen = new Set<string>();
  const out: IntelEvidence[] = [];
  for (const ev of list) { const k = `${ev.docId}|${ev.chunkId ?? ""}`; if (seen.has(k)) continue; seen.add(k); out.push(ev); }
  return out;
}

function contentHashOf(i: IntelInsight): string {
  return sha256(JSON.stringify({ t: i.title, s: i.summary, d: i.data, e: i.evidence.map((ev) => ev.docId), c: i.confidence }));
}

/**
 * Store an insight idempotently: an unchanged record keeps its timestamps and
 * status; a dismissed record stays dismissed; a changed record takes the new
 * content and status (a sweep flag is cleared because the content is new).
 */
export function saveInsight(insight: IntelInsight, opts: { audit?: boolean } = {}): { insight: IntelInsight; status: "created" | "updated" | "unchanged" } {
  const col = intelInsights();
  const existing = col.get(insight.id);
  if (!existing) {
    col.put(insight);
    if (opts.audit !== false) audit("ai.generate", { kind: "intel.insight", id: insight.id, label: insight.title, matterId: insight.scope.matterId }, { kind: insight.kind, computed: true, confidence: insight.confidence, evidence: insight.evidence.length });
    return { insight, status: "created" };
  }
  if (contentHashOf(existing) === contentHashOf(insight)) return { insight: existing, status: "unchanged" };
  const status: IntelInsight["status"] = existing.status === "dismissed" ? "dismissed" : insight.status;
  const next: IntelInsight = { ...insight, status, createdAt: existing.createdAt, provenance: { ...insight.provenance, review: existing.provenance.review?.status === "approved" || existing.provenance.review?.status === "rejected" ? existing.provenance.review : insight.provenance.review } };
  col.put(next);
  return { insight: next, status: "updated" };
}

// ---------------------------------------------------------------------------
// Queries and lifecycle
// ---------------------------------------------------------------------------

export function getInsight(id: string): IntelInsight | null {
  return intelInsights().get(id);
}

export interface ListInsightsOptions { userId?: string; matterId?: string; status?: IntelInsight["status"][]; kind?: IntelInsightKind[]; entityId?: string; q?: string; limit?: number; offset?: number; rank?: boolean; includeFirmWide?: boolean; now?: Date }

export function rankContext(userId: string | undefined, matterId: string | undefined, now?: Date): RankContext {
  const uid = userId ?? currentUser().id;
  const active = db().matters.find((m) => m.status === "active" && (m.teamIds.includes(uid) || m.leadAttorneyId === uid)).map((m) => m.id);
  return { userId: uid, matterId, activeMatterIds: active, watchedTargets: watchedTargets(uid), now };
}

export function listInsights(o: ListInsightsOptions = {}): InsightListResult {
  const statuses = o.status?.length ? o.status : ["published", "verified", "draft", "flagged"];
  const q = o.q?.trim().toLowerCase();
  const uid = o.userId;
  const all = intelInsights().find((i) => statuses.includes(i.status)
    && (!o.kind?.length || o.kind.includes(i.kind))
    && (!o.entityId || i.scope.entityIds.includes(o.entityId))
    && (!o.matterId || i.scope.matterId === o.matterId || (o.includeFirmWide !== false && !i.scope.matterId))
    && (!uid || !i.scope.userId || i.scope.userId === uid)
    && (!q || i.title.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q)));
  const limit = Math.max(1, Math.min(o.limit ?? 50, 500));
  const offset = Math.max(0, o.offset ?? 0);
  if (o.rank) {
    const ranked = rankInsightsPure(all, rankContext(uid, o.matterId, o.now), all.length);
    const page = ranked.slice(offset, offset + limit).map((i) => ({ ...i, score: i.score }));
    return { insights: page, items: page, total: ranked.length, ranked: true };
  }
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const page = all.slice(offset, offset + limit);
  return { insights: page, items: page, total: all.length, ranked: false };
}

/** Ranked insights for a user, optionally narrowed to one matter (Home "For you", matter headers). */
export function rankInsights(o: { userId?: string; matterId?: string; limit?: number; now?: Date; status?: IntelInsight["status"][] } = {}): IntelInsight[] {
  return listInsights({ userId: o.userId ?? currentUser().id, matterId: o.matterId, status: o.status ?? ["published", "verified"], limit: o.limit ?? 8, rank: true, now: o.now }).insights;
}

export function publishInsight(id: string, opts: { force?: boolean; by?: string } = {}): { ok: boolean; insight?: IntelInsight; message?: string } {
  const i = intelInsights().get(id);
  if (!i) return { ok: false, message: "Insight not found" };
  if (!opts.force) {
    if (i.provenance.verification?.status === "contradicted") return { ok: false, insight: i, message: "Contradicted by its evidence; fix the evidence or dismiss it" };
    if (i.confidence < CONFIDENCE_GATE) return { ok: false, insight: i, message: `Confidence ${(i.confidence * 100).toFixed(0)}% is below the publication gate` };
    if (!i.evidence.length) return { ok: false, insight: i, message: "No evidence attached" };
  }
  const at = new Date().toISOString();
  const next = intelInsights().update(id, (x) => ({ ...x, status: "published", flags: x.flags.filter((f) => f.kind !== "needs_review"), updatedAt: at })) ?? i;
  audit("ai.apply", { kind: "intel.insight", id, label: i.title, matterId: i.scope.matterId }, { decision: "published", forced: Boolean(opts.force), by: opts.by });
  return { ok: true, insight: next };
}

export function dismissInsight(id: string, opts: { by?: string; note?: string } = {}): IntelInsight | null {
  const i = intelInsights().get(id);
  if (!i) return null;
  const at = new Date().toISOString();
  const next = intelInsights().update(id, (x) => ({ ...x, status: "dismissed", updatedAt: at }));
  audit("update", { kind: "intel.insight", id, label: i.title, matterId: i.scope.matterId }, { decision: "dismissed", by: opts.by, note: opts.note });
  return next;
}

/** Re-verify one insight against its evidence with the claims method (needs a model key). */
export async function verifyInsight(id: string, opts: { signal?: AbortSignal } = {}): Promise<{ checked: number; verified: number; flagged: number; skipped: number; reason?: string; insight: IntelInsight | null }> {
  const { verifyInsights } = await import("../steward");
  const r = await verifyInsights({ insightIds: [id], signal: opts.signal });
  return { ...r, insight: intelInsights().get(id) };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface RunAnalysisOptions {
  now?: Date;
  /** Re-resolve entities for every document (default: only new or changed documents). */
  full?: boolean;
  matterIds?: string[];
  userIds?: string[];
  kinds?: IntelInsightKind[];
  /** Queue model verification for created/updated insights when a key exists (default true; seeds pass false). */
  enqueueVerify?: boolean;
  audit?: boolean;
}

function within(doc: IntelDocument, from: string, to?: string): boolean {
  const d = dateOf(doc);
  return Boolean(d && d >= from && (!to || d <= to));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shift(now: Date, days: number): string {
  return isoDay(new Date(now.getTime() + days * 86400_000));
}

/** Run the deterministic analyses and compose insights for every matter, the firm and each watcher. */
export function runAnalysis(o: RunAnalysisOptions = {}): AnalysisRunResult {
  const started = Date.now();
  const now = o.now ?? new Date();
  const nowIso = now.toISOString();
  const notes: string[] = [];
  const kinds = new Set<IntelInsightKind>(o.kinds ?? ["trend", "cluster", "pattern", "chronology", "profile", "anomaly", "alert", "digest"]);
  const lastRun = db().kv.get<AnalysisRunResult>(LAST_RUN_KEY);

  const entities = rebuildEntities({ since: o.full ? undefined : lastRun?.at, now: nowIso });
  const relations = buildRelations({ now: nowIso });

  const counts = { created: 0, updated: 0, unchanged: 0 };
  const touched: string[] = [];
  const save = (i: IntelInsight) => { const r = saveInsight(i, { audit: o.audit }); counts[r.status]++; if (r.status !== "unchanged") touched.push(r.insight.id); };
  const d = db();
  const matters = (o.matterIds?.length ? o.matterIds.map((id) => d.matters.get(id)) : d.matters.all()).filter((m): m is NonNullable<typeof m> => Boolean(m));
  let chronologies = 0;
  const day30 = shift(now, -30), day90 = shift(now, -90), day180 = shift(now, -180);

  for (const matter of matters) {
    const docs = intelDocuments().find((x) => x.matterIds.includes(matter.id));
    if (!docs.length) continue;
    const mdlId = docs.find((x) => x.mdlId)?.mdlId;
    const scope = { matterId: matter.id, entityIds: mdlId ? [mdlId] : [] };

    if (kinds.has("chronology")) {
      const chron = buildChronology({ matterId: matter.id, includeEdiscovery: true });
      if (chron.entries.length) {
        const intelEntries = chron.entries.filter((e) => e.evidence.some((ev) => !ev.docId.startsWith("tl_")));
        const latest = chron.entries[chron.entries.length - 1];
        const confidence = intelEntries.length ? intelEntries.reduce((n, e) => n + e.confidence, 0) / intelEntries.length : 0.6;
        save(composeInsight({ kind: "chronology", scope, key: "matter-chronology", title: `Chronology: ${matter.shortName}`, summary: `${chron.entries.length} dated events from ${chron.sources.intel} intelligence records and ${chron.sources.ediscovery} e-discovery timeline entries (${fmtDate(chron.entries[0].at)} – ${fmtDate(latest.at)}); ${chron.merged} duplicates merged. Latest: ${latest.title} (${fmtDate(latest.at)}).`, data: { timeline: chron.entries.slice(-40), total: chron.entries.length, range: { from: chron.entries[0].at, to: latest.at }, sources: chron.sources }, evidence: intelEntries.slice(-MAX_EVIDENCE).flatMap((e) => e.evidence.filter((ev) => !ev.docId.startsWith("tl_"))), confidence, now: nowIso }));
        chronologies++;
      }
    }

    if (kinds.has("trend") || kinds.has("anomaly")) {
      const from = addMonths(monthKey(nowIso)!, -23);
      const t = buildTrends({ groupBy: "kind", matterId: matter.id, kinds: ["docket_entry", "opinion", "register_notice", "recall", "news", "regulation"], from, top: 6 });
      if (t.sample) {
        const recent = docs.filter((x) => within(x, day90)).length;
        const prior = docs.filter((x) => within(x, day180, day90)).length;
        const lead = t.totals[0];
        const change = prior ? ` (${recent >= prior ? "+" : ""}${Math.round(((recent - prior) / prior) * 100)}% vs the prior 90 days)` : "";
        const evidence = docs.filter((x) => within(x, day180)).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? "")).slice(0, 12).map((x) => evidenceForDoc(x));
        if (kinds.has("trend")) save(composeInsight({ kind: "trend", scope, key: "matter-activity", title: `Activity in ${matter.shortName}: ${recent} records in 90 days`, summary: `${recent} dated records in the last 90 days${change}; ${t.sample} in the last two years. Most frequent kind: ${lead ? `${lead.label} (${lead.count})` : "n/a"}.`, data: { series: t.series, months: t.months, totals: t.totals, recent, prior }, evidence: evidence.length ? evidence : docs.slice(0, 6).map((x) => evidenceForDoc(x)), confidence: Math.min(0.92, 0.5 + 0.08 * Math.min(6, t.sample)), now: nowIso }));
        if (kinds.has("anomaly")) for (const a of t.anomalies.slice(0, 3)) {
          const month = a.anomaly.t;
          const monthDocs = docs.filter((x) => monthKey(dateOf(x)) === month && (a.series === "all" || x.kind === a.series)).slice(0, 10);
          save(composeInsight({ kind: "anomaly", scope, key: `anomaly-${a.series}-${month}`, title: `${a.anomaly.direction === "up" ? "Spike" : "Drop"} in ${a.series.replace(/_/g, " ")} activity, ${monthLabel(month)} (${matter.shortName})`, summary: `${a.anomaly.v} ${a.series.replace(/_/g, " ")} records in ${monthLabel(month)} against a rolling mean of ${a.anomaly.mean} (z = ${a.anomaly.z}).`, data: { series: t.series.filter((s) => s.label === a.series), anomaly: a.anomaly }, evidence: monthDocs.map((x) => evidenceForDoc(x)), confidence: Math.min(0.85, 0.45 + 0.1 * monthDocs.length), now: nowIso }));
        }
      }
    }

    if (kinds.has("profile")) {
      const judgeCounts = new Map<string, number>();
      for (const x of docs) for (const j of x.judgeIds) judgeCounts.set(j, (judgeCounts.get(j) ?? 0) + 1);
      const judgeId = Array.from(judgeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      const judge = judgeId ? intelEntities().get(judgeId) : null;
      if (judge) {
        const jdocs = entityDocuments(judge.id);
        const p = profileSummary(judge, jdocs);
        const decided = p.tendencies.filter((t) => t.grantRate != null);
        const lines = decided.slice(0, 4).map((t) => `${t.label.toLowerCase()}: ${t.granted} granted, ${t.denied} denied${t.partial ? `, ${t.partial} in part` : ""}`);
        const evidence = p.tendencies.flatMap((t) => t.evidence).slice(0, 16).map((e) => { const doc = intelDocuments().get(e.docId); return doc ? evidenceForDoc(doc) : null; }).filter((x): x is IntelEvidence => Boolean(x));
        save(composeInsight({ kind: "profile", scope: { ...scope, entityIds: Array.from(new Set([...scope.entityIds, judge.id])) }, key: `judge-${judge.id}`, title: `${judge.name}: ${p.counts.documents} records, ${decided.length} motion types with outcomes`, summary: lines.length ? `Orders and opinions on record before ${judge.name} (${matter.shortName}): ${lines.join("; ")}.` : `${p.counts.documents} records on ${judge.name}; no motion outcomes are derivable from the record yet.`, data: { profile: p, entityId: judge.id }, evidence: evidence.length ? evidence : jdocs.slice(0, 6).map((x) => evidenceForDoc(x)), confidence: decided.length ? Math.min(0.9, 0.55 + 0.05 * decided.reduce((n, t) => n + t.total, 0)) : 0.6, now: nowIso }));
      }
    }

    if (kinds.has("alert")) {
      const recent = docs.filter((x) => (x.kind === "docket_entry" || x.kind === "register_notice" || x.kind === "recall" || x.kind === "news" || x.kind === "opinion") && within(x, day30)).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? ""));
      if (recent.length) save(composeInsight({ kind: "alert", scope, key: "recent-activity", title: `${recent.length} new record${recent.length === 1 ? "" : "s"} in ${matter.shortName} in the last 30 days`, summary: recent.slice(0, 3).map((x) => `${fmtDate(dateOf(x))}: ${clip(x.title, 90)}`).join(" · "), data: { table: recent.slice(0, 20).map((x) => ({ id: x.id, date: dateOf(x), kind: x.kind, title: x.title, url: x.url, href: documentHref(x.id) })) }, evidence: recent.slice(0, 12).map((x) => evidenceForDoc(x)), confidence: 0.9, now: nowIso }));
      const flagged = docs.filter((x) => x.flags.some((f) => f.kind === "contradicted" || f.kind === "needs_review" || f.kind === "broken_link"));
      if (flagged.length) save(composeInsight({ kind: "alert", scope, key: "flagged-records", title: `${flagged.length} flagged record${flagged.length === 1 ? "" : "s"} in ${matter.shortName} need attention`, summary: flagged.slice(0, 3).map((x) => `${clip(x.title, 70)} (${x.flags.map((f) => f.kind).join(", ")})`).join(" · "), data: { table: flagged.slice(0, 20).map((x) => ({ id: x.id, title: x.title, flags: x.flags, href: documentHref(x.id) })) }, evidence: flagged.slice(0, 12).map((x) => evidenceForDoc(x)), confidence: 0.95, now: nowIso }));
    }
  }

  // Firm-wide patterns, trends and topic clusters.
  const firm = { entityIds: [] as string[] };
  if (kinds.has("trend")) {
    const t = buildTrends({ groupBy: "court", from: addMonths(monthKey(nowIso)!, -35), top: 6 });
    if (t.sample >= 3) {
      const evidence = intelDocuments().find((x) => (x.kind === "opinion" || x.kind === "docket_entry") && within(x, shift(now, -3 * 365))).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? "")).slice(0, 12).map((x) => evidenceForDoc(x));
      save(composeInsight({ kind: "trend", scope: firm, key: "filings-by-court", title: `Filings and rulings by court: ${t.totals[0]?.label ? `${clip(t.totals[0].label, 50)} leads` : `${t.sample} records`}`, summary: `${t.sample} opinions, docket entries and rules over three years across ${t.totals.length} courts. ${t.totals.slice(0, 3).map((x) => `${clip(x.label, 46)}: ${x.count}`).join("; ")}.`, data: { series: t.series, months: t.months, totals: t.totals }, evidence, confidence: Math.min(0.9, 0.5 + 0.05 * t.sample), now: nowIso }));
    }
  }
  if (kinds.has("pattern")) {
    const rulings = intelDocuments().find((x) => x.kind === "docket_entry" || x.kind === "opinion");
    for (const row of motionOutcomes(rulings).filter((r) => r.total >= 3).slice(0, 6)) {
      const byJudge = new Map<string, { name: string; granted: number; denied: number; partial: number; total: number }>();
      for (const { doc, outcome } of row.docs) for (const j of doc.judgeIds) {
        const e = byJudge.get(j) ?? { name: intelEntities().get(j)?.name ?? j, granted: 0, denied: 0, partial: 0, total: 0 };
        e.total++;
        if (outcome === "granted" || outcome === "affirmed") e.granted++; else if (outcome === "denied" || outcome === "reversed") e.denied++; else if (outcome === "partial") e.partial++;
        byJudge.set(j, e);
      }
      const decided = row.granted + row.denied + row.partial;
      const rate = decided ? Math.round(((row.granted + row.partial * 0.5) / decided) * 100) : null;
      const judges = Array.from(byJudge.entries());
      save(composeInsight({ kind: "pattern", scope: { entityIds: judges.map(([id]) => id) }, key: `motion-${row.motion}`, title: `${MOTION_LABEL[row.motion]}: ${row.total} rulings${rate != null ? `, ${rate}% granted` : ""}`, summary: `${row.total} ${MOTION_LABEL[row.motion].toLowerCase()} rulings on record (${row.granted} granted, ${row.denied} denied, ${row.partial} in part, ${row.other} without a stated outcome) across ${judges.length} judge${judges.length === 1 ? "" : "s"}${judges.length ? `: ${judges.slice(0, 3).map(([, j]) => `${j.name} ${j.granted}/${j.total} granted`).join("; ")}` : ""}.`, data: { table: judges.map(([id, j]) => ({ entityId: id, ...j })), motion: row.motion, totals: { granted: row.granted, denied: row.denied, partial: row.partial, other: row.other, total: row.total } }, evidence: row.docs.slice(0, 16).map(({ doc }) => evidenceForDoc(doc)), confidence: Math.min(0.9, 0.5 + 0.06 * row.total), now: nowIso }));
    }
  }
  if (kinds.has("cluster")) {
    try {
      const c = clusterScope({ kinds: ["opinion", "docket_entry", "regulation", "register_notice", "recall", "news", "statute", "court_rule"], maxChunks: 400, chunksPerDoc: 2 });
      if (c.chunks >= 8 && c.clusters.length >= 2) {
        const top = c.clusters.slice(0, 5);
        save(composeInsight({ kind: "cluster", scope: firm, key: "corpus-topics", title: `${c.clusters.length} topics across ${c.documents} records: ${top.slice(0, 2).map((x) => x.label).join("; ")}`, summary: `${c.method === "embeddings" ? "Embedding" : "TF-IDF"} clusters over ${c.chunks} passages from ${c.documents} records. ${top.map((x) => `${x.label} (${Math.round(x.share * 100)}%)`).join("; ")}.`, data: { clusters: c.clusters.map(({ chunkIds: _c, ...rest }) => { void _c; return rest; }), method: c.method, k: c.k, chunks: c.chunks, documents: c.documents }, evidence: top.flatMap((x) => x.topDocs.slice(0, 3)).map((t) => { const doc = intelDocuments().get(t.docId); return doc ? evidenceForDoc(doc, t.excerpt) : null; }).filter((x): x is IntelEvidence => Boolean(x)), confidence: c.method === "embeddings" ? 0.75 : 0.65, now: nowIso }));
      }
    } catch (e) { notes.push(`Clustering skipped: ${(e as Error).message}`); }
  }

  // Watch alerts and digests per user.
  const users = new Set<string>([currentUser().id, ...(o.userIds ?? []), ...intelWatches().all().map((w) => w.userId)]);
  for (const userId of users) {
    if (kinds.has("alert")) for (const w of listWatches({ userId })) {
      const docs = (w.kind === "query" ? listDocuments({ q: w.target, dateFrom: day30, limit: 50 }).items : entityDocuments(w.target)).filter((x) => within(x, day30)).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? ""));
      if (!docs.length) continue;
      save(composeInsight({ kind: "alert", scope: { userId, matterId: w.matterId, entityIds: w.kind === "query" ? [] : [w.target] }, key: `watch-${w.id}`, title: `${w.label}: ${docs.length} new record${docs.length === 1 ? "" : "s"} in 30 days`, summary: docs.slice(0, 3).map((x) => `${fmtDate(dateOf(x))}: ${clip(x.title, 90)}`).join(" · "), data: { table: docs.slice(0, 20).map((x) => ({ id: x.id, date: dateOf(x), kind: x.kind, title: x.title, href: documentHref(x.id) })), watchId: w.id }, evidence: docs.slice(0, 12).map((x) => evidenceForDoc(x)), confidence: 0.9, now: nowIso }));
      intelWatches().update(w.id, (x) => ({ ...x, lastNotifiedAt: nowIso }));
    }
    if (kinds.has("digest")) {
      const mine = d.matters.find((m) => m.status === "active" && (m.teamIds.includes(userId) || m.leadAttorneyId === userId));
      const recent = intelDocuments().find((x) => x.matterIds.some((m) => mine.some((mm) => mm.id === m)) && within(x, shift(now, -7)));
      const perMatter = mine.map((m) => ({ id: m.id, shortName: m.shortName, records: recent.filter((x) => x.matterIds.includes(m.id)).length, keyDates: (m.keyDates ?? []).filter((k) => k.date >= isoDay(now) && k.date <= shift(now, 14)) })).filter((m) => m.records || m.keyDates.length);
      if (!recent.length && !perMatter.some((m) => m.keyDates.length)) continue;
      const evidence = recent.sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? "")).slice(0, 12).map((x) => evidenceForDoc(x));
      save(composeInsight({ kind: "digest", scope: { userId, entityIds: [] }, key: "weekly-digest", title: `This week: ${recent.length} new record${recent.length === 1 ? "" : "s"} across ${perMatter.filter((m) => m.records).length} matter${perMatter.filter((m) => m.records).length === 1 ? "" : "s"}`, summary: perMatter.map((m) => `${m.shortName}: ${m.records} record${m.records === 1 ? "" : "s"}${m.keyDates.length ? `, ${m.keyDates.map((k) => `${k.label} ${fmtDate(k.date)}`).join(", ")}` : ""}`).join(" · ") || "No new records this week.", data: { table: perMatter, week: { from: shift(now, -7), to: isoDay(now) } }, evidence: evidence.length ? evidence : intelDocuments().find((x) => x.matterIds.some((m) => mine.some((mm) => mm.id === m))).slice(0, 4).map((x) => evidenceForDoc(x)), confidence: 0.8, now: nowIso }));
    }
  }

  if (o.enqueueVerify !== false && touched.length && aiConfig().hasKey) {
    try { enqueueJob({ kind: "insight.verify", payload: { insightIds: touched.slice(0, 25) }, priority: 6, dedupeKey: "insight.verify:analysis", maxAttempts: 2 }, now); notes.push(`Queued verification for ${Math.min(25, touched.length)} insight(s).`); } catch (e) { notes.push(`Could not queue verification: ${(e as Error).message}`); }
  }
  const result: AnalysisRunResult = { at: nowIso, durationMs: Date.now() - started, entities: { docs: entities.docs, linked: entities.linked, created: entities.created }, relations, insights: { ...counts, total: intelInsights().count() }, chronologies, notes };
  db().kv.set(LAST_RUN_KEY, result);
  return result;
}

export function lastAnalysisRun(): AnalysisRunResult | null {
  return db().kv.get<AnalysisRunResult>(LAST_RUN_KEY);
}

export function analysisStatus(): AnalysisStatus {
  const last = lastAnalysisRun() ?? undefined;
  const insights = intelInsights().all();
  const count = (s: IntelInsight["status"]) => insights.filter((i) => i.status === s).length;
  return {
    lastRun: last,
    entities: intelEntities().count(),
    relations: intelRelations().count(),
    insights: { total: insights.length, published: count("published") + count("verified"), flagged: count("flagged"), draft: count("draft"), dismissed: count("dismissed") },
    watches: intelWatches().count(),
    documents: intelDocuments().count(),
    pending: last ? intelDocuments().count((d) => d.updatedAt > last.at) : intelDocuments().count(),
  };
}
