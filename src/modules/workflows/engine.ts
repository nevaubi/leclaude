import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { AIConfigError } from "@/lib/ai/config";
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowRun, WorkflowRunStep } from "@/lib/types/domain";
import { executionPlan, isLoopBackEdge, validateWorkflow, type ExecutionPlan } from "./graph";
import { EXECUTORS, StepError, TrustGateError, matterContext, type ExecContext, type RunTrustState } from "./executors";
import { audit } from "@/lib/integrity/audit";
import { resolveDeep, resolveTemplate, resolveText, type ResolveReport, type TemplateContext } from "./template-expr";
import { publishRunEvent } from "./events";
import { nodeSpec } from "./registry";
import { WORKFLOW_CURRENT_USER, type RunApproval, type RunArtifact, type RunStartRequest, type RunUsage, type WorkflowRunRecord } from "./types";

/**
 * Workflow engine: executes a validated DAG with dynamic scheduling (a node
 * starts as soon as every predecessor has settled, so independent branches run
 * in parallel), persists per-step state to the run record, streams progress
 * through the run event bus, pauses on approvals, iterates loops, honours
 * cancellation and per-step timeouts, retries flaky model/network steps and
 * accounts tokens and estimated cost.
 */

type ActiveRun = { controller: AbortController; promise: Promise<void> };
type G = typeof globalThis & { __leclaudeWorkflowActive?: Map<string, ActiveRun> };

function activeRuns() {
  const g = globalThis as G;
  if (!g.__leclaudeWorkflowActive) g.__leclaudeWorkflowActive = new Map();
  return g.__leclaudeWorkflowActive;
}

const MAX_LOOP_ITERATIONS = 50;
const STRING_CAP = 300_000;

const DEFAULT_TIMEOUT_SEC: Record<string, number> = { trigger: 10, ai: 180, data: 60, logic: 60 * 60 * 24, action: 30 };

/** Estimated USD per 1M tokens by model tier (override through env). */
function rates(tier: "primary" | "fast") {
  const env = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n >= 0 ? n : d; };
  return tier === "fast" ? { input: env("WORKFLOW_COST_FAST_INPUT", 0.25), output: env("WORKFLOW_COST_FAST_OUTPUT", 2) } : { input: env("WORKFLOW_COST_PRIMARY_INPUT", 2.5), output: env("WORKFLOW_COST_PRIMARY_OUTPUT", 10) };
}

export function estimateCostUsd(usage: { input: number; output: number }, tier: "primary" | "fast"): number {
  const r = rates(tier);
  return (usage.input / 1e6) * r.input + (usage.output / 1e6) * r.output;
}

function capStrings<T>(v: T, cap = STRING_CAP): T {
  if (typeof v === "string") return (v.length > cap ? v.slice(0, cap) + "…[truncated]" : v) as T;
  if (Array.isArray(v)) return v.map((x) => capStrings(x, cap)) as T;
  if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = capStrings(x, cap); return o as T; }
  return v;
}

function errorInfo(e: unknown): { message: string; code?: string } {
  if (e instanceof AIConfigError) return { message: "OpenAI key required: add OPENAI_API_KEY to .env.local to run AI steps.", code: "no_api_key" };
  if (e instanceof StepError) return { message: e.message, code: e.code };
  if (e instanceof DOMException && e.name === "AbortError") return { message: "Cancelled", code: "cancelled" };
  if (e instanceof Error) {
    if (e.name === "AbortError") return { message: "Cancelled", code: "cancelled" };
    if (e.name === "TimeoutError") return { message: e.message, code: "timeout" };
    const status = (e as { status?: number }).status;
    if (status === 401) return { message: "OpenAI rejected the API key (401).", code: "bad_api_key" };
    if (status === 429) return { message: "Rate limited by the model provider (429).", code: "rate_limited" };
    return { message: e.message || String(e), code: (e as { code?: string }).code };
  }
  return { message: String(e) };
}

class TimeoutError extends Error { constructor(ms: number) { super(`Step timed out after ${Math.round(ms / 1000)}s`); this.name = "TimeoutError"; } }

function isSkippable(spec: ReturnType<typeof nodeSpec>) { return Boolean(spec); }

interface Frame {
  /** Step states visible for edge activation and templates (top-level or loop iteration). */
  steps: Map<string, WorkflowRunStep>;
  /** Extra template context (loop item…). */
  loop?: TemplateContext["loop"];
  /** Loop iteration metadata for events. */
  iteration?: { loopId: string; index: number; count: number };
  /** Parent frame (for templates: outer steps stay visible). */
  parent?: Frame;
}

class RunExecution {
  private run: WorkflowRunRecord;
  private workflow: Workflow;
  private nodes: Map<string, WorkflowNode>;
  private edges: WorkflowEdge[];
  private plan: ExecutionPlan;
  private usage: RunUsage;
  private matter: Record<string, unknown> | null;
  private paused = false;
  private failed: { message: string; code?: string } | null = null;

  constructor(run: WorkflowRunRecord, workflow: Workflow, private controller: AbortController) {
    this.run = run;
    this.workflow = workflow;
    const nodes = run.snapshot?.nodes ?? workflow.nodes;
    const edges = run.snapshot?.edges ?? workflow.edges;
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.edges = edges;
    this.plan = executionPlan(nodes, edges);
    this.usage = run.usage ?? { input: 0, output: 0, total: 0, calls: 0, costUsd: 0 };
    this.matter = matterContext(run.matterId);
  }

  get signal() { return this.controller.signal; }

  // ───────────── persistence & events ─────────────

  private persist() {
    this.run.updatedAt = new Date().toISOString();
    this.run.usage = this.usage;
    db().workflowRuns.put(this.run);
  }

  private topSteps(): Map<string, WorkflowRunStep> {
    const m = new Map<string, WorkflowRunStep>();
    for (const s of this.run.steps) m.set(s.nodeId, s);
    return m;
  }

  private syncSteps(map: Map<string, WorkflowRunStep>) {
    this.run.steps = Array.from(this.nodes.keys()).map((id) => map.get(id) ?? { nodeId: id, status: "pending" });
  }

  private setStep(frame: Frame, nodeId: string, patch: Partial<WorkflowRunStep>, opts: { persist?: boolean } = {}) {
    const cur = frame.steps.get(nodeId) ?? { nodeId, status: "pending" };
    const next: WorkflowRunStep = { ...cur, ...patch };
    frame.steps.set(nodeId, next);
    if (!frame.parent) this.syncSteps(frame.steps);
    else {
      // Mirror the latest iteration state on the top-level step so the canvas shows progress.
      const top = this.rootFrame(frame).steps;
      top.set(nodeId, { ...next, logs: [...(next.logs ?? [])] });
      this.syncSteps(top);
    }
    if (opts.persist !== false) this.persist();
    publishRunEvent(this.run.id, { type: "step.status", runId: this.run.id, nodeId, step: next, iteration: frame.iteration });
  }

  private rootFrame(frame: Frame): Frame { let f = frame; while (f.parent) f = f.parent; return f; }

  private log(frame: Frame, nodeId: string, line: string) {
    const step = frame.steps.get(nodeId) ?? { nodeId, status: "pending" as const };
    const logs = [...(step.logs ?? []), line].slice(-200);
    frame.steps.set(nodeId, { ...step, logs });
    if (!frame.parent) this.syncSteps(frame.steps);
    publishRunEvent(this.run.id, { type: "step.log", runId: this.run.id, nodeId, line, at: new Date().toISOString() });
  }

  private setRunStatus(status: WorkflowRun["status"], extra: { error?: string; errorCode?: string } = {}) {
    this.run.status = status;
    if (extra.error !== undefined) this.run.error = extra.error;
    if (extra.errorCode !== undefined) this.run.errorCode = extra.errorCode;
    if (["succeeded", "failed", "cancelled"].includes(status)) {
      this.run.finishedAt = new Date().toISOString();
      this.run.durationMs = new Date(this.run.finishedAt).getTime() - new Date(this.run.startedAt).getTime();
      audit("workflow.run", { kind: "workflowRun", id: this.run.id, label: `${this.workflow.name}: ${status}`, matterId: this.run.matterId }, { workflowId: this.workflow.id, status, error: this.run.error, errorCode: this.run.errorCode, durationMs: this.run.durationMs, usage: this.usage, artifacts: (this.run.artifacts ?? []).length });
    }
    this.persist();
    publishRunEvent(this.run.id, { type: "run.status", runId: this.run.id, status, error: this.run.error, errorCode: this.run.errorCode, finishedAt: this.run.finishedAt, usage: this.usage });
  }

  private addArtifact(a: RunArtifact) {
    this.run.artifacts = [...(this.run.artifacts ?? []), a];
    publishRunEvent(this.run.id, { type: "artifact", runId: this.run.id, artifact: a });
  }

  // ───────────── template context ─────────────

  private templateContext(frame: Frame): TemplateContext {
    const steps: Record<string, { output?: unknown; status?: string; label?: string }> = {};
    const chain: Frame[] = [];
    for (let f: Frame | undefined = frame; f; f = f.parent) chain.unshift(f);
    for (const f of chain) for (const s of f.steps.values()) steps[s.nodeId] = { output: s.output, status: s.status, label: this.nodes.get(s.nodeId)?.label };
    return {
      inputs: this.run.inputs,
      steps,
      matter: this.matter,
      loop: frame.loop ?? frame.parent?.loop ?? null,
      run: { id: this.run.id, workflowId: this.workflow.id, workflowName: this.workflow.name, startedAt: this.run.startedAt, triggeredBy: this.run.triggeredBy, href: `/workflows/runs/${this.run.id}` },
      user: { id: WORKFLOW_CURRENT_USER.id, name: WORKFLOW_CURRENT_USER.name },
      now: new Date().toISOString(),
    };
  }

  // ───────────── edge activation ─────────────

  private incoming(nodeId: string) { return this.edges.filter((e) => e.target === nodeId && !isLoopBackEdge(e, this.nodes)); }

  private isEdgeActive(e: WorkflowEdge, frame: Frame): boolean {
    const src = frame.steps.get(e.source) ?? frame.parent?.steps.get(e.source);
    if (!src || src.status !== "succeeded") return false;
    const type: string | undefined = this.nodes.get(e.source)?.type;
    const out = (src.output ?? {}) as Record<string, unknown>;
    switch (type) {
      case "logic.branch": return !e.sourceHandle || e.sourceHandle === out.matched;
      case "logic.approval": return out.approved ? !e.sourceHandle || e.sourceHandle === "approved" || e.sourceHandle === "out" : e.sourceHandle === "rejected";
      case "logic.review": return out.approved || out.trusted ? !e.sourceHandle || e.sourceHandle === "approved" || e.sourceHandle === "out" : e.sourceHandle === "rejected";
      case "logic.loop": return e.sourceHandle !== "each";
      default: return true;
    }
  }

  private settled(s?: WorkflowRunStep) { return !!s && (s.status === "succeeded" || s.status === "skipped" || s.status === "failed"); }

  // ───────────── scheduling ─────────────

  /** Execute a set of nodes with dynamic scheduling. Resolves when all settle, the run pauses, fails or is cancelled. */
  private async runNodeSet(ids: string[], frame: Frame): Promise<void> {
    const pendingIds = new Set(ids.filter((id) => !this.settled(frame.steps.get(id)) && frame.steps.get(id)?.status !== "waiting_approval"));
    const inflight = new Map<string, Promise<void>>();
    const schedule = () => {
      if (this.paused || this.failed || this.signal.aborted) return;
      for (const id of Array.from(pendingIds)) {
        if (inflight.has(id)) continue;
        // Inside a loop body the edge from the loop's "each" handle is the entry edge: always ready and active.
        const loopId = frame.iteration?.loopId;
        const all = this.incoming(id);
        const entry = Boolean(loopId) && all.some((e) => e.source === loopId && e.sourceHandle === "each");
        const inc = all.filter((e) => e.source !== loopId && (ids.includes(e.source) || frame.parent?.steps.has(e.source)));
        const ready = inc.every((e) => this.settled(frame.steps.get(e.source) ?? frame.parent?.steps.get(e.source)));
        if (!ready) continue;
        pendingIds.delete(id);
        const active = inc.filter((e) => this.isEdgeActive(e, frame)).map((e) => e.source);
        if (entry) active.push(loopId!);
        if ((inc.length || all.length) && !active.length) {
          this.setStep(frame, id, { status: "skipped", finishedAt: new Date().toISOString(), logs: ["Skipped: no active incoming path"] });
          continue;
        }
        const p = this.execNode(id, frame, active).finally(() => inflight.delete(id));
        inflight.set(id, p);
      }
    };
    schedule();
    while (inflight.size) {
      await Promise.race(inflight.values());
      schedule();
    }
    // Anything still pending after a pause/failure stays pending (pause) or becomes skipped (failure/cancel).
    if (this.failed || this.signal.aborted) {
      for (const id of pendingIds) this.setStep(frame, id, { status: "skipped", logs: [this.failed ? "Skipped: run failed" : "Skipped: run cancelled"] }, { persist: false });
      this.persist();
    }
  }

  private async execNode(id: string, frame: Frame, activeSources: string[]): Promise<void> {
    const node = this.nodes.get(id)!;
    const spec = nodeSpec(node.type);
    if (!isSkippable(spec)) { this.fail({ message: `Unknown node type ${node.type}`, code: "unknown_type" }, frame, id); return; }
    if (node.type === "logic.approval") return this.requestApproval(node, frame);
    if (node.type === "logic.loop") return this.runLoop(node, frame, activeSources);
    const startedAt = new Date().toISOString();
    const report: ResolveReport = { missing: [], errors: [] };
    // Re-executed nodes (a lifted trust gate) keep the gate's log lines so the panel shows why it paused.
    this.setStep(frame, id, { status: "running", startedAt, error: undefined, logs: (frame.steps.get(id)?.logs ?? []).filter((l) => /^Trust gate/.test(l)) });
    const ctx: ExecContext = {
      node, run: this.run, workflow: this.workflow, config: node.config, ctx: this.templateContext(frame), report,
      signal: this.signal,
      log: (line) => this.log(frame, id, line),
      progress: (label, value) => publishRunEvent(this.run.id, { type: "step.progress", runId: this.run.id, nodeId: id, label, value }),
      artifact: (a) => this.addArtifact({ ...a, nodeId: id }),
      activeSources,
    };
    const category = node.type.split(".")[0];
    const timeoutSec = Number(node.config.timeoutSec) || DEFAULT_TIMEOUT_SEC[category] || 60;
    const retriable = Boolean(spec?.usesAI || spec?.usesNetwork);
    const retries = retriable ? Math.min(3, Math.max(0, Number(node.config.retries ?? 1) || 0)) : 0;
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= retries) {
      attempt++;
      try {
        if (this.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const stepController = new AbortController();
        const onAbort = () => stepController.abort();
        this.signal.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => stepController.abort(), timeoutSec * 1000);
        let timedOut = false;
        stepController.signal.addEventListener("abort", () => { if (!this.signal.aborted) timedOut = true; }, { once: true });
        let result;
        try {
          result = await EXECUTORS[node.type]({ ...ctx, signal: stepController.signal });
        } catch (e) {
          if (timedOut && (e instanceof DOMException || (e as Error)?.name === "AbortError")) throw new TimeoutError(timeoutSec * 1000);
          throw e;
        } finally { clearTimeout(timer); this.signal.removeEventListener("abort", onAbort); }
        if (report.missing.length) this.log(frame, id, `Unresolved variables: ${Array.from(new Set(report.missing)).slice(0, 8).join(", ")}`);
        for (const err of report.errors.slice(0, 5)) this.log(frame, id, `Template: ${err}`);
        if (result.usage) {
          const tier = node.config.modelTier === "fast" ? "fast" : "primary";
          this.usage.input += result.usage.input; this.usage.output += result.usage.output; this.usage.total += result.usage.total;
          this.usage.calls += result.calls ?? 1;
          this.usage.costUsd = Number((this.usage.costUsd + estimateCostUsd(result.usage, tier)).toFixed(6));
        }
        const finishedAt = new Date().toISOString();
        this.setStep(frame, id, { status: "succeeded", finishedAt, output: capStrings(result.output), input: capStrings(summarizeInput(node.config, ctx.ctx), 2000), tokens: result.usage?.total });
        return;
      } catch (e) {
        if (e instanceof TrustGateError) {
          if (frame.parent) {
            // Inside a loop body the run cannot pause; the action is skipped so nothing is created from untrusted output.
            this.setStep(frame, id, { status: "skipped", finishedAt: new Date().toISOString(), output: { gated: true, reason: e.message, reasons: e.reasons, stepIds: e.stepIds }, logs: [...(frame.steps.get(id)?.logs ?? []), `Trust gate: ${e.message}`] });
            return;
          }
          this.pauseForTrust(node, frame, e);
          return;
        }
        lastErr = e;
        const info = errorInfo(e);
        const fatal = e instanceof AIConfigError || e instanceof StepError || info.code === "cancelled" || info.code === "bad_api_key" || this.signal.aborted;
        if (fatal || attempt > retries) break;
        const backoff = Math.min(8000, 1000 * 2 ** (attempt - 1));
        this.log(frame, id, `Attempt ${attempt} failed (${info.message}); retrying in ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    const info = errorInfo(lastErr);
    this.setStep(frame, id, { status: "failed", finishedAt: new Date().toISOString(), error: info.message });
    if (frame.parent) throw Object.assign(new Error(info.message), { code: info.code, nodeId: id });
    this.fail(info, frame, id);
  }

  private fail(info: { message: string; code?: string }, frame: Frame, nodeId: string) {
    if (this.failed) return;
    this.failed = info;
    const label = this.nodes.get(nodeId)?.label ?? nodeId;
    this.run.logs = [...(this.run.logs ?? []), `Failed at "${label}": ${info.message}`];
    if (frame.parent) this.setStep(frame, nodeId, { status: "failed", error: info.message }, { persist: false });
    if (info.code === "cancelled") return;
    this.controller.abort();
  }

  // ───────────── approvals ─────────────

  private async requestApproval(node: WorkflowNode, frame: Frame) {
    if (frame.parent) { this.fail({ message: "Approval steps inside a loop body are not supported.", code: "unsupported" }, frame, node.id); return; }
    const ctx = this.templateContext(frame);
    const report: ResolveReport = { missing: [], errors: [] };
    const approval: RunApproval = {
      nodeId: node.id,
      title: resolveText(String(node.config.title ?? "Approval"), ctx, report),
      message: resolveText(String(node.config.message ?? ""), ctx, report),
      approverId: node.config.approverId ? String(node.config.approverId) : undefined,
      requestedAt: new Date().toISOString(),
    };
    this.run.approvals = [...(this.run.approvals ?? []).filter((a) => a.nodeId !== node.id), approval];
    this.paused = true;
    this.setStep(frame, node.id, { status: "waiting_approval", startedAt: approval.requestedAt, output: { approved: null, title: approval.title, message: approval.message }, logs: [`Waiting for ${approval.approverId ? db().people.get(approval.approverId)?.name ?? approval.approverId : "approval"}`] });
    publishRunEvent(this.run.id, { type: "approval.requested", runId: this.run.id, approval });
  }

  /**
   * Trust gate: an action (or a logic.review node) refused to act on AI output
   * that is not trusted. The run pauses like an approval; the approval carries
   * kind "trust-gate", the reasons and the AI step ids so the run panel can
   * show exactly what failed verification.
   */
  private pauseForTrust(node: WorkflowNode, frame: Frame, e: TrustGateError) {
    const approverId = node.config.approverId ? String(node.config.approverId) : WORKFLOW_CURRENT_USER.id;
    const title = (node.type as string) === "logic.review" ? String(node.config.title || `Trust review: ${node.label}`) : `Trust gate: ${node.label}`;
    const approval = { nodeId: node.id, title, message: e.message, approverId, requestedAt: new Date().toISOString(), kind: "trust-gate", reasons: e.reasons, stepIds: e.stepIds } as RunApproval;
    this.run.approvals = [...(this.run.approvals ?? []).filter((a) => a.nodeId !== node.id), approval];
    this.paused = true;
    this.run.logs = [...(this.run.logs ?? []), `Paused at "${node.label}": ${e.message}`];
    this.setStep(frame, node.id, { status: "waiting_approval", startedAt: approval.requestedAt, output: { approved: null, trusted: false, reasons: e.reasons, stepIds: e.stepIds, title, message: e.message }, logs: [...(frame.steps.get(node.id)?.logs ?? []), `Trust gate: ${e.message}`, `Waiting for ${db().people.get(approverId)?.name ?? approverId}`] });
    audit("workflow.approve", { kind: "workflowRun", id: this.run.id, label: `${this.workflow.name} › ${node.label}: trust gate`, matterId: this.run.matterId }, { requested: true, nodeId: node.id, reasons: e.reasons, stepIds: e.stepIds });
    publishRunEvent(this.run.id, { type: "approval.requested", runId: this.run.id, approval });
  }

  // ───────────── loops ─────────────

  private async runLoop(node: WorkflowNode, frame: Frame, activeSources: string[]) {
    const id = node.id;
    const startedAt = new Date().toISOString();
    const report: ResolveReport = { missing: [], errors: [] };
    this.setStep(frame, id, { status: "running", startedAt, logs: [] });
    const ctx = this.templateContext(frame);
    let items: unknown[] = [];
    try {
      const raw = resolveTemplate(String(node.config.over ?? ""), ctx, report);
      if (Array.isArray(raw)) items = raw;
      else if (typeof raw === "string" && raw.trim()) { try { const p = JSON.parse(raw); items = Array.isArray(p) ? p : raw.split(/\r?\n/).filter(Boolean); } catch { items = raw.split(/\r?\n/).filter(Boolean); } }
      else if (raw && typeof raw === "object") items = Object.values(raw as Record<string, unknown>);
    } catch (e) { this.setStep(frame, id, { status: "failed", error: (e as Error).message }); this.fail(errorInfo(e), frame, id); return; }
    const max = Math.min(MAX_LOOP_ITERATIONS, Math.max(1, Number(node.config.maxIterations) || MAX_LOOP_ITERATIONS));
    const total = items.length;
    if (total > max) this.log(frame, id, `${total} items; bounded to the first ${max}`);
    items = items.slice(0, max);
    const bodyPlan = this.plan.loops[id] ?? { body: [], bodyOrder: [] };
    const results: { index: number; item: unknown; steps: Record<string, unknown> }[] = [];
    const errors: { index: number; error: string }[] = [];
    const stopOnError = Boolean(node.config.stopOnError);
    const label = String(node.config.itemLabel || "item");
    this.run.loopIterations = { ...(this.run.loopIterations ?? {}), [id]: [] };
    this.log(frame, id, `${items.length} ${label}(s) to process`);
    void activeSources;
    for (let i = 0; i < items.length; i++) {
      if (this.signal.aborted || this.failed) break;
      const item = items[i];
      const iterFrame: Frame = { steps: new Map(bodyPlan.body.map((b) => [b, { nodeId: b, status: "pending" as const }])), loop: { item, index: i, count: items.length, number: i + 1, label }, iteration: { loopId: id, index: i, count: items.length }, parent: frame };
      publishRunEvent(this.run.id, { type: "step.progress", runId: this.run.id, nodeId: id, label: `${label} ${i + 1} of ${items.length}`, value: i / items.length });
      let error: string | undefined;
      try {
        await this.runNodeSet(bodyPlan.bodyOrder, iterFrame);
        if (this.failed) break;
      } catch (e) {
        error = (e as Error).message;
        errors.push({ index: i, error });
        this.log(frame, id, `${label} ${i + 1}: ${error}`);
      }
      const stepOutputs: Record<string, unknown> = {};
      const stepRecords: Record<string, WorkflowRunStep> = {};
      for (const s of iterFrame.steps.values()) { stepOutputs[s.nodeId] = s.output; stepRecords[s.nodeId] = s; }
      results.push({ index: i, item, steps: stepOutputs });
      this.run.loopIterations[id].push({ index: i, item: capStrings(item, 4000), steps: stepRecords, error });
      if (error && stopOnError) { this.setStep(frame, id, { status: "failed", finishedAt: new Date().toISOString(), error: `Stopped at ${label} ${i + 1}: ${error}` }); this.fail({ message: `Loop stopped at ${label} ${i + 1}: ${error}`, code: "loop_error" }, frame, id); return; }
    }
    if (this.failed || this.signal.aborted) { this.setStep(frame, id, { status: this.signal.aborted && !this.failed ? "skipped" : "failed", finishedAt: new Date().toISOString(), error: this.failed?.message }); return; }
    this.setStep(frame, id, { status: "succeeded", finishedAt: new Date().toISOString(), output: capStrings({ count: results.length, total, results, errors, errorCount: errors.length }) });
  }

  // ───────────── main ─────────────

  async execute(): Promise<void> {
    const rootFrame: Frame = { steps: this.topSteps() };
    if (this.run.status !== "running") this.setRunStatus("running");
    try {
      await this.runNodeSet(this.plan.order, rootFrame);
    } catch (e) {
      if (!this.failed) this.fail(errorInfo(e), rootFrame, this.plan.order[0] ?? "");
    }
    if (this.failed) {
      this.setRunStatus(this.failed.code === "cancelled" ? "cancelled" : "failed", { error: this.failed.message, errorCode: this.failed.code });
      if (this.failed.code === "no_api_key") publishRunEvent(this.run.id, { type: "error", message: this.failed.message, code: "no_api_key" });
      publishRunEvent(this.run.id, { type: "run.done", runId: this.run.id, status: this.run.status });
      return;
    }
    if (this.signal.aborted) {
      this.setRunStatus("cancelled", { error: this.run.error ?? "Cancelled by user", errorCode: "cancelled" });
      publishRunEvent(this.run.id, { type: "run.done", runId: this.run.id, status: "cancelled" });
      return;
    }
    if (this.paused) {
      this.setRunStatus("waiting_approval");
      publishRunEvent(this.run.id, { type: "run.done", runId: this.run.id, status: "waiting_approval" });
      return;
    }
    // Collect outputs of leaf nodes (no outgoing active edges) plus every succeeded step's output.
    const outputs: Record<string, unknown> = {};
    for (const s of rootFrame.steps.values()) if (s.status === "succeeded" && !this.nodes.get(s.nodeId)?.type.startsWith("trigger.")) outputs[s.nodeId] = s.output;
    this.run.outputs = outputs;
    this.setRunStatus("succeeded");
    publishRunEvent(this.run.id, { type: "run.done", runId: this.run.id, status: "succeeded" });
  }
}

function summarizeInput(config: Record<string, unknown>, ctx: TemplateContext): Record<string, unknown> {
  // Store the resolved config for debugging, but keep it small.
  try { return resolveDeep(config, ctx); } catch { return config; }
}

// ─────────────────────────── Public API ───────────────────────────

export interface StartRunOptions extends RunStartRequest {
  /** Payload for event triggers (exposed as steps.<trigger>.output.*). */
  event?: Record<string, unknown>;
  triggeredById?: string;
  /** Run inline (await completion) — used by tests and the scheduler. */
  wait?: boolean;
}

export function createRunRecord(workflow: Workflow, opts: StartRunOptions): WorkflowRunRecord {
  const inputs: Record<string, unknown> = { ...(opts.inputs ?? {}) };
  if (opts.event) inputs.__event = opts.event;
  let matterId = opts.matterId ?? undefined;
  if (!matterId) {
    const matterInput = (workflow.inputs ?? []).find((i) => i.type === "matter");
    if (matterInput && typeof inputs[matterInput.key] === "string" && db().matters.has(inputs[matterInput.key] as string)) matterId = inputs[matterInput.key] as string;
  }
  const now = new Date().toISOString();
  return {
    id: `run_${nanoid(10)}`,
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowCategory: workflow.category,
    status: "queued",
    inputs,
    steps: workflow.nodes.map((n) => ({ nodeId: n.id, status: "pending" })),
    startedAt: now,
    updatedAt: now,
    triggeredBy: opts.triggeredBy ?? "manual",
    triggeredById: opts.triggeredById ?? WORKFLOW_CURRENT_USER.id,
    matterId,
    usage: { input: 0, output: 0, total: 0, calls: 0, costUsd: 0 },
    artifacts: [],
    approvals: [],
    parentRunId: opts.parentRunId,
    snapshot: { nodes: workflow.nodes, edges: workflow.edges, inputs: workflow.inputs },
  };
}

/** Validate, persist and launch a run. Resolves with the run record immediately (or after completion when `wait`). */
export async function startRun(workflow: Workflow, opts: StartRunOptions = {}): Promise<WorkflowRunRecord> {
  const v = validateWorkflow(workflow.nodes, workflow.edges);
  if (!v.ok) throw new StepError(`Workflow is not runnable: ${v.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`, "invalid_workflow");
  const missing = (workflow.inputs ?? []).filter((i) => i.required && (opts.inputs?.[i.key] == null || opts.inputs?.[i.key] === "")).map((i) => i.label);
  if (missing.length) throw new StepError(`Missing required input${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`, "missing_inputs");
  const run = createRunRecord(workflow, opts);
  db().workflowRuns.put(run);
  db().workflows.update(workflow.id, (w) => ({ ...w, runsCount: (w.runsCount ?? 0) + 1, lastRunAt: run.startedAt }));
  audit("workflow.run", { kind: "workflowRun", id: run.id, label: `${workflow.name}: started`, matterId: run.matterId }, { workflowId: workflow.id, triggeredBy: run.triggeredBy, inputs: Object.keys(run.inputs).filter((k) => k !== "__event") }, { id: run.triggeredById ?? WORKFLOW_CURRENT_USER.id, name: db().people.get(run.triggeredById ?? WORKFLOW_CURRENT_USER.id)?.name ?? "Workflow" });
  const promise = launch(run, workflow);
  if (opts.wait) { await promise; return db().workflowRuns.get(run.id) as WorkflowRunRecord; }
  return run;
}

function launch(run: WorkflowRunRecord, workflow: Workflow): Promise<void> {
  const controller = new AbortController();
  const exec = new RunExecution(run, workflow, controller);
  const promise = exec.execute().catch((e) => { console.error(`[workflows] run ${run.id} crashed`, e); }).finally(() => { activeRuns().delete(run.id); });
  activeRuns().set(run.id, { controller, promise });
  return promise;
}

export function isRunActive(runId: string) { return activeRuns().has(runId); }

/** Cancel a running or waiting run. */
export function cancelRun(runId: string): WorkflowRunRecord | null {
  const d = db();
  const run = d.workflowRuns.get(runId) as WorkflowRunRecord | null;
  if (!run) return null;
  const active = activeRuns().get(runId);
  if (active) { active.controller.abort(); return run; }
  if (run.status === "waiting_approval" || run.status === "queued" || run.status === "running") {
    const now = new Date().toISOString();
    run.status = "cancelled"; run.error = "Cancelled by user"; run.errorCode = "cancelled"; run.finishedAt = now; run.updatedAt = now;
    run.steps = run.steps.map((s) => (s.status === "pending" || s.status === "waiting_approval" || s.status === "running" ? { ...s, status: "skipped", finishedAt: now, logs: [...(s.logs ?? []), "Cancelled"] } : s));
    d.workflowRuns.put(run);
    publishRunEvent(runId, { type: "run.status", runId, status: "cancelled", error: run.error, errorCode: "cancelled", finishedAt: now, usage: run.usage });
    publishRunEvent(runId, { type: "run.done", runId, status: "cancelled" });
  }
  return run;
}

/** Record an approval decision and resume the run. */
export async function resumeRun(runId: string, decision: { approved: boolean; comment?: string; decidedBy?: string }, opts: { wait?: boolean } = {}): Promise<WorkflowRunRecord> {
  const d = db();
  const run = d.workflowRuns.get(runId) as WorkflowRunRecord | null;
  if (!run) throw new StepError("Run not found", "not_found");
  if (run.status !== "waiting_approval") throw new StepError(`Run is ${run.status}, not waiting for approval`, "not_waiting");
  const step = run.steps.find((s) => s.status === "waiting_approval");
  if (!step) throw new StepError("No approval step is pending", "not_waiting");
  const workflow = d.workflows.get(run.workflowId);
  if (!workflow) throw new StepError("Workflow no longer exists", "not_found");
  const now = new Date().toISOString();
  const decidedBy = decision.decidedBy ?? WORKFLOW_CURRENT_USER.id;
  const output = { approved: decision.approved, comment: decision.comment ?? "", decidedBy, decidedByName: d.people.get(decidedBy)?.name ?? decidedBy, decidedAt: now };
  const approval = (run.approvals ?? []).find((a) => a.nodeId === step.nodeId) as (RunApproval & { kind?: string; stepIds?: string[]; reasons?: string[] }) | undefined;
  const actor = { id: decidedBy, name: output.decidedByName };
  audit("workflow.approve", { kind: "workflowRun", id: run.id, label: `${workflow.name} › ${step.nodeId}: ${decision.approved ? "approved" : "rejected"}`, matterId: run.matterId }, { nodeId: step.nodeId, approved: decision.approved, comment: decision.comment, kind: approval?.kind ?? "approval", stepIds: approval?.stepIds }, actor);
  run.approvals = (run.approvals ?? []).map((a) => (a.nodeId === step.nodeId ? { ...a, approved: decision.approved, comment: decision.comment, decidedAt: now, decidedBy } : a));
  if (approval?.kind === "trust-gate") {
    const node = (run.snapshot?.nodes ?? workflow.nodes).find((n) => n.id === step.nodeId);
    const trust = run as WorkflowRunRecord & RunTrustState;
    const log = `${decision.approved ? "Trust gate lifted" : "Trust gate rejected"} by ${output.decidedByName}${decision.comment ? `: ${decision.comment}` : ""}`;
    if (decision.approved) {
      // The reviewer vouched for the AI output: remember it for this run and re-execute the node with the gate lifted.
      trust.trustOverrides = Array.from(new Set([...(trust.trustOverrides ?? []), step.nodeId, ...(approval.stepIds ?? [])]));
      run.steps = run.steps.map((s) => (s.nodeId === step.nodeId ? { nodeId: s.nodeId, status: "pending", logs: [...(s.logs ?? []), log] } : s));
    } else if ((node?.type as string | undefined) === "logic.review") {
      run.steps = run.steps.map((s) => (s.nodeId === step.nodeId ? { ...s, status: "succeeded", finishedAt: now, output: { ...output, trusted: false, reasons: approval.reasons ?? [], steps: (approval.stepIds ?? []).map((id) => ({ id, trusted: false })) }, logs: [...(s.logs ?? []), log] } : s));
    } else {
      // An action was refused: it is skipped (nothing is created) and the rest of the run continues.
      run.steps = run.steps.map((s) => (s.nodeId === step.nodeId ? { ...s, status: "skipped", finishedAt: now, output: { gated: true, reasons: approval.reasons ?? [], ...output }, logs: [...(s.logs ?? []), log, "Skipped: reviewer rejected the AI output"] } : s));
    }
    run.logs = [...(run.logs ?? []), log];
    publishRunEvent(runId, { type: "step.status", runId, nodeId: step.nodeId, step: run.steps.find((s) => s.nodeId === step.nodeId)! });
    run.status = "running"; run.updatedAt = now;
    d.workflowRuns.put(run);
    const promise = launch(run, workflow);
    if (opts.wait) { await promise; return d.workflowRuns.get(runId) as WorkflowRunRecord; }
    return run;
  }
  run.steps = run.steps.map((s) => (s.nodeId === step.nodeId ? { ...s, status: "succeeded", finishedAt: now, output, logs: [...(s.logs ?? []), `${decision.approved ? "Approved" : "Rejected"} by ${output.decidedByName}${decision.comment ? `: ${decision.comment}` : ""}`] } : s));
  const edges = run.snapshot?.edges ?? workflow.edges;
  const hasRejectedPath = edges.some((e) => e.source === step.nodeId && e.sourceHandle === "rejected");
  publishRunEvent(runId, { type: "step.status", runId, nodeId: step.nodeId, step: run.steps.find((s) => s.nodeId === step.nodeId)! });
  if (!decision.approved && !hasRejectedPath) {
    run.status = "cancelled"; run.error = `Rejected by ${output.decidedByName}${decision.comment ? `: ${decision.comment}` : ""}`; run.errorCode = "rejected"; run.finishedAt = now; run.updatedAt = now;
    run.steps = run.steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped", logs: ["Skipped: approval rejected"] } : s));
    d.workflowRuns.put(run);
    publishRunEvent(runId, { type: "run.status", runId, status: "cancelled", error: run.error, errorCode: "rejected", finishedAt: now, usage: run.usage });
    publishRunEvent(runId, { type: "run.done", runId, status: "cancelled" });
    return run;
  }
  run.status = "running"; run.updatedAt = now;
  d.workflowRuns.put(run);
  const promise = launch(run, workflow);
  if (opts.wait) { await promise; return d.workflowRuns.get(runId) as WorkflowRunRecord; }
  return run;
}

/** Start a new run with the same inputs as an existing one. */
export async function rerun(runId: string, opts: { wait?: boolean } = {}): Promise<WorkflowRunRecord> {
  const d = db();
  const prev = d.workflowRuns.get(runId) as WorkflowRunRecord | null;
  if (!prev) throw new StepError("Run not found", "not_found");
  const workflow = d.workflows.get(prev.workflowId);
  if (!workflow) throw new StepError("Workflow no longer exists", "not_found");
  const inputs = { ...prev.inputs };
  const event = inputs.__event as Record<string, unknown> | undefined;
  delete inputs.__event;
  return startRun(workflow, { inputs, matterId: prev.matterId, triggeredBy: "manual", parentRunId: prev.id, event, wait: opts.wait });
}

/** Mark runs that were "running" when the process died as failed (called on boot by the scheduler). */
export function reapOrphanedRuns() {
  const d = db();
  const now = new Date().toISOString();
  for (const run of d.workflowRuns.find((r) => (r.status === "running" || r.status === "queued") && !activeRuns().has(r.id)) as WorkflowRunRecord[]) {
    const age = Date.now() - new Date(run.updatedAt ?? run.startedAt).getTime();
    if (age < 5 * 60_000) continue; // may belong to another worker
    run.status = "failed"; run.error = "Interrupted: the server restarted while this run was in progress."; run.errorCode = "interrupted"; run.finishedAt = now; run.updatedAt = now;
    run.steps = run.steps.map((s) => (s.status === "running" ? { ...s, status: "failed", error: "Interrupted", finishedAt: now } : s.status === "pending" ? { ...s, status: "skipped" } : s));
    d.workflowRuns.put(run);
  }
}
