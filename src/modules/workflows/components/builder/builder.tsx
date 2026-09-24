"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type IsValidConnection, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, LayoutGrid, Loader2, Maximize2, Minus, Play, Plus, Redo2, Save, Sparkles, Undo2, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import type { Workflow, WorkflowNodeType, WorkflowRunStep } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { useTheme } from "@/components/shell/theme-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { findCycleNodes } from "../../graph";
import { nodeSpec } from "../../registry";
import { apiJson, ApiError, useWorkflowMeta } from "../../hooks";
import type { WorkflowRecord } from "../../service";
import { WorkflowStatusBadge, CategoryBadge, toneFor } from "../shared";
import { RunDialog } from "../run/run-dialog";
import { RunPanel } from "../run/run-panel";
import { RunsTable } from "../run/runs-table";
import { ConfigPanel } from "./config-panel";
import { DEFAULT_EDGE_OPTIONS, EDGE_TYPES, EdgeMarkers } from "./edges";
import { NODE_TYPES } from "./nodes";
import { DND_MIME, NodePalette } from "./palette";
import { graphBounds, toDomainGraph, useBuilderStore, type WfNode } from "./store";

export function WorkflowBuilder({ workflow }: { workflow: WorkflowRecord }) {
  return (
    <ReactFlowProvider>
      <BuilderInner workflow={workflow} />
    </ReactFlowProvider>
  );
}

function BuilderInner({ workflow }: { workflow: WorkflowRecord }) {
  const router = useRouter();
  const search = useSearchParams();
  const meta = useWorkflowMeta();
  const { resolved } = useTheme();
  const rf = useReactFlow<WfNode>();
  const store = useBuilderStore;
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const wfMeta = useBuilderStore((s) => s.meta);
  const dirty = useBuilderStore((s) => s.dirty);
  const saving = useBuilderStore((s) => s.saving);
  const issues = useBuilderStore((s) => s.issues);
  const past = useBuilderStore((s) => s.past);
  const future = useBuilderStore((s) => s.future);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const [paletteOpen, setPaletteOpen] = React.useState(true);
  // Collapse the palette on narrower windows (after mount, so SSR markup matches) so the canvas keeps a usable width next to the config panel.
  React.useEffect(() => { if (window.innerWidth < 1440) setPaletteOpen(false); }, []);
  const [rightTab, setRightTab] = React.useState<"configure" | "runs">("configure");
  const [runOpen, setRunOpen] = React.useState(false);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(search.get("run") && search.get("run") !== "1" ? search.get("run") : null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const errors = issues.filter((i) => i.level === "error");
  const isTemplate = wfMeta.isTemplate;

  React.useEffect(() => { store.getState().init(workflow); }, [workflow.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Initial viewport: fit everything when it stays readable, otherwise anchor on the trigger at a readable zoom.
  React.useEffect(() => {
    const t = setTimeout(() => {
      const el = wrapperRef.current;
      const ns = store.getState().nodes;
      if (!el || !ns.length) return;
      const b = graphBounds(ns);
      const fit = Math.min((el.clientWidth - 80) / Math.max(b.width, 1), (el.clientHeight - 80) / Math.max(b.height, 1), 1);
      if (fit >= 0.55) { rf.fitView({ padding: 0.2, maxZoom: 1 }); return; }
      const zoom = 0.72;
      rf.setViewport({ x: 48 - b.x * zoom, y: el.clientHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
    }, 60);
    return () => clearTimeout(t);
  }, [workflow.id, rf, store]);
  React.useEffect(() => { if (search.get("run") === "1") setRunOpen(true); }, [search]);
  React.useEffect(() => { if (activeRunId) setRightTab("runs"); }, [activeRunId]);
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (store.getState().dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store]);

  const save = React.useCallback(async (opts: { status?: Workflow["status"]; silent?: boolean } = {}) => {
    const st = store.getState();
    const graph = toDomainGraph(st.nodes, st.edges);
    const body = { name: st.meta.name, description: st.meta.description, category: st.meta.category, nodes: graph.nodes, edges: graph.edges, inputs: st.meta.inputs, tags: st.meta.tags, status: opts.status ?? st.meta.status };
    st.setSaving(true);
    try {
      if (st.meta.isTemplate) {
        const res = await apiJson<{ workflow: WorkflowRecord }>("/api/workflows", { method: "POST", body: JSON.stringify({ ...body, status: "draft", isTemplate: false }) });
        toast.success("Saved as your own workflow");
        router.push(`/workflows/${res.workflow.id}`);
        return res.workflow.id;
      }
      const res = await apiJson<{ workflow: WorkflowRecord; issues: unknown[] }>(`/api/workflows/${st.workflowId}`, { method: "PUT", body: JSON.stringify(body) });
      st.markSaved(res.workflow.updatedAt);
      if (opts.status) st.setMeta({ status: opts.status });
      if (!opts.silent) toast.success("Workflow saved");
      return st.workflowId;
    } catch (e) {
      st.setSaving(false);
      const msg = e instanceof ApiError ? e.message : "Save failed";
      toast.error(msg);
      return null;
    }
  }, [router, store]);

  const toggleActive = async (active: boolean) => {
    if (active && errors.length) { toast.error("Fix the validation errors before activating"); return; }
    const previous = store.getState().meta.status;
    store.getState().setMeta({ status: active ? "active" : "draft" });
    const id = await save({ status: active ? "active" : "draft", silent: true });
    if (!id) { store.getState().setMeta({ status: previous }); return; }
    toast.success(active ? "Workflow activated" : "Workflow set to draft");
  };

  const openRun = React.useCallback(async () => {
    if (errors.length) { toast.error(`Fix ${errors.length} validation error${errors.length > 1 ? "s" : ""} first`); setRightTab("configure"); store.getState().select(null); return; }
    if (store.getState().dirty || isTemplate) {
      const id = await save({ silent: true });
      if (!id) return;
      if (id !== store.getState().workflowId) return; // navigated to the clone; the new page opens the dialog via ?run=1
    }
    setRunOpen(true);
  }, [errors.length, isTemplate, save, store]);

  const addNode = React.useCallback((type: WorkflowNodeType, position?: { x: number; y: number }) => {
    const st = store.getState();
    let pos = position;
    let connectFrom: string | null = null;
    if (!pos) {
      const sel = st.nodes.find((n) => n.id === st.selectedNodeId);
      if (sel) { pos = { x: sel.position.x + 300, y: sel.position.y }; connectFrom = sel.id; }
      else {
        const el = wrapperRef.current;
        const center = el ? rf.screenToFlowPosition({ x: el.getBoundingClientRect().left + el.clientWidth / 2, y: el.getBoundingClientRect().top + el.clientHeight / 2 }) : { x: 200, y: 200 };
        pos = { x: center.x - 120, y: center.y - 40 };
      }
    }
    const id = st.addNode(type, pos, { select: true, connectFrom: connectFrom && !type.startsWith("trigger.") ? connectFrom : null });
    setRightTab("configure");
    return id;
  }, [rf, store]);

  const onDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DND_MIME) as WorkflowNodeType;
    if (!type || !nodeSpec(type)) return;
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(type, { x: pos.x - 120, y: pos.y - 30 });
  }, [rf, addNode]);

  const isValidConnection: IsValidConnection = React.useCallback((c) => {
    const st = store.getState();
    if (!c.source || !c.target || c.source === c.target) return false;
    const target = st.nodes.find((n) => n.id === c.target);
    if (!target || target.data.wfType.startsWith("trigger.")) return false;
    if (c.targetHandle === "loop-back") return target.data.wfType === "logic.loop";
    const d = toDomainGraph(st.nodes, st.edges);
    const candidate = { id: "__candidate__", source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? undefined, targetHandle: c.targetHandle ?? undefined };
    return findCycleNodes(d.nodes, [...d.edges, candidate]).length === 0;
  }, [store]);

  const onConnect = React.useCallback((c: Connection) => store.getState().connect(c), [store]);
  const onNodeClick: NodeMouseHandler<WfNode> = React.useCallback((_e, node) => { store.getState().select(node.id); setRightTab("configure"); }, [store]);
  const onPaneClick = React.useCallback(() => store.getState().select(null), [store]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || target.closest("[role=dialog]"));
      const mod = e.metaKey || e.ctrlKey;
      const st = store.getState();
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); return; }
      if (mod && e.key === "Enter") { e.preventDefault(); void openRun(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); st.redo(); return; }
      if (mod && e.key.toLowerCase() === "c") { st.copy(); return; }
      if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); st.paste(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); st.duplicate(st.nodes.filter((n) => n.selected).map((n) => n.id)); return; }
      if (e.key === "/") { e.preventDefault(); setPaletteOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); return; }
      if (e.key === "Escape") { st.select(null); return; }
      if (e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); st.layout(); requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 300 })); return; }
      if (e.key.toLowerCase() === "f" && !mod) { rf.fitView({ padding: 0.2, duration: 300 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, openRun, rf, store]);

  const onStepStatuses = React.useCallback((s: Record<string, WorkflowRunStep["status"]>) => store.getState().setStepStatuses(s), [store]);
  const usesAI = nodes.some((n) => nodeSpec(n.data.wfType)?.usesAI);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopbarSlot>
        <nav className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link href="/workflows" className="flex items-center gap-1 text-muted-foreground hover:text-foreground"><WorkflowIcon className="size-4" /> Workflows</Link>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="truncate font-medium">{wfMeta.name || "Untitled workflow"}</span>
          {isTemplate ? <Badge variant="info">Template</Badge> : <WorkflowStatusBadge status={wfMeta.status} />}
          <CategoryBadge category={wfMeta.category} className="hidden lg:inline-flex" />
          {dirty && !isTemplate && <span className="hidden text-[11px] text-muted-foreground sm:inline">· unsaved</span>}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          {!isTemplate && (
            <label className="mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex"><Switch size="sm" checked={wfMeta.status === "active"} onCheckedChange={toggleActive} /> Active</label>
          )}
          <Tip label={isTemplate ? "Save as your own workflow" : "Save"} shortcut="⌘S">
            <Button variant="outline" size="sm" onClick={() => save()} disabled={saving || (!dirty && !isTemplate)}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : isTemplate ? <Copy className="size-3.5" /> : <Save className="size-3.5" />} {isTemplate ? "Use template" : "Save"}</Button>
          </Tip>
          <Tip label="Run with inputs" shortcut="⌘↵">
            <Button size="sm" onClick={openRun} disabled={saving}><Play className="size-3.5" /> Run</Button>
          </Tip>
        </div>
      </TopbarSlot>

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <aside className={cn("relative shrink-0 border-r bg-card transition-[width] duration-200", paletteOpen ? "w-[268px]" : "w-0")}>
          {paletteOpen && <NodePalette onAdd={(t) => addNode(t)} searchRef={searchRef} />}
          <button onClick={() => setPaletteOpen((o) => !o)} className="absolute -right-3 top-3 z-10 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:text-foreground cursor-pointer" aria-label={paletteOpen ? "Collapse palette" : "Expand palette"}>
            {paletteOpen ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        </aside>

        {/* Canvas */}
        <div ref={wrapperRef} className="relative min-w-0 flex-1 bg-background" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <EdgeMarkers />
          <ReactFlow<WfNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            onNodesChange={(c) => store.getState().onNodesChange(c)}
            onEdgesChange={(c) => store.getState().onEdgesChange(c)}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeDragStart={() => store.getState().commit("drag")}
            onBeforeDelete={async () => { store.getState().commit(); return true; }}
            colorMode={resolved}
            minZoom={0.15}
            maxZoom={1.75}
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode="Shift"
            selectionKeyCode="Shift"
            className="[&_.react-flow__attribution]:rounded-tl-md [&_.react-flow__attribution]:bg-background/80 [&_.react-flow__attribution]:text-[9px] [&_.react-flow__attribution]:text-muted-foreground"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <MiniMap pannable zoomable position="bottom-right" className="!m-3 !rounded-lg !border !bg-card [&_svg]:rounded-lg" maskColor="color-mix(in oklch, var(--background) 65%, transparent)" nodeColor={(n) => `var(--${toneFor((n as WfNode).data.wfType).text.includes("primary") ? "primary" : toneFor((n as WfNode).data.wfType).text.includes("success") ? "success" : toneFor((n as WfNode).data.wfType).text.includes("info") ? "info" : toneFor((n as WfNode).data.wfType).text.includes("warning") ? "warning" : "chart-5"})`} nodeStrokeWidth={0} nodeBorderRadius={6} />
            <Panel position="top-left" className="!m-3 flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
              <Tip label="Undo" shortcut="⌘Z"><Button variant="ghost" size="icon-xs" onClick={() => store.getState().undo()} disabled={!past.length} aria-label="Undo"><Undo2 className="size-3.5" /></Button></Tip>
              <Tip label="Redo" shortcut="⌘⇧Z"><Button variant="ghost" size="icon-xs" onClick={() => store.getState().redo()} disabled={!future.length} aria-label="Redo"><Redo2 className="size-3.5" /></Button></Tip>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <Tip label="Zoom in"><Button variant="ghost" size="icon-xs" onClick={() => rf.zoomIn({ duration: 200 })} aria-label="Zoom in"><Plus className="size-3.5" /></Button></Tip>
              <Tip label="Zoom out"><Button variant="ghost" size="icon-xs" onClick={() => rf.zoomOut({ duration: 200 })} aria-label="Zoom out"><Minus className="size-3.5" /></Button></Tip>
              <Tip label="Fit view" shortcut="F"><Button variant="ghost" size="icon-xs" onClick={() => rf.fitView({ padding: 0.2, duration: 300 })} aria-label="Fit view"><Maximize2 className="size-3.5" /></Button></Tip>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <Tip label="Auto-layout" shortcut="⇧L"><Button variant="ghost" size="icon-xs" onClick={() => { store.getState().layout(); requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 300 })); }} aria-label="Auto-layout"><LayoutGrid className="size-3.5" /></Button></Tip>
            </Panel>
            <Panel position="top-right" className="!m-3">
              <button type="button" onClick={() => { store.getState().select(null); setRightTab("configure"); }} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] shadow-xs cursor-pointer", errors.length ? "border-destructive/50 bg-destructive/8 text-destructive" : issues.length ? "border-warning/50 bg-warning/10 text-warning-foreground dark:text-warning" : "border-success/40 bg-success/8 text-success")}>
                {errors.length ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />}
                {errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : issues.length ? `${issues.length} warning${issues.length > 1 ? "s" : ""}` : "Valid"}
                {usesAI && meta && !meta.aiConfigured && <span className="ml-1 rounded bg-warning/20 px-1 text-[10px] text-warning-foreground dark:text-warning">no API key</span>}
              </button>
            </Panel>
            {nodes.length === 0 && (
              <Panel position="top-center" className="!mt-24 pointer-events-none">
                <div className="rounded-lg border border-dashed bg-card/80 px-6 py-5 text-center text-sm text-muted-foreground shadow-xs">
                  <Sparkles className="mx-auto mb-2 size-5" />
                  Drag a trigger from the palette to start, then add AI, data, logic and action steps.
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {/* Right panel */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l bg-card xl:w-[400px]">
          <div className="flex items-center border-b px-2">
            <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as "configure" | "runs")} className="w-full">
              <TabsList variant="underline" className="h-9 w-full justify-start border-0">
                <TabsTrigger value="configure" className="text-xs">{selectedNodeId ? "Step" : "Workflow"}</TabsTrigger>
                <TabsTrigger value="runs" className="text-xs">{activeRunId ? "Run" : "Runs"}{activeRunId && <span className="ml-1 size-1.5 rounded-full bg-info" />}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="min-h-0 flex-1">
            {rightTab === "configure" ? (
              <ConfigPanel meta={meta} />
            ) : activeRunId ? (
              <RunPanel runId={activeRunId} onClose={() => { setActiveRunId(null); store.getState().setStepStatuses({}); }} onRerun={(id) => setActiveRunId(id)} onStepStatuses={onStepStatuses} />
            ) : (
              <div className="flex h-full flex-col p-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Run history</span><Button size="xs" onClick={openRun}><Play className="size-3" /> Run</Button></div>
                {isTemplate ? <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">Templates have no run history. Use the template to create your own copy and run it.</div> : <RunsTable workflowId={workflow.id} compact limit={20} className="min-h-0 flex-1" />}
              </div>
            )}
          </div>
        </aside>
      </div>

      <RunDialog open={runOpen} onOpenChange={setRunOpen} workflow={{ id: store.getState().workflowId || workflow.id, name: wfMeta.name, inputs: wfMeta.inputs, usesAI }} meta={meta} onStarted={(id) => { setActiveRunId(id); setRightTab("runs"); toast.success("Run started"); }} />
    </div>
  );
}
