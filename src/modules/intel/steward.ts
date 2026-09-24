import "server-only";
import { db } from "@/lib/db";
import { generateJSON } from "@/lib/ai/agent";
import { aiConfig } from "@/lib/ai/config";
import { applyVerification, safeVerifyClaims, type VerifySource } from "@/lib/ai/verify";
import { audit } from "@/lib/integrity/audit";
import { makeProvenance } from "@/lib/integrity/provenance";
import { putProvenance } from "@/lib/integrity/store";
import { getAdapter } from "./adapters";
import { intelConfig } from "./config";
import { enqueueJob, getJob } from "./jobs";
import { defaultProviders, isProviderError, toIntelErrorCode, type IntelProviders } from "./providers";
import { flagDocument, getDocumentText, hasFlag, intelChunks, intelDocuments, intelEntities, intelInsights, intelJobs, intelSources, unflagDocument } from "./store";
import { INTEL_STALE_AFTER_DAYS, type IntelDocument, type IntelErrorCode, type IntelInsight, type IntelJob, type IntelJobLogLine, type IntelSource, type IntelSweepReport, type StewardAction } from "./types";

/**
 * The steward: an automated reviewer that reads failed jobs, applies one
 * fix from an allow-list (deterministically, or chosen by the model over the
 * job log), re-runs once, and escalates to the human review queue when the
 * re-run fails too. Its sweep re-verifies insights, marks stale documents,
 * detects contradictions and broken links, and flags orphaned entities.
 */
export const FIX_ALLOWLIST: StewardAction[] = ["retry", "backoff", "switch_provider", "narrow_query", "rechunk", "reembed", "quarantine", "flag", "disable_source", "escalate", "none"];
export const DISABLE_AFTER_FAILURES = 5;

const CODES: IntelErrorCode[] = ["rate_limited", "network", "not_configured", "parse", "schema_drift", "empty", "low_confidence", "duplicate", "timeout", "cancelled", "unknown"];

export function classifyError(input: unknown): IntelErrorCode {
  if (input && typeof input === "object" && "code" in input && typeof (input as { code: unknown }).code === "string" && CODES.includes((input as { code: IntelErrorCode }).code)) {
    const code = (input as { code: IntelErrorCode }).code;
    return code === "unknown" ? classifyMessage(String((input as { message?: string }).message ?? "")) : code;
  }
  if (isProviderError(input)) return toIntelErrorCode(input);
  const msg = input instanceof Error ? `${input.name}: ${input.message}` : String(input ?? "");
  return classifyMessage(msg);
}

function classifyMessage(msg: string): IntelErrorCode {
  const m = msg.toLowerCase();
  if (/cancel|abort/.test(m) && !/timed? ?out/.test(m)) return "cancelled";
  if (/429|rate.?limit|too many requests|quota/.test(m)) return "rate_limited";
  if (/timed? ?out|etimedout|deadline|no heartbeat/.test(m)) return "timeout";
  if (/not configured|api key|missing key|unauthori[sz]ed|authentication failed|401|403/.test(m)) return "not_configured";
  if (/schema drift|no results array|unexpected shape|missing field|unknown adapter|invalid source configuration/.test(m)) return "schema_drift";
  if (/enotfound|econnreset|econnrefused|eai_again|fetch failed|network|socket|502|503|504|http 5\d\d/.test(m)) return "network";
  if (/json|unexpected token|parse|could not read|no text|no readable text/.test(m)) return "parse";
  if (/duplicate/.test(m)) return "duplicate";
  if (/low.?confidence/.test(m)) return "low_confidence";
  if (/\bempty\b|no results|0 documents|nothing (was )?fetched/.test(m)) return "empty";
  return "unknown";
}

export interface StewardDecision {
  action: StewardAction;
  note: string;
  by: "steward" | "model";
  delayMs?: number;
  configOverride?: Record<string, unknown>;
}

function halve(n: unknown, min: number): number | undefined {
  return typeof n === "number" ? Math.max(min, Math.ceil(n / 2)) : undefined;
}

/** Narrow the query window / page size for a retry. */
export function narrowedConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["maxResults", "maxEntries", "maxFiles", "maxDeviceEvents"]) { const v = halve(config[key], 5); if (v !== undefined) out[key] = v; }
  for (const key of ["sinceDays", "entrySinceDays"]) { const v = halve(config[key], 1); if (v !== undefined) out[key] = v; }
  if (typeof config.maxTextChars === "number") out.maxTextChars = Math.max(2000, Math.ceil(config.maxTextChars / 2));
  return out;
}

/** Deterministic fix from the allow-list, or null when the model (or escalation) should decide. */
export function deterministicFix(job: IntelJob, source: IntelSource | null, code: IntelErrorCode, opts: { firecrawlConfigured?: boolean } = {}): StewardDecision | null {
  const tried = new Set(job.fixes.map((f) => f.action));
  const retryAfter = typeof job.error === "object" && job.error && "retryAfterMs" in job.error ? Number((job.error as { retryAfterMs?: number }).retryAfterMs) : undefined;
  if (source && source.health.consecutiveFailures >= DISABLE_AFTER_FAILURES && code !== "cancelled") {
    return { action: "disable_source", note: `Disabled after ${source.health.consecutiveFailures} consecutive failures (${code}). Re-enable it in Settings once the cause is fixed.`, by: "steward" };
  }
  const family = source ? getAdapter(source.adapter)?.family : undefined;
  const canSwitch = family === "web" && Boolean(opts.firecrawlConfigured) && !tried.has("switch_provider") && (source?.config.prefer ?? "auto") !== "firecrawl";
  switch (code) {
    case "rate_limited": return { action: "backoff", note: "Provider rate limit hit; re-running after a cooling-off period.", by: "steward", delayMs: Number.isFinite(retryAfter) && retryAfter! > 0 ? Math.min(retryAfter!, 3600_000) : 15 * 60_000 };
    case "timeout": return !tried.has("narrow_query") && source ? { action: "narrow_query", note: "Request timed out; re-running with a smaller window and page size.", by: "steward", configOverride: narrowedConfig(source.config) } : { action: "backoff", note: "Timed out again; re-running later.", by: "steward", delayMs: 30 * 60_000 };
    case "network": return !tried.has("retry") ? { action: "retry", note: "Transient network failure; re-running.", by: "steward", delayMs: 2 * 60_000 } : { action: "backoff", note: "Network still failing; re-running later.", by: "steward", delayMs: 30 * 60_000 };
    case "not_configured": return { action: "flag", note: `Provider not configured${source ? ` for ${source.name}` : ""}; add the API key in the environment. The source is not re-run until its next schedule.`, by: "steward" };
    case "parse": return canSwitch ? { action: "switch_provider", note: "Plain fetch could not be parsed; re-running through Firecrawl.", by: "steward", configOverride: { prefer: "firecrawl" } } : !tried.has("narrow_query") && source ? { action: "narrow_query", note: "Response could not be parsed; re-running with a smaller request.", by: "steward", configOverride: narrowedConfig(source.config) } : null;
    case "schema_drift": return canSwitch ? { action: "switch_provider", note: "Provider response shape changed; re-running through Firecrawl.", by: "steward", configOverride: { prefer: "firecrawl" } } : null;
    case "empty": return { action: "none", note: "The run produced no records; that is not an error.", by: "steward" };
    case "low_confidence": return { action: "flag", note: "Low-confidence records flagged for review.", by: "steward" };
    case "duplicate": return { action: "quarantine", note: "Duplicate records quarantined (flagged needs_review).", by: "steward" };
    case "cancelled": return { action: "none", note: "Cancelled by request.", by: "steward" };
    default: return !tried.has("retry") ? { action: "retry", note: "Unclassified failure; re-running once.", by: "steward", delayMs: 60_000 } : null;
  }
}

const DIAGNOSIS_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: FIX_ALLOWLIST },
    rationale: { type: "string" },
    delayMinutes: { type: ["integer", "null"], description: "For backoff: minutes to wait before re-running" },
    narrow: { type: ["boolean", "null"], description: "For narrow_query: halve page sizes and date windows" },
  },
  required: ["action", "rationale"],
};

/** Ask the model to pick one allow-listed action from the job log and a sample of the failing payload. Null without a key or on failure. */
export async function modelDiagnosis(job: IntelJob, source: IntelSource | null, code: IntelErrorCode, opts: { signal?: AbortSignal } = {}): Promise<StewardDecision | null> {
  if (!aiConfig().hasKey) return null;
  try {
    const sample = { kind: job.kind, adapter: source?.adapter, schedule: source?.schedule, configKeys: Object.keys(source?.config ?? {}), config: JSON.stringify(source?.config ?? {}).slice(0, 1500), errorCode: code, error: job.error, attempts: job.attempts, fixesTried: job.fixes.map((f) => `${f.action} (${f.by}): ${f.note}`), consecutiveFailures: source?.health.consecutiveFailures, recentLog: job.log.slice(-30).map((l) => `${l.at} ${l.level} ${l.msg}${l.data ? " " + JSON.stringify(l.data).slice(0, 200) : ""}`), lastResult: JSON.stringify(job.result ?? {}).slice(0, 1200) };
    const res = await generateJSON<{ action: StewardAction; rationale: string; delayMinutes?: number | null; narrow?: boolean | null }>({
      fast: true,
      reasoningEffort: "low",
      instructions: `You are the steward for a legal-intelligence ingestion pipeline. A background job failed. Choose exactly one repair action from the allow-list and explain it in one sentence. Allow-list: retry (transient), backoff (rate limits or flaky providers; set delayMinutes), switch_provider (web pages that fail to parse with plain fetch), narrow_query (timeouts or oversized responses), rechunk (indexing failures on long documents), reembed (embedding failures), quarantine (duplicate or corrupt records), flag (leave failed, mark the source/records for a human), disable_source (repeated failures with no fix; ${DISABLE_AFTER_FAILURES}+ consecutive), escalate (you cannot tell what is wrong), none (not actually an error). Never invent configuration; never choose an action that was already tried unless the log shows the situation changed.`,
      input: JSON.stringify(sample),
      schema: DIAGNOSIS_SCHEMA,
      name: "steward_diagnosis",
      maxOutputTokens: 400,
      signal: opts.signal,
    });
    if (!res || !FIX_ALLOWLIST.includes(res.action)) return null;
    return { action: res.action, note: `Model diagnosis: ${res.rationale.slice(0, 300)}`, by: "model", delayMs: res.delayMinutes ? Math.max(1, Math.min(240, res.delayMinutes)) * 60_000 : undefined, configOverride: res.action === "narrow_query" && source ? narrowedConfig(source.config) : res.action === "switch_provider" ? { prefer: "firecrawl" } : undefined };
  } catch {
    return null;
  }
}

function recordFix(jobId: string, decision: StewardDecision, extra: Partial<IntelJob> = {}, at = new Date().toISOString()): IntelJob | null {
  return intelJobs().update(jobId, (j) => ({ ...j, ...extra, fixes: [...j.fixes, { at, action: decision.action, by: decision.by, note: decision.note }], log: [...j.log, { at, level: "info" as const, msg: `Steward (${decision.by}): ${decision.action} — ${decision.note}` }].slice(-200), updatedAt: at }));
}

function scheduleRerun(job: IntelJob, decision: StewardDecision, now: Date): IntelJob {
  const runAfter = decision.delayMs ? new Date(now.getTime() + decision.delayMs).toISOString() : undefined;
  const configOverride = { ...((job.payload.configOverride as Record<string, unknown> | undefined) ?? {}), ...(decision.configOverride ?? {}) };
  return enqueueJob({ kind: job.kind, sourceId: job.sourceId, payload: { ...job.payload, rerunOf: job.id, fix: decision.action, configOverride: Object.keys(configOverride).length ? configOverride : undefined }, priority: 2, maxAttempts: 1, runAfter, dedupeKey: `rerun:${job.id}` }, now);
}

/** Apply a decision: mutate the source/documents as needed and schedule the single re-run. */
export async function applyFix(job: IntelJob, source: IntelSource | null, decision: StewardDecision, opts: { now?: Date } = {}): Promise<{ job: IntelJob; rerun?: IntelJob }> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const docIds = Array.isArray(job.result?.docIds) ? (job.result!.docIds as string[]) : Array.isArray(job.payload.docIds) ? (job.payload.docIds as string[]) : [];
  switch (decision.action) {
    case "retry":
    case "backoff":
    case "switch_provider":
    case "narrow_query": {
      const rerun = scheduleRerun(job, decision, now);
      const updated = recordFix(job.id, decision, { status: "fixed", finishedAt: at }, at);
      audit("scan.fix", { kind: "intel.job", id: job.id, label: `${decision.action}: ${decision.note.slice(0, 120)}` }, { by: decision.by, rerunJobId: rerun.id, action: decision.action });
      return { job: updated ?? job, rerun };
    }
    case "rechunk": {
      const rerun = enqueueJob({ kind: "doc.index", sourceId: job.sourceId, payload: { docIds: docIds.length ? docIds : intelDocuments().find((d) => d.sourceId === job.sourceId).slice(0, 200).map((d) => d.id), chunkSize: 800, rerunOf: job.id, fix: "rechunk" }, priority: 3, maxAttempts: 1, dedupeKey: `rerun:${job.id}` }, now);
      const updated = recordFix(job.id, decision, { status: "fixed", finishedAt: at }, at);
      return { job: updated ?? job, rerun };
    }
    case "reembed": {
      const rerun = enqueueJob({ kind: "doc.index", sourceId: job.sourceId, payload: { limit: 50, rerunOf: job.id, fix: "reembed" }, priority: 4, maxAttempts: 1, dedupeKey: `rerun:${job.id}` }, now);
      const updated = recordFix(job.id, decision, { status: "fixed", finishedAt: at }, at);
      return { job: updated ?? job, rerun };
    }
    case "quarantine": {
      for (const id of docIds) flagDocument(id, { kind: "needs_review", note: `Quarantined by the steward: ${decision.note}`, by: "steward", at });
      return { job: recordFix(job.id, decision, {}, at) ?? job };
    }
    case "flag": {
      for (const id of docIds) flagDocument(id, { kind: "low_confidence", note: decision.note, by: "steward", at });
      if (source) intelSources().update(source.id, (s) => ({ ...s, health: { ...s.health, lastError: decision.note.slice(0, 500) }, updatedAt: at }));
      return { job: recordFix(job.id, decision, {}, at) ?? job };
    }
    case "disable_source": {
      if (source) intelSources().update(source.id, (s) => ({ ...s, enabled: false, status: "disabled", nextRunAt: undefined, health: { ...s.health, lastError: decision.note.slice(0, 500) }, updatedAt: at }));
      audit("settings.change", { kind: "intel.source", id: source?.id, label: `Disabled ${source?.name ?? job.sourceId}` }, { by: "steward", reason: decision.note });
      return { job: recordFix(job.id, decision, {}, at) ?? job };
    }
    case "escalate":
      return { job: escalate(job, decision.note, { now }) };
    case "none":
    default:
      return { job: recordFix(job.id, decision, {}, at) ?? job };
  }
}

/** Escalate a job to the human review queue (provenance sidecar kind "intel.job" + audit ai.verify "escalated"). */
export function escalate(job: IntelJob, reason: string, opts: { now?: Date } = {}): IntelJob {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const source = job.sourceId ? intelSources().get(job.sourceId) : null;
  const title = `Intel job ${job.kind}${source ? ` — ${source.name}` : ""}: ${reason}`.slice(0, 200);
  const provenance = makeProvenance({ surface: "intel.steward", model: "steward", confidence: 0.2, sources: [{ kind: "internal", id: job.id, title: `job ${job.id}` }, ...(source ? [{ kind: "internal" as const, id: source.id, title: source.name }] : [])] });
  provenance.review = { status: "pending", note: reason.slice(0, 300) };
  const rec = putProvenance({ kind: "intel.job", recordId: job.id, title, href: `/settings?tab=data&job=${job.id}`, provenance });
  audit("ai.verify", { kind: "intel.job", id: job.id, label: title }, { method: "schema", decision: "escalated", reason, code: job.error?.code, sourceId: job.sourceId, fixes: job.fixes.map((f) => f.action) });
  if (source) intelSources().update(source.id, (s) => ({ ...s, status: s.enabled ? "error" : "disabled", health: { ...s.health, ok: false, lastError: `Escalated: ${reason}`.slice(0, 500) }, updatedAt: at }));
  return intelJobs().update(job.id, (j) => ({ ...j, status: "escalated", finishedAt: j.finishedAt ?? at, escalation: { reason, reviewId: rec.id, at }, fixes: [...j.fixes, { at, action: "escalate", by: "steward", note: reason }], log: [...j.log, { at, level: "warn" as const, msg: `Escalated to review: ${reason}` }].slice(-200), updatedAt: at })) ?? job;
}

/** Review a finally-failed job: classify, fix (deterministic → model), re-run once, else escalate. */
export async function reviewJob(jobId: string, opts: { providers?: IntelProviders; now?: Date; model?: boolean; signal?: AbortSignal } = {}): Promise<IntelJob | null> {
  const job = getJob(jobId);
  if (!job) return null;
  if (job.status !== "failed") return job;
  const now = opts.now ?? new Date();
  const code = classifyError(job.error);
  const source = job.sourceId ? intelSources().get(job.sourceId) : null;
  if (job.payload.rerunOf) {
    const original = getJob(String(job.payload.rerunOf));
    const fix = String(job.payload.fix ?? original?.fixes.at(-1)?.action ?? "fix");
    return escalate(job, `Re-run after "${fix}" failed again (${code}: ${job.error?.message.slice(0, 160) ?? "unknown"})`, { now });
  }
  const firecrawlConfigured = (opts.providers ?? defaultProviders()).firecrawl.configured;
  const decision = deterministicFix(job, source, code, { firecrawlConfigured }) ?? (opts.model !== false ? await modelDiagnosis(job, source, code, { signal: opts.signal }) : null) ?? { action: "escalate" as const, note: `No applicable automatic fix for ${code}: ${job.error?.message.slice(0, 160) ?? "unknown error"}`, by: "steward" as const };
  const applied = await applyFix(job, source, decision, { now });
  return applied.job;
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

export interface SweepOptions {
  providers?: IntelProviders;
  signal?: AbortSignal;
  now?: Date;
  log?: (line: IntelJobLogLine) => void;
  /** Insights re-verified per sweep. */
  sampleSize?: number;
  /** URLs probed per sweep. */
  urlChecks?: number;
  /** Set false to skip network probes (tests, offline). */
  network?: boolean;
}

const SWEEP_KEY = "intel:last-sweep";

export function lastSweepReport(): IntelSweepReport | null {
  return db().kv.get<IntelSweepReport>(SWEEP_KEY);
}

function normalizeDocket(n: string | undefined): string | undefined {
  if (!n) return undefined;
  const m = n.toLowerCase().replace(/\s+/g, "").match(/(\d{1,2}:\d{2}-[a-z]{2,3}-\d{3,6})/);
  return m ? m[1].replace(/-0+(\d)/g, "-$1") : n.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCitation(c: string | undefined): string | undefined {
  return c ? c.toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim() : undefined;
}

/** Same docket number or citation reported with conflicting dates by different sources. */
export function findContradictions(docs: IntelDocument[]): { a: IntelDocument; b: IntelDocument; field: string; values: [string, string] }[] {
  const out: { a: IntelDocument; b: IntelDocument; field: string; values: [string, string] }[] = [];
  const groups = new Map<string, IntelDocument[]>();
  for (const d of docs) {
    if (d.kind === "docket" || d.kind === "mdl") { const k = normalizeDocket(d.docketNumber); if (k) groups.set(`dk:${k}`, [...(groups.get(`dk:${k}`) ?? []), d]); }
    if (d.kind === "opinion") { const k = normalizeCitation(d.citation); if (k) groups.set(`ci:${k}`, [...(groups.get(`ci:${k}`) ?? []), d]); }
  }
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const field = key.startsWith("dk:") ? "filed" : "decided";
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.sourceId === b.sourceId && a.adapter === b.adapter) continue;
      const va = a.dates[field as keyof IntelDocument["dates"]], vb = b.dates[field as keyof IntelDocument["dates"]];
      if (va && vb && va !== vb) out.push({ a, b, field, values: [va, vb] });
    }
  }
  return out;
}

/** Documents not refreshed by their source within the kind-specific window (only for enabled, scheduled sources). */
export function staleDocuments(now: Date, docs = intelDocuments().all()): IntelDocument[] {
  const sources = new Map(intelSources().all().map((s) => [s.id, s]));
  return docs.filter((d) => {
    const s = sources.get(d.sourceId);
    if (!s || !s.enabled || s.schedule.every === "manual") return false;
    const days = INTEL_STALE_AFTER_DAYS[d.kind] ?? 30;
    return now.getTime() - new Date(d.fetchedAt).getTime() > days * 86400_000;
  });
}

export async function verifyInsights(opts: { limit?: number; insightIds?: string[]; signal?: AbortSignal; log?: (line: IntelJobLogLine) => void; now?: Date }): Promise<{ checked: number; verified: number; flagged: number; skipped: number; reason?: string }> {
  const now = opts.now ?? new Date();
  const candidates = opts.insightIds?.length
    ? opts.insightIds.map((id) => intelInsights().get(id)).filter((x): x is IntelInsight => Boolean(x))
    : intelInsights().find((i) => i.status === "verified" || i.status === "published" || i.status === "draft").sort((a, b) => (a.provenance.verification?.checkedAt ?? "").localeCompare(b.provenance.verification?.checkedAt ?? "")).slice(0, opts.limit ?? 5);
  if (!candidates.length) return { checked: 0, verified: 0, flagged: 0, skipped: 0 };
  if (!aiConfig().hasKey) return { checked: 0, verified: 0, flagged: 0, skipped: candidates.length, reason: "no_api_key" };
  let verified = 0, flagged = 0, skipped = 0;
  for (const insight of candidates) {
    if (opts.signal?.aborted) break;
    const sources: VerifySource[] = [];
    for (const ev of insight.evidence.slice(0, 12)) {
      const chunk = ev.chunkId ? intelChunks().get(ev.chunkId) : null;
      const doc = intelDocuments().get(ev.docId);
      const text = chunk?.text ?? (ev.quote ? ev.quote : (getDocumentText(ev.docId) ?? "").slice(0, 4000));
      if (text) sources.push({ title: doc?.title ?? ev.docId, cite: doc?.citation ?? doc?.docketNumber, url: ev.url ?? doc?.url, text });
    }
    if (!sources.length) { skipped++; continue; }
    const result = await safeVerifyClaims({ answer: `${insight.title}\n${insight.summary}`, sources, signal: opts.signal });
    if (result.error) { skipped++; opts.log?.({ at: now.toISOString(), level: "warn" as const, msg: `Verification skipped for ${insight.id}: ${result.error}` }); continue; }
    const at = now.toISOString();
    const bad = result.contradicted > 0 || (result.unsupported > result.supported && result.verdicts.length > 0);
    const provenance = applyVerification(insight.provenance, result);
    const flags = insight.flags.filter((f) => f.kind !== "contradicted" && f.kind !== "unverified");
    if (result.contradicted > 0) flags.push({ kind: "contradicted", note: `${result.contradicted} claim(s) contradicted by the evidence`, at, by: "steward:sweep" });
    else if (bad) flags.push({ kind: "unverified", note: `${result.unsupported} of ${result.verdicts.length} claims unsupported by the evidence`, at, by: "steward:sweep" });
    intelInsights().put({ ...insight, provenance, flags, status: bad ? "flagged" : insight.status === "flagged" ? "verified" : insight.status, updatedAt: at });
    audit("ai.verify", { kind: "intel.insight", id: insight.id, label: insight.title, matterId: insight.scope.matterId }, { method: "claims", decision: bad ? "flagged" : "verified", supported: result.supported, unsupported: result.unsupported, contradicted: result.contradicted });
    if (bad) flagged++; else verified++;
  }
  return { checked: candidates.length - skipped, verified, flagged, skipped };
}

/** Continuous verification sweep: insights, staleness, contradictions, broken links, orphaned entities. */
export async function sweep(opts: SweepOptions = {}): Promise<IntelSweepReport> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const notes: string[] = [];
  const log = opts.log ?? (() => {});

  const ins = await verifyInsights({ limit: opts.sampleSize ?? 5, signal: opts.signal, log, now });
  if (ins.reason) notes.push(`Insight verification skipped (${ins.reason}).`);

  // Staleness: flag documents their (enabled, scheduled) source has not refreshed within the kind window; clear flags when refreshed.
  let staleFlagged = 0;
  const all = intelDocuments().all();
  const stale = new Set(staleDocuments(now, all).map((d) => d.id));
  for (const d of all) {
    if (stale.has(d.id) && !hasFlag(d, "stale")) { flagDocument(d.id, { kind: "stale", note: `Not refreshed for more than ${INTEL_STALE_AFTER_DAYS[d.kind]} days`, by: "steward:sweep", at }); staleFlagged++; }
    else if (!stale.has(d.id) && hasFlag(d, "stale")) unflagDocument(d.id, "stale");
  }

  // Contradictions between sources on the same docket/citation.
  let contradictions = 0;
  for (const c of findContradictions(intelDocuments().all())) {
    const note = `${c.field} date differs between sources: ${c.values[0]} (${c.a.adapter}) vs ${c.values[1]} (${c.b.adapter})`;
    if (!c.a.flags.some((f) => f.kind === "contradicted" && f.note === note)) flagDocument(c.a.id, { kind: "contradicted", note, by: "steward:sweep", at });
    if (!c.b.flags.some((f) => f.kind === "contradicted" && f.note === note)) flagDocument(c.b.id, { kind: "contradicted", note, by: "steward:sweep", at });
    contradictions++;
  }

  // Broken links: a small rate-limited sample per sweep.
  let brokenLinks = 0, urlsChecked = 0;
  const network = opts.network ?? !intelConfig().offline;
  if (network) {
    const providers = opts.providers ?? defaultProviders();
    const weekAgo = now.getTime() - 7 * 86400_000;
    const candidates = intelDocuments().find((d) => Boolean(d.url && /^https?:\/\//i.test(d.url)) && !(typeof d.meta?.urlCheckedAt === "string" && new Date(d.meta.urlCheckedAt as string).getTime() > weekAgo)).sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt)).slice(0, opts.urlChecks ?? 10);
    for (const d of candidates) {
      if (opts.signal?.aborted) break;
      const probe = await providers.web.probe(d.url!, { signal: opts.signal, timeoutMs: 8_000 });
      urlsChecked++;
      if (probe.error) continue; // network trouble is not a broken link
      const latest = intelDocuments().get(d.id) ?? d;
      if (probe.status === 404 || probe.status === 410) { flagDocument(d.id, { kind: "broken_link", note: `HTTP ${probe.status} for ${d.url}`, by: "steward:sweep", at }); brokenLinks++; }
      else if (probe.ok && hasFlag(latest, "broken_link")) unflagDocument(d.id, "broken_link");
      intelDocuments().update(d.id, (doc) => ({ ...doc, meta: { ...(doc.meta ?? {}), urlCheckedAt: at, urlStatus: probe.status } }));
    }
  } else notes.push("Link checks skipped (offline).");

  // Orphaned entities: every linked document is gone.
  let orphanedEntities = 0;
  for (const e of intelEntities().all()) {
    const orphan = e.docIds.length > 0 && e.docIds.every((id) => !intelDocuments().has(id));
    const flagged = e.flags?.some((f) => f.kind === "needs_review" && /orphan/i.test(f.note ?? ""));
    if (orphan && !flagged) { intelEntities().put({ ...e, flags: [...(e.flags ?? []), { kind: "needs_review", note: "Orphaned: none of its linked documents exist any more", at, by: "steward:sweep" }], updatedAt: at }); orphanedEntities++; }
    else if (!orphan && flagged) intelEntities().put({ ...e, flags: (e.flags ?? []).filter((f) => !(f.kind === "needs_review" && /orphan/i.test(f.note ?? ""))), updatedAt: at });
    else if (orphan) orphanedEntities++;
  }

  const report: IntelSweepReport = { at, durationMs: Date.now() - started, insightsChecked: ins.checked, insightsFlagged: ins.flagged, staleFlagged, contradictions, brokenLinks, urlsChecked, orphanedEntities, notes };
  db().kv.set(SWEEP_KEY, report);
  audit("scan.run", { kind: "intel.sweep", label: `${staleFlagged} stale, ${contradictions} contradictions, ${brokenLinks} broken links, ${ins.flagged} flagged insights` }, { ...report, notes: undefined });
  log({ at, level: "info" as const, msg: `Sweep finished`, data: { ...report, notes: undefined } });
  return report;
}
