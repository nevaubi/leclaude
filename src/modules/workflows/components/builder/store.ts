"use client";
import { create } from "zustand";
import { nanoid } from "nanoid";
import { applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from "@xyflow/react";
import type { Workflow, WorkflowEdge, WorkflowFrontend, WorkflowNode, WorkflowNodeType, WorkflowRunStep } from "@/lib/types/domain";
import { autoLayout, validateWorkflow, type GraphIssue } from "../../graph";
import { defaultConfigFor, nodeSpec } from "../../registry";
import { referencedStepIds } from "../../template-expr";

export interface WfNodeData extends Record<string, unknown> {
  wfType: WorkflowNodeType;
  label: string;
  config: Record<string, unknown>;
}
export type WfNode = Node<WfNodeData, "wf">;
export type WfEdge = Edge;

export interface WorkflowMeta {
  name: string;
  description: string;
  category: Workflow["category"];
  status: Workflow["status"];
  tags: string[];
  inputs: NonNullable<Workflow["inputs"]>;
  isTemplate: boolean;
  ownerId?: string;
  /** The one-page start form (null: none; the run dialog is generated from `inputs`). */
  frontend: WorkflowFrontend | null;
  system?: boolean;
}

interface Snapshot { nodes: WfNode[]; edges: WfEdge[] }

export interface BuilderState {
  workflowId: string;
  meta: WorkflowMeta;
  nodes: WfNode[];
  edges: WfEdge[];
  selectedNodeId: string | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  clipboard: Snapshot | null;
  stepStatuses: Record<string, WorkflowRunStep["status"]>;
  issues: GraphIssue[];
  lastCommitKey: string | null;
  lastCommitAt: number;

  init: (w: Workflow) => void;
  onNodesChange: (changes: NodeChange<WfNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<WfEdge>[]) => void;
  connect: (c: Connection) => void;
  commit: (key?: string) => void;
  addNode: (type: WorkflowNodeType, position: { x: number; y: number }, opts?: { select?: boolean; connectFrom?: string | null }) => string;
  updateNodeConfig: (id: string, patch: Record<string, unknown> | ((c: Record<string, unknown>) => Record<string, unknown>)) => void;
  updateNodeLabel: (id: string, label: string) => void;
  renameNodeId: (id: string, nextId: string) => boolean;
  removeNodes: (ids: string[]) => void;
  removeEdges: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
  copy: (ids?: string[]) => void;
  paste: () => void;
  undo: () => void;
  redo: () => void;
  layout: () => void;
  select: (id: string | null) => void;
  setMeta: (patch: Partial<WorkflowMeta>) => void;
  setStepStatuses: (s: Record<string, WorkflowRunStep["status"]>) => void;
  markSaved: (at: string) => void;
  setSaving: (v: boolean) => void;
  toDomain: () => { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
  validate: () => GraphIssue[];
}

export function fromDomain(nodes: WorkflowNode[], edges: WorkflowEdge[]): Snapshot {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: "wf" as const, position: n.position, data: { wfType: n.type, label: n.label, config: n.config }, selected: false })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined, label: e.label, type: "wf" })),
  };
}

export function toDomainGraph(nodes: WfNode[], edges: WfEdge[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.wfType, label: n.data.label, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, config: n.data.config })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined, label: typeof e.label === "string" ? e.label : undefined })),
  };
}

/** Readable ids like "extract", "extract_2" — templates reference them. */
export function nodeIdFor(type: WorkflowNodeType, existing: Set<string>): string {
  const spec = nodeSpec(type);
  const base = (spec?.short ?? type.split(".")[1] ?? "step").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "step";
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function edgeId(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null) {
  return `e_${source}__${target}${sourceHandle ? `__${sourceHandle}` : ""}${targetHandle ? `__${targetHandle}` : ""}`;
}

const MAX_HISTORY = 100;

/** Rewrite {{steps.old.…}} references to a renamed node id across all configs. */
function rewriteRefs(nodes: WfNode[], oldId: string, newId: string): WfNode[] {
  const re = new RegExp(`(\\{\\{\\s*steps\\.)${oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s.|}\\[])`, "g");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, `$1${newId}`);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return nodes.map((n) => (referencedStepIds(n.data.config).includes(oldId) ? { ...n, data: { ...n.data, config: walk(n.data.config) as Record<string, unknown> } } : n));
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  workflowId: "",
  meta: { name: "", description: "", category: "operations", status: "draft", tags: [], inputs: [], isTemplate: false, frontend: null },
  nodes: [],
  edges: [],
  selectedNodeId: null,
  past: [],
  future: [],
  dirty: false,
  saving: false,
  lastSavedAt: null,
  clipboard: null,
  stepStatuses: {},
  issues: [],
  lastCommitKey: null,
  lastCommitAt: 0,

  init: (w) => {
    const snap = fromDomain(w.nodes, w.edges);
    set({
      workflowId: w.id,
      meta: { name: w.name, description: w.description ?? "", category: w.category, status: w.status, tags: w.tags ?? [], inputs: w.inputs ?? [], isTemplate: Boolean(w.isTemplate), ownerId: w.ownerId, frontend: w.frontend?.fields ? JSON.parse(JSON.stringify(w.frontend)) : null, system: Boolean(w.system) },
      nodes: snap.nodes,
      edges: snap.edges,
      selectedNodeId: null,
      past: [],
      future: [],
      dirty: false,
      saving: false,
      lastSavedAt: w.updatedAt,
      stepStatuses: {},
      issues: validateWorkflow(w.nodes, w.edges).issues,
      lastCommitKey: null,
      lastCommitAt: 0,
    });
  },

  onNodesChange: (changes) => {
    const nodes = applyNodeChanges(changes, get().nodes);
    const sel = nodes.find((n) => n.selected);
    const structural = changes.some((c) => c.type === "remove");
    set({ nodes, selectedNodeId: sel ? sel.id : changes.some((c) => c.type === "select") ? null : get().selectedNodeId, dirty: get().dirty || changes.some((c) => c.type === "position" || c.type === "remove") });
    if (structural) get().validate();
  },

  onEdgesChange: (changes) => {
    const edges = applyEdgeChanges(changes, get().edges);
    set({ edges, dirty: get().dirty || changes.some((c) => c.type === "remove") });
    if (changes.some((c) => c.type === "remove")) get().validate();
  },

  connect: (c) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const { edges } = get();
    const id = edgeId(c.source, c.target, c.sourceHandle, c.targetHandle);
    if (edges.some((e) => e.id === id)) return;
    get().commit();
    set({ edges: [...edges, { id, source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? undefined, targetHandle: c.targetHandle ?? undefined, type: "wf" }], dirty: true });
    get().validate();
  },

  commit: (key) => {
    const { nodes, edges, past, lastCommitKey, lastCommitAt } = get();
    if (key && key === lastCommitKey && Date.now() - lastCommitAt < 900) { set({ lastCommitAt: Date.now() }); return; }
    const snap: Snapshot = { nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })), edges: [...edges] };
    set({ past: [...past.slice(-(MAX_HISTORY - 1)), snap], future: [], lastCommitKey: key ?? null, lastCommitAt: Date.now() });
  },

  addNode: (type, position, opts = {}) => {
    const { nodes, edges } = get();
    get().commit();
    const id = nodeIdFor(type, new Set(nodes.map((n) => n.id)));
    const spec = nodeSpec(type);
    const node: WfNode = { id, type: "wf", position, data: { wfType: type, label: spec?.label ?? type, config: defaultConfigFor(type) }, selected: opts.select !== false };
    let nextEdges = edges;
    if (opts.connectFrom) {
      const from = nodes.find((n) => n.id === opts.connectFrom);
      if (from) nextEdges = [...edges, { id: edgeId(from.id, id), source: from.id, target: id, type: "wf" }];
    }
    set({ nodes: [...nodes.map((n) => ({ ...n, selected: false })), node], edges: nextEdges, selectedNodeId: opts.select !== false ? id : get().selectedNodeId, dirty: true });
    get().validate();
    return id;
  },

  updateNodeConfig: (id, patch) => {
    get().commit(`config:${id}`);
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: typeof patch === "function" ? patch(n.data.config) : { ...n.data.config, ...patch } } } : n)), dirty: true });
    get().validate();
  },

  updateNodeLabel: (id, label) => {
    get().commit(`label:${id}`);
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)), dirty: true });
  },

  renameNodeId: (id, nextId) => {
    const clean = nextId.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!clean || clean === id) return false;
    const { nodes, edges } = get();
    if (nodes.some((n) => n.id === clean)) return false;
    get().commit();
    const renamed = rewriteRefs(nodes, id, clean).map((n) => (n.id === id ? { ...n, id: clean } : n));
    const nextEdges = edges.map((e) => (e.source === id || e.target === id ? { ...e, id: edgeId(e.source === id ? clean : e.source, e.target === id ? clean : e.target, e.sourceHandle, e.targetHandle), source: e.source === id ? clean : e.source, target: e.target === id ? clean : e.target } : e));
    set({ nodes: renamed, edges: nextEdges, selectedNodeId: get().selectedNodeId === id ? clean : get().selectedNodeId, dirty: true });
    get().validate();
    return true;
  },

  removeNodes: (ids) => {
    if (!ids.length) return;
    get().commit();
    const set_ = new Set(ids);
    set({ nodes: get().nodes.filter((n) => !set_.has(n.id)), edges: get().edges.filter((e) => !set_.has(e.source) && !set_.has(e.target)), selectedNodeId: set_.has(get().selectedNodeId ?? "") ? null : get().selectedNodeId, dirty: true });
    get().validate();
  },

  removeEdges: (ids) => {
    if (!ids.length) return;
    get().commit();
    const set_ = new Set(ids);
    set({ edges: get().edges.filter((e) => !set_.has(e.id)), dirty: true });
    get().validate();
  },

  duplicate: (ids) => {
    get().copy(ids);
    get().paste();
  },

  copy: (ids) => {
    const { nodes, edges } = get();
    const selected = ids?.length ? new Set(ids) : new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (!selected.size) return;
    set({ clipboard: { nodes: nodes.filter((n) => selected.has(n.id)).map((n) => ({ ...n, data: { ...n.data, config: JSON.parse(JSON.stringify(n.data.config)) } })), edges: edges.filter((e) => selected.has(e.source) && selected.has(e.target)) } });
  },

  paste: () => {
    const { clipboard, nodes, edges } = get();
    if (!clipboard?.nodes.length) return;
    get().commit();
    const existing = new Set(nodes.map((n) => n.id));
    const idMap = new Map<string, string>();
    const pasted: WfNode[] = clipboard.nodes.map((n) => {
      const type = n.data.wfType;
      // Triggers are unique: paste a manual trigger as an AI prompt placeholder? No — skip triggers entirely.
      const id = nodeIdFor(type, existing);
      existing.add(id);
      idMap.set(n.id, id);
      return { ...n, id, position: { x: n.position.x + 48, y: n.position.y + 48 }, selected: true, data: { ...n.data, config: JSON.parse(JSON.stringify(n.data.config)) } };
    }).filter((n) => !n.data.wfType.startsWith("trigger.") || !nodes.some((x) => x.data.wfType.startsWith("trigger.")));
    let withRefs = pasted;
    for (const [oldId, newId] of idMap) withRefs = rewriteRefs(withRefs, oldId, newId);
    const pastedEdges: WfEdge[] = clipboard.edges.filter((e) => idMap.has(e.source) && idMap.has(e.target) && withRefs.some((n) => n.id === idMap.get(e.source)) && withRefs.some((n) => n.id === idMap.get(e.target))).map((e) => ({ ...e, id: edgeId(idMap.get(e.source)!, idMap.get(e.target)!, e.sourceHandle, e.targetHandle), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
    set({ nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...withRefs], edges: [...edges, ...pastedEdges], selectedNodeId: withRefs.length === 1 ? withRefs[0].id : null, dirty: true });
    get().validate();
  },

  undo: () => {
    const { past, future, nodes, edges } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ nodes: prev.nodes, edges: prev.edges, past: past.slice(0, -1), future: [{ nodes, edges }, ...future].slice(0, MAX_HISTORY), dirty: true, selectedNodeId: prev.nodes.find((n) => n.selected)?.id ?? null, lastCommitKey: null });
    get().validate();
  },

  redo: () => {
    const { past, future, nodes, edges } = get();
    if (!future.length) return;
    const next = future[0];
    set({ nodes: next.nodes, edges: next.edges, past: [...past, { nodes, edges }].slice(-MAX_HISTORY), future: future.slice(1), dirty: true, selectedNodeId: next.nodes.find((n) => n.selected)?.id ?? null, lastCommitKey: null });
    get().validate();
  },

  layout: () => {
    get().commit();
    const { nodes, edges } = get();
    const d = toDomainGraph(nodes, edges);
    const laid = autoLayout(d.nodes, d.edges);
    const pos = new Map(laid.map((n) => [n.id, n.position]));
    set({ nodes: nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })), dirty: true });
  },

  select: (id) => set({ selectedNodeId: id, nodes: get().nodes.map((n) => ({ ...n, selected: n.id === id })) }),

  setMeta: (patch) => set({ meta: { ...get().meta, ...patch }, dirty: true }),
  setStepStatuses: (s) => set({ stepStatuses: s }),
  markSaved: (at) => set({ dirty: false, saving: false, lastSavedAt: at }),
  setSaving: (v) => set({ saving: v }),
  toDomain: () => toDomainGraph(get().nodes, get().edges),
  validate: () => {
    const d = toDomainGraph(get().nodes, get().edges);
    const issues = validateWorkflow(d.nodes, d.edges).issues;
    set({ issues });
    return issues;
  },
}));

export function newClipboardId() { return nanoid(6); }

/** Bounds of the graph using measured sizes when available, else the card's known size (240 × ~96). */
export function graphBounds(nodes: WfNode[]): { x: number; y: number; width: number; height: number } {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = n.measured?.width ?? 240;
    const h = n.measured?.height ?? 96;
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + h);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
