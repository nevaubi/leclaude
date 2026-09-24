"use client";
import * as React from "react";
import { GripVertical, Plus, Search } from "lucide-react";
import type { WorkflowNodeType } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { CATEGORY_META, CATEGORY_ORDER, NODE_TYPES, type NodeCategory, type NodeTypeSpec } from "../../registry";
import { NodeTypeIcon, toneFor } from "../shared";
import { useBuilderStore } from "./store";

export const DND_MIME = "application/x-leclaude-workflow-node";

export function NodePalette({ onAdd, searchRef, className }: { onAdd: (type: WorkflowNodeType) => void; searchRef?: React.RefObject<HTMLInputElement | null>; className?: string }) {
  const [q, setQ] = React.useState("");
  const hasTrigger = useBuilderStore((s) => s.nodes.some((n) => n.data.wfType.startsWith("trigger.")));
  const term = q.trim().toLowerCase();
  const groups = React.useMemo(() => {
    const filtered = NODE_TYPES.filter((n) => !term || `${n.label} ${n.short} ${n.description} ${n.keywords.join(" ")} ${n.type}`.toLowerCase().includes(term));
    return CATEGORY_ORDER.map((c) => ({ category: c, items: filtered.filter((n) => n.category === c) })).filter((g) => g.items.length);
  }, [term]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search steps…  ( / )" className="h-8 pl-7 text-xs" aria-label="Search node types" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2 space-y-3">
        {groups.length === 0 && <div className="px-1 py-6 text-center text-xs text-muted-foreground">No steps match “{q}”.</div>}
        {groups.map((g) => (
          <PaletteGroup key={g.category} category={g.category} items={g.items} onAdd={onAdd} hasTrigger={hasTrigger} />
        ))}
      </div>
      <div className="border-t px-3 py-2 text-[10.5px] text-muted-foreground">Drag a step onto the canvas, or click <Plus className="inline size-3" /> to add it next to the selected step.</div>
    </div>
  );
}

function PaletteGroup({ category, items, onAdd, hasTrigger }: { category: NodeCategory; items: NodeTypeSpec[]; onAdd: (t: WorkflowNodeType) => void; hasTrigger: boolean }) {
  const meta = CATEGORY_META[category];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className={cn("text-[10.5px] font-semibold uppercase tracking-wider", toneFor(`${category}.x`).text)}>{meta.plural}</span>
        <span className="text-[10px] text-muted-foreground">{items.length}</span>
      </div>
      <div className="space-y-1">
        {items.map((n) => {
          const disabled = category === "trigger" && hasTrigger;
          return (
            <PaletteItem key={n.type} spec={n} disabled={disabled} onAdd={() => onAdd(n.type)} />
          );
        })}
      </div>
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
        <div className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">{spec.description}</div>
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
