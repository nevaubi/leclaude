/**
 * Pure helpers for the Start page (WorkflowFrontendPage) and the builder's
 * Front end tab. No React, no server imports: tested directly.
 */
import type { Workflow, WorkflowEdge, WorkflowFrontend, WorkflowFrontendField, WorkflowNode } from "@/lib/types/domain";
import { executionPlan } from "../../graph";
import { nodeSpec } from "../../registry";
import { fieldDefault, OUTPUT_FORMATS, OUTPUT_INPUT_KEYS, type OutputFormat } from "../../frontend";
import { nodeSummary } from "../node-summary";

export interface OutputChoice { format: OutputFormat | ""; label: string; folderId: string }

/** True when the workflow renders a deliverable, so the Start page shows the Output section. */
export function hasOutputStep(nodes: Pick<WorkflowNode, "type">[]): boolean {
  return nodes.some((n) => n.type === "output.file" || n.type === "action.save_document" || n.type === "action.export");
}

/** The formats the Start page offers: the front end's list, else every format. */
export function outputFormats(frontend: WorkflowFrontend | null | undefined): OutputFormat[] {
  const list = frontend?.output?.formats?.filter((f): f is OutputFormat => (OUTPUT_FORMATS as string[]).includes(f)) ?? [];
  return list.length ? list : [...OUTPUT_FORMATS];
}

/** Initial field values for the form (front-end defaults, then type defaults). */
export function initialFieldValues(frontend: Pick<WorkflowFrontend, "fields"> | null | undefined, presets: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of frontend?.fields ?? []) out[f.key] = presets[f.key] !== undefined ? presets[f.key] : fieldDefault(f);
  return out;
}

/** Initial output choice: the front end's default format/label/folder, else the first offered format. */
export function initialOutputChoice(frontend: WorkflowFrontend | null | undefined): OutputChoice {
  const formats = outputFormats(frontend);
  const def = frontend?.output?.defaultFormat;
  return { format: def && formats.includes(def) ? def : formats[0] ?? "", label: frontend?.output?.defaultLabel ?? "", folderId: frontend?.output?.libraryFolderId ?? "" };
}

/**
 * Values the page sends to `mapFrontendValues`: field values plus the output
 * section under the reserved keys. A field of type output-format / label /
 * library-folder already carries the choice, so the section is skipped then.
 */
export function withOutputValues(frontend: Pick<WorkflowFrontend, "fields"> | null | undefined, values: Record<string, unknown>, output: OutputChoice | null): Record<string, unknown> {
  if (!output) return { ...values };
  const fields = frontend?.fields ?? [];
  const has = (t: WorkflowFrontendField["type"]) => fields.some((f) => f.type === t);
  const out = { ...values };
  if (!has("output-format") && output.format) out[OUTPUT_INPUT_KEYS.format] = output.format;
  if (!has("label") && output.label.trim()) out[OUTPUT_INPUT_KEYS.label] = output.label.trim();
  if (!has("library-folder") && output.folderId) out[OUTPUT_INPUT_KEYS.folder] = output.folderId;
  return out;
}

export interface StepPreview { id: string; label: string; type: string; short: string; summary: string; depth: number; usesAI: boolean; usesNetwork: boolean; approval: boolean }

/** The ordered "what happens" list: nodes in execution order (loop bodies indented), triggers excluded. */
export function stepPreviews(nodes: WorkflowNode[], edges: WorkflowEdge[]): StepPreview[] {
  const rows: StepPreview[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const push = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n || n.type.startsWith("trigger.")) return;
    const spec = nodeSpec(n.type);
    rows.push({ id, label: n.label, type: n.type, short: spec?.short ?? n.type, summary: nodeSummary(n.type, n.config ?? {}), depth, usesAI: Boolean(spec?.usesAI), usesNetwork: Boolean(spec?.usesNetwork), approval: n.type === "logic.approval" || n.type === "logic.review" });
  };
  try {
    const plan = executionPlan(nodes, edges);
    const walk = (ids: string[], depth: number) => { for (const id of ids) { push(id, depth); const loop = plan.loops[id]; if (loop) walk(loop.bodyOrder, depth + 1); } };
    walk(plan.order, 0);
    for (const n of nodes) if (!rows.some((r) => r.id === n.id)) push(n.id, 0);
  } catch {
    for (const n of nodes) push(n.id, 0);
  }
  return rows;
}

/** One line describing the front end's after-run settings, for the Start page footer. */
export function describeAfter(frontend: WorkflowFrontend | null | undefined, workflowNames: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const after = frontend?.after;
  if (after?.createTask?.title) out.push(`Creates the task "${after.createTask.title}"${after.createTask.dueRule ? ` (due ${after.createTask.dueRule})` : ""}.`);
  for (const id of after?.triggerWorkflowIds ?? []) out.push(`Then starts "${workflowNames[id] ?? id}".`);
  if (frontend?.output?.notifyPeopleIds?.length) out.push(`Notifies ${frontend.output.notifyPeopleIds.length} ${frontend.output.notifyPeopleIds.length === 1 ? "person" : "people"} when done.`);
  return out;
}

/** Group heading + fields in order (mirrors frontend.groupFields but also names an untitled first group). */
export function sections(frontend: Pick<WorkflowFrontend, "fields"> | null | undefined): { group: string | undefined; fields: WorkflowFrontendField[] }[] {
  const out: { group: string | undefined; fields: WorkflowFrontendField[] }[] = [];
  for (const f of frontend?.fields ?? []) {
    const last = out[out.length - 1];
    if (last && last.group === f.group) last.fields.push(f); else out.push({ group: f.group, fields: [f] });
  }
  return out;
}

/** Keyboard-friendly id for a field control. */
export function fieldControlId(key: string): string { return `fe_${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`; }

export type StartableWorkflow = Pick<Workflow, "id" | "name" | "description" | "nodes" | "edges" | "inputs" | "frontend" | "isTemplate" | "system" | "status" | "category">;
