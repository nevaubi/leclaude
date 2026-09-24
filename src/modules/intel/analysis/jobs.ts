import "server-only";
import { enqueueJob, registerJobHandler } from "../jobs";
import { intelConfig } from "../config";
import { intelDocuments } from "../store";
import type { IntelInsightKind } from "../types";
import { rebuildEntities } from "./entities";
import { buildRelations } from "./graph";
import { lastAnalysisRun, runAnalysis } from "./insights";

/**
 * Job handlers the analysis layer registers with the intel runner:
 * `doc.extract` / `entities.resolve` (entity resolution + relations for a set
 * of documents) and `analysis.run` (the full deterministic analysis pass that
 * composes insights). Registration is idempotent per process.
 */
type G = typeof globalThis & { __leclaudeIntelAnalysisJobs?: boolean };

export function registerAnalysisJobHandlers(): void {
  const g = globalThis as G;
  if (g.__leclaudeIntelAnalysisJobs) return;
  g.__leclaudeIntelAnalysisJobs = true;
  const resolve = async (job: { payload: Record<string, unknown> }, ctx: { log: (l: { at: string; level: "info"; msg: string; data?: Record<string, unknown> }) => void; now: Date }) => {
    const docIds = Array.isArray(job.payload.docIds) ? (job.payload.docIds as string[]) : undefined;
    const since = typeof job.payload.since === "string" ? job.payload.since : undefined;
    const ents = rebuildEntities({ docIds, since, now: ctx.now.toISOString(), limit: typeof job.payload.limit === "number" ? job.payload.limit : undefined });
    const rels = buildRelations({ docIds, now: ctx.now.toISOString() });
    ctx.log({ at: new Date().toISOString(), level: "info", msg: `Resolved entities for ${ents.docs} document(s): ${ents.linked} links, ${ents.created} new entities; ${rels.created} new relations`, data: { ...ents, relations: rels } });
    return { entities: ents, relations: rels };
  };
  registerJobHandler("entities.resolve", resolve);
  registerJobHandler("doc.extract", resolve);
  registerJobHandler("analysis.run", async (job, ctx) => {
    const kinds = Array.isArray(job.payload.kinds) ? (job.payload.kinds as IntelInsightKind[]) : undefined;
    const matterIds = Array.isArray(job.payload.matterIds) ? (job.payload.matterIds as string[]) : undefined;
    const r = runAnalysis({ now: ctx.now, full: job.payload.full === true, kinds, matterIds, audit: true });
    ctx.log({ at: new Date().toISOString(), level: "info", msg: `Analysis: ${r.insights.created} new, ${r.insights.updated} updated, ${r.insights.unchanged} unchanged insight(s); ${r.entities.docs} documents resolved`, data: { ...r, notes: undefined } });
    return r as unknown as Record<string, unknown>;
  });
}

const MIN_GAP_MS = 5 * 60_000;

/** Queue an analysis run when documents changed since the last run (inline background only; deduped). */
export function scheduleAnalysisIfStale(now = new Date()): { queued: boolean; reason: string } {
  if (intelConfig().background === "off") return { queued: false, reason: "background off" };
  const last = lastAnalysisRun();
  if (last && now.getTime() - new Date(last.at).getTime() < MIN_GAP_MS) return { queued: false, reason: "ran recently" };
  const pending = last ? intelDocuments().count((d) => d.updatedAt > last.at) : intelDocuments().count();
  if (!pending) return { queued: false, reason: "nothing changed" };
  enqueueJob({ kind: "analysis.run", payload: { trigger: "stale", pending }, priority: 7, dedupeKey: "analysis.run", maxAttempts: 2 }, now);
  return { queued: true, reason: `${pending} document(s) changed` };
}
