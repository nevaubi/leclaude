/**
 * DAG utilities shared by the builder (validation, auto-layout) and the engine
 * (execution plan). Pure and client-safe.
 */
import type { WorkflowEdge, WorkflowNode } from "@/lib/types/domain";
import { isTriggerType, NODE_TYPE_MAP, sourceHandles } from "./registry";
import { referencedStepIds } from "./template-expr";

export interface GraphIssue { level: "error" | "warning"; code: string; message: string; nodeId?: string; edgeId?: string }

export interface Graph {
  nodeMap: Map<string, WorkflowNode>;
  /** outgoing edges by source id (loop-back edges included) */
  out: Map<string, WorkflowEdge[]>;
  /** incoming edges by target id (loop-back edges included) */
  inc: Map<string, WorkflowEdge[]>;
}

export function buildGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): Graph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, WorkflowEdge[]>();
  const inc = new Map<string, WorkflowEdge[]>();
  for (const n of nodes) { out.set(n.id, []); inc.set(n.id, []); }
  for (const e of edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
    out.get(e.source)!.push(e);
    inc.get(e.target)!.push(e);
  }
  return { nodeMap, out, inc };
}

export function isLoopBackEdge(e: WorkflowEdge, nodeMap: Map<string, WorkflowNode>) {
  return e.targetHandle === "loop-back" && nodeMap.get(e.target)?.type === "logic.loop";
}

export function triggerNodes(nodes: WorkflowNode[]) {
  return nodes.filter((n) => isTriggerType(n.type));
}

/** Reachable set from a start node following forward edges (optionally filtered), never through loop-back edges. */
function reach(g: Graph, start: string[], edgeFilter?: (e: WorkflowEdge) => boolean): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of g.out.get(id) ?? []) {
      if (isLoopBackEdge(e, g.nodeMap)) continue;
      if (edgeFilter && !edgeFilter(e)) continue;
      stack.push(e.target);
    }
  }
  return seen;
}

export interface LoopBody { loopId: string; body: string[]; done: string[] }

/**
 * Body of each loop: nodes reachable from its "each" handle. Nodes reachable
 * from "done" are the continuation. Nested loops are allowed (a nested loop and
 * its body belong to the outer body).
 */
export function loopBodies(nodes: WorkflowNode[], edges: WorkflowEdge[]): { bodies: LoopBody[]; issues: GraphIssue[] } {
  const g = buildGraph(nodes, edges);
  const issues: GraphIssue[] = [];
  const bodies: LoopBody[] = [];
  for (const n of nodes) {
    if (n.type !== "logic.loop") continue;
    const eachTargets = (g.out.get(n.id) ?? []).filter((e) => e.sourceHandle === "each").map((e) => e.target);
    const doneTargets = (g.out.get(n.id) ?? []).filter((e) => e.sourceHandle !== "each").map((e) => e.target);
    // Body: reachable from each-targets but stop at edges that lead into the loop itself.
    const body = new Set<string>();
    const stack = [...eachTargets];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === n.id || body.has(id)) continue;
      body.add(id);
      for (const e of g.out.get(id) ?? []) { if (e.target === n.id) continue; stack.push(e.target); }
    }
    const done = reach(g, doneTargets);
    const overlap = [...body].filter((id) => done.has(id));
    if (overlap.length) issues.push({ level: "error", code: "loop_overlap", message: `Loop "${n.label}": ${overlap.length} node(s) are reachable from both the "each" and "done" handles. Body nodes may only rejoin through the loop-back handle.`, nodeId: n.id });
    for (const id of body) {
      for (const e of g.inc.get(id) ?? []) {
        if (e.source === n.id) continue;
        if (!body.has(e.source)) issues.push({ level: "error", code: "loop_entry", message: `Loop body node "${g.nodeMap.get(id)?.label ?? id}" has an incoming edge from outside the loop body.`, nodeId: id, edgeId: e.id });
      }
    }
    bodies.push({ loopId: n.id, body: [...body], done: [...done] });
  }
  return { bodies, issues };
}

/** Kahn topological order over a node subset. Returns null when a cycle exists. */
export function topologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[], subset?: Set<string>): string[] | null {
  const g = buildGraph(nodes, edges);
  const ids = nodes.map((n) => n.id).filter((id) => !subset || subset.has(id));
  const idSet = new Set(ids);
  const indeg = new Map<string, number>();
  for (const id of ids) indeg.set(id, 0);
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    if (isLoopBackEdge(e, g.nodeMap)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of g.out.get(id) ?? []) {
      if (!idSet.has(e.target) || isLoopBackEdge(e, g.nodeMap)) continue;
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  return order.length === ids.length ? order : null;
}

/** Nodes that participate in a cycle (ignoring loop-back edges). */
export function findCycleNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const g = buildGraph(nodes, edges);
  const color = new Map<string, 0 | 1 | 2>();
  const inCycle = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    color.set(id, 1);
    stack.push(id);
    for (const e of g.out.get(id) ?? []) {
      if (isLoopBackEdge(e, g.nodeMap)) continue;
      const c = color.get(e.target) ?? 0;
      if (c === 0) visit(e.target);
      else if (c === 1) { const i = stack.indexOf(e.target); for (const s of stack.slice(i)) inCycle.add(s); }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const n of nodes) if ((color.get(n.id) ?? 0) === 0) visit(n.id);
  return [...inCycle];
}

export interface ExecutionPlan {
  /** Top-level nodes in a valid topological order (loop bodies excluded). */
  order: string[];
  /** Loop id → ordered body node ids (nested loops appear as one node whose own plan is nested). */
  loops: Record<string, { body: string[]; bodyOrder: string[] }>;
  /** Every node id that lives inside some loop body. */
  bodyNodeIds: Set<string>;
  graph: Graph;
}

export function executionPlan(nodes: WorkflowNode[], edges: WorkflowEdge[]): ExecutionPlan {
  const graph = buildGraph(nodes, edges);
  const { bodies } = loopBodies(nodes, edges);
  const bodyNodeIds = new Set<string>();
  for (const b of bodies) b.body.forEach((id) => bodyNodeIds.add(id));
  const topLevel = new Set(nodes.map((n) => n.id).filter((id) => !bodyNodeIds.has(id)));
  const order = topologicalOrder(nodes, edges, topLevel) ?? [];
  const loops: ExecutionPlan["loops"] = {};
  for (const b of bodies) {
    // Nested bodies are excluded from the outer loop's direct order.
    const nested = new Set<string>();
    for (const inner of bodies) if (inner.loopId !== b.loopId && b.body.includes(inner.loopId)) inner.body.forEach((id) => nested.add(id));
    const direct = new Set(b.body.filter((id) => !nested.has(id)));
    loops[b.loopId] = { body: b.body, bodyOrder: topologicalOrder(nodes, edges, direct) ?? [...direct] };
  }
  return { order, loops, bodyNodeIds, graph };
}

/** Full validation used by the builder, the save endpoint and the engine. */
export function validateWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): { ok: boolean; issues: GraphIssue[] } {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) issues.push({ level: "error", code: "duplicate_id", message: `Duplicate node id "${n.id}"`, nodeId: n.id });
    ids.add(n.id);
    if (!NODE_TYPE_MAP[n.type]) issues.push({ level: "error", code: "unknown_type", message: `Unknown node type "${n.type}"`, nodeId: n.id });
  }
  const triggers = triggerNodes(nodes);
  if (triggers.length === 0) issues.push({ level: "error", code: "no_trigger", message: "Add exactly one trigger node to start the workflow." });
  if (triggers.length > 1) issues.push({ level: "error", code: "multiple_triggers", message: `Only one trigger is allowed (found ${triggers.length}).`, nodeId: triggers[1].id });
  const g = buildGraph(nodes, edges);
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) { issues.push({ level: "error", code: "dangling_edge", message: `Edge ${e.id} references a missing node.`, edgeId: e.id }); continue; }
    if (e.source === e.target) issues.push({ level: "error", code: "self_loop", message: `Node "${g.nodeMap.get(e.source)?.label}" connects to itself.`, edgeId: e.id, nodeId: e.source });
    const src = g.nodeMap.get(e.source)!;
    if (isTriggerType(g.nodeMap.get(e.target)!.type)) issues.push({ level: "error", code: "edge_into_trigger", message: "Triggers cannot have incoming connections.", edgeId: e.id, nodeId: e.target });
    const handles = sourceHandles(src.type, src.config);
    if (e.sourceHandle && !handles.some((h) => h.id === e.sourceHandle) && handles[0]?.id !== "__dynamic__") {
      issues.push({ level: "warning", code: "unknown_handle", message: `Edge from "${src.label}" uses handle "${e.sourceHandle}" which no longer exists.`, edgeId: e.id, nodeId: src.id });
    }
    if (e.targetHandle === "loop-back" && g.nodeMap.get(e.target)?.type !== "logic.loop") issues.push({ level: "error", code: "bad_loop_back", message: "Loop-back edges may only target a Loop node.", edgeId: e.id });
  }
  const cyc = findCycleNodes(nodes, edges);
  if (cyc.length) issues.push({ level: "error", code: "cycle", message: `Cycle detected through ${cyc.map((id) => `"${g.nodeMap.get(id)?.label ?? id}"`).join(" → ")}. Only loop-back edges into a Loop node may form cycles.`, nodeId: cyc[0] });
  const { issues: loopIssues, bodies } = loopBodies(nodes, edges);
  issues.push(...loopIssues);
  for (const b of bodies) if (!b.body.length) issues.push({ level: "warning", code: "empty_loop", message: `Loop "${g.nodeMap.get(b.loopId)?.label}" has no body connected to its "each" handle.`, nodeId: b.loopId });
  if (triggers.length === 1) {
    const reachable = reach(g, [triggers[0].id]);
    for (const n of nodes) if (!reachable.has(n.id)) issues.push({ level: "warning", code: "unreachable", message: `"${n.label}" is not connected to the trigger and will be skipped.`, nodeId: n.id });
  }
  for (const n of nodes) {
    const spec = NODE_TYPE_MAP[n.type];
    if (!spec) continue;
    for (const f of spec.fields) {
      if (!f.required) continue;
      if (f.showWhen) {
        const v = n.config[f.showWhen.key];
        if (f.showWhen.equals !== undefined && v !== f.showWhen.equals) continue;
        if (f.showWhen.in && !f.showWhen.in.includes(v)) continue;
      }
      const v = getConfigValue(n.config, f.key);
      const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) issues.push({ level: "warning", code: "missing_config", message: `"${n.label}": ${f.label} is empty.`, nodeId: n.id });
    }
    for (const ref of referencedStepIds(n.config)) {
      if (!ids.has(ref)) issues.push({ level: "warning", code: "unknown_step_ref", message: `"${n.label}" references steps.${ref} which does not exist.`, nodeId: n.id });
    }
    if (n.type === "logic.branch") {
      const rules = Array.isArray(n.config.rules) ? (n.config.rules as { id: string }[]) : [];
      if (!rules.length) issues.push({ level: "warning", code: "branch_no_rules", message: `"${n.label}" has no rules; everything will go to "else".`, nodeId: n.id });
    }
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}

export function getConfigValue(config: Record<string, unknown>, key: string): unknown {
  if (!key.includes(".")) return config[key];
  let cur: unknown = config;
  for (const s of key.split(".")) { if (cur == null || typeof cur !== "object") return undefined; cur = (cur as Record<string, unknown>)[s]; }
  return cur;
}

export function setConfigValue(config: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const next = { ...config };
  if (!key.includes(".")) { next[key] = value; return next; }
  const segs = key.split(".");
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    const existing = cur[s];
    cur[s] = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
    cur = cur[s] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
  return next;
}

/**
 * Simple layered layout: rank = longest path from the trigger (loop-back edges
 * ignored), nodes within a rank ordered by the barycenter of their predecessors.
 */
export function autoLayout(nodes: WorkflowNode[], edges: WorkflowEdge[], opts: { xGap?: number; yGap?: number; x0?: number; y0?: number } = {}): WorkflowNode[] {
  const xGap = opts.xGap ?? 300, yGap = opts.yGap ?? 130, x0 = opts.x0 ?? 60, y0 = opts.y0 ?? 80;
  const g = buildGraph(nodes, edges);
  const order = topologicalOrder(nodes, edges);
  const rank = new Map<string, number>();
  const seq = order ?? nodes.map((n) => n.id);
  for (const id of seq) {
    const preds = (g.inc.get(id) ?? []).filter((e) => !isLoopBackEdge(e, g.nodeMap));
    const r = preds.length ? Math.max(...preds.map((e) => (rank.get(e.source) ?? 0) + 1)) : 0;
    rank.set(id, r);
  }
  // nodes not in order (cycles) get rank by position
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);
  const byRank = new Map<number, string[]>();
  for (const n of nodes) { const r = rank.get(n.id)!; if (!byRank.has(r)) byRank.set(r, []); byRank.get(r)!.push(n.id); }
  const yIndex = new Map<string, number>();
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const r of ranks) {
    const ids = byRank.get(r)!;
    const bary = (id: string) => {
      const preds = (g.inc.get(id) ?? []).filter((e) => !isLoopBackEdge(e, g.nodeMap)).map((e) => yIndex.get(e.source)).filter((v): v is number => v != null);
      if (!preds.length) return nodes.findIndex((n) => n.id === id);
      return preds.reduce((a, b) => a + b, 0) / preds.length;
    };
    ids.sort((a, b) => bary(a) - bary(b));
    ids.forEach((id, i) => yIndex.set(id, i));
  }
  const maxPerRank = Math.max(...ranks.map((r) => byRank.get(r)!.length), 1);
  return nodes.map((n) => {
    const r = rank.get(n.id)!;
    const count = byRank.get(r)!.length;
    const offset = ((maxPerRank - count) * yGap) / 2;
    return { ...n, position: { x: x0 + r * xGap, y: y0 + offset + (yIndex.get(n.id) ?? 0) * yGap } };
  });
}

/** Ids of nodes downstream of a given node (following forward edges only). */
export function downstreamOf(nodes: WorkflowNode[], edges: WorkflowEdge[], id: string): Set<string> {
  const g = buildGraph(nodes, edges);
  const s = reach(g, [id]);
  s.delete(id);
  return s;
}

/** Ids of nodes upstream of a given node (those whose outputs are usable in templates). */
export function upstreamOf(nodes: WorkflowNode[], edges: WorkflowEdge[], id: string): string[] {
  const g = buildGraph(nodes, edges);
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of g.inc.get(cur) ?? []) {
      if (isLoopBackEdge(e, g.nodeMap)) continue;
      if (seen.has(e.source)) continue;
      seen.add(e.source);
      stack.push(e.source);
    }
  }
  const order = topologicalOrder(nodes, edges) ?? nodes.map((n) => n.id);
  return order.filter((x) => seen.has(x));
}
