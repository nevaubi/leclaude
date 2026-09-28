import "server-only";
import { db } from "@/lib/db";
import type { Matter } from "@/lib/types/domain";
import { excerpt } from "@/lib/net/redact";
import { intelConfig, type IntelEnvConfig } from "../config";
import { listJobs, type DurableIntelJob } from "../jobs";
import { entityIdsOf, intelDocuments, intelInsights, intelRelations, intelSources } from "../store";
import type { IntelDocument, IntelSource } from "../types";
import type { ConfiguredSearch, CoverageJob, CoverageResponse, CoverageSource, CoverageSourceState, MatterCoverage } from "../components/coverage-models";

/**
 * Read-only, per-matter view of what the intelligence layer is doing: which sources serve each matter and in
 * what state, what they search for, and what came back (records, entities, relations, insights), plus the live
 * and recently failed jobs. Everything is counted from the store; nothing is generated.
 *
 * Authorization: the caller passes the matter ids the principal may read (MatterScope.matterIds). Only those
 * matters are described, and jobs are listed only when their source serves one of those matters or is not
 * matter-scoped at all. An empty list returns an empty view; it never widens to all matters.
 */

/** Adapters that iterate the active matters when a source names none (see run.ts `ctx.matters`). */
const MATTER_AWARE: ReadonlySet<string> = new Set(["courtlistener-dockets", "courtlistener-judges", "jpml-mdls", "local-corpus", "news"]);

const FAILURE_WINDOW_MS = 24 * 3600_000;
const RECENT_WINDOW_MS = 7 * 86400_000;

export interface MatterCoverageOptions {
  now?: Date;
  /** The principal sees only part of the firm's matters (shown as a note in the UI). */
  restricted?: boolean;
  /** Test hook: environment config (provider keys). */
  config?: IntelEnvConfig;
}

/** Missing provider key for a source, by adapter and by the error its last run recorded. */
export function sourceNeedsKey(source: Pick<IntelSource, "adapter" | "health">, cfg: Pick<IntelEnvConfig, "tavilyKey" | "firecrawlKey">): string | undefined {
  if (source.adapter === "news" && !cfg.tavilyKey && !cfg.firecrawlKey) return "TAVILY_API_KEY or FIRECRAWL_API_KEY";
  const m = /\b([A-Z][A-Z0-9_]*_(?:API_KEY|API_TOKEN|TOKEN|KEY))\b/.exec(source.health.lastError ?? "");
  if (m && /not configured|needs|missing|requires/i.test(source.health.lastError ?? "")) return m[1];
  return undefined;
}

export function sourceState(source: IntelSource, jobs: Pick<DurableIntelJob, "status" | "sourceId">[], needsKey: string | undefined): CoverageSourceState {
  const mine = jobs.filter((j) => j.sourceId === source.id);
  if (source.status === "running" || mine.some((j) => j.status === "running")) return "running";
  if (mine.some((j) => j.status === "queued")) return "queued";
  if (needsKey) return "needs_key";
  if (!source.enabled) return "disabled";
  if (source.status === "error" || !source.health.ok) return "failed";
  return "idle";
}

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** The searches a source runs, read from its config and scope (keys the built-in adapters use). */
export function configuredSearches(source: Pick<IntelSource, "config" | "scope">): ConfiguredSearch[] {
  const c = source.config ?? {};
  const out: ConfiguredSearch[] = [];
  const add = (kind: ConfiguredSearch["kind"], list: string[]) => { for (const text of list) if (!out.some((x) => x.kind === kind && x.text === text)) out.push({ kind, text }); };
  add("query", [...strings(c.queries), ...strings(c.query), ...strings(c.terms), ...strings(source.scope?.queries)]);
  add("docket", [...strings(c.docketNumbers), ...strings(c.docketIds)]);
  add("mdl", [...strings(c.mdlNumbers), ...strings(c.watch)]);
  add("judge", strings(c.names));
  add("cfr", (Array.isArray(c.sections) ? c.sections : []).flatMap((x) => {
    const o = (x ?? {}) as { title?: unknown; section?: unknown; part?: unknown };
    if (typeof o.title !== "number") return [];
    return typeof o.section === "string" ? [`${o.title} CFR ${o.section}`] : typeof o.part === "string" ? [`${o.title} CFR Part ${o.part}`] : [];
  }));
  add("court", [...strings(c.courts).flatMap((s) => s.split(/\s+/)).filter(Boolean), ...strings(source.scope?.courts)]);
  add("product", [...strings(c.products), ...strings(c.firms), ...strings(c.labels)]);
  const docketSet = new Set(strings(c.docketNumbers));
  add("target", [...strings(c.urls), ...strings(source.scope?.targets).filter((t) => !docketSet.has(t))]);
  return out.slice(0, 40);
}

function maxIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Which matters a source serves: its named matters, or every active matter for matter-aware adapters. */
function servedMatters(source: IntelSource, activeIds: string[]): { ids: string[]; linked: CoverageSource["linked"] } {
  const named = source.scope?.matterIds ?? [];
  if (named.length) return { ids: named, linked: "matter" };
  if (MATTER_AWARE.has(source.adapter)) return { ids: activeIds, linked: "all_active" };
  return { ids: [], linked: "all_active" };
}

function toCoverageJob(j: DurableIntelJob, sources: Map<string, IntelSource>, docs: IntelDocument[], matterIds: string[], cfg: IntelEnvConfig): CoverageJob {
  const src = j.sourceId ? sources.get(j.sourceId) : undefined;
  const lastLine = [...j.log].reverse().find((l) => l.level !== "debug");
  const since = j.startedAt ?? j.createdAt;
  const recordsSoFar = j.sourceId && (j.status === "running" || j.status === "queued" || j.startedAt)
    ? docs.filter((d) => d.sourceId === j.sourceId && d.fetchedAt >= since && (!j.finishedAt || d.fetchedAt <= j.finishedAt)).length
    : 0;
  const message = j.lastError?.message ?? j.error?.message;
  const needsKey = src && (j.status === "failed" || j.status === "escalated") ? sourceNeedsKey({ adapter: src.adapter, health: { ...src.health, lastError: message ?? src.health.lastError } }, cfg) : undefined;
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    sourceId: j.sourceId,
    sourceName: src?.name,
    adapter: src?.adapter,
    phase: lastLine ? excerpt(lastLine.msg, 140) : undefined,
    recordsSoFar,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    updatedAt: j.updatedAt,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    errorCode: j.lastError?.code ?? j.error?.code,
    error: message ? excerpt(message, 200) : undefined,
    needsKey,
    matterIds,
    log: j.log.filter((l) => l.level !== "debug").slice(-6).map((l) => ({ at: l.at, level: l.level, msg: excerpt(l.msg, 160) })),
  };
}

export function matterCoverage(allowedMatterIds: readonly string[], o: MatterCoverageOptions = {}): CoverageResponse {
  const now = o.now ?? new Date();
  const cfg = o.config ?? intelConfig();
  const allowed = new Set(allowedMatterIds);
  const d = db();
  const matters: Matter[] = d.matters.all().filter((m) => allowed.has(m.id)).sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || a.name.localeCompare(b.name));
  const activeIds = d.matters.find((m) => m.status === "active").map((m) => m.id);
  const sources = intelSources().all();
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const served = new Map(sources.map((s) => [s.id, servedMatters(s, activeIds)]));

  const liveJobs = listJobs({ status: ["queued", "running"], kind: "source.run", limit: 200 }).items;
  const sinceIso = new Date(now.getTime() - FAILURE_WINDOW_MS).toISOString();
  const recentRuns = listJobs({ kind: "source.run", since: sinceIso, limit: 500 }).items;
  // A failure stays visible only while it is the latest run of its source (a later success clears it).
  const latestBySource = new Map<string, DurableIntelJob>();
  for (const j of recentRuns) if (j.sourceId && !latestBySource.has(j.sourceId)) latestBySource.set(j.sourceId, j);
  const failures = Array.from(latestBySource.values()).filter((j) => j.status === "failed" || j.status === "escalated");

  const visibleMatters = (sourceId: string | undefined): string[] | null => {
    if (!sourceId) return null;
    const s = served.get(sourceId);
    if (!s) return null;
    const named = sourceById.get(sourceId)?.scope?.matterIds ?? [];
    const inScope = s.ids.filter((id) => allowed.has(id));
    // A source scoped only to matters the caller cannot read stays invisible; unscoped sources are firm-wide.
    if (named.length && !inScope.length) return null;
    return inScope;
  };

  const docs = intelDocuments().all();
  const jobs: CoverageJob[] = [];
  for (const j of [...liveJobs, ...failures]) {
    const ids = visibleMatters(j.sourceId);
    if (ids == null) continue;
    if (jobs.some((x) => x.id === j.id)) continue;
    jobs.push(toCoverageJob(j, sourceById, docs, ids, cfg));
  }
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Per-matter documents in one pass.
  const docsByMatter = new Map<string, IntelDocument[]>();
  for (const doc of docs) for (const m of doc.matterIds ?? []) if (allowed.has(m)) docsByMatter.set(m, [...(docsByMatter.get(m) ?? []), doc]);
  const relations = intelRelations().all();
  const insights = intelInsights().all();
  const recentCutoff = new Date(now.getTime() - RECENT_WINDOW_MS).toISOString();
  const liveForState = liveJobs.map((j) => ({ status: j.status, sourceId: j.sourceId }));

  const out: MatterCoverage[] = matters.map((m) => {
    const mdocs = docsByMatter.get(m.id) ?? [];
    const docIds = new Set(mdocs.map((x) => x.id));
    const entityIds = new Set<string>();
    for (const doc of mdocs) for (const e of entityIdsOf(doc)) entityIds.add(e);
    const relationCount = relations.filter((r) => r.evidence.some((e) => docIds.has(e.docId))).length;
    const mInsights = insights.filter((i) => i.scope.matterId === m.id && i.status !== "dismissed");
    const perSource = new Map<string, number>();
    for (const doc of mdocs) perSource.set(doc.sourceId, (perSource.get(doc.sourceId) ?? 0) + 1);

    const mSources: CoverageSource[] = [];
    for (const s of sources) {
      const sv = served.get(s.id)!;
      const serves = sv.ids.includes(m.id);
      if (!serves && !perSource.has(s.id)) continue;
      const needsKey = sourceNeedsKey(s, cfg);
      mSources.push({
        id: s.id,
        name: s.name,
        adapter: s.adapter,
        enabled: s.enabled,
        state: sourceState(s, liveForState, needsKey),
        linked: serves ? sv.linked : "records",
        sharedWith: sv.ids.filter((id) => allowed.has(id)).length,
        lastRunAt: s.lastRunAt,
        nextRunAt: s.enabled ? s.nextRunAt : undefined,
        lastError: s.health.lastError ? excerpt(s.health.lastError, 200) : undefined,
        needsKey,
        records: perSource.get(s.id) ?? 0,
        searches: configuredSearches(s),
      });
    }
    const rank: Record<CoverageSourceState, number> = { running: 0, queued: 1, failed: 2, needs_key: 3, idle: 4, disabled: 5 };
    mSources.sort((a, b) => rank[a.state] - rank[b.state] || b.records - a.records || a.name.localeCompare(b.name));

    let lastRunAt: string | undefined;
    for (const s of mSources) lastRunAt = maxIso(lastRunAt, s.lastRunAt);
    let lastRecordAt: string | undefined;
    for (const doc of mdocs) lastRecordAt = maxIso(lastRecordAt, doc.fetchedAt);
    return {
      matterId: m.id,
      name: m.name,
      shortName: m.shortName,
      status: m.status,
      court: m.court,
      judge: m.judge,
      sources: mSources,
      records: mdocs.length,
      recentRecords: mdocs.filter((x) => x.fetchedAt >= recentCutoff).length,
      entities: entityIds.size,
      relations: relationCount,
      insights: { total: mInsights.length, published: mInsights.filter((i) => i.status === "published" || i.status === "verified").length, flagged: mInsights.filter((i) => i.status === "flagged").length },
      lastRunAt,
      lastRecordAt,
      activeJobs: jobs.filter((j) => (j.status === "running" || j.status === "queued") && j.matterIds.includes(m.id)).length,
      failedJobs: jobs.filter((j) => (j.status === "failed" || j.status === "escalated") && j.matterIds.includes(m.id)).length,
    };
  });

  // Totals cover the sources visible to the caller (serving an allowed matter, or firm-wide).
  const visibleSources = sources.filter((s) => visibleMatters(s.id) != null);
  const needsKeyCount = visibleSources.filter((s) => sourceNeedsKey(s, cfg)).length;
  return {
    generatedAt: now.toISOString(),
    matters: out,
    jobs,
    totals: {
      matters: out.length,
      sources: visibleSources.length,
      enabledSources: visibleSources.filter((s) => s.enabled).length,
      running: jobs.filter((j) => j.status === "running").length,
      queued: jobs.filter((j) => j.status === "queued").length,
      failed: jobs.filter((j) => j.status === "failed" || j.status === "escalated").length,
      needsKey: needsKeyCount,
    },
    keys: { news: Boolean(cfg.tavilyKey || cfg.firecrawlKey), courtListener: Boolean(cfg.courtListenerToken) },
    restricted: Boolean(o.restricted),
  };
}
