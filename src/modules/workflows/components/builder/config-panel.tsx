"use client";
import * as React from "react";
import { AlertTriangle, Check, Copy, CornerDownRight, Info, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tip } from "@/components/ui/tooltip";
import type { Workflow } from "@/lib/types/domain";
import { getConfigValue, loopBodies, setConfigValue, upstreamOf } from "../../graph";
import { NODE_TYPE_MAP, WORKFLOW_CATEGORIES, type FieldSpec } from "../../registry";
import type { WorkflowMeta } from "../../hooks";
import { NodeTypeIcon, SectionLabel, toneFor } from "../shared";
import { ConfigField, TagsInput, type FieldContext, type VariableGroup } from "./fields";
import { InputsEditor } from "./inputs-editor";
import { toDomainGraph, useBuilderStore } from "./store";

const MATTER_PATHS: { path: string; label: string }[] = [
  { path: "matter.id", label: "Matter id" }, { path: "matter.name", label: "Matter name" }, { path: "matter.shortName", label: "Short name" }, { path: "matter.caption", label: "Caption" }, { path: "matter.client", label: "Client" }, { path: "matter.court", label: "Court" }, { path: "matter.judge", label: "Judge" }, { path: "matter.stage", label: "Stage" }, { path: "matter.description", label: "Description" },
  { path: "matter.keyDates | table:label,date", label: "Key dates (table)" }, { path: "matter.openTasks | table:title,status,priority,dueAt", label: "Open tasks (table)" }, { path: "matter.upcomingEvents | table:startsAt,title,kind", label: "Upcoming events (table)" }, { path: "matter.team | pluck:name | join:\", \"", label: "Team names" },
];

function showField(f: FieldSpec, config: Record<string, unknown>) {
  if (!f.showWhen) return true;
  const v = getConfigValue(config, f.showWhen.key);
  if (f.showWhen.equals !== undefined) return v === f.showWhen.equals;
  if (f.showWhen.in) return f.showWhen.in.includes(v);
  if (f.showWhen.truthy !== undefined) return Boolean(v) === f.showWhen.truthy;
  return true;
}

export function ConfigPanel({ meta }: { meta: WorkflowMeta | null }) {
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {selectedNodeId ? <NodeConfig key={selectedNodeId} nodeId={selectedNodeId} meta={meta} /> : <WorkflowSettings meta={meta} />}
    </div>
  );
}

function useVariableGroups(nodeId: string | null, meta: WorkflowMeta | null): VariableGroup[] {
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const inputs = useBuilderStore((s) => s.meta.inputs);
  return React.useMemo(() => {
    const d = toDomainGraph(nodes, edges);
    const groups: VariableGroup[] = [];
    if (inputs.length) groups.push({ label: "Inputs", items: inputs.map((i) => ({ path: `inputs.${i.key}`, label: i.label, hint: i.type })) });
    if (nodeId) {
      const up = upstreamOf(d.nodes, d.edges, nodeId);
      const items = up.flatMap((id) => {
        const n = d.nodes.find((x) => x.id === id)!;
        const spec = NODE_TYPE_MAP[n.type];
        const paths = spec?.outputPaths?.length ? spec.outputPaths : ["output"];
        return paths.map((p) => ({ path: `steps.${id}.${p}`, label: n.label, hint: p.replace(/^output\.?/, "") || "whole output" }));
      });
      if (items.length) groups.push({ label: "Earlier steps", items });
      const { bodies } = loopBodies(d.nodes, d.edges);
      const inLoop = bodies.find((b) => b.body.includes(nodeId));
      if (inLoop) {
        const loopNode = d.nodes.find((n) => n.id === inLoop.loopId);
        groups.push({ label: `Loop (${loopNode?.label ?? inLoop.loopId})`, items: [{ path: "loop.item", label: "Current item" }, { path: "loop.item | json", label: "Current item as JSON" }, { path: "loop.index", label: "Index (0-based)" }, { path: "loop.number", label: "Number (1-based)" }, { path: "loop.count", label: "Total items" }] });
      }
    }
    groups.push({ label: "Matter", items: MATTER_PATHS.map((m) => ({ path: m.path, label: m.label })) });
    groups.push({ label: "Run", items: [{ path: "run.workflowName", label: "Workflow name" }, { path: "run.id", label: "Run id" }, { path: "run.href", label: "Run link" }, { path: "user.name", label: "Current user" }, { path: "now | date:long", label: "Today (long date)" }, { path: "now | date:date", label: "Today (YYYY-MM-DD)" }] });
    void meta;
    return groups;
  }, [nodes, edges, inputs, nodeId, meta]);
}

function useMatterOptions(meta: WorkflowMeta | null) {
  const inputs = useBuilderStore((s) => s.meta.inputs);
  return React.useMemo(() => [
    { value: "", label: "None" },
    { value: "{{matter.id}}", label: "The run's matter", hint: "{{matter.id}}" },
    ...inputs.filter((i) => i.type === "matter").map((i) => ({ value: `{{inputs.${i.key}}}`, label: `Input: ${i.label}`, hint: `{{inputs.${i.key}}}` })),
    ...(meta?.matters ?? []).map((m) => ({ value: m.id, label: m.shortName, hint: m.client })),
  ], [inputs, meta]);
}

function NodeConfig({ nodeId, meta }: { nodeId: string; meta: WorkflowMeta | null }) {
  const node = useBuilderStore((s) => s.nodes.find((n) => n.id === nodeId));
  const allIssues = useBuilderStore((s) => s.issues);
  const issues = React.useMemo(() => allIssues.filter((i) => i.nodeId === nodeId), [allIssues, nodeId]);
  const updateNodeConfig = useBuilderStore((s) => s.updateNodeConfig);
  const updateNodeLabel = useBuilderStore((s) => s.updateNodeLabel);
  const renameNodeId = useBuilderStore((s) => s.renameNodeId);
  const removeNodes = useBuilderStore((s) => s.removeNodes);
  const duplicate = useBuilderStore((s) => s.duplicate);
  const select = useBuilderStore((s) => s.select);
  const inputs = useBuilderStore((s) => s.meta.inputs);
  const variables = useVariableGroups(nodeId, meta);
  const matterOptions = useMatterOptions(meta);
  const [editingId, setEditingId] = React.useState(false);
  const [idDraft, setIdDraft] = React.useState(nodeId);
  if (!node) return null;
  const spec = NODE_TYPE_MAP[node.data.wfType];
  const tone = toneFor(node.data.wfType);
  const config = node.data.config;
  const ctx: FieldContext = { meta, inputs, variables, matterOptions };
  const visible = (spec?.fields ?? []).filter((f) => showField(f, config));
  const groups = new Map<string, FieldSpec[]>();
  for (const f of visible) { const g = f.group ?? "Configuration"; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(f); }
  const outputRef = `{{steps.${node.id}.${spec?.outputPaths?.[0] ?? "output"}}}`;
  const commitId = () => { if (idDraft !== node.id) { const ok = renameNodeId(node.id, idDraft); if (!ok) toast.error("That id is taken or invalid"); } setEditingId(false); };

  return (
    <>
      <div className="border-b px-3 py-2.5">
        <div className="flex items-start gap-2">
          <NodeTypeIcon type={node.data.wfType} />
          <div className="min-w-0 flex-1">
            <Input value={node.data.label} onChange={(e) => updateNodeLabel(node.id, e.target.value)} className="h-7 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none hover:border-input focus-visible:border-ring" aria-label="Step label" />
            <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[10.5px]">
              <span className={cn("font-medium uppercase tracking-wider", tone.text)}>{spec?.label ?? node.data.wfType}</span>
              <span className="text-muted-foreground">·</span>
              {editingId ? (
                <input autoFocus value={idDraft} onChange={(e) => setIdDraft(e.target.value)} onBlur={commitId} onKeyDown={(e) => { if (e.key === "Enter") commitId(); if (e.key === "Escape") { setIdDraft(node.id); setEditingId(false); } }} className="h-5 w-32 rounded border bg-background px-1 font-mono text-[10.5px] outline-none focus:border-ring" />
              ) : (
                <button type="button" onClick={() => { setIdDraft(node.id); setEditingId(true); }} className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground cursor-pointer" title="Rename step id (references are updated)"><span>{node.id}</span><Pencil className="size-2.5" /></button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tip label="Duplicate"><Button variant="ghost" size="icon-xs" onClick={() => duplicate([node.id])} aria-label="Duplicate step"><Copy className="size-3.5" /></Button></Tip>
            <Tip label="Delete step"><Button variant="ghost" size="icon-xs" className="hover:text-destructive" onClick={() => { removeNodes([node.id]); select(null); }} aria-label="Delete step"><Trash2 className="size-3.5" /></Button></Tip>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{spec?.description}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {issues.length > 0 && (
          <div className="border-b bg-muted/30 px-3 py-2 space-y-1">
            {issues.map((i, k) => (
              <div key={k} className={cn("flex items-start gap-1.5 text-[11px]", i.level === "error" ? "text-destructive" : "text-warning-foreground dark:text-warning")}><AlertTriangle className="mt-0.5 size-3 shrink-0" /><span>{i.message}</span></div>
            ))}
          </div>
        )}
        <div className="px-3 py-3 space-y-4">
          {[...groups.entries()].map(([g, fields]) => (
            <div key={g} className="space-y-3">
              {groups.size > 1 && <SectionLabel>{g}</SectionLabel>}
              {fields.map((f) => (
                <ConfigField key={f.key} spec={f} value={getConfigValue(config, f.key)} onChange={(v) => updateNodeConfig(node.id, (c) => setConfigValue(c, f.key, v))} ctx={ctx} />
              ))}
            </div>
          ))}
        </div>
        <Separator />
        <div className="px-3 py-3 space-y-2">
          <SectionLabel>Output</SectionLabel>
          <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
            <div className="font-mono text-muted-foreground">{spec?.outputShape}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <CornerDownRight className="size-3 text-muted-foreground" />
              <code className="flex-1 truncate rounded bg-background px-1.5 py-0.5 font-mono text-[10.5px]">{outputRef}</code>
              <Button variant="ghost" size="icon-xs" onClick={() => { navigator.clipboard?.writeText(outputRef); toast.success("Copied"); }} aria-label="Copy reference"><Copy className="size-3" /></Button>
            </div>
            <div className="mt-1 text-[10.5px] text-muted-foreground">Reference this step from later steps with the expression above.</div>
          </div>
        </div>
      </div>
    </>
  );
}

function WorkflowSettings({ meta }: { meta: WorkflowMeta | null }) {
  const wf = useBuilderStore((s) => s.meta);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const issues = useBuilderStore((s) => s.issues);
  const nodes = useBuilderStore((s) => s.nodes);
  const select = useBuilderStore((s) => s.select);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const trigger = nodes.find((n) => n.data.wfType.startsWith("trigger."));
  void meta;
  return (
    <>
      <div className="border-b px-3 py-2.5">
        <div className="text-sm font-semibold">Workflow settings</div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Select a step on the canvas to configure it.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-3 py-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Name</Label>
            <Input value={wf.name} onChange={(e) => setMeta({ name: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Description</Label>
            <Textarea value={wf.description} onChange={(e) => setMeta({ description: e.target.value })} rows={3} className="min-h-0 text-xs" placeholder="What this playbook does and when to use it" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Category</Label>
              <Select value={wf.category} onValueChange={(v) => setMeta({ category: v as Workflow["category"] })}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>{WORKFLOW_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Status</Label>
              <Select value={wf.status} onValueChange={(v) => setMeta({ status: v as Workflow["status"] })}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Tags</Label>
            <TagsInput value={wf.tags} onChange={(tags) => setMeta({ tags })} />
          </div>
        </div>
        <Separator />
        <div className="px-3 py-3 space-y-2">
          <SectionLabel right={<span className="text-[10px] normal-case tracking-normal">{trigger ? `Trigger: ${NODE_TYPE_MAP[trigger.data.wfType]?.label}` : "No trigger"}</span>}>Run inputs</SectionLabel>
          <InputsEditor value={wf.inputs} onChange={(inputs) => setMeta({ inputs })} />
        </div>
        <Separator />
        <div className="px-3 py-3 space-y-2">
          <SectionLabel right={<span className={cn("text-[10px] normal-case tracking-normal", errors.length ? "text-destructive" : "text-success")}>{errors.length ? `${errors.length} error(s)` : "Runnable"}</span>}>Validation</SectionLabel>
          {issues.length === 0 ? (
            <div className="flex items-center gap-1.5 text-[11px] text-success"><Check className="size-3.5" /> No issues. The graph is ready to run.</div>
          ) : (
            <div className="space-y-1">
              {[...errors, ...warnings].map((i, k) => (
                <button key={k} type="button" onClick={() => i.nodeId && select(i.nodeId)} className={cn("flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-accent cursor-pointer", i.level === "error" ? "text-destructive" : "text-warning-foreground dark:text-warning")}>
                  {i.level === "error" ? <AlertTriangle className="mt-0.5 size-3 shrink-0" /> : <Info className="mt-0.5 size-3 shrink-0" />}
                  <span className="text-foreground">{i.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
