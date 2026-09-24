"use client";
import * as React from "react";
import { ChevronRight, GripVertical, Plus, Search } from "lucide-react";
import type { WorkflowNodeType } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { CATEGORY_META, CATEGORY_ORDER, NODE_TYPES, type NodeCategory, type NodeTypeSpec } from "../../registry";
import { NodeTypeIcon, toneFor } from "../shared";
import { useBuilderStore } from "./store";

export const DND_MIME = "application/x-leclaude-workflow-node";

/**
 * Step palette. Groups start collapsed (one line per category with its count)
 * so the panel reads as a quiet index; typing in the search expands every
 * matching group. Click a group to open it, drag or click "+" to add a step.
 */
export function NodePalette({ onAdd, searchRef, className, defaultOpen = [] }: { onAdd: (type: WorkflowNodeType) => void; searchRef?: React.RefObject<HTMLInputElement | null>; className?: string; defaultOpen?: NodeCategory[] }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<Set<NodeCategory>>(() => new Set(defaultOpen));
  const hasTrigger = useBuilderStore((s) => s.nodes.some((n) => n.data.wfType.startsWith("trigger.")));
  const term = q.trim().toLowerCase();
  const groups = React.useMemo(() => {
    const filtered = NODE_TYPES.filter((n) => !term || `${n.label} ${n.short} ${n.description} ${n.keywords.join(" ")} ${n.type}`.toLowerCase().includes(term));
    return CATEGORY_ORDER.map((c) => ({ category: c, items: filtered.filter((n) => n.category === c), total: NODE_TYPES.filter((n) => n.category === c).length })).filter((g) => g.items.length);
  }, [term]);
  const toggle = (c: NodeCategory) => setOpen((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search steps…  ( / )" className="h-8 pl-7 text-xs" aria-label="Search node types" onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-1.5" role="tree" aria-label="Step types">
        {groups.length === 0 && <div className="px-1 py-6 text-center text-xs text-muted-foreground">No steps match “{q}”.</div>}
        {groups.map((g) => (
          <PaletteGroup key={g.category} category={g.category} items={g.items} total={g.total} open={!!term || open.has(g.category)} onToggle={() => toggle(g.category)} onAdd={onAdd} hasTrigger={hasTrigger} />
        ))}
      </div>
      <div className="border-t px-3 py-2 text-[10.5px] text-muted-foreground">Drag a step onto the canvas, or click <Plus className="inline size-3" /> to add it after the selected step.</div>
    </div>
  );
}

function PaletteGroup({ category, items, total, open, onToggle, onAdd, hasTrigger }: { category: NodeCategory; items: NodeTypeSpec[]; total: number; open: boolean; onToggle: () => void; onAdd: (t: WorkflowNodeType) => void; hasTrigger: boolean }) {
  const meta = CATEGORY_META[category];
  const tone = toneFor(`${category}.x`);
  return (
    <div className="mb-0.5" role="treeitem" aria-expanded={open}>
      <button type="button" onClick={onToggle} className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-accent/60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`${meta.plural} (${items.length})`}>
        <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className={cn("size-2 rounded-full", tone.bg.replace("/10", "").replace("/12", "").replace("/18", ""), tone.text.includes("primary") ? "bg-primary" : tone.text.includes("success") ? "bg-success" : tone.text.includes("info") ? "bg-info" : tone.text.includes("warning") ? "bg-warning" : "bg-chart-5")} aria-hidden />
        <span className="flex-1 text-[12px] font-medium">{meta.plural}</span>
        <span className="text-[10.5px] tabular text-muted-foreground">{items.length === total ? total : `${items.length}/${total}`}</span>
      </button>
      {open && (
        <div className="space-y-0.5 pb-1 pl-1">
          {items.map((n) => <PaletteItem key={n.type} spec={n} disabled={category === "trigger" && hasTrigger} onAdd={() => onAdd(n.type)} />)}
        </div>
      )}
    </div>
  );
}

function PaletteItem({ spec, disabled, onAdd }: { spec: NodeTypeSpec; disabled: boolean; onAdd: () => void }) {
  const inner = (
    <div
      draggable={!disabled}
      onDragStart={(e) => { e.dataTransfer.setData(DND_MIME, spec.type); e.dataTransfer.effectAllowed = "move"; }}
      onDoubleClick={() => !disabled && onAdd()}
      className={cn("group flex cursor-grab items-start gap-2 rounded-md border border-transparent px-1.5 py-1.5 transition-colors hover:border-border hover:bg-accent/60 active:cursor-grabbing", disabled && "cursor-not-allowed opacity-45 hover:bg-transparent")}
      role="button"
      aria-disabled={disabled}
      title={disabled ? "Only one trigger per workflow" : `${spec.label} — drag to canvas or double-click to add`}
    >
      <GripVertical className="mt-1 size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
      <NodeTypeIcon type={spec.type} size="sm" className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{spec.label}</span>
          {spec.usesAI && <span className="rounded bg-primary/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-primary">AI</span>}
          {spec.usesNetwork && <span className="rounded bg-info/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-info">net</span>}
        </div>
        <div className="line-clamp-1 text-[10.5px] leading-snug text-muted-foreground" title={spec.description}>{spec.description}</div>
      </div>
      {!disabled && (
        <button onClick={(e) => { e.stopPropagation(); onAdd(); }} className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 cursor-pointer" aria-label={`Add ${spec.label}`}>
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
  return disabled ? <Tip label="Only one trigger per workflow" side="right">{inner}</Tip> : inner;
}
