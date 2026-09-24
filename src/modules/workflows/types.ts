/** Client-safe types shared by the workflows engine, API routes, hooks and UI. */
import type { ID, ISODate, Workflow, WorkflowFailureKind, WorkflowRun, WorkflowRunStep, WorkflowRunTerminalStatus, WorkflowSkipReason, WorkflowStepTelemetry } from "@/lib/types/domain";
import type { RunTerminalState } from "@/lib/ai/providers/types";
import type { AgentId } from "@/lib/ai/agents/personas";
import { CURRENT_USER } from "@/lib/current-user";

export const WORKFLOW_CURRENT_USER = CURRENT_USER;

/** Platform agents a workflow can hand work to (mirrors src/lib/ai/agents/personas.ts; kept here so client code never imports the server registry). */
export const WORKFLOW_AGENTS: { id: AgentId; label: string; hint: string }[] = [
  { id: "coordinator", label: "Coordinator", hint: "Routes work to a specialist; never answers substantive law itself" },
  { id: "research", label: "Research", hint: "Case law, statutes, regulations, dockets and firm knowledge with citations" },
  { id: "drafter", label: "Drafter", hint: "Memos, letters, briefs and clauses from a brief and sources" },
  { id: "reviewer", label: "Reviewer", hint: "Claim, citation and style QA before anything is applied or published" },
  { id: "coder", label: "Coder", hint: "Predictive coding suggestions with rationale and quotes" },
  { id: "analyst", label: "Analyst", hint: "Trends, profiles and chronologies over the intelligence store" },
  { id: "steward", label: "Steward", hint: "Diagnoses failed jobs and steps and picks an allow-listed fix" },
];

// ─────────────────────────── Terminal states (constitution §14) ───────────────────────────

/**
 * The run's terminal states are the platform's orchestration terminal states.
 * `WorkflowRunTerminalStatus` (domain) and `RunTerminalState` (model runtime)
 * must stay identical; this assignment fails to compile when they drift.
 */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const TERMINAL_STATES_MATCH: Equal<WorkflowRunTerminalStatus, RunTerminalState> = true;
void TERMINAL_STATES_MATCH;

export type RunStatus = WorkflowRun["status"];
export type RunTerminalStatus = WorkflowRunTerminalStatus;

export const TERMINAL_RUN_STATUSES: readonly RunTerminalStatus[] = ["succeeded", "partial", "budget_exhausted", "verification_failed", "cancelled", "failed"];
const TERMINAL_SET = new Set<string>(TERMINAL_RUN_STATUSES);

export function isTerminalStatus(status: string | undefined | null): status is RunTerminalStatus {
  return Boolean(status) && TERMINAL_SET.has(status as string);
}

/** A run that will not change on its own: terminal, or parked on a human decision. */
export function isRestingStatus(status: string | undefined | null): boolean {
  return isTerminalStatus(status) || status === "waiting_approval";
}

/**
 * Why a run stopped. Stored on the record next to the terminal status so the
 * UI never infers the reason from prose.
 */
export type RunStopReason =
  | "completed"
  | "completed_with_failures"
  | "step_failed"
  | "verification_failed"
  | "not_configured"
  | "budget_tokens"
  | "budget_cost"
  | "budget_time"
  | "cancelled_by_user"
  | "approval_rejected"
  | "interrupted"
  | "unknown";

/** Terminal state of a run, including records written before terminal states existed (explicit mapping, never a guess). */
export function terminalStateOf(run: Pick<WorkflowRun, "status"> & { errorCode?: string; terminalState?: RunTerminalStatus; stopReason?: RunStopReason }): RunTerminalStatus | null {
  if (run.terminalState) return run.terminalState;
  switch (run.status) {
    case "succeeded": return "succeeded";
    case "partial": return "partial";
    case "budget_exhausted": return "budget_exhausted";
    case "verification_failed": return "verification_failed";
    case "cancelled": return "cancelled";
    case "failed": return run.errorCode === "cancelled" ? "cancelled" : "failed";
    default: return null;
  }
}

/** Stop reason of a run, derived for records that predate `stopReason`. */
export function stopReasonOf(run: Pick<WorkflowRun, "status"> & { errorCode?: string; stopReason?: RunStopReason }): RunStopReason | null {
  if (run.stopReason) return run.stopReason;
  switch (run.status) {
    case "succeeded": return "completed";
    case "partial": return "completed_with_failures";
    case "budget_exhausted": return "budget_tokens";
    case "verification_failed": return "verification_failed";
    case "cancelled": return run.errorCode === "rejected" ? "approval_rejected" : "cancelled_by_user";
    case "failed": return run.errorCode === "no_api_key" ? "not_configured" : run.errorCode === "interrupted" ? "interrupted" : "step_failed";
    default: return null;
  }
}

// ─────────────────────────── Budgets, leases, outcomes (constitution §13, §39) ───────────────────────────

/** Per-run budget. Defaults come from the environment; a start request or the trigger node's `budget` config can narrow them. */
export interface RunBudget {
  maxTokens: number;
  maxCostUsd: number;
  maxDurationMs: number;
}

/** In-flight ownership of a run. A run whose lease expired while its process was down is recovered on boot. */
export interface RunLease {
  owner: string;
  acquiredAt: ISODate;
  heartbeatAt: ISODate;
  expiresAt: ISODate;
}

/** What completed and what did not (populated when a run reaches a terminal state). */
export interface RunOutcome {
  completed: ID[];
  failed: ID[];
  skipped: ID[];
  cancelled: ID[];
  notRun: ID[];
}

export interface RunRecovery {
  at: ISODate;
  action: "resumed" | "failed";
  reason: string;
  /** Steps that were re-executed (resumed) or marked failed (not idempotent). */
  stepIds: ID[];
}

export interface RunArtifact {
  kind: "task" | "event" | "document" | "library" | "file" | "notification" | "coding";
  id: ID;
  title: string;
  href?: string;
  nodeId: ID;
  meta?: Record<string, unknown>;
}

/** An explicit agent-to-agent handoff recorded on the run (ai.route, ai.agent). */
export interface RunHandoff {
  at: ISODate;
  from: string;
  to: string;
  brief: string;
  nodeId?: ID;
  evidenceIds?: string[];
  meta?: Record<string, unknown>;
}

/**
 * A deliverable the run produced (output.file, action.save_document,
 * action.export, intel.publish to the library): the file or document with its
 * label, format and destinations. Distinct from `WorkflowRun.outputs`, which is
 * the map of step outputs by node id.
 */
export interface RunOutput {
  id: ID;
  kind: "file" | "document" | "library" | "insight";
  format?: string;
  title: string;
  /** Open in the app (Office editor, library item, insight). */
  href?: string;
  /** Download the bytes (/api/blobs/<id>). */
  downloadHref?: string;
  blobId?: ID;
  docId?: ID;
  libraryItemId?: ID;
  libraryFolderId?: ID;
  matterId?: ID;
  mime?: string;
  size?: number;
  nodeId: ID;
  at: ISODate;
  meta?: Record<string, unknown>;
}

/** What the engine did after a successful run on behalf of the front end's `after` settings. */
export interface RunFollowUps {
  taskIds: ID[];
  triggered: { workflowId: ID; runId: ID; name?: string }[];
  notified: ID[];
  notes: string[];
}

/** Run-level token, cost and time accounting. `activeMs` counts execution time only (not time parked on an approval). */
export interface RunUsage {
  input: number;
  output: number;
  total: number;
  calls: number;
  costUsd: number;
  cacheRead?: number;
  cacheWrite?: number;
  activeMs?: number;
}

export interface RunApproval {
  nodeId: ID;
  title: string;
  message: string;
  /** "approval" (logic.approval) or "trust-gate" (an action blocked by untrusted AI input). */
  kind?: "approval" | "trust-gate";
  reasons?: string[];
  stepIds?: string[];
  approverId?: ID;
  requestedAt: ISODate;
  decidedAt?: ISODate;
  decidedBy?: ID;
  approved?: boolean;
  comment?: string;
}

/** Persisted run record: the shared WorkflowRun plus module extensions (all optional, backwards compatible). */
export interface WorkflowRunRecord extends WorkflowRun {
  /** Step ids whose trust gate was lifted by an approver. */
  trustOverrides?: string[];
  workflowName?: string;
  workflowCategory?: string;
  triggeredById?: ID;
  error?: string;
  errorCode?: string;
  usage?: RunUsage;
  artifacts?: RunArtifact[];
  approvals?: RunApproval[];
  /** Non-persisted-per-step log of engine-level events. */
  logs?: string[];
  parentRunId?: ID;
  updatedAt?: ISODate;
  durationMs?: number;
  /** Loop iteration outputs by loop node id (body steps are recorded here rather than in `steps`). */
  loopIterations?: Record<ID, { index: number; item: unknown; steps: Record<ID, WorkflowRunStep>; error?: string }[]>;
  /** Graph as it was when the run started, so the run detail page is stable if the workflow is edited later. */
  snapshot?: { nodes: Workflow["nodes"]; edges: Workflow["edges"]; inputs?: Workflow["inputs"]; frontend?: Workflow["frontend"] };
  /** Agent handoffs recorded by ai.route / ai.agent steps. */
  handoffs?: RunHandoff[];
  /** Files and documents the run delivered (see RunOutput). */
  deliverables?: RunOutput[];
  /** Runs this run started (logic.schedule_after, after.triggerWorkflowIds). */
  childRunIds?: ID[];
  /** Tasks, notifications and runs created from the front end's `after` settings once the run succeeded. */
  followUps?: RunFollowUps;
  /** Steps that failed but were allowed to continue (`onError: "continue"`), with what the steward did about them. */
  stewardship?: { nodeId: ID; code?: string; action?: string; fixed: boolean; escalated: boolean; note?: string }[];
  // ── Runtime contract (constitution §13, §14, §39, §47) ──
  /** Terminal state, set once; equals `status` for finished runs (kept explicit so old records map through terminalStateOf). */
  terminalState?: RunTerminalStatus;
  stopReason?: RunStopReason;
  /** Failure kind of the failure that ended the run (when it ended because of one). */
  failureKind?: WorkflowFailureKind;
  /** Node where the run stopped (failure, cancellation or budget exhaustion). */
  stoppedAtNodeId?: ID;
  budget?: RunBudget;
  lease?: RunLease | null;
  outcome?: RunOutcome;
  /** Set when the scheduler recovered this run after a restart. */
  recovery?: RunRecovery;
  /** The run this one retried from (state of succeeded steps carried over). */
  retryOf?: ID;
  /** Timestamps of the checkpoints (one per node boundary), most recent last; bounded. */
  checkpointAt?: ISODate;
}

// ─────────────────────────── Structured events (constitution §46) ───────────────────────────

export type RunIteration = { loopId: ID; index: number; count: number };

export type RunTerminalEventType = "run.completed" | "run.partial" | "run.failed" | "run.cancelled" | "run.budget_exhausted" | "run.verification_failed";

export const TERMINAL_EVENT_FOR: Record<RunTerminalStatus, RunTerminalEventType> = {
  succeeded: "run.completed",
  partial: "run.partial",
  failed: "run.failed",
  cancelled: "run.cancelled",
  budget_exhausted: "run.budget_exhausted",
  verification_failed: "run.verification_failed",
};

export interface RunTerminalEvent {
  type: RunTerminalEventType;
  runId: ID;
  status: RunTerminalStatus;
  stopReason: RunStopReason;
  failureKind?: WorkflowFailureKind;
  error?: string;
  errorCode?: string;
  stoppedAtNodeId?: ID;
  endedAt: ISODate;
  usage?: RunUsage;
  outcome?: RunOutcome;
}

/**
 * Typed run events. The frontend folds these into the run record; nothing in
 * the UI derives a status from log text. `run.done` closes the stream and is
 * kept for the SSE route; the terminal `run.*` event before it carries the
 * state.
 */
export type RunEvent =
  | { type: "snapshot"; run: WorkflowRunRecord }
  | { type: "run.started"; runId: ID; at: ISODate; resumed?: boolean; budget?: RunBudget }
  | { type: "plan.created"; runId: ID; order: ID[]; loops: Record<ID, ID[]>; budget: RunBudget }
  | { type: "node.started"; runId: ID; nodeId: ID; step: WorkflowRunStep; attempt: number; iteration?: RunIteration }
  | { type: "node.progress"; runId: ID; nodeId: ID; label: string; value?: number }
  | { type: "node.log"; runId: ID; nodeId: ID; line: string; at: ISODate }
  | { type: "node.retrying"; runId: ID; nodeId: ID; attempt: number; nextAttempt: number; delayMs: number; failureKind: WorkflowFailureKind; message: string }
  | { type: "node.completed"; runId: ID; nodeId: ID; step: WorkflowRunStep; iteration?: RunIteration }
  | { type: "node.failed"; runId: ID; nodeId: ID; step: WorkflowRunStep; failureKind: WorkflowFailureKind; iteration?: RunIteration }
  | { type: "node.skipped"; runId: ID; nodeId: ID; step: WorkflowRunStep; reason: WorkflowSkipReason; iteration?: RunIteration }
  | { type: "node.cancelled"; runId: ID; nodeId: ID; step: WorkflowRunStep; iteration?: RunIteration }
  | { type: "node.waiting"; runId: ID; nodeId: ID; step: WorkflowRunStep }
  | { type: "node.reset"; runId: ID; nodeId: ID; step: WorkflowRunStep }
  | { type: "tool.started"; runId: ID; nodeId: ID; tool: string; callId?: string }
  | { type: "tool.completed"; runId: ID; nodeId: ID; tool: string; callId?: string; durationMs?: number }
  | { type: "tool.failed"; runId: ID; nodeId: ID; tool: string; callId?: string; durationMs?: number; error: string }
  | { type: "artifact.created"; runId: ID; artifact: RunArtifact }
  | { type: "output.created"; runId: ID; output: RunOutput }
  | { type: "handoff.created"; runId: ID; handoff: RunHandoff }
  | { type: "review.required"; runId: ID; approval: RunApproval }
  | { type: "budget.warning"; runId: ID; dimension: "tokens" | "cost" | "time"; used: number; limit: number }
  | { type: "run.waiting"; runId: ID; nodeId: ID; usage?: RunUsage }
  | RunTerminalEvent
  | { type: "run.done"; runId: ID; status: RunStatus }
  | { type: "error"; message: string; code?: string };

/** Progress/tool/log events an executor may emit through the engine (`x.emit`). */
export type ExecutorEmit =
  | { type: "tool.started"; tool: string; callId?: string }
  | { type: "tool.completed"; tool: string; callId?: string; durationMs?: number }
  | { type: "tool.failed"; tool: string; callId?: string; durationMs?: number; error: string };

/**
 * Runtime context the engine adds to every executor call on top of
 * `ExecContext` (src/modules/workflows/executors.ts). Executors read it with
 * `engineContext(x)`; all fields are optional so older executors keep working.
 */
export interface EngineStepContext {
  /** Idempotency key of this attempt: `<runId>:<nodeId>[:i<iteration>]:<attempt>`. Use it to make side effects idempotent. */
  stepKey: string;
  attempt: number;
  maxAttempts: number;
  /** Remaining budget at the time the step started; long-running executors should bound their own loops with it. */
  budget: { remainingTokens: number; remainingCostUsd: number; remainingMs: number; deadlineAt: ISODate };
  /** Structured tool telemetry (constitution §46); never parsed from log lines. */
  emit: (e: ExecutorEmit) => void;
  /** Telemetry the executor knows and the engine cannot see: provider and model of its model calls. */
  reportModel: (info: { provider?: string; model?: string }) => void;
}

/** Read the engine context from an executor context (undefined for direct executor calls in tests). */
export function engineContext(x: unknown): EngineStepContext | undefined {
  const e = (x as { engine?: EngineStepContext } | null)?.engine;
  return e && typeof e.stepKey === "string" ? e : undefined;
}

/** Extra fields an executor may return next to `output`/`usage` (read by the engine when present). */
export interface ExecResultTelemetry {
  telemetry?: Partial<Pick<WorkflowStepTelemetry, "provider" | "model" | "cacheRead" | "cacheWrite">>;
}

export interface RunStartRequest {
  inputs?: Record<string, unknown>;
  matterId?: string | null;
  triggeredBy?: WorkflowRun["triggeredBy"];
  /** Ids of workflow snapshot nodes to skip (dry-run subsets), rarely used. */
  parentRunId?: string;
  /** Narrow the run's budget below the environment defaults. */
  budget?: Partial<RunBudget>;
}

export interface WorkflowListItem extends Omit<Workflow, "nodes" | "edges"> {
  nodeCount: number;
  nodeTypes: string[];
  usesAI: boolean;
  usesNetwork: boolean;
  hasApproval: boolean;
  /** True when the workflow ships a one-page start form (`workflow.frontend`). */
  hasFrontend: boolean;
  schedule?: ScheduleConfig | null;
  lastRunStatus?: WorkflowRun["status"];
  lastRunId?: ID;
  lastRunError?: string;
  ownerName?: string;
  nextRunAt?: ISODate | null;
}

export interface ScheduleConfig {
  frequency: "hourly" | "daily" | "weekly" | "monthly";
  /** "06:00" (24h, server local time) */
  time?: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday?: number;
  dayOfMonth?: number;
  /** Hourly only: fire every N hours (default 1). */
  interval?: number;
  /** Daily only: skip Saturdays and Sundays. */
  weekdaysOnly?: boolean;
}

export interface WorkflowStats {
  workflows: number;
  templates: number;
  /** System (automation) workflows that power the platform's background work. */
  system: number;
  active: number;
  scheduled: number;
  runs: number;
  runsThisWeek: number;
  succeededThisWeek: number;
  /** Runs that reached the end with failed or failure-skipped steps. */
  partialThisWeek: number;
  /** failed + verification_failed + budget_exhausted. */
  failedThisWeek: number;
  waitingApproval: number;
  running: number;
  successRate: number;
  tokensThisWeek: number;
  costThisWeekUsd: number;
  byCategory: Record<string, number>;
  nextScheduled: { workflowId: string; name: string; at: string; system?: boolean }[];
}

export interface GeneratedWorkflowDraft {
  name: string;
  description: string;
  category: Workflow["category"];
  tags: string[];
  inputs: NonNullable<Workflow["inputs"]>;
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
  notes?: string[];
}

export interface RunFilters { workflowId?: string; status?: string; matterId?: string; triggeredBy?: string; q?: string; limit?: number; offset?: number }

// ─────────────────────────── Labels (lookup tables, never prose parsing) ───────────────────────────

export const RUN_STATUS_LABEL: Record<WorkflowRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  partial: "Partial",
  failed: "Failed",
  cancelled: "Cancelled",
  budget_exhausted: "Budget exhausted",
  verification_failed: "Verification failed",
  waiting_approval: "Waiting for approval",
};

export const STEP_STATUS_LABEL: Record<WorkflowRunStep["status"], string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
  waiting_approval: "Waiting for approval",
};

export const FAILURE_KIND_LABEL: Record<WorkflowFailureKind, string> = {
  no_result: "No result",
  provider_outage: "Provider unavailable",
  rate_limit: "Rate limited",
  timeout: "Timed out",
  cancelled: "Cancelled",
  auth: "Authorization failed",
  malformed_output: "Malformed output",
  incomplete_model_result: "Incomplete model result",
  tool_failure: "Tool failed",
  verification_failed: "Verification failed",
  budget_exhausted: "Budget exhausted",
  not_configured: "Provider not configured",
  step_error: "Step error",
  interrupted: "Interrupted by a restart",
  unknown: "Failed",
};

export const STOP_REASON_LABEL: Record<RunStopReason, string> = {
  completed: "Completed",
  completed_with_failures: "Completed with failures",
  step_failed: "A step failed",
  verification_failed: "Verification failed",
  not_configured: "Model provider not configured",
  budget_tokens: "Token budget exhausted",
  budget_cost: "Cost budget exhausted",
  budget_time: "Time budget exhausted",
  cancelled_by_user: "Stopped",
  approval_rejected: "Approval rejected",
  interrupted: "Interrupted by a restart",
  unknown: "Stopped",
};

export const SKIP_REASON_LABEL: Record<WorkflowSkipReason, string> = {
  inactive_path: "Not on the taken path",
  upstream_failed: "An earlier step failed",
  run_failed: "The run failed",
  run_cancelled: "The run was stopped",
  budget_exhausted: "Budget exhausted",
  trust_gate: "AI output not trusted",
  trust_gate_rejected: "Skipped by the reviewer",
  approval_rejected: "Approval rejected",
  interrupted: "Interrupted by a restart",
};
