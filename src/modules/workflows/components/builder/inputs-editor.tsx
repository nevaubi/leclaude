"use client";
import * as React from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { Workflow } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type WorkflowInput = NonNullable<Workflow["inputs"]>[number];

const TYPES: { value: WorkflowInput["type"]; label: string }[] = [
  { value: "text", label: "Text" }, { value: "textarea", label: "Long text" }, { value: "file", label: "File (text extracted)" }, { value: "matter", label: "Matter" }, { value: "select", label: "Select" }, { value: "number", label: "Number" }, { value: "date", label: "Date" },
];

export function InputsEditor({ value, onChange }: { value: WorkflowInput[]; onChange: (v: WorkflowInput[]) => void }) {
  const rows = value ?? [];
  const update = (i: number, patch: Partial<WorkflowInput>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const keyFrom = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^(\d)/, "_$1");
  return (
    <div className="space-y-2">
      {rows.length === 0 && <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">No inputs yet. Inputs become the run form and are available as <span className="font-mono">{"{{inputs.key}}"}</span>.</div>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border bg-background/60 p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <GripVertical className="size-3.5 text-muted-foreground/40" />
            <Input value={r.label} onChange={(e) => update(i, { label: e.target.value, key: r.key && r.key !== keyFrom(r.label) ? r.key : keyFrom(e.target.value) })} placeholder="Label shown on the form" className="h-7 flex-1 text-[11px]" />
            <Select value={r.type} onValueChange={(v) => update(i, { type: v as WorkflowInput["type"] })}>
              <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="icon-xs" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove input"><Trash2 className="size-3.5" /></Button>
          </div>
          <div className="flex items-center gap-2 pl-5">
            <span className="text-[10.5px] text-muted-foreground">key</span>
            <Input value={r.key} onChange={(e) => update(i, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} className="h-6 w-40 font-mono text-[10.5px]" />
            <label className="ml-auto flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><Switch size="sm" checked={Boolean(r.required)} onCheckedChange={(v) => update(i, { required: v })} /> Required</label>
          </div>
          <div className="pl-5">
            <Input value={r.placeholder ?? ""} onChange={(e) => update(i, { placeholder: e.target.value })} placeholder="Placeholder / hint" className="h-6 text-[10.5px]" />
          </div>
          {r.type === "select" && (
            <div className="pl-5">
              <Input value={(r.options ?? []).join(", ")} onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Options, comma separated" className="h-6 text-[10.5px]" />
            </div>
          )}
        </div>
      ))}
      <Button variant="outline" size="xs" onClick={() => onChange([...rows, { key: `input_${rows.length + 1}`, label: "", type: "text", required: false }])}><Plus className="size-3" /> Add input</Button>
    </div>
  );
}
