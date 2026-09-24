import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import type { Workflow, WorkflowFrontend, WorkflowRun } from "@/lib/types/domain";
import { intelSources } from "@/modules/intel/store";
import { syncInputsFromFrontend } from "./frontend";
import { validateWorkflow, type GraphIssue } from "./graph";
import { nodeSpec } from "./registry";
import { normalizeWorkflowGraph, type WorkflowUpsert } from "./schema";
import { describeSchedule, nextRunAt, normalizeSchedule } from "./schedule";
import { WORKFLOW_AGENTS, WORKFLOW_CURRENT_USER, type RunFilters, type WorkflowListItem, type WorkflowRunRecord, type WorkflowStats } from "./types";

export interface WorkflowRecord extends Workflow {
  sourceTemplateId?: string;
  version?: number;
}

/** Normalize a front end coming from the API: drop empty groups, keep field order, never trust `default` beyond JSON. */
function normalizeFrontend(f: WorkflowFrontend | null | undefined): WorkflowFrontend | undefined {
  if (!f) return undefined;
  return {
    title: f.title.trim() || "Start",
    intro: f.intro?.trim() || undefined,
    fields: f.fields.map((x) => ({ ...x, key: x.key.trim(), label: x.label.trim(), group: x.group?.trim() || undefined, help: x.help?.trim() || undefined, placeholder: x.placeholder?.trim() || undefined, options: x.options?.map((o) => o.trim()).filter(Boolean), accept: x.accept?.map((a) => a.trim()).filter(Boolean) })),
    submitLabel: f.submitLabel?.trim() || undefined,
    output: f.output ? { ...f.output, defaultLabel: f.output.defaultLabel?.trim() || undefined, libraryFolderId: f.output.libraryFolderId?.trim() || undefined } : undefined,
    after: f.after ? { triggerWorkflowIds: f.after.triggerWorkflowIds?.filter(Boolean), createTask: f.after.createTask?.title?.trim() ? { ...f.after.createTask, title: f.after.createTask.title.trim() } : undefined } : undefined,
  };
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
    hasFrontend: Boolean(w.frontend?.fields?.length),
    schedule: sched?.schedule ?? null,
    lastRunStatus: lastRun?.status,
    lastRunId: lastRun?.id,
    lastRunError: lastRun?.error,
    lastRunAt: lastRun?.startedAt ?? w.lastRunAt,
    ownerName: ownerName(w.ownerId),
    nextRunAt: sched && sched.enabled && w.status === "active" ? nextRunAt(sched.schedule, from).toISOString() : null,
  };
}

export interface ListWorkflowOptions { template?: boolean; mine?: boolean; category?: string; q?: string; status?: string; tag?: string; limit?: number; /** true: only system (automation) workflows; false: exclude them; undefined: both. */ system?: boolean }

export function listWorkflows(opts: ListWorkflowOptions = {}): WorkflowListItem[] {
  const d = db();
  const q = opts.q?.trim().toLowerCase();
  const lastRuns = new Map<string, WorkflowRunRecord>();
  for (const r of d.workflowRuns.all() as WorkflowRunRecord[]) { const cur = lastRuns.get(r.workflowId); if (!cur || r.startedAt > cur.startedAt) lastRuns.set(r.workflowId, r); }
  return (d.workflows.all() as WorkflowRecord[])
    .filter((w) => (opts.template == null || Boolean(w.isTemplate) === opts.template))
    .filter((w) => (opts.system == null || Boolean(w.system) === opts.system))
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
  const frontend = normalizeFrontend(input.frontend as WorkflowFrontend | null | undefined);
  const w: WorkflowRecord = {
    id: opts.id ?? `wf_${nanoid(10)}`,
    name: input.name.trim(),
    description: input.description?.trim(),
    category: input.category,
    nodes, edges,
    inputs: input.inputs ?? (frontend ? syncInputsFromFrontend(frontend) : []),
    frontend,
    status: input.status ?? "draft",
    ownerId: opts.ownerId ?? WORKFLOW_CURRENT_USER.id,
    createdAt: now,
    updatedAt: now,
    isTemplate: input.isTemplate ?? false,
    system: input.system ?? undefined,
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
  // `frontend: null` removes it; a new front end also refreshes the legacy inputs list unless the patch sets inputs itself.
  const frontend = patch.frontend === undefined ? cur.frontend : normalizeFrontend(patch.frontend as WorkflowFrontend | null);
  const inputs = patch.inputs ?? (patch.frontend ? syncInputsFromFrontend(frontend!) : cur.inputs);
  const next: WorkflowRecord = {
    ...cur,
    name: patch.name?.trim() || cur.name,
    description: patch.description !== undefined ? patch.description?.trim() : cur.description,
    category: patch.category ?? cur.category,
    nodes: graph.nodes,
    edges: graph.edges,
    inputs,
    frontend,
    status,
    tags: patch.tags ?? cur.tags,
    isTemplate: patch.isTemplate ?? cur.isTemplate,
    system: patch.system ?? cur.system,
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

/** Clone a template (or any workflow) into a new draft owned by the current user. The front end travels with it; the system flag does not. */
export function cloneWorkflow(id: string, opts: { name?: string; ownerId?: string; status?: Workflow["status"] } = {}): WorkflowRecord | null {
  const src = getWorkflow(id);
  if (!src) return null;
  const { workflow } = createWorkflow(
    { name: opts.name ?? (src.isTemplate ? src.name : `${src.name} (copy)`), description: src.description, category: src.category, nodes: JSON.parse(JSON.stringify(src.nodes)), edges: JSON.parse(JSON.stringify(src.edges)), inputs: src.inputs, frontend: src.frontend ? JSON.parse(JSON.stringify(src.frontend)) : undefined, status: opts.status ?? "draft", tags: src.tags, isTemplate: false },
    { ownerId: opts.ownerId, sourceTemplateId: src.isTemplate ? src.id : src.sourceTemplateId },
  );
  return workflow;
}

/**
 * The user's own copy of a template for the Start page: an existing, non-archived
 * clone owned by them when there is one, otherwise a fresh active clone. Running
 * the template itself would attach run history to the shared template.
 */
export function workflowForTemplate(templateId: string, opts: { ownerId?: string } = {}): WorkflowRecord | null {
  const src = getWorkflow(templateId);
  if (!src) return null;
  if (!src.isTemplate) return src;
  const ownerId = opts.ownerId ?? WORKFLOW_CURRENT_USER.id;
  const existing = (db().workflows.find((w) => !w.isTemplate && w.status !== "archived" && (w as WorkflowRecord).sourceTemplateId === templateId && w.ownerId === ownerId) as WorkflowRecord[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (existing) return existing;
  return cloneWorkflow(templateId, { ownerId, status: "active" });
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
  type Next = { workflowId: string; name: string; at: string; system?: boolean };
  const nextScheduled: Next[] = [];
  for (const w of workflows) {
    if (w.status !== "active" || w.isTemplate) continue;
    const s = scheduleOf(w);
    if (!s || !s.enabled) continue;
    const last = d.kv.get<string>(`wf:schedule:last:${w.id}`);
    nextScheduled.push({ workflowId: w.id, name: w.name, at: nextRunAt(s.schedule, last ? new Date(last) : new Date(w.updatedAt)).toISOString(), system: w.system || undefined });
  }
  nextScheduled.sort((a, b) => a.at.localeCompare(b.at)).splice(8);
  return {
    workflows: workflows.filter((w) => !w.isTemplate && !w.system).length,
    templates: workflows.filter((w) => w.isTemplate).length,
    system: workflows.filter((w) => w.system && !w.isTemplate).length,
    active: workflows.filter((w) => !w.isTemplate && !w.system && w.status === "active").length,
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
  let sources: { id: string; name: string; adapter: string; enabled: boolean }[] = [];
  try { sources = intelSources().all().map((s) => ({ id: s.id, name: s.name, adapter: s.adapter, enabled: s.enabled })).sort((a, b) => a.name.localeCompare(b.name)); } catch { sources = []; }
  return {
    aiConfigured: aiConfig().hasKey,
    model: aiConfig().model,
    fastModel: aiConfig().fastModel,
    people: d.people.find((p) => ["attorney", "paralegal", "staff"].includes(p.role)).map((p) => ({ id: p.id, name: p.name, title: p.title, role: p.role })),
    matters: d.matters.all().map((m) => ({ id: m.id, name: m.name, shortName: m.shortName, client: m.client, status: m.status, practiceArea: m.practiceArea })),
    scheduleDescriptions: Object.fromEntries((d.workflows.all() as WorkflowRecord[]).map((w) => [w.id, describeSchedule(scheduleOf(w)?.schedule)])),
    /** Workflows a step can start (logic.schedule_after) or a front end can chain to (after.triggerWorkflowIds). */
    workflows: (d.workflows.all() as WorkflowRecord[]).filter((w) => !w.isTemplate).map((w) => ({ id: w.id, name: w.name, status: w.status, system: Boolean(w.system), hasFrontend: Boolean(w.frontend?.fields?.length) })).sort((a, b) => a.name.localeCompare(b.name)),
    /** Intelligence sources for intel.fetch. */
    intelSources: sources,
    agents: WORKFLOW_AGENTS,
  };
}
