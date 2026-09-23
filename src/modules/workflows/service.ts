import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import type { Workflow, WorkflowRun } from "@/lib/types/domain";
import { validateWorkflow, type GraphIssue } from "./graph";
import { nodeSpec } from "./registry";
import { normalizeWorkflowGraph, type WorkflowUpsert } from "./schema";
import { describeSchedule, nextRunAt, normalizeSchedule } from "./schedule";
import { WORKFLOW_CURRENT_USER, type RunFilters, type WorkflowListItem, type WorkflowRunRecord, type WorkflowStats } from "./types";

export interface WorkflowRecord extends Workflow {
  sourceTemplateId?: string;
  version?: number;
}

export interface RunSummary extends Omit<WorkflowRunRecord, "snapshot" | "steps" | "loopIterations"> {
  stepCounts: Record<WorkflowRun["status"] | "pending" | "skipped", number>;
  stepTotal: number;
  matterName?: string;
  triggeredByName?: string;
  currentStep?: string;
}

function ownerName(id?: string) { return id ? db().people.get(id)?.name : undefined; }

export function scheduleOf(w: Workflow) {
  const t = w.nodes.find((n) => n.type === "trigger.schedule");
  if (!t) return null;
  const s = normalizeSchedule(t.config.schedule);
  return s ? { schedule: s, enabled: t.config.enabled !== false, presetInputs: (t.config.presetInputs as Record<string, unknown>) ?? {} } : null;
}

export function toListItem(w: WorkflowRecord, lastRun?: WorkflowRunRecord | null): WorkflowListItem {
  const { nodes, edges, ...rest } = w;
  void edges;
  const specs = nodes.map((n) => nodeSpec(n.type));
  const sched = scheduleOf(w);
  const last = db().kv.get<string>(`wf:schedule:last:${w.id}`);
  const from = last ? new Date(last) : new Date(w.updatedAt);
  return {
    ...rest,
    nodeCount: nodes.length,
    nodeTypes: Array.from(new Set(nodes.map((n) => n.type))),
    usesAI: specs.some((s) => s?.usesAI),
    usesNetwork: specs.some((s) => s?.usesNetwork),
    hasApproval: nodes.some((n) => n.type === "logic.approval"),
    schedule: sched?.schedule ?? null,
    lastRunStatus: lastRun?.status,
    ownerName: ownerName(w.ownerId),
    nextRunAt: sched && sched.enabled && w.status === "active" ? nextRunAt(sched.schedule, from).toISOString() : null,
  };
}

export interface ListWorkflowOptions { template?: boolean; mine?: boolean; category?: string; q?: string; status?: string; tag?: string; limit?: number }

export function listWorkflows(opts: ListWorkflowOptions = {}): WorkflowListItem[] {
  const d = db();
  const q = opts.q?.trim().toLowerCase();
  const lastRuns = new Map<string, WorkflowRunRecord>();
  for (const r of d.workflowRuns.all() as WorkflowRunRecord[]) { const cur = lastRuns.get(r.workflowId); if (!cur || r.startedAt > cur.startedAt) lastRuns.set(r.workflowId, r); }
  return (d.workflows.all() as WorkflowRecord[])
    .filter((w) => (opts.template == null || Boolean(w.isTemplate) === opts.template))
    .filter((w) => (!opts.mine || w.ownerId === WORKFLOW_CURRENT_USER.id))
    .filter((w) => (!opts.category || w.category === opts.category))
    .filter((w) => (!opts.status || w.status === opts.status))
    .filter((w) => (!opts.tag || (w.tags ?? []).includes(opts.tag)))
    .filter((w) => (!q || `${w.name} ${w.description ?? ""} ${(w.tags ?? []).join(" ")} ${w.category}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.isTemplate ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)))
    .slice(0, opts.limit ?? 500)
    .map((w) => toListItem(w, lastRuns.get(w.id)));
}

export function getWorkflow(id: string): WorkflowRecord | null {
  return (db().workflows.get(id) as WorkflowRecord | null) ?? null;
}

export function createWorkflow(input: WorkflowUpsert, opts: { ownerId?: string; sourceTemplateId?: string; id?: string } = {}): { workflow: WorkflowRecord; issues: GraphIssue[] } {
  const now = new Date().toISOString();
  const { nodes, edges } = normalizeWorkflowGraph(input.nodes, input.edges);
  const issues = validateWorkflow(nodes, edges).issues;
  const w: WorkflowRecord = {
    id: opts.id ?? `wf_${nanoid(10)}`,
    name: input.name.trim(),
    description: input.description?.trim(),
    category: input.category,
    nodes, edges,
    inputs: input.inputs ?? [],
    status: input.status ?? "draft",
    ownerId: opts.ownerId ?? WORKFLOW_CURRENT_USER.id,
    createdAt: now,
    updatedAt: now,
    isTemplate: input.isTemplate ?? false,
    runsCount: 0,
    tags: input.tags ?? [],
    sourceTemplateId: opts.sourceTemplateId,
    version: 1,
  };
  db().workflows.put(w);
  return { workflow: w, issues };
}

export function updateWorkflow(id: string, patch: Partial<WorkflowUpsert>): { workflow: WorkflowRecord; issues: GraphIssue[] } | null {
  const d = db();
  const cur = d.workflows.get(id) as WorkflowRecord | null;
  if (!cur) return null;
  const graph = patch.nodes && patch.edges ? normalizeWorkflowGraph(patch.nodes, patch.edges) : { nodes: cur.nodes, edges: cur.edges };
  const issues = validateWorkflow(graph.nodes, graph.edges).issues;
  const status = patch.status ?? cur.status;
  const next: WorkflowRecord = {
    ...cur,
    name: patch.name?.trim() || cur.name,
    description: patch.description !== undefined ? patch.description?.trim() : cur.description,
    category: patch.category ?? cur.category,
    nodes: graph.nodes,
    edges: graph.edges,
    inputs: patch.inputs ?? cur.inputs,
    status,
    tags: patch.tags ?? cur.tags,
    isTemplate: patch.isTemplate ?? cur.isTemplate,
    updatedAt: new Date().toISOString(),
    version: (cur.version ?? 1) + 1,
  };
  d.workflows.put(next);
  return { workflow: next, issues };
}

export function deleteWorkflow(id: string) {
  const d = db();
  const ok = d.workflows.delete(id);
  for (const r of d.workflowRuns.find((r) => r.workflowId === id)) d.workflowRuns.delete(r.id);
  d.kv.delete(`wf:schedule:last:${id}`);
  return ok;
}

/** Clone a template (or any workflow) into a new draft owned by the current user. */
export function cloneWorkflow(id: string, opts: { name?: string; ownerId?: string; status?: Workflow["status"] } = {}): WorkflowRecord | null {
  const src = getWorkflow(id);
  if (!src) return null;
  const { workflow } = createWorkflow(
    { name: opts.name ?? (src.isTemplate ? src.name : `${src.name} (copy)`), description: src.description, category: src.category, nodes: JSON.parse(JSON.stringify(src.nodes)), edges: JSON.parse(JSON.stringify(src.edges)), inputs: src.inputs, status: opts.status ?? "draft", tags: src.tags, isTemplate: false },
    { ownerId: opts.ownerId, sourceTemplateId: src.isTemplate ? src.id : src.sourceTemplateId },
  );
  return workflow;
}

// ─────────────────────────── Runs ───────────────────────────

export function summarizeRun(run: WorkflowRunRecord): RunSummary {
  const { snapshot, steps, loopIterations, ...rest } = run;
  void snapshot; void loopIterations;
  const stepCounts: RunSummary["stepCounts"] = { pending: 0, running: 0, succeeded: 0, failed: 0, skipped: 0, waiting_approval: 0, queued: 0, cancelled: 0 };
  for (const s of steps) stepCounts[s.status] = (stepCounts[s.status] ?? 0) + 1;
  const d = db();
  const current = steps.find((s) => s.status === "running" || s.status === "waiting_approval");
  const w = d.workflows.get(run.workflowId);
  return {
    ...rest,
    workflowName: run.workflowName ?? w?.name ?? run.workflowId,
    workflowCategory: run.workflowCategory ?? w?.category,
    stepCounts,
    stepTotal: steps.length,
    matterName: run.matterId ? d.matters.get(run.matterId)?.shortName : undefined,
    triggeredByName: run.triggeredById ? d.people.get(run.triggeredById)?.name : undefined,
    currentStep: current ? (run.snapshot?.nodes ?? w?.nodes ?? []).find((n) => n.id === current.nodeId)?.label ?? current.nodeId : undefined,
    artifacts: run.artifacts?.slice(0, 20),
  };
}

export function listRuns(filters: RunFilters = {}): { runs: RunSummary[]; total: number } {
  const d = db();
  const q = filters.q?.trim().toLowerCase();
  let runs = (d.workflowRuns.all() as WorkflowRunRecord[])
    .filter((r) => (!filters.workflowId || r.workflowId === filters.workflowId))
    .filter((r) => (!filters.status || r.status === filters.status))
    .filter((r) => (!filters.matterId || r.matterId === filters.matterId))
    .filter((r) => (!filters.triggeredBy || r.triggeredBy === filters.triggeredBy))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (q) runs = runs.filter((r) => `${r.workflowName ?? ""} ${r.id} ${r.error ?? ""} ${JSON.stringify(r.inputs).slice(0, 2000)}`.toLowerCase().includes(q));
  const total = runs.length;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;
  return { runs: runs.slice(offset, offset + limit).map(summarizeRun), total };
}

export function getRun(id: string): WorkflowRunRecord | null {
  return (db().workflowRuns.get(id) as WorkflowRunRecord | null) ?? null;
}

export function deleteRun(id: string) {
  return db().workflowRuns.delete(id);
}

// ─────────────────────────── Stats & meta ───────────────────────────

export function workflowStats(): WorkflowStats {
  const d = db();
  const workflows = d.workflows.all() as WorkflowRecord[];
  const runs = d.workflowRuns.all() as WorkflowRunRecord[];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const thisWeek = runs.filter((r) => r.startedAt >= weekAgo);
  const finished = runs.filter((r) => r.status === "succeeded" || r.status === "failed");
  const byCategory: Record<string, number> = {};
  for (const w of workflows) byCategory[w.category] = (byCategory[w.category] ?? 0) + 1;
  const nextScheduled = workflows
    .filter((w) => w.status === "active" && !w.isTemplate)
    .map((w) => { const s = scheduleOf(w); if (!s || !s.enabled) return null; const last = d.kv.get<string>(`wf:schedule:last:${w.id}`); return { workflowId: w.id, name: w.name, at: nextRunAt(s.schedule, last ? new Date(last) : new Date(w.updatedAt)).toISOString() }; })
    .filter((x): x is { workflowId: string; name: string; at: string } => Boolean(x))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 5);
  return {
    workflows: workflows.filter((w) => !w.isTemplate).length,
    templates: workflows.filter((w) => w.isTemplate).length,
    active: workflows.filter((w) => !w.isTemplate && w.status === "active").length,
    scheduled: nextScheduled.length,
    runs: runs.length,
    runsThisWeek: thisWeek.length,
    succeededThisWeek: thisWeek.filter((r) => r.status === "succeeded").length,
    failedThisWeek: thisWeek.filter((r) => r.status === "failed").length,
    waitingApproval: runs.filter((r) => r.status === "waiting_approval").length,
    running: runs.filter((r) => r.status === "running" || r.status === "queued").length,
    successRate: finished.length ? Math.round((finished.filter((r) => r.status === "succeeded").length / finished.length) * 100) : 0,
    tokensThisWeek: thisWeek.reduce((a, r) => a + (r.usage?.total ?? 0), 0),
    costThisWeekUsd: Number(thisWeek.reduce((a, r) => a + (r.usage?.costUsd ?? 0), 0).toFixed(2)),
    byCategory,
    nextScheduled,
  };
}

export function workflowMeta() {
  const d = db();
  return {
    aiConfigured: aiConfig().hasKey,
    model: aiConfig().model,
    fastModel: aiConfig().fastModel,
    people: d.people.find((p) => ["attorney", "paralegal", "staff"].includes(p.role)).map((p) => ({ id: p.id, name: p.name, title: p.title, role: p.role })),
    matters: d.matters.all().map((m) => ({ id: m.id, name: m.name, shortName: m.shortName, client: m.client, status: m.status, practiceArea: m.practiceArea })),
    scheduleDescriptions: Object.fromEntries((d.workflows.all() as WorkflowRecord[]).map((w) => [w.id, describeSchedule(scheduleOf(w)?.schedule)])),
  };
}
