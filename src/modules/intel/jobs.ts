import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { getAdapter } from "./adapters";
import { intelConfig } from "./config";
import type { IntelProviders } from "./providers";
import { runFailed, runSource } from "./run";
import { backoffMs, computeNextRunAt, isSourceDue } from "./schedule";
import { indexIntelDocument, intelDocuments, intelJobs, intelSources, reindexMissingEmbeddings } from "./store";
import type { AdapterError, IntelHealth, IntelJob, IntelJobKind, IntelJobLogLine, IntelJobStatus, IntelRunDueResult, IntelSource } from "./types";

/**
 * Durable job queue in `intel_jobs` and the runner that drives it. Jobs are
 * claimed with a heartbeat, retried with exponential backoff, reaped when a
 * worker dies, and handed to the steward when they fail for good.
 */
export interface EnqueueInput {
  kind: IntelJobKind;
  sourceId?: string;
  payload?: Record<string, unknown>;
  /** 1 (highest) – 9. Default 5. */
  priority?: number;
  maxAttempts?: number;
  /** While a job with this key is queued or running, enqueue returns it instead of adding another. */
  dedupeKey?: string;
  runAfter?: string;
}

const MAX_LOG = 200;
const ACTIVE: IntelJobStatus[] = ["queued", "running"];

export function enqueueJob(input: EnqueueInput, now = new Date()): IntelJob {
  const col = intelJobs();
  if (input.dedupeKey) {
    const existing = col.findOne((j) => j.dedupeKey === input.dedupeKey && ACTIVE.includes(j.status));
    if (existing) return existing;
  }
  const ts = now.toISOString();
  const job: IntelJob = {
    id: `ijob_${nanoid(12)}`,
    kind: input.kind,
    sourceId: input.sourceId,
    payload: input.payload ?? {},
    status: "queued",
    priority: Math.max(1, Math.min(9, input.priority ?? 5)),
    attempts: 0,
    maxAttempts: Math.max(1, input.maxAttempts ?? 3),
    log: [{ at: ts, level: "info" as const, msg: `Queued (${input.kind})` }],
    runAfter: input.runAfter,
    fixes: [],
    dedupeKey: input.dedupeKey,
    createdAt: ts,
    updatedAt: ts,
  };
  col.put(job);
  return job;
}

export function getJob(id: string): IntelJob | null {
  return intelJobs().get(id);
}

export interface ListJobsOptions { status?: IntelJobStatus[]; kind?: IntelJobKind; sourceId?: string; since?: string; limit?: number; offset?: number; escalatedOnly?: boolean }

export function listJobs(o: ListJobsOptions = {}): { items: IntelJob[]; total: number } {
  const all = intelJobs().find((j) => (!o.status?.length || o.status.includes(j.status)) && (!o.kind || j.kind === o.kind) && (!o.sourceId || j.sourceId === o.sourceId) && (!o.since || j.createdAt >= o.since) && (!o.escalatedOnly || Boolean(j.escalation)))
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0));
  const offset = o.offset ?? 0;
  return { items: all.slice(offset, offset + (o.limit ?? 50)), total: all.length };
}

function patch(id: string, fn: (j: IntelJob) => IntelJob): IntelJob | null {
  return intelJobs().update(id, (j) => ({ ...fn(j), updatedAt: new Date().toISOString() }));
}

export function appendLog(id: string, line: IntelJobLogLine): void {
  patch(id, (j) => ({ ...j, log: [...j.log, line].slice(-MAX_LOG) }));
}

/** Move a queued job to running (attempts++). Returns null when it is not claimable. */
export function claimJob(id: string, workerId: string, now = new Date()): IntelJob | null {
  const job = intelJobs().get(id);
  if (!job || job.status !== "queued") return null;
  if (job.runAfter && new Date(job.runAfter).getTime() > now.getTime()) return null;
  const ts = now.toISOString();
  return patch(id, (j) => ({ ...j, status: "running", attempts: j.attempts + 1, startedAt: ts, heartbeatAt: ts, workerId, finishedAt: undefined, error: undefined, log: [...j.log, { at: ts, level: "info" as const, msg: `Started attempt ${j.attempts + 1}/${j.maxAttempts} on ${workerId}` }].slice(-MAX_LOG) }));
}

export function jobFamily(job: IntelJob): string {
  if (job.kind === "source.run" && job.sourceId) {
    const src = intelSources().get(job.sourceId);
    return src ? getAdapter(src.adapter)?.family ?? src.adapter : "source";
  }
  return job.kind;
}

/** Highest-priority claimable job whose provider family is not already running. */
export function claimNext(o: { now?: Date; workerId: string; busyFamilies?: Set<string>; kinds?: IntelJobKind[] }): IntelJob | null {
  const now = o.now ?? new Date();
  const candidates = intelJobs().find((j) => j.status === "queued" && (!j.runAfter || new Date(j.runAfter).getTime() <= now.getTime()) && (!o.kinds?.length || o.kinds.includes(j.kind)))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  for (const c of candidates) {
    if (o.busyFamilies?.has(jobFamily(c))) continue;
    const claimed = claimJob(c.id, o.workerId, now);
    if (claimed) return claimed;
  }
  return null;
}

export function heartbeat(id: string, now = new Date()): void {
  patch(id, (j) => ({ ...j, heartbeatAt: now.toISOString() }));
}

export function completeJob(id: string, result: Record<string, unknown> | undefined, now = new Date()): IntelJob | null {
  const ts = now.toISOString();
  return patch(id, (j) => ({ ...j, status: "succeeded", finishedAt: ts, result, error: undefined, log: [...j.log, { at: ts, level: "info" as const, msg: "Succeeded" }].slice(-MAX_LOG) }));
}

/** Fail a job: re-queued with backoff while attempts remain and the error is retryable; otherwise failed for good. */
export function failJob(id: string, error: { code: IntelJob["error"] extends infer E ? (E extends { code: infer C } ? C : never) : never; message: string }, o: { retryable?: boolean; now?: Date; backoffMs?: number } = {}): IntelJob | null {
  const now = o.now ?? new Date();
  const ts = now.toISOString();
  return patch(id, (j) => {
    const retry = (o.retryable ?? true) && j.attempts < j.maxAttempts;
    const delay = retry ? o.backoffMs ?? backoffMs(j.attempts) : 0;
    const runAfter = retry ? new Date(now.getTime() + delay).toISOString() : undefined;
    return { ...j, status: retry ? "queued" : "failed", finishedAt: retry ? undefined : ts, runAfter, error: { code: error.code, message: error.message.slice(0, 1000) }, log: [...j.log, { at: ts, level: "error" as const, msg: retry ? `Failed (${error.code}); retry ${j.attempts + 1}/${j.maxAttempts} in ${Math.round(delay / 1000)}s` : `Failed (${error.code}): ${error.message.slice(0, 300)}`, data: { code: error.code, retryable: o.retryable ?? true } }].slice(-MAX_LOG) };
  });
}

export function cancelJob(id: string, now = new Date()): IntelJob | null {
  const job = intelJobs().get(id);
  if (!job || !ACTIVE.includes(job.status)) return job;
  const ts = now.toISOString();
  return patch(id, (j) => ({ ...j, status: "cancelled", finishedAt: ts, log: [...j.log, { at: ts, level: "warn" as const, msg: "Cancelled" }].slice(-MAX_LOG) }));
}

/** Put a failed/escalated/cancelled job back in the queue with fresh attempts. */
export function retryJob(id: string, o: { by?: IntelJob["fixes"][number]["by"]; note?: string; now?: Date } = {}): IntelJob | null {
  const job = intelJobs().get(id);
  if (!job || ACTIVE.includes(job.status)) return job;
  const ts = (o.now ?? new Date()).toISOString();
  return patch(id, (j) => ({ ...j, status: "queued", runAfter: undefined, finishedAt: undefined, error: undefined, maxAttempts: Math.max(j.maxAttempts, j.attempts + 2), escalation: undefined, fixes: [...j.fixes, { at: ts, action: "retry", by: o.by ?? "human", note: o.note ?? "Re-queued" }], log: [...j.log, { at: ts, level: "info" as const, msg: `Re-queued by ${o.by ?? "human"}${o.note ? `: ${o.note}` : ""}` }].slice(-MAX_LOG) }));
}

/** Running jobs whose heartbeat is older than `orphanAfterMs` are failed (retryable) so they get picked up again. */
export function reapOrphans(now = new Date(), orphanAfterMs = intelConfig().orphanAfterMs): IntelJob[] {
  const out: IntelJob[] = [];
  for (const j of intelJobs().find((j) => j.status === "running")) {
    const beat = new Date(j.heartbeatAt ?? j.startedAt ?? j.updatedAt).getTime();
    if (now.getTime() - beat > orphanAfterMs) {
      const r = failJob(j.id, { code: "timeout", message: `No heartbeat for ${Math.round((now.getTime() - beat) / 1000)}s; the worker was interrupted` }, { retryable: true, now, backoffMs: 5_000 });
      if (r) out.push(r);
      if (j.sourceId) intelSources().update(j.sourceId, (s) => (s.status === "running" ? { ...s, status: s.enabled ? "idle" : "disabled", updatedAt: now.toISOString() } : s));
    }
  }
  return out;
}

/** Enqueue a source.run for every enabled scheduled source that is due. */
export function scheduleDueSources(now = new Date()): IntelJob[] {
  const out: IntelJob[] = [];
  for (const s of intelSources().all()) {
    if (!isSourceDue(s, now)) continue;
    out.push(enqueueJob({ kind: "source.run", sourceId: s.id, payload: { trigger: "schedule" }, priority: 6, dedupeKey: `source.run:${s.id}` }, now));
  }
  return out;
}

export function jobCounts(now = new Date()): IntelHealth["jobs"] {
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const jobs = intelJobs().all();
  return {
    queued: jobs.filter((j) => j.status === "queued").length,
    running: jobs.filter((j) => j.status === "running").length,
    failed24h: jobs.filter((j) => (j.status === "failed" || j.status === "escalated") && (j.finishedAt ?? j.updatedAt) >= dayAgo).length,
    fixed24h: jobs.filter((j) => j.fixes.some((f) => f.at >= dayAgo && f.by !== "human")).length,
    escalated: jobs.filter((j) => j.status === "escalated").length,
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type JobHandler = (job: IntelJob, ctx: { providers?: IntelProviders; signal?: AbortSignal; log: (line: IntelJobLogLine) => void; now: Date }) => Promise<Record<string, unknown> | void>;

type G = typeof globalThis & { __leclaudeIntelJobHandlers?: Map<string, JobHandler>; __leclaudeIntelRunnerBusy?: boolean };

/** Register a handler for a job kind (the analysis layer registers doc.extract, entities.resolve, analysis.run…). */
export function registerJobHandler(kind: IntelJobKind, handler: JobHandler) {
  const g = globalThis as G;
  if (!g.__leclaudeIntelJobHandlers) g.__leclaudeIntelJobHandlers = new Map();
  g.__leclaudeIntelJobHandlers.set(kind, handler);
}

export function getJobHandler(kind: IntelJobKind): JobHandler | undefined {
  return (globalThis as G).__leclaudeIntelJobHandlers?.get(kind);
}

export interface ExecuteOptions { providers?: IntelProviders; signal?: AbortSignal; now?: Date; review?: boolean }

function sourceStatsAfterRun(source: IntelSource, added: number, durationMs: number | undefined): IntelSource["stats"] {
  const docs = intelDocuments().find((d) => d.sourceId === source.id);
  return { ...source.stats, documents: docs.length, chunks: docs.reduce((n, d) => n + d.chunkCount, 0), lastAdded: added, lastDurationMs: durationMs };
}

async function runSourceJob(job: IntelJob, o: ExecuteOptions, now: Date, log: (line: IntelJobLogLine) => void): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: AdapterError }> {
  const source = job.sourceId ? intelSources().get(job.sourceId) : null;
  if (!source) return { ok: false, error: { code: "unknown", message: `Source ${job.sourceId ?? "?"} no longer exists`, retryable: false, fatal: true } };
  if (!source.enabled && !job.payload.force) { log({ at: now.toISOString(), level: "warn" as const, msg: "Source is disabled; nothing to do" }); return { ok: true, result: { skipped: true, reason: "disabled" } }; }
  intelSources().update(source.id, (s) => ({ ...s, status: "running", updatedAt: now.toISOString() }));
  const beat = setInterval(() => { try { heartbeat(job.id); } catch { /* ignore */ } }, 20_000);
  (beat as { unref?: () => void }).unref?.();
  let result;
  try {
    result = await runSource(source, { providers: o.providers, signal: o.signal, log, now, since: typeof job.payload.since === "string" ? job.payload.since : undefined, maxDocs: typeof job.payload.maxDocs === "number" ? job.payload.maxDocs : undefined, chunkSize: typeof job.payload.chunkSize === "number" ? job.payload.chunkSize : undefined, configOverride: (job.payload.configOverride as Record<string, unknown> | undefined) ?? undefined });
  } finally { clearInterval(beat); }
  const finished = new Date();
  const verdict = runFailed(result);
  const next = computeNextRunAt(source.schedule, finished);
  const notConfigured = !verdict.failed && result.errors.length > 0 && result.errors.every((e) => e.code === "not_configured");
  intelSources().update(source.id, (s) => ({
    ...s,
    status: verdict.failed ? "error" : s.enabled ? "idle" : "disabled",
    lastRunAt: finished.toISOString(),
    nextRunAt: next?.toISOString(),
    cursor: result.nextCursor ?? s.cursor,
    stats: sourceStatsAfterRun(s, result.added, result.durationMs),
    health: verdict.failed
      ? { ok: false, lastError: verdict.error?.message.slice(0, 500), consecutiveFailures: s.health.consecutiveFailures + 1, lastSuccessAt: s.health.lastSuccessAt }
      : { ok: true, lastError: notConfigured ? result.errors[0].message.slice(0, 500) : undefined, consecutiveFailures: 0, lastSuccessAt: finished.toISOString() },
    updatedAt: finished.toISOString(),
  }));
  const summary = { added: result.added, updated: result.updated, skipped: result.skipped, errors: result.errors.slice(0, 20), notes: result.notes, chunks: result.chunks, durationMs: result.durationMs, docIds: result.docIds?.slice(0, 200) };
  if (verdict.failed) return { ok: false, error: verdict.error ?? { code: "unknown", message: "Run failed", retryable: false } };
  return { ok: true, result: summary };
}

/** Execute one claimed job to completion (success, retry or final failure + steward review). */
export async function executeJob(job: IntelJob, o: ExecuteOptions = {}): Promise<IntelJob> {
  const now = o.now ?? new Date();
  const log = (line: IntelJobLogLine) => appendLog(job.id, line);
  let outcome: { ok: true; result?: Record<string, unknown> | void } | { ok: false; error: AdapterError };
  try {
    switch (job.kind) {
      case "source.run":
        outcome = await runSourceJob(job, o, now, log);
        break;
      case "doc.index": {
        const docIds = Array.isArray(job.payload.docIds) ? (job.payload.docIds as string[]) : [];
        const chunkSize = typeof job.payload.chunkSize === "number" ? job.payload.chunkSize : undefined;
        if (docIds.length) {
          let chunks = 0, embedded = 0;
          for (const id of docIds) { const doc = intelDocuments().get(id); if (!doc) continue; const r = await indexIntelDocument(doc, undefined, { size: chunkSize, embed: job.payload.embed === false ? false : undefined }); chunks += r.chunks; embedded += r.embedded; }
          outcome = { ok: true, result: { docs: docIds.length, chunks, embedded } };
        } else {
          const r = await reindexMissingEmbeddings(typeof job.payload.limit === "number" ? job.payload.limit : 25, { chunkSize });
          outcome = { ok: true, result: r };
        }
        break;
      }
      case "sweep": {
        const { sweep } = await import("./steward");
        outcome = { ok: true, result: (await sweep({ providers: o.providers, signal: o.signal, now, log })) as unknown as Record<string, unknown> };
        break;
      }
      case "insight.verify": {
        const { verifyInsights } = await import("./steward");
        outcome = { ok: true, result: await verifyInsights({ limit: typeof job.payload.limit === "number" ? job.payload.limit : 5, insightIds: Array.isArray(job.payload.insightIds) ? (job.payload.insightIds as string[]) : undefined, signal: o.signal, log }) };
        break;
      }
      case "workflow.tick": {
        const { tick } = await import("@/modules/workflows/scheduler");
        outcome = { ok: true, result: await tick(now) };
        break;
      }
      case "scan.run": {
        const { runScans } = await import("@/lib/integrity/bootstrap");
        const report = runScans("scheduled", Array.isArray(job.payload.only) ? (job.payload.only as string[]) : undefined);
        outcome = { ok: true, result: { reportId: report.id, totals: report.totals } };
        break;
      }
      default: {
        const handler = getJobHandler(job.kind);
        if (!handler) outcome = { ok: false, error: { code: "unknown", message: `No handler registered for job kind "${job.kind}"`, retryable: false, fatal: true } };
        else outcome = { ok: true, result: await handler(job, { providers: o.providers, signal: o.signal, log, now }) };
      }
    }
  } catch (e) {
    const { errorFrom } = await import("./adapters/types");
    outcome = { ok: false, error: errorFrom(e, { fatal: true }) };
  }
  if (outcome.ok) return completeJob(job.id, (outcome.result as Record<string, unknown> | undefined) ?? undefined) ?? job;
  const failed = failJob(job.id, { code: outcome.error.code, message: outcome.error.message }, { retryable: outcome.error.retryable && outcome.error.code !== "cancelled" ? true : outcome.error.code === "cancelled" });
  if (failed?.status === "failed" && o.review !== false) {
    try {
      const { reviewJob } = await import("./steward");
      return (await reviewJob(failed.id, { providers: o.providers, now })) ?? failed;
    } catch (e) {
      appendLog(failed.id, { at: new Date().toISOString(), level: "error" as const, msg: `Steward review failed: ${(e as Error).message}` });
    }
  }
  return failed ?? job;
}

export interface RunDueOptions {
  limit?: number;
  deadlineMs?: number;
  now?: Date;
  providers?: IntelProviders;
  concurrency?: number;
  /**
   * Also enqueue housekeeping by cadence. `true` enqueues everything (the cron tick); the inline loop passes
   * `{ sweep: true, reembed: true }` because the workflow scheduler and the scan timer run on their own timers there.
   */
  housekeeping?: boolean | HousekeepingOptions;
  workerId?: string;
  kinds?: IntelJobKind[];
}

export interface HousekeepingOptions { sweep?: boolean; reembed?: boolean; workflow?: boolean; scans?: boolean }

export const HOUSEKEEPING_EVERY_MS = { sweep: 6 * 3600_000, reembed: 3600_000, workflow: 60_000, scans: 6 * 3600_000 } as const;

/** Enqueue the housekeeping jobs whose cadence has elapsed (kv-timestamped so restarts and multiple drivers do not double up). */
export function dueHousekeeping(now: Date, which: HousekeepingOptions): IntelJob[] {
  const kv = db().kv;
  const out: IntelJob[] = [];
  const ts = now.toISOString();
  const due = (key: string, every: number) => { const last = kv.get<string>(key); return !last || now.getTime() - new Date(last).getTime() >= every; };
  // The cadence timestamp advances only when a job is actually created; a dedupe onto a still-queued job leaves it alone.
  const add = (key: string, input: EnqueueInput) => { const j = enqueueJob(input, now); out.push(j); if (j.createdAt === ts) kv.set(key, ts); };
  if (which.sweep && due("intel:hk:sweep", HOUSEKEEPING_EVERY_MS.sweep)) add("intel:hk:sweep", { kind: "sweep", priority: 7, dedupeKey: "sweep", maxAttempts: 1 });
  if (which.workflow && due("intel:hk:workflow", HOUSEKEEPING_EVERY_MS.workflow)) add("intel:hk:workflow", { kind: "workflow.tick", priority: 3, dedupeKey: "workflow.tick", maxAttempts: 1 });
  if (which.scans && due("intel:hk:scans", HOUSEKEEPING_EVERY_MS.scans)) add("intel:hk:scans", { kind: "scan.run", priority: 8, dedupeKey: "scan.run", maxAttempts: 1 });
  if (which.reembed && process.env.OPENAI_API_KEY?.trim() && due("intel:hk:reembed", HOUSEKEEPING_EVERY_MS.reembed)) add("intel:hk:reembed", { kind: "doc.index", priority: 8, dedupeKey: "doc.index:reembed", payload: { limit: 25 }, maxAttempts: 1 });
  return out;
}

/** Reap orphans, enqueue due sources, then run claimable jobs with bounded concurrency until the limit or deadline. */
export async function runDue(o: RunDueOptions = {}): Promise<IntelRunDueResult> {
  const g = globalThis as G;
  const started = Date.now();
  const res: IntelRunDueResult = { enqueued: 0, ran: 0, succeeded: 0, failed: 0, fixed: 0, escalated: 0, reaped: 0, durationMs: 0, jobIds: [] };
  if (g.__leclaudeIntelRunnerBusy) return res;
  g.__leclaudeIntelRunnerBusy = true;
  try {
    const cfg = intelConfig();
    const now = o.now ?? new Date();
    const workerId = o.workerId ?? `w_${process.pid}_${nanoid(4)}`;
    const deadline = started + (o.deadlineMs ?? 25_000);
    const limit = o.limit ?? 10;
    const concurrency = Math.max(1, o.concurrency ?? cfg.concurrency);
    res.reaped = reapOrphans(now, cfg.orphanAfterMs).length;
    const hk: HousekeepingOptions | null = o.housekeeping === true ? { sweep: true, reembed: true, workflow: true, scans: true } : o.housekeeping && typeof o.housekeeping === "object" ? o.housekeeping : null;
    res.enqueued = scheduleDueSources(now).length + (hk ? dueHousekeeping(now, hk).length : 0);
    const ctrl = new AbortController();
    const abortTimer = setTimeout(() => ctrl.abort(), Math.max(1000, deadline - Date.now() + 15_000));
    (abortTimer as { unref?: () => void }).unref?.();
    const active = new Map<string, Promise<void>>();
    const busy = new Set<string>();
    try {
      while (res.ran < limit && Date.now() < deadline) {
        while (active.size < concurrency && res.ran < limit) {
          const job = claimNext({ now: new Date(), workerId, busyFamilies: busy, kinds: o.kinds });
          if (!job) break;
          res.ran++;
          res.jobIds.push(job.id);
          const family = jobFamily(job);
          busy.add(family);
          const p = executeJob(job, { providers: o.providers, signal: ctrl.signal, now: new Date() })
            .then((done) => { if (done.status === "succeeded") res.succeeded++; else if (done.status === "escalated") res.escalated++; else if (done.status === "fixed") res.fixed++; else if (done.status === "failed" || done.status === "cancelled") res.failed++; })
            .catch(() => { res.failed++; })
            .finally(() => { active.delete(job.id); busy.delete(family); });
          active.set(job.id, p);
        }
        if (!active.size) break;
        await Promise.race(active.values());
      }
      await Promise.all(active.values());
    } finally { clearTimeout(abortTimer); }
  } finally {
    g.__leclaudeIntelRunnerBusy = false;
  }
  res.durationMs = Date.now() - started;
  return res;
}

/** Enqueue a high-priority run for one source. With `wait`, executes it inline and returns the finished job. */
export async function runSourceNow(sourceId: string, o: { wait?: boolean; providers?: IntelProviders; force?: boolean; maxDocs?: number; now?: Date } = {}): Promise<IntelJob> {
  const source = intelSources().get(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  const job = enqueueJob({ kind: "source.run", sourceId, payload: { trigger: "manual", force: o.force ?? true, maxDocs: o.maxDocs }, priority: 1, dedupeKey: `source.run:${sourceId}` }, o.now);
  if (!o.wait) return job;
  if (job.status === "running") return job;
  const claimed = claimJob(job.id, `inline_${process.pid}`, o.now);
  if (!claimed) return job;
  return executeJob(claimed, { providers: o.providers, now: o.now });
}
