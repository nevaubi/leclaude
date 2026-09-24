/** Client-safe types shared by the workflows engine, API routes, hooks and UI. */
import type { ID, ISODate, Workflow, WorkflowRun, WorkflowRunStep } from "@/lib/types/domain";
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

export interface RunUsage { input: number; output: number; total: number; calls: number; costUsd: number }

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
}

export type RunEvent =
  | { type: "snapshot"; run: WorkflowRunRecord }
  | { type: "run.status"; runId: ID; status: WorkflowRun["status"]; error?: string; errorCode?: string; finishedAt?: ISODate; usage?: RunUsage }
  | { type: "step.status"; runId: ID; nodeId: ID; step: WorkflowRunStep; iteration?: { loopId: ID; index: number; count: number } }
  | { type: "step.log"; runId: ID; nodeId: ID; line: string; at: ISODate }
  | { type: "step.progress"; runId: ID; nodeId: ID; label: string; value?: number }
  | { type: "artifact"; runId: ID; artifact: RunArtifact }
  | { type: "handoff"; runId: ID; handoff: RunHandoff }
  | { type: "output"; runId: ID; output: RunOutput }
  | { type: "approval.requested"; runId: ID; approval: RunApproval }
  | { type: "run.done"; runId: ID; status: WorkflowRun["status"] }
  | { type: "error"; message: string; code?: string };

export interface RunStartRequest {
  inputs?: Record<string, unknown>;
  matterId?: string | null;
  triggeredBy?: WorkflowRun["triggeredBy"];
  /** Ids of workflow snapshot nodes to skip (dry-run subsets), rarely used. */
  parentRunId?: string;
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

export const RUN_STATUS_LABEL: Record<WorkflowRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  waiting_approval: "Waiting for approval",
};

export const STEP_STATUS_LABEL: Record<WorkflowRunStep["status"], string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  waiting_approval: "Waiting for approval",
};
