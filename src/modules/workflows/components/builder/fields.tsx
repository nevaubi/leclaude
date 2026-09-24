"use client";
import * as React from "react";
import { Braces, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CONDITION_OPS, type BranchRule, type Condition } from "../../conditions";
import type { FieldSpec } from "../../registry";
import { describeSchedule, nextRunAt, normalizeSchedule, SCHEDULE_PRESETS } from "../../schedule";
import type { ScheduleConfig } from "../../types";
import type { WorkflowMeta } from "../../hooks";

export interface VariableItem { path: string; label: string; hint?: string }
export interface VariableGroup { label: string; items: VariableItem[] }

export interface FieldContext {
  meta: WorkflowMeta | null;
  inputs: { key: string; label: string; type: string }[];
  variables: VariableGroup[];
  matterOptions: { value: string; label: string; hint?: string }[];
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─────────────────────────── Variable picker ───────────────────────────

export function VariablePicker({ groups, onPick, className }: { groups: VariableGroup[]; onPick: (path: string) => void; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const term = q.trim().toLowerCase();
  const filtered = groups.map((g) => ({ ...g, items: g.items.filter((i) => !term || `${i.path} ${i.label} ${i.hint ?? ""}`.toLowerCase().includes(term)) })).filter((g) => g.items.length);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex h-6 items-center gap-1 rounded border bg-background px-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer", className)} title="Insert a variable">
          <Braces className="size-3" /> Insert variable
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b p-2"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search variables…" className="h-7 text-xs" /></div>
        <div className="max-h-72 overflow-y-auto scrollbar-thin p-1">
          {filtered.length === 0 && <div className="p-3 text-center text-xs text-muted-foreground">No variables match.</div>}
          {filtered.map((g) => (
            <div key={g.label} className="mb-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
              {g.items.map((it) => (
                <button key={it.path} type="button" onClick={() => { onPick(`{{${it.path}}}`); setOpen(false); setQ(""); }} className="flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-accent cursor-pointer">
                  <span className="font-mono text-[11px] text-foreground">{`{{${it.path}}}`}</span>
                  <span className="text-[10.5px] text-muted-foreground">{it.label}{it.hint ? ` — ${it.hint}` : ""}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t px-2 py-1.5 text-[10px] text-muted-foreground">Filters: <span className="font-mono">| json · | truncate:500 · | join:&quot;, &quot; · | pluck:key · | table · | date:long</span></div>
      </PopoverContent>
    </Popover>
  );
}

/** Text / textarea with a variable picker that inserts at the caret. */
export function TemplateInput({ value, onChange, groups, rows, placeholder, mono, single, id }: { value: string; onChange: (v: string) => void; groups: VariableGroup[]; rows?: number; placeholder?: string; mono?: boolean; single?: boolean; id?: string }) {
  const ref = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const insert = (snippet: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => { if (el) { el.focus(); const pos = start + snippet.length; el.setSelectionRange(pos, pos); } });
  };
  const cls = cn("text-xs", mono && "font-mono", !single && "leading-relaxed");
  return (
    <div className="space-y-1">
      {single ? (
        <Input id={id} ref={ref as React.RefObject<HTMLInputElement>} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn("h-8", cls)} />
      ) : (
        <Textarea id={id} ref={ref as React.RefObject<HTMLTextAreaElement>} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows ?? 3} className={cn("min-h-0 resize-y", cls)} spellCheck={false} />
      )}
      <div className="flex justify-end"><VariablePicker groups={groups} onPick={insert} /></div>
    </div>
  );
}

// ─────────────────────────── List editors ───────────────────────────

const FIELD_TYPES = ["string", "string[]", "number", "boolean", "date", "object", "object[]"];

export function FieldsEditor({ value, onChange }: { value: { name: string; type?: string; description?: string }[]; onChange: (v: { name: string; type?: string; description?: string }[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  const update = (i: number, patch: Partial<{ name: string; type: string; description: string }>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border bg-background/60 p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Input value={r.name} onChange={(e) => update(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} placeholder="field_name" className="h-7 flex-1 font-mono text-[11px]" />
            <Select value={r.type ?? "string"} onValueChange={(v) => update(i, { type: v })}>
              <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="icon-xs" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove field"><Trash2 className="size-3.5" /></Button>
          </div>
          <Input value={r.description ?? ""} onChange={(e) => update(i, { description: e.target.value })} placeholder="What to extract, with any normalization rule" className="h-7 text-[11px]" />
        </div>
      ))}
      <Button variant="outline" size="xs" onClick={() => onChange([...rows, { name: "", type: "string", description: "" }])}><Plus className="size-3" /> Add field</Button>
    </div>
  );
}

export function LabelsEditor({ value, onChange }: { value: { label: string; description?: string }[]; onChange: (v: { label: string; description?: string }[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <Input value={r.label} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="label" className="h-7 w-28 font-mono text-[11px]" />
          <Input value={r.description ?? ""} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="When to use this label" className="h-7 flex-1 text-[11px]" />
          <Button variant="ghost" size="icon-xs" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove label"><Trash2 className="size-3.5" /></Button>
        </div>
      ))}
      <Button variant="outline" size="xs" onClick={() => onChange([...rows, { label: "", description: "" }])}><Plus className="size-3" /> Add label</Button>
    </div>
  );
}

export function ChecklistEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-1.5 w-4 text-right font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
          <Textarea value={r} onChange={(e) => onChange(rows.map((x, j) => (j === i ? e.target.value : x)))} rows={1} className="min-h-0 flex-1 resize-none py-1.5 text-[11px]" />
          <Button variant="ghost" size="icon-xs" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove item"><Trash2 className="size-3.5" /></Button>
        </div>
      ))}
      <Button variant="outline" size="xs" onClick={() => onChange([...rows, ""])}><Plus className="size-3" /> Add item</Button>
    </div>
  );
}

export function KvEditor({ value, onChange, groups }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; groups: VariableGroup[] }) {
  const entries = Object.entries(value ?? {});
  const [draftKey, setDraftKey] = React.useState("");
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-start gap-1.5">
          <span className="mt-1.5 w-24 truncate font-mono text-[11px]" title={k}>{k}</span>
          <div className="flex-1"><TemplateInput single value={String(v ?? "")} onChange={(nv) => onChange({ ...value, [k]: nv })} groups={groups} /></div>
          <Button variant="ghost" size="icon-xs" onClick={() => { const next = { ...value }; delete next[k]; onChange(next); }} aria-label="Remove"><Trash2 className="size-3.5" /></Button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Input value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="input key" className="h-7 w-32 font-mono text-[11px]" onKeyDown={(e) => { if (e.key === "Enter" && draftKey.trim()) { onChange({ ...value, [draftKey.trim()]: "" }); setDraftKey(""); } }} />
        <Button variant="outline" size="xs" disabled={!draftKey.trim()} onClick={() => { onChange({ ...value, [draftKey.trim()]: "" }); setDraftKey(""); }}><Plus className="size-3" /> Add</Button>
      </div>
    </div>
  );
}

export function TagsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = React.useState("");
  const tags = Array.isArray(value) ? value : [];
  const add = () => { const t = draft.trim().replace(/,$/, ""); if (t && !tags.includes(t)) onChange([...tags, t]); setDraft(""); };
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background px-1.5 py-1">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">{t}<button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label={`Remove ${t}`}><X className="size-3" /></button></span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1)); }} onBlur={add} placeholder={tags.length ? "" : (placeholder ?? "Add tag…")} className="h-6 min-w-[80px] flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground" />
    </div>
  );
}

export function JsonField({ value, onChange, rows }: { value: unknown; onChange: (v: string) => void; rows?: number }) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (!text.trim()) { setErr(null); return; } try { JSON.parse(text); setErr(null); } catch (e) { setErr((e as Error).message); } }, [text]);
  return (
    <div className="space-y-1">
      <Textarea value={text} onChange={(e) => onChange(e.target.value)} rows={rows ?? 6} spellCheck={false} className={cn("min-h-0 font-mono text-[11px] leading-relaxed", err && "border-destructive")} />
      {err ? <div className="text-[10.5px] text-destructive">Invalid JSON: {err}</div> : text.trim() ? <div className="text-[10.5px] text-success">Valid JSON</div> : null}
    </div>
  );
}

export function ConditionsEditor({ value, onChange, groups }: { value: BranchRule[]; onChange: (v: BranchRule[]) => void; groups: VariableGroup[] }) {
  const rules = Array.isArray(value) ? value : [];
  const updateRule = (i: number, patch: Partial<BranchRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateCond = (ri: number, ci: number, patch: Partial<Condition>) => updateRule(ri, { conditions: rules[ri].conditions.map((c, j) => (j === ci ? { ...c, ...patch } : c)) });
  const idFrom = (label: string, i: number) => { const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `rule_${i + 1}`; return rules.some((r, j) => j !== i && r.id === base) ? `${base}_${i + 1}` : base; };
  return (
    <div className="space-y-2">
      {rules.map((r, ri) => (
        <div key={ri} className="rounded-md border bg-background/60 p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Input value={r.label ?? ""} onChange={(e) => updateRule(ri, { label: e.target.value, id: idFrom(e.target.value, ri) })} placeholder="Rule label (becomes the handle)" className="h-7 flex-1 text-[11px]" />
            <span className="font-mono text-[10px] text-muted-foreground" title="Source handle id">{r.id}</span>
            <Select value={r.logic ?? "all"} onValueChange={(v) => updateRule(ri, { logic: v as "all" | "any" })}>
              <SelectTrigger size="sm" className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">all of</SelectItem><SelectItem value="any">any of</SelectItem></SelectContent>
            </Select>
            <Button variant="ghost" size="icon-xs" onClick={() => onChange(rules.filter((_, j) => j !== ri))} aria-label="Remove rule"><Trash2 className="size-3.5" /></Button>
          </div>
          {(r.conditions ?? []).map((c, ci) => {
            const op = CONDITION_OPS.find((o) => o.value === c.op);
            return (
              <div key={ci} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1">
                <Input value={c.left} onChange={(e) => updateCond(ri, ci, { left: e.target.value })} placeholder="{{steps.classify.output.label}}" className="h-7 font-mono text-[10.5px]" />
                <Select value={c.op} onValueChange={(v) => updateCond(ri, ci, { op: v as Condition["op"] })}>
                  <SelectTrigger size="sm" className="w-[132px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONDITION_OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={c.right ?? ""} disabled={op?.unary} onChange={(e) => updateCond(ri, ci, { right: e.target.value })} placeholder={op?.unary ? "—" : "value"} className="h-7 font-mono text-[10.5px]" />
                <Button variant="ghost" size="icon-xs" onClick={() => updateRule(ri, { conditions: r.conditions.filter((_, j) => j !== ci) })} aria-label="Remove condition"><X className="size-3.5" /></Button>
              </div>
            );
          })}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="xs" onClick={() => updateRule(ri, { conditions: [...(r.conditions ?? []), { left: "", op: "equals", right: "" }] })}><Plus className="size-3" /> Condition</Button>
            <VariablePicker groups={groups} onPick={(v) => { const last = (r.conditions ?? []).length - 1; if (last >= 0 && !r.conditions[last].left) updateCond(ri, last, { left: v }); else updateRule(ri, { conditions: [...(r.conditions ?? []), { left: v, op: "equals", right: "" }] }); }} />
          </div>
        </div>
      ))}
      <Button variant="outline" size="xs" onClick={() => onChange([...rules, { id: `rule_${rules.length + 1}`, label: `Rule ${rules.length + 1}`, logic: "all", conditions: [{ left: "", op: "equals", right: "" }] }])}><Plus className="size-3" /> Add rule</Button>
      <div className="text-[10.5px] text-muted-foreground">Rules are evaluated top to bottom; the first match wins. Everything else follows the <span className="font-mono">else</span> handle.</div>
    </div>
  );
}

export function ScheduleEditor({ value, onChange }: { value: unknown; onChange: (v: ScheduleConfig) => void }) {
  const s = normalizeSchedule(value) ?? { frequency: "weekly", time: "06:00", weekday: 1, dayOfMonth: 1 };
  const next = nextRunAt(s, new Date());
  return (
    <div className="space-y-2 rounded-md border bg-background/60 p-2">
      <div className="flex flex-wrap gap-1">
        {SCHEDULE_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => onChange({ ...s, ...p.value })} className={cn("rounded-full border px-2 py-0.5 text-[10.5px] hover:bg-accent cursor-pointer", describeSchedule(s) === describeSchedule(p.value) && "border-primary bg-primary/10 text-primary")}>{p.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10.5px] text-muted-foreground">Frequency</Label>
          <Select value={s.frequency} onValueChange={(v) => onChange({ ...s, frequency: v as ScheduleConfig["frequency"] })}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10.5px] text-muted-foreground">{s.frequency === "hourly" ? "Minute (mm)" : "Time"}</Label>
          <Input type="time" value={s.time ?? "06:00"} onChange={(e) => onChange({ ...s, time: e.target.value || "06:00" })} className="h-8 text-xs" />
        </div>
        {s.frequency === "weekly" && (
          <div className="space-y-1">
            <Label className="text-[10.5px] text-muted-foreground">Weekday</Label>
            <Select value={String(s.weekday ?? 1)} onValueChange={(v) => onChange({ ...s, weekday: Number(v) })}>
              <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>{DAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {s.frequency === "monthly" && (
          <div className="space-y-1">
            <Label className="text-[10.5px] text-muted-foreground">Day of month</Label>
            <Input type="number" min={1} max={28} value={s.dayOfMonth ?? 1} onChange={(e) => onChange({ ...s, dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} className="h-8 text-xs" />
          </div>
        )}
      </div>
      <div className="text-[10.5px] text-muted-foreground">{describeSchedule(s)} · next {next.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (server time)</div>
    </div>
  );
}

export function MultiSelect({ options, value, onChange }: { options: { value: string; label: string; hint?: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = React.useState(false);
  const selected = Array.isArray(value) ? value : [];
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const labels = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-background px-2.5 text-left text-xs shadow-xs hover:bg-accent/40 cursor-pointer">
          <span className={cn("truncate", !labels.length && "text-muted-foreground")}>{labels.length ? labels.join(", ") : "Select…"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <div className="max-h-64 overflow-y-auto scrollbar-thin">
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
              <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="truncate text-[10px] text-muted-foreground">{o.hint}</span>}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Select with an escape hatch for arbitrary template values. */
export function SelectOrCustom({ options, value, onChange, groups, placeholder }: { options: { value: string; label: string; hint?: string }[]; value: string; onChange: (v: string) => void; groups: VariableGroup[]; placeholder?: string }) {
  const known = options.some((o) => o.value === value);
  const [custom, setCustom] = React.useState(!known && Boolean(value));
  React.useEffect(() => { if (!known && value) setCustom(true); }, [known, value]);
  if (custom) {
    return (
      <div className="space-y-1">
        <TemplateInput single value={value} onChange={onChange} groups={groups} placeholder={placeholder} mono />
        <button type="button" onClick={() => { setCustom(false); if (!known) onChange(options[0]?.value ?? ""); }} className="text-[10.5px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer">Choose from list instead</button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger size="sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value || "__none__"} value={o.value || "__none__"}>{o.label}{o.hint ? <span className="ml-1 text-[10px] text-muted-foreground">{o.hint}</span> : null}</SelectItem>)}
        </SelectContent>
      </Select>
      <button type="button" onClick={() => setCustom(true)} className="text-[10.5px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer">Use an expression</button>
    </div>
  );
}

// ─────────────────────────── Field dispatcher ───────────────────────────

export function ConfigField({ spec, value, onChange, ctx }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; ctx: FieldContext }) {
  const id = `f_${spec.key.replace(/\./g, "_")}`;
  const people = ctx.meta?.people ?? [];
  let control: React.ReactNode;
  switch (spec.type) {
    case "text":
      control = <TemplateInput id={id} single value={String(value ?? "")} onChange={onChange} groups={ctx.variables} placeholder={spec.placeholder} />;
      break;
    case "template":
      control = <TemplateInput id={id} value={String(value ?? "")} onChange={onChange} groups={ctx.variables} rows={spec.rows} placeholder={spec.placeholder} />;
      break;
    case "textarea":
      control = <Textarea id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={spec.rows ?? 3} placeholder={spec.placeholder} className="min-h-0 resize-y text-xs leading-relaxed" />;
      break;
    case "number":
      control = <Input id={id} type="number" min={spec.min} max={spec.max} value={value == null || value === "" ? "" : Number(value)} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className="h-8 w-32 text-xs" />;
      break;
    case "toggle":
      control = <Switch id={id} checked={Boolean(value)} onCheckedChange={(v) => onChange(v)} size="sm" />;
      break;
    case "select":
      control = (
        <Select value={String(value ?? "")} onValueChange={(v) => onChange(v === "__empty__" ? "" : v)}>
          <SelectTrigger id={id} size="sm"><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>{(spec.options ?? []).map((o) => <SelectItem key={o.value || "__empty__"} value={o.value || "__empty__"}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      );
      break;
    case "multiselect": {
      const options = spec.options?.length ? spec.options : people.map((p) => ({ value: p.id, label: p.name, hint: p.title }));
      control = <MultiSelect options={options} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;
      break;
    }
    case "person":
      control = <SelectOrCustom options={[{ value: "", label: "Unassigned" }, ...people.map((p) => ({ value: p.id, label: p.name, hint: p.title }))]} value={String(value ?? "")} onChange={onChange} groups={ctx.variables} placeholder="{{inputs.assignee}}" />;
      break;
    case "matter":
      control = <SelectOrCustom options={ctx.matterOptions} value={String(value ?? "")} onChange={onChange} groups={ctx.variables} placeholder="{{inputs.matter}}" />;
      break;
    case "tags":
      control = <TagsInput value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;
      break;
    case "json":
      control = <JsonField value={value} onChange={onChange} rows={spec.rows} />;
      break;
    case "fields":
      control = <FieldsEditor value={value as { name: string; type?: string; description?: string }[]} onChange={onChange} />;
      break;
    case "labels":
      control = <LabelsEditor value={value as { label: string; description?: string }[]} onChange={onChange} />;
      break;
    case "conditions":
      control = <ConditionsEditor value={value as BranchRule[]} onChange={onChange} groups={ctx.variables} />;
      break;
    case "checklist":
      control = <ChecklistEditor value={value as string[]} onChange={onChange} />;
      break;
    case "kv":
      control = <KvEditor value={(value as Record<string, unknown>) ?? {}} onChange={onChange} groups={ctx.variables} />;
      break;
    case "schedule":
      control = <ScheduleEditor value={value} onChange={onChange} />;
      break;
    default:
      control = <Input id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" />;
  }
  const inline = spec.type === "toggle";
  return (
    <div className={cn("space-y-1", inline && "flex items-center justify-between gap-3 space-y-0")}>
      <div className="min-w-0">
        <Label htmlFor={id} className="text-[11px]">{spec.label}{spec.required && <span className="ml-0.5 text-destructive">*</span>}</Label>
        {spec.help && inline && <div className="text-[10.5px] text-muted-foreground">{spec.help}</div>}
      </div>
      {control}
      {spec.help && !inline && <div className="text-[10.5px] leading-snug text-muted-foreground">{spec.help}</div>}
    </div>
  );
}
