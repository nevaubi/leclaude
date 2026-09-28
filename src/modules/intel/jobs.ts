import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { excerpt, redactSecrets, sanitizeForLog } from "@/lib/net/redact";
import { getAdapter } from "./adapters";
import { intelConfig } from "./config";
import type { IntelProviders } from "./providers";
import { runFailed, runSource } from "./run";
import { backoffMs, computeNextRunAt, isSourceDue, periodicJobs, registerPeriodicJob, type PeriodicJobSpec } from "./schedule";
import { indexIntelDocument, intelDocuments, intelSources, reindexMissingEmbeddings } from "./store";
import { INTEL_COLLECTIONS, type AdapterError, type IntelErrorCode, type IntelHealth, type IntelJob, type IntelJobKind, type IntelJobLogLine, type IntelJobStatus, type IntelRunDueResult, type IntelSource, type StewardAction } from "./types";

/**
 * Durable job queue in `intel_jobs` and the runner that drives it
 * (CLAUDE.md §39 durable async work, §42 observability, §47 failure model).
 *
 * Contract:
 * - a job is claimed with a **lease** (`leaseUntil`); the running worker
 *   heartbeats to extend it; a running job whose lease expired is reclaimable
 *   by any worker and is re-queued by the tick;
 * - an **idempotency key** makes re-enqueueing the same work a no-op while the
 *   earlier job is active or finished within its TTL (`dedupeKey` keeps the
 *   older, active-only semantics);
 * - failures **retry with backoff only when transient** (network, timeout,
 *   rate limit) and only while attempts remain; interruptions (process
 *   restart, runner deadline) give the attempt back, bounded;
 * - after the last attempt the job is **dead-lettered** (`deadLetter` record,
 *   status `failed`) and handed to the steward, whose decision is stored on the
 *   job; an escalation links the review record;
 * - **recovery on boot** re-queues jobs whose leases expired while the process
 *   was down (inline mode may force-recover every running job);
 * - one **tick** entrypoint drives everything: the production cron
 *   (vercel.json → /api/intel/jobs/tick) and the development loop
 *   (background.ts) both call `tick()`; periodic jobs (sweep, scans, workflow
 *   tick, embedding backfill) are registered specs enqueued by cadence, so no
 *   critical job depends on a setInterval;
 * - every job carries a trace id, per-attempt spans, durations and a redacted
 *   last error; `recentJobRuns()` is the compact, confidential-text-free view
 *   for the settings UI.
 */
export interface JobAttempt {
  attempt: number;
  workerId: string;
  /** Span id for this attempt: `<traceId>.<attempt>`. */
  spanId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome?: "succeeded" | "failed" | "retry" | "cancelled" | "reclaimed" | "interrupted";
  errorCode?: IntelErrorCode;
  /** Redacted, bounded. */
  error?: string;
}

export interface JobLastError { code: IntelErrorCode; message: string; at: string; attempt: number; retryable: boolean }

export interface JobDeadLetter {
  at: string;
  reason: string;
  attempts: number;
  /** Review/provenance record id once the steward escalated the job. */
  escalationId?: string;
}

export interface JobStewardDecision { action: StewardAction; by: "steward" | "model" | "human"; note: string; at: string }

/** Durable-execution fields stored on the job record beside the `IntelJob` contract in types.ts (additive, all optional). */
export interface DurableJobFields {
  /** Exclusive ownership expires at this time; a running job past it is reclaimable. */
  leaseUntil?: string;
  leaseMs?: number;
  /** Stable trace id shared by every attempt, the steward review and re-runs. */
  traceId?: string;
  idempotencyKey?: string;
  idempotencyExpiresAt?: string;
  attemptHistory?: JobAttempt[];
  lastError?: JobLastError;
  deadLetter?: JobDeadLetter;
  stewardDecision?: JobStewardDecision;
  /** Duration of the last finished attempt and the sum over attempts. */
  durationMs?: number;
  totalDurationMs?: number;
  /** Times the job was re-queued without consuming an attempt (restart, runner deadline). */
  interruptions?: number;
}

export type DurableIntelJob = IntelJob & DurableJobFields;

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
  /** Re-enqueueing the same key returns the existing job while it is active or finished within the TTL (cancelled jobs do not count). */
  idempotencyKey?: string;
  /** Default 24h. */
  idempotencyTtlMs?: number;
  /** Lease length for this job (default INTEL_JOB_LEASE_MS, else the orphan window). */
  leaseMs?: number;
  /** Correlate with an outer trace (workflow run, request). */
  traceId?: string;
}

const MAX_LOG = 200;
const MAX_ATTEMPT_HISTORY = 20;
const MAX_INTERRUPTIONS = 3;
const ACTIVE: IntelJobStatus[] = ["queued", "running"];
const TRANSIENT: IntelErrorCode[] = ["network", "timeout", "rate_limited"];
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 3600_000;
export const HEARTBEAT_EVERY_MS = 20_000;

const jobs = () => db().collection<DurableIntelJob>(INTEL_COLLECTIONS.jobs);

/** Lease length: INTEL_JOB_LEASE_MS (≥ 10 s), else the configured orphan window (5 min). Heartbeats every 20 s extend it. */
export function defaultLeaseMs(): number {
  const n = Number(process.env.INTEL_JOB_LEASE_MS);
  return Number.isFinite(n) && n >= 10_000 ? n : intelConfig().orphanAfterMs;
}

/** Only these codes are retried automatically; everything else fails on the first attempt. */
export function isTransientError(code: IntelErrorCode | string | undefined): boolean {
  return TRANSIENT.includes(code as IntelErrorCode);
}

function newTraceId(): string { return `itr_${nanoid(10)}`; }

function sanitizeLine(line: IntelJobLogLine): IntelJobLogLine {
  return { at: line.at, level: line.level, msg: excerpt(line.msg, 600), data: line.data ? (sanitizeForLog(line.data) as Record<string, unknown>) : undefined };
}

function sanitizeAdapterError(e: AdapterError): AdapterError {
  return { ...e, message: excerpt(e.message, 500), data: e.data ? (sanitizeForLog(e.data) as Record<string, unknown>) : undefined };
}

function patch(id: string, fn: (j: DurableIntelJob) => DurableIntelJob): DurableIntelJob | null {
  return jobs().update(id, (j) => ({ ...fn(j), updatedAt: new Date().toISOString() }));
}

/** Close the open attempt in the history (duration, outcome, bounded error). */
function finishAttempt(j: DurableIntelJob, ts: string, outcome: NonNullable<JobAttempt["outcome"]>, err?: { code: IntelErrorCode; message: string }): Pick<DurableJobFields, "attemptHistory" | "durationMs" | "totalDurationMs"> {
  const history = [...(j.attemptHistory ?? [])];
  const last = history[history.length - 1];
  const startedAt = last?.startedAt ?? j.startedAt ?? ts;
  const durationMs = Math.max(0, Date.parse(ts) - Date.parse(startedAt));
  if (last && !last.finishedAt) history[history.length - 1] = { ...last, finishedAt: ts, durationMs, outcome, errorCode: err?.code, error: err ? excerpt(err.message, 300) : undefined };
  return { attemptHistory: history.slice(-MAX_ATTEMPT_HISTORY), durationMs, totalDurationMs: (j.totalDurationMs ?? 0) + durationMs };
}

// ---------------------------------------------------------------------------
// Queue primitives
// ---------------------------------------------------------------------------

/** The job an idempotency key currently maps to: active, or finished (not cancelled) within its TTL. */
export function findIdempotent(key: string, now = new Date()): DurableIntelJob | null {
  const t = now.getTime();
  return jobs().findOne((j) => j.idempotencyKey === key && j.status !== "cancelled" && (ACTIVE.includes(j.status) || (j.idempotencyExpiresAt ? new Date(j.idempotencyExpiresAt).getTime() > t : false)));
}

export function enqueueJob(input: EnqueueInput, now = new Date()): DurableIntelJob {
  const col = jobs();
  if (input.dedupeKey) {
    const existing = col.findOne((j) => j.dedupeKey === input.dedupeKey && ACTIVE.includes(j.status));
    if (existing) return existing;
  }
  if (input.idempotencyKey) {
    const existing = findIdempotent(input.idempotencyKey, now);
    if (existing) return existing;
  }
  const ts = now.toISOString();
  const traceId = input.traceId ?? newTraceId();
  const job: DurableIntelJob = {
    id: `ijob_${nanoid(12)}`,
    kind: input.kind,
    sourceId: input.sourceId,
    payload: input.payload ?? {},
    status: "queued",
    priority: Math.max(1, Math.min(9, input.priority ?? 5)),
    attempts: 0,
    maxAttempts: Math.max(1, input.maxAttempts ?? 3),
    log: [{ at: ts, level: "info" as const, msg: `Queued (${input.kind})`, data: { traceId } }],
    runAfter: input.runAfter,
    fixes: [],
    dedupeKey: input.dedupeKey,
    createdAt: ts,
    updatedAt: ts,
    traceId,
    leaseMs: input.leaseMs,
    idempotencyKey: input.idempotencyKey,
    idempotencyExpiresAt: input.idempotencyKey ? new Date(now.getTime() + (input.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS)).toISOString() : undefined,
    attemptHistory: [],
  };
  col.put(job);
  return job;
}

export function getJob(id: string): DurableIntelJob | null {
  return jobs().get(id);
}

export interface ListJobsOptions { status?: IntelJobStatus[]; kind?: IntelJobKind; sourceId?: string; since?: string; limit?: number; offset?: number; escalatedOnly?: boolean; deadLetterOnly?: boolean }

export function listJobs(o: ListJobsOptions = {}): { items: DurableIntelJob[]; total: number } {
  const all = jobs().find((j) => (!o.status?.length || o.status.includes(j.status)) && (!o.kind || j.kind === o.kind) && (!o.sourceId || j.sourceId === o.sourceId) && (!o.since || j.createdAt >= o.since) && (!o.escalatedOnly || Boolean(j.escalation)) && (!o.deadLetterOnly || Boolean(j.deadLetter)))
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0));
  const offset = o.offset ?? 0;
  return { items: all.slice(offset, offset + (o.limit ?? 50)), total: all.length };
}

/** Append a log line (message and data are bounded and redacted before they are stored). */
export function appendLog(id: string, line: IntelJobLogLine): void {
  const clean = sanitizeLine(line);
  patch(id, (j) => ({ ...j, log: [...j.log, clean].slice(-MAX_LOG) }));
}

/** True when a running job's lease has lapsed (legacy rows without a lease fall back to the heartbeat age). */
export function leaseExpired(job: Pick<DurableIntelJob, "status" | "leaseUntil" | "heartbeatAt" | "startedAt" | "updatedAt">, now = new Date(), orphanAfterMs = intelConfig().orphanAfterMs): boolean {
  if (job.status !== "running") return false;
  if (job.leaseUntil) return new Date(job.leaseUntil).getTime() <= now.getTime();
  const beat = new Date(job.heartbeatAt ?? job.startedAt ?? job.updatedAt).getTime();
  return now.getTime() - beat > orphanAfterMs;
}

/**
 * Claim a job: a queued job whose runAfter has passed, or a running job whose
 * lease expired (reclaim). Takes a lease, bumps attempts, opens an attempt
 * span. Returns null when the job is not claimable.
 */
export function claimJob(id: string, workerId: string, now = new Date(), o: { leaseMs?: number } = {}): DurableIntelJob | null {
  const job = jobs().get(id);
  if (!job) return null;
  const reclaim = job.status === "running" && leaseExpired(job, now);
  if (job.status !== "queued" && !reclaim) return null;
  if (!reclaim && job.runAfter && new Date(job.runAfter).getTime() > now.getTime()) return null;
  const ts = now.toISOString();
  const leaseMs = o.leaseMs ?? job.leaseMs ?? defaultLeaseMs();
  return patch(id, (j) => {
    const attempt = j.attempts + 1;
    const traceId = j.traceId ?? newTraceId();
    const spanId = `${traceId}.${attempt}`;
    const history = [...(j.attemptHistory ?? [])];
    const last = history[history.length - 1];
    if (reclaim && last && !last.finishedAt) history[history.length - 1] = { ...last, finishedAt: ts, durationMs: Math.max(0, Date.parse(ts) - Date.parse(last.startedAt)), outcome: "reclaimed", error: `Lease expired on ${last.workerId}` };
    history.push({ attempt, workerId, spanId, startedAt: ts });
    const line: IntelJobLogLine = reclaim
      ? { at: ts, level: "warn", msg: `Reclaimed from ${j.workerId ?? "an unknown worker"} after its lease expired; attempt ${attempt}/${j.maxAttempts} on ${workerId}`, data: { traceId, spanId } }
      : { at: ts, level: "info", msg: `Started attempt ${attempt}/${j.maxAttempts} on ${workerId}`, data: { traceId, spanId } };
    return { ...j, status: "running", attempts: attempt, startedAt: ts, heartbeatAt: ts, leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), leaseMs, workerId, traceId, finishedAt: undefined, error: undefined, attemptHistory: history.slice(-MAX_ATTEMPT_HISTORY), log: [...j.log, line].slice(-MAX_LOG) };
  });
}

export function jobFamily(job: IntelJob): string {
  if (job.kind === "source.run" && job.sourceId) {
    const src = intelSources().get(job.sourceId);
    return src ? getAdapter(src.adapter)?.family ?? src.adapter : "source";
  }
  return job.kind;
}

/** Highest-priority claimable job (queued and due, or running with an expired lease) whose provider family is not already running. */
export function claimNext(o: { now?: Date; workerId: string; busyFamilies?: Set<string>; kinds?: IntelJobKind[]; leaseMs?: number }): DurableIntelJob | null {
  const now = o.now ?? new Date();
  const candidates = jobs().find((j) => ((j.status === "queued" && (!j.runAfter || new Date(j.runAfter).getTime() <= now.getTime())) || leaseExpired(j, now)) && (!o.kinds?.length || o.kinds.includes(j.kind)))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  for (const c of candidates) {
    if (o.busyFamilies?.has(jobFamily(c))) continue;
    const claimed = claimJob(c.id, o.workerId, now, { leaseMs: o.leaseMs });
    if (claimed) return claimed;
  }
  return null;
}

/** Extend the lease of a running job. */
export function heartbeat(id: string, now = new Date(), o: { leaseMs?: number } = {}): DurableIntelJob | null {
  return patch(id, (j) => (j.status !== "running" ? j : { ...j, heartbeatAt: now.toISOString(), leaseUntil: new Date(now.getTime() + (o.leaseMs ?? j.leaseMs ?? defaultLeaseMs())).toISOString() }));
}

export function completeJob(id: string, result: Record<string, unknown> | undefined, now = new Date()): DurableIntelJob | null {
  const ts = now.toISOString();
  return patch(id, (j) => {
    if (j.status === "cancelled") return { ...j, ...finishAttempt(j, ts, "cancelled") }; // a cancelled job is never resurrected by a late completion
    const done = finishAttempt(j, ts, "succeeded");
    return { ...j, status: "succeeded", finishedAt: ts, result, error: undefined, leaseUntil: undefined, ...done, log: [...j.log, { at: ts, level: "info" as const, msg: "Succeeded", data: { durationMs: done.durationMs } }].slice(-MAX_LOG) };
  });
}

/**
 * Fail a job. Retryable failures (default: transient codes only) are re-queued
 * with backoff while attempts remain; otherwise the job is failed for good and
 * dead-lettered (the steward reviews it next).
 */
export function failJob(id: string, error: { code: IntelErrorCode; message: string }, o: { retryable?: boolean; now?: Date; backoffMs?: number } = {}): DurableIntelJob | null {
  const now = o.now ?? new Date();
  const ts = now.toISOString();
  const message = redactSecrets(error.message).slice(0, 1000);
  return patch(id, (j) => {
    if (j.status === "cancelled") return { ...j, ...finishAttempt(j, ts, "cancelled", { code: error.code, message }) };
    const retryable = o.retryable ?? isTransientError(error.code);
    const retry = retryable && j.attempts < j.maxAttempts;
    const delay = retry ? o.backoffMs ?? backoffMs(j.attempts) : 0;
    const runAfter = retry ? new Date(now.getTime() + delay).toISOString() : undefined;
    const lastError: JobLastError = { code: error.code, message: excerpt(message, 500), at: ts, attempt: j.attempts, retryable };
    const deadLetter: JobDeadLetter | undefined = retry ? j.deadLetter : { at: ts, reason: `${error.code}: ${excerpt(message, 200)}`, attempts: j.attempts, escalationId: j.deadLetter?.escalationId };
    const line: IntelJobLogLine = { at: ts, level: "error", msg: retry ? `Failed (${error.code}); retry ${j.attempts + 1}/${j.maxAttempts} in ${Math.round(delay / 1000)}s` : `Failed (${error.code}): ${message.slice(0, 300)}${!retryable ? " — not retryable" : j.attempts >= j.maxAttempts ? " — attempts exhausted; dead-lettered" : ""}`, data: { code: error.code, retryable } };
    return { ...j, status: retry ? "queued" : "failed", finishedAt: retry ? undefined : ts, runAfter, leaseUntil: undefined, error: { code: error.code, message }, lastError, deadLetter, ...finishAttempt(j, ts, retry ? "retry" : "failed", { code: error.code, message }), log: [...j.log, line].slice(-MAX_LOG) };
  });
}

/** Re-queue a running job without consuming its attempt (restart, runner deadline); beyond MAX_INTERRUPTIONS it fails as a timeout instead. */
export function requeueInterrupted(id: string, reason: string, now = new Date()): DurableIntelJob | null {
  const job = jobs().get(id);
  if (!job || job.status !== "running") return job;
  if ((job.interruptions ?? 0) >= MAX_INTERRUPTIONS) return failJob(id, { code: "timeout", message: `${reason} (interrupted ${job.interruptions} times; treated as a failure)` }, { retryable: true, now, backoffMs: 5_000 });
  const ts = now.toISOString();
  return patch(id, (j) => {
    const history = [...(j.attemptHistory ?? [])];
    const last = history[history.length - 1];
    if (last && !last.finishedAt) history[history.length - 1] = { ...last, finishedAt: ts, durationMs: Math.max(0, Date.parse(ts) - Date.parse(last.startedAt)), outcome: "interrupted", error: excerpt(reason, 300) };
    return { ...j, status: "queued", attempts: Math.max(0, j.attempts - 1), interruptions: (j.interruptions ?? 0) + 1, runAfter: new Date(now.getTime() + 5_000).toISOString(), leaseUntil: undefined, workerId: undefined, heartbeatAt: undefined, attemptHistory: history.slice(-MAX_ATTEMPT_HISTORY), log: [...j.log, { at: ts, level: "warn" as const, msg: `${excerpt(reason, 300)}; re-queued without consuming the attempt` }].slice(-MAX_LOG) };
  });
}

export function cancelJob(id: string, now = new Date()): DurableIntelJob | null {
  const job = jobs().get(id);
  if (!job || !ACTIVE.includes(job.status)) return job;
  const ts = now.toISOString();
  return patch(id, (j) => ({ ...j, status: "cancelled", finishedAt: ts, leaseUntil: undefined, ...(j.status === "running" ? finishAttempt(j, ts, "cancelled") : {}), log: [...j.log, { at: ts, level: "warn" as const, msg: "Cancelled" }].slice(-MAX_LOG) }));
}

/** Put a failed/escalated/cancelled job back in the queue with fresh attempts (clears the dead-letter record). */
export function retryJob(id: string, o: { by?: IntelJob["fixes"][number]["by"]; note?: string; now?: Date } = {}): DurableIntelJob | null {
  const job = jobs().get(id);
  if (!job || ACTIVE.includes(job.status)) return job;
  const ts = (o.now ?? new Date()).toISOString();
  return patch(id, (j) => ({ ...j, status: "queued", runAfter: undefined, finishedAt: undefined, error: undefined, leaseUntil: undefined, deadLetter: undefined, maxAttempts: Math.max(j.maxAttempts, j.attempts + 2), escalation: undefined, fixes: [...j.fixes, { at: ts, action: "retry", by: o.by ?? "human", note: o.note ?? "Re-queued" }], log: [...j.log, { at: ts, level: "info" as const, msg: `Re-queued by ${o.by ?? "human"}${o.note ? `: ${excerpt(o.note, 200)}` : ""}` }].slice(-MAX_LOG) }));
}

/** Record the steward's decision on the job (kept beside `fixes` for the run summary). */
export function recordStewardDecision(id: string, decision: { action: StewardAction; by: "steward" | "model" | "human"; note: string }, now = new Date()): DurableIntelJob | null {
  return patch(id, (j) => ({ ...j, stewardDecision: { action: decision.action, by: decision.by, note: excerpt(decision.note, 300), at: now.toISOString() } }));
}

/** Move a job to `escalated`, link the review record on the dead-letter entry and store the decision. */
export function markEscalated(id: string, o: { reason: string; reviewId?: string; now?: Date; by?: "steward" | "model" | "human" }): DurableIntelJob | null {
  const at = (o.now ?? new Date()).toISOString();
  const reason = excerpt(o.reason, 300);
  const by = o.by ?? "steward";
  return patch(id, (j) => ({
    ...j,
    status: "escalated",
    finishedAt: j.finishedAt ?? at,
    leaseUntil: undefined,
    escalation: { reason, reviewId: o.reviewId, at },
    deadLetter: { ...(j.deadLetter ?? { at, reason, attempts: j.attempts }), escalationId: o.reviewId ?? j.deadLetter?.escalationId },
    stewardDecision: { action: "escalate", by, note: reason, at },
    fixes: [...j.fixes, { at, action: "escalate", by, note: reason }],
    log: [...j.log, { at, level: "warn" as const, msg: `Escalated to review: ${reason}` }].slice(-MAX_LOG),
  }));
}

function resetSourceStatus(sourceId: string | undefined, now: Date) {
  if (!sourceId) return;
  intelSources().update(sourceId, (s) => (s.status === "running" ? { ...s, status: s.enabled ? "idle" : "disabled", updatedAt: now.toISOString() } : s));
}

/** Running jobs whose lease expired are failed (retryable, short backoff) so they get picked up again. */
export function reapOrphans(now = new Date(), orphanAfterMs = intelConfig().orphanAfterMs): DurableIntelJob[] {
  const out: DurableIntelJob[] = [];
  for (const j of jobs().find((j) => j.status === "running")) {
    if (!leaseExpired(j, now, orphanAfterMs)) continue;
    const beat = new Date(j.heartbeatAt ?? j.startedAt ?? j.updatedAt).getTime();
    const r = failJob(j.id, { code: "timeout", message: `Lease expired (no heartbeat for ${Math.round((now.getTime() - beat) / 1000)}s); the worker was interrupted` }, { retryable: true, now, backoffMs: 5_000 });
    if (r) out.push(r);
    resetSourceStatus(j.sourceId, now);
  }
  return out;
}

/**
 * Boot recovery: re-queue work that was running when the process stopped.
 * Default: only jobs whose lease already expired (safe with several workers).
 * `force` re-queues every running job without consuming its attempt; use it
 * only where exactly one process runs jobs (the inline development loop).
 */
export function recoverInterruptedJobs(o: { now?: Date; force?: boolean } = {}): DurableIntelJob[] {
  const now = o.now ?? new Date();
  if (!o.force) return reapOrphans(now);
  const out: DurableIntelJob[] = [];
  for (const j of jobs().find((j) => j.status === "running")) {
    const r = requeueInterrupted(j.id, `Process restarted while attempt ${j.attempts} was running on ${j.workerId ?? "an unknown worker"}`, now);
    if (r) out.push(r);
    resetSourceStatus(j.sourceId, now);
  }
  return out;
}

/** Enqueue a source.run for every enabled scheduled source that is due. */
export function scheduleDueSources(now = new Date()): DurableIntelJob[] {
  const out: DurableIntelJob[] = [];
  for (const s of intelSources().all()) {
    if (!isSourceDue(s, now)) continue;
    out.push(enqueueJob({ kind: "source.run", sourceId: s.id, payload: { trigger: "schedule" }, priority: 6, dedupeKey: `source.run:${s.id}` }, now));
  }
  return out;
}

export function jobCounts(now = new Date()): IntelHealth["jobs"] {
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const all = jobs().all();
  return {
    queued: all.filter((j) => j.status === "queued").length,
    running: all.filter((j) => j.status === "running").length,
    failed24h: all.filter((j) => (j.status === "failed" || j.status === "escalated") && (j.finishedAt ?? j.updatedAt) >= dayAgo).length,
    fixed24h: all.filter((j) => j.fixes.some((f) => f.at >= dayAgo && f.by !== "human")).length,
    escalated: all.filter((j) => j.status === "escalated").length,
  };
}

/** Dead-lettered jobs (failed for good or escalated), newest first. */
export function listDeadLetters(limit = 50): DurableIntelJob[] {
  return listJobs({ deadLetterOnly: true, limit }).items.filter((j) => j.status === "failed" || j.status === "escalated");
}

// ---------------------------------------------------------------------------
// Observability view for the settings UI: no payloads, no logs, no result text.
// ---------------------------------------------------------------------------

export interface JobRunSummary {
  id: string;
  kind: IntelJobKind;
  sourceId?: string;
  sourceName?: string;
  status: IntelJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  interruptions: number;
  traceId?: string;
  workerId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  totalDurationMs?: number;
  leaseUntil?: string;
  runAfter?: string;
  errorCode?: IntelErrorCode;
  /** Redacted, ≤ 160 chars. */
  error?: string;
  steward?: { action: StewardAction; by: string; at: string };
  deadLetter?: { at: string; attempts: number; escalationId?: string };
  escalated: boolean;
}

export function summarizeJob(j: DurableIntelJob, sourceName?: string): JobRunSummary {
  return {
    id: j.id,
    kind: j.kind,
    sourceId: j.sourceId,
    sourceName,
    status: j.status,
    priority: j.priority,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    interruptions: j.interruptions ?? 0,
    traceId: j.traceId,
    workerId: j.workerId,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    durationMs: j.durationMs,
    totalDurationMs: j.totalDurationMs,
    leaseUntil: j.leaseUntil,
    runAfter: j.runAfter,
    errorCode: j.lastError?.code ?? j.error?.code,
    error: j.lastError ? excerpt(j.lastError.message, 160) : j.error ? excerpt(j.error.message, 160) : undefined,
    steward: j.stewardDecision ? { action: j.stewardDecision.action, by: j.stewardDecision.by, at: j.stewardDecision.at } : undefined,
    deadLetter: j.deadLetter ? { at: j.deadLetter.at, attempts: j.deadLetter.attempts, escalationId: j.deadLetter.escalationId } : undefined,
    escalated: j.status === "escalated" || Boolean(j.escalation),
  };
}

/** Recent job runs for the settings UI (most recently updated first). */
export function recentJobRuns(o: { limit?: number; since?: string; status?: IntelJobStatus[]; kind?: IntelJobKind } = {}): JobRunSummary[] {
  const names = new Map(intelSources().all().map((s) => [s.id, s.name]));
  return listJobs({ limit: o.limit ?? 20, since: o.since, status: o.status, kind: o.kind }).items.map((j) => summarizeJob(j, j.sourceId ? names.get(j.sourceId) : undefined));
}

// ---------------------------------------------------------------------------
// Periodic jobs
// ---------------------------------------------------------------------------

export const HOUSEKEEPING_EVERY_MS = { sweep: 6 * 3600_000, reembed: 3600_000, workflow: 60_000, scans: 6 * 3600_000 } as const;

const BUILTIN_PERIODIC: Record<keyof typeof HOUSEKEEPING_EVERY_MS, PeriodicJobSpec> = {
  sweep: { id: "sweep", kind: "sweep", everyMs: HOUSEKEEPING_EVERY_MS.sweep, priority: 7, maxAttempts: 1, dedupeKey: "sweep", description: "Steward sweep: insight re-verification, staleness, contradictions, broken links, orphaned entities" },
  workflow: { id: "workflow", kind: "workflow.tick", everyMs: HOUSEKEEPING_EVERY_MS.workflow, priority: 3, maxAttempts: 1, dedupeKey: "workflow.tick", description: "Workflow scheduler tick" },
  scans: { id: "scans", kind: "scan.run", everyMs: HOUSEKEEPING_EVERY_MS.scans, priority: 8, maxAttempts: 1, dedupeKey: "scan.run", description: "Integrity scans (src/lib/integrity/scans.ts)" },
  reembed: { id: "reembed", kind: "doc.index", everyMs: HOUSEKEEPING_EVERY_MS.reembed, priority: 8, maxAttempts: 1, dedupeKey: "doc.index:reembed", payload: { limit: 25 }, enabled: () => Boolean(process.env.OPENAI_API_KEY?.trim()), description: "Embedding backfill for chunks indexed without vectors" },
};
for (const spec of Object.values(BUILTIN_PERIODIC)) registerPeriodicJob(spec);

export interface HousekeepingOptions {
  sweep?: boolean;
  reembed?: boolean;
  workflow?: boolean;
  scans?: boolean;
  /** Periodic jobs registered by other modules (default false when selecting explicitly; `true` housekeeping includes them). */
  extra?: boolean;
}

/** Enqueue the periodic jobs whose cadence has elapsed (kv-timestamped so restarts and several drivers do not double up). */
export function dueHousekeeping(now: Date, which: HousekeepingOptions | true): DurableIntelJob[] {
  const kv = db().kv;
  const out: DurableIntelJob[] = [];
  const ts = now.toISOString();
  const wanted = (spec: PeriodicJobSpec) => (which === true ? true : spec.id in BUILTIN_PERIODIC ? Boolean(which[spec.id as keyof HousekeepingOptions]) : Boolean(which.extra));
  for (const spec of periodicJobs()) {
    if (!wanted(spec)) continue;
    if (spec.enabled && !spec.enabled()) continue;
    const key = `intel:hk:${spec.id}`;
    const last = kv.get<string>(key);
    if (last && now.getTime() - new Date(last).getTime() < spec.everyMs) continue;
    // The cadence timestamp advances only when a job is actually created; a dedupe onto a still-queued job leaves it alone.
    const j = enqueueJob({ kind: spec.kind, priority: spec.priority, dedupeKey: spec.dedupeKey ?? spec.kind, maxAttempts: spec.maxAttempts ?? 1, payload: spec.payload }, now);
    out.push(j);
    if (j.createdAt === ts) kv.set(key, ts);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type JobHandler = (job: IntelJob, ctx: { providers?: IntelProviders; signal?: AbortSignal; log: (line: IntelJobLogLine) => void; now: Date }) => Promise<Record<string, unknown> | void>;

type G = typeof globalThis & { __leclaudeIntelJobHandlers?: Map<string, JobHandler>; __leclaudeIntelRunnerBusy?: boolean; __leclaudeIntelBootRecovered?: boolean };

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
  const result = await runSource(source, { providers: o.providers, signal: o.signal, log, now, since: typeof job.payload.since === "string" ? job.payload.since : undefined, maxDocs: typeof job.payload.maxDocs === "number" ? job.payload.maxDocs : undefined, chunkSize: typeof job.payload.chunkSize === "number" ? job.payload.chunkSize : undefined, configOverride: (job.payload.configOverride as Record<string, unknown> | undefined) ?? undefined });
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
      ? { ok: false, lastError: excerpt(verdict.error?.message, 500) || undefined, consecutiveFailures: s.health.consecutiveFailures + 1, lastSuccessAt: s.health.lastSuccessAt }
      : { ok: true, lastError: notConfigured ? excerpt(result.errors[0].message, 500) : undefined, consecutiveFailures: 0, lastSuccessAt: finished.toISOString() },
    updatedAt: finished.toISOString(),
  }));
  const summary = { added: result.added, updated: result.updated, skipped: result.skipped, errors: result.errors.slice(0, 20).map(sanitizeAdapterError), notes: result.notes, chunks: result.chunks, durationMs: result.durationMs, docIds: result.docIds?.slice(0, 200) };
  if (verdict.failed) return { ok: false, error: verdict.error ?? { code: "unknown", message: "Run failed", retryable: false } };
  return { ok: true, result: summary };
}

/**
 * Execute one claimed job to completion: heartbeats extend the lease while it
 * runs; success completes it; a transient failure re-queues it with backoff;
 * an interruption (runner deadline) gives the attempt back; a final failure
 * dead-letters it and hands it to the steward.
 */
export async function executeJob(job: IntelJob, o: ExecuteOptions = {}): Promise<DurableIntelJob> {
  const now = o.now ?? new Date();
  const log = (line: IntelJobLogLine) => appendLog(job.id, line);
  const beat = setInterval(() => { try { heartbeat(job.id); } catch { /* ignore */ } }, HEARTBEAT_EVERY_MS);
  (beat as { unref?: () => void }).unref?.();
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
        const { tick: workflowTick } = await import("@/modules/workflows/scheduler");
        outcome = { ok: true, result: await workflowTick(now) };
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
  } finally {
    clearInterval(beat);
  }
  if (outcome.ok) return completeJob(job.id, (outcome.result as Record<string, unknown> | undefined) ?? undefined) ?? (job as DurableIntelJob);
  const code = outcome.error.code;
  // The runner's own abort surfaces from providers as "cancelled" or "timeout"; either way it is an interruption, not a failed attempt.
  if ((code === "cancelled" || code === "timeout") && o.signal?.aborted) {
    const current = getJob(job.id);
    if (current?.status === "running") { resetSourceStatus(job.sourceId, now); return requeueInterrupted(job.id, "Interrupted by the runner deadline", new Date()) ?? current; }
  }
  const failed = failJob(job.id, { code, message: outcome.error.message }, { retryable: code === "cancelled" ? true : outcome.error.retryable && isTransientError(code) });
  if (failed?.status === "failed" && o.review !== false) {
    try {
      const { reviewJob } = await import("./steward");
      return (await reviewJob(failed.id, { providers: o.providers, now })) ?? failed;
    } catch (e) {
      appendLog(failed.id, { at: new Date().toISOString(), level: "error" as const, msg: `Steward review failed: ${(e as Error).message}` });
    }
  }
  return failed ?? (job as DurableIntelJob);
}

/** Review dead-lettered jobs the steward has not decided on yet (e.g. the review threw last time). Bounded per tick. */
export async function reviewDeadLetters(o: { now?: Date; limit?: number; providers?: IntelProviders } = {}): Promise<number> {
  const now = o.now ?? new Date();
  const candidates = jobs().find((j) => j.status === "failed" && Boolean(j.deadLetter) && !j.stewardDecision && j.fixes.length === 0 && !j.escalation)
    .sort((a, b) => (a.finishedAt ?? a.updatedAt).localeCompare(b.finishedAt ?? b.updatedAt))
    .slice(0, o.limit ?? 3);
  let reviewed = 0;
  for (const j of candidates) {
    try {
      const { reviewJob } = await import("./steward");
      await reviewJob(j.id, { providers: o.providers, now });
      reviewed++;
    } catch (e) {
      appendLog(j.id, { at: now.toISOString(), level: "error" as const, msg: `Steward review failed: ${(e as Error).message}` });
    }
  }
  return reviewed;
}

export interface RunDueOptions {
  limit?: number;
  deadlineMs?: number;
  now?: Date;
  providers?: IntelProviders;
  concurrency?: number;
  /**
   * Also enqueue periodic jobs by cadence. `true` enqueues everything (the cron tick); the inline loop passes an
   * explicit selection because the workflow scheduler runs on its own timer in that process.
   */
  housekeeping?: boolean | HousekeepingOptions;
  workerId?: string;
  kinds?: IntelJobKind[];
}

/** Reap expired leases, enqueue due sources and periodic jobs, then run claimable jobs with bounded concurrency until the limit or deadline. */
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
    const hk: HousekeepingOptions | true | null = o.housekeeping === true ? true : o.housekeeping && typeof o.housekeeping === "object" ? o.housekeeping : null;
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

export interface TickOptions extends RunDueOptions {
  /** "expired" (default): re-queue jobs whose lease lapsed; "all": every running job (single-process inline mode at boot only); "none". */
  recover?: "expired" | "all" | "none";
  /** Dead-lettered jobs without a steward decision to review this tick (default 3). */
  reviewDeadLetters?: number;
}

export interface IntelTickResult extends IntelRunDueResult {
  traceId: string;
  recovered: number;
  reviewed: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * The single entrypoint for background work. The production cron
 * (POST /api/intel/jobs/tick) and the development loop (background.ts) both
 * call it: recover interrupted jobs, review unreviewed dead letters, enqueue
 * due sources and periodic jobs, then run claimable jobs until the deadline.
 */
export async function tick(o: TickOptions = {}): Promise<IntelTickResult> {
  const startedAt = new Date().toISOString();
  const traceId = `tick_${nanoid(8)}`;
  const now = o.now ?? new Date();
  const recovered = o.recover === "none" ? 0 : recoverInterruptedJobs({ now, force: o.recover === "all" }).length;
  const reviewed = await reviewDeadLetters({ now, limit: o.reviewDeadLetters ?? 3, providers: o.providers });
  const r = await runDue({ ...o, now, housekeeping: o.housekeeping ?? true });
  return { ...r, traceId, recovered, reviewed, startedAt, finishedAt: new Date().toISOString() };
}

/** Once per process: recover jobs interrupted by the previous run (force in single-process inline mode). */
export function recoverOnBoot(o: { force?: boolean; now?: Date } = {}): DurableIntelJob[] {
  const g = globalThis as G;
  if (g.__leclaudeIntelBootRecovered) return [];
  g.__leclaudeIntelBootRecovered = true;
  return recoverInterruptedJobs({ now: o.now, force: o.force });
}

/** Enqueue a high-priority run for one source. With `wait`, executes it inline and returns the finished job. */
export async function runSourceNow(sourceId: string, o: { wait?: boolean; providers?: IntelProviders; force?: boolean; maxDocs?: number; since?: string; now?: Date } = {}): Promise<DurableIntelJob> {
  const source = intelSources().get(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  const job = enqueueJob({ kind: "source.run", sourceId, payload: { trigger: "manual", force: o.force ?? true, maxDocs: o.maxDocs, since: o.since }, priority: 1, dedupeKey: `source.run:${sourceId}` }, o.now);
  if (!o.wait) return job;
  if (job.status === "running") return job;
  const claimed = claimJob(job.id, `inline_${process.pid}`, o.now);
  if (!claimed) return job;
  return executeJob(claimed, { providers: o.providers, now: o.now });
}
