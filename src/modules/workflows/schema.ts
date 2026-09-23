/**
 * Zod schemas for workflow persistence and the AI builder, plus the JSON
 * Schema handed to generateJSON. Client-safe.
 */
import { z } from "zod";
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowNodeType } from "@/lib/types/domain";
import { KNOWN_NODE_TYPES, defaultConfigFor, isTriggerType } from "./registry";
import { validateWorkflow } from "./graph";

export const workflowCategorySchema = z.enum(["intake", "discovery", "drafting", "research", "compliance", "transactional", "operations"]);

export const workflowInputSchema = z.object({
  key: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "keys must be identifiers"),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "file", "matter", "select", "number", "date"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});

export const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().refine((t) => (KNOWN_NODE_TYPES as string[]).includes(t), { message: "unknown node type" }),
  label: z.string().min(1).max(120),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional().nullable(),
  targetHandle: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
});

export const workflowUpsertSchema = z.object({
  name: z.string().min(1).max(140),
  description: z.string().max(2000).optional(),
  category: workflowCategorySchema,
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  inputs: z.array(workflowInputSchema).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
  isTemplate: z.boolean().optional(),
});

export type WorkflowUpsert = z.infer<typeof workflowUpsertSchema>;

export const runStartSchema = z.object({
  inputs: z.record(z.string(), z.unknown()).optional(),
  matterId: z.string().nullable().optional(),
  triggeredBy: z.enum(["manual", "schedule", "event", "api"]).optional(),
});

export const approvalSchema = z.object({ approved: z.boolean(), comment: z.string().max(4000).optional() });

export const generateRequestSchema = z.object({ description: z.string().min(8).max(6000), category: workflowCategorySchema.optional(), matterId: z.string().optional() });

/** Normalize edges (null → undefined) and node configs (fill defaults). */
export function normalizeWorkflowGraph(nodes: z.infer<typeof nodeSchema>[], edges: z.infer<typeof edgeSchema>[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const outNodes: WorkflowNode[] = nodes.map((n) => ({
    id: n.id,
    type: n.type as WorkflowNodeType,
    label: n.label,
    position: n.position,
    config: { ...defaultConfigFor(n.type as WorkflowNodeType), ...n.config },
  }));
  const outEdges: WorkflowEdge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined, label: e.label ?? undefined }));
  return { nodes: outNodes, edges: outEdges };
}

// ─────────────────────────── AI builder schema ───────────────────────────

/** JSON Schema constrained to known node types for generateJSON (strict mode friendly). */
export const GENERATED_WORKFLOW_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short workflow name (≤ 8 words)" },
    description: { type: "string", description: "One or two sentences on what it does and when to use it" },
    category: { type: "string", enum: ["intake", "discovery", "drafting", "research", "compliance", "transactional", "operations"] },
    tags: { type: "array", items: { type: "string" } },
    inputs: {
      type: "array",
      description: "Inputs the user fills in when running the workflow",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "snake_case identifier" },
          label: { type: "string" },
          type: { type: "string", enum: ["text", "textarea", "file", "matter", "select", "number", "date"] },
          required: { type: "boolean" },
          options: { type: "array", items: { type: "string" }, description: "Only for select inputs" },
          placeholder: { type: "string" },
        },
        required: ["key", "label", "type", "required"],
      },
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "snake_case id, unique, referenced by edges and templates (e.g. 'extract', 'classify')" },
          type: { type: "string", enum: KNOWN_NODE_TYPES },
          label: { type: "string" },
          configJson: { type: "string", description: "JSON object string with the node's config keys for its type (see the config reference). Use {{inputs.key}} and {{steps.<id>.output.<path>}} expressions." },
        },
        required: ["id", "type", "label", "configJson"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          sourceHandle: { type: "string", description: "Only for branch rule ids / 'else', loop 'each' / 'done', approval 'approved' / 'rejected'; otherwise empty string" },
          targetHandle: { type: "string", description: "'loop-back' when connecting the last loop body node back to the loop; otherwise empty string" },
        },
        required: ["source", "target", "sourceHandle", "targetHandle"],
      },
    },
    notes: { type: "array", items: { type: "string" }, description: "Assumptions or things the user should configure before running" },
  },
  required: ["name", "description", "category", "tags", "inputs", "nodes", "edges", "notes"],
};

export interface GeneratedRaw {
  name: string; description: string; category: string; tags: string[];
  inputs: { key: string; label: string; type: string; required?: boolean | null; options?: string[] | null; placeholder?: string | null }[];
  nodes: { id: string; type: string; label: string; configJson: string }[];
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[];
  notes?: string[] | null;
}

const generatedRawSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  inputs: z.array(z.object({ key: z.string(), label: z.string(), type: z.string(), required: z.boolean().nullable().optional(), options: z.array(z.string()).nullable().optional(), placeholder: z.string().nullable().optional() })).default([]),
  nodes: z.array(z.object({ id: z.string(), type: z.string(), label: z.string(), configJson: z.string().default("{}") })),
  edges: z.array(z.object({ source: z.string(), target: z.string(), sourceHandle: z.string().nullable().optional(), targetHandle: z.string().nullable().optional() })),
  notes: z.array(z.string()).nullable().optional(),
});

export interface ValidatedDraft {
  name: string; description: string; category: Workflow["category"]; tags: string[];
  inputs: NonNullable<Workflow["inputs"]>; nodes: WorkflowNode[]; edges: WorkflowEdge[]; notes: string[];
  issues: { level: "error" | "warning"; message: string }[];
}

/**
 * Validate and normalize a generated draft: unknown node types, bad inputs and
 * dangling edges are rejected with explicit errors; positions are assigned later.
 */
export function validateGeneratedDraft(raw: unknown): { ok: true; draft: ValidatedDraft } | { ok: false; errors: string[] } {
  const parsed = generatedRawSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const errors: string[] = [];
  const d = parsed.data;
  const category = workflowCategorySchema.safeParse(d.category).success ? (d.category as Workflow["category"]) : "operations";
  const seen = new Set<string>();
  const nodes: WorkflowNode[] = [];
  for (const n of d.nodes) {
    if (!(KNOWN_NODE_TYPES as string[]).includes(n.type)) { errors.push(`Unknown node type "${n.type}" on node "${n.id}"`); continue; }
    if (seen.has(n.id)) { errors.push(`Duplicate node id "${n.id}"`); continue; }
    seen.add(n.id);
    let config: Record<string, unknown> = {};
    try { const c = JSON.parse(n.configJson || "{}"); if (c && typeof c === "object" && !Array.isArray(c)) config = c as Record<string, unknown>; } catch { errors.push(`Node "${n.id}": configJson is not valid JSON`); }
    nodes.push({ id: n.id, type: n.type as WorkflowNodeType, label: n.label || n.id, position: { x: 0, y: 0 }, config: { ...defaultConfigFor(n.type as WorkflowNodeType), ...config } });
  }
  const edges: WorkflowEdge[] = [];
  d.edges.forEach((e, i) => {
    if (!seen.has(e.source) || !seen.has(e.target)) { errors.push(`Edge ${e.source} → ${e.target} references a missing node`); return; }
    edges.push({ id: `e${i + 1}_${e.source}_${e.target}`, source: e.source, target: e.target, sourceHandle: e.sourceHandle || undefined, targetHandle: e.targetHandle || undefined });
  });
  const inputs: NonNullable<Workflow["inputs"]> = [];
  for (const inp of d.inputs) {
    const r = workflowInputSchema.safeParse({ key: inp.key, label: inp.label, type: inp.type, required: inp.required ?? undefined, options: inp.options ?? undefined, placeholder: inp.placeholder ?? undefined });
    if (r.success) inputs.push(r.data); else errors.push(`Input "${inp.key}": ${r.error.issues[0]?.message}`);
  }
  if (!nodes.some((n) => isTriggerType(n.type))) errors.push("The draft has no trigger node");
  if (errors.length) return { ok: false, errors };
  const v = validateWorkflow(nodes, edges);
  if (!v.ok) return { ok: false, errors: v.issues.filter((i) => i.level === "error").map((i) => i.message) };
  return { ok: true, draft: { name: d.name, description: d.description, category, tags: d.tags, inputs, nodes, edges, notes: d.notes ?? [], issues: v.issues.map((i) => ({ level: i.level, message: i.message })) } };
}
