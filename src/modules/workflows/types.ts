/** Client-safe types shared by the workflows engine, API routes, hooks and UI. */
import type { ID, ISODate, Workflow, WorkflowRun, WorkflowRunStep } from "@/lib/types/domain";

export const WORKFLOW_CURRENT_USER = { id: "p_jwhitfield", name: "Jordan Whitfield" } as const;

export interface RunArtifact {
  kind: "task" | "event" | "document" | "library" | "file" | "notification" | "coding";
  id: ID;
  title: string;
  href?: string;
  nodeId: ID;
  meta?: Record<string, unknown>;
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
  snapshot?: { nodes: Workflow["nodes"]; edges: Workflow["edges"]; inputs?: Workflow["inputs"] };
}

export type RunEvent =
  | { type: "snapshot"; run: WorkflowRunRecord }
  | { type: "run.status"; runId: ID; status: WorkflowRun["status"]; error?: string; errorCode?: string; finishedAt?: ISODate; usage?: RunUsage }
  | { type: "step.status"; runId: ID; nodeId: ID; step: WorkflowRunStep; iteration?: { loopId: ID; index: number; count: number } }
  | { type: "step.log"; runId: ID; nodeId: ID; line: string; at: ISODate }
  | { type: "step.progress"; runId: ID; nodeId: ID; label: string; value?: number }
  | { type: "artifact"; runId: ID; artifact: RunArtifact }
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
  schedule?: ScheduleConfig | null;
  lastRunStatus?: WorkflowRun["status"];
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
}

export interface WorkflowStats {
  workflows: number;
  templates: number;
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
  nextScheduled: { workflowId: string; name: string; at: string }[];
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
