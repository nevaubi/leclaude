"use client";
import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import type { WorkflowFrontend, WorkflowFrontendField } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldGroup } from "@/components/ui/form";
import { FolderSelect, PersonSelect } from "@/components/ui/entity-selects";
import { emptyFrontend, FRONTEND_FIELD_TYPES, OUTPUT_FORMAT_LABEL, OUTPUT_FORMATS, type FrontendFieldType, type OutputFormat } from "../../frontend";
import type { WorkflowMeta } from "../../hooks";
import { FrontendFieldControl } from "../frontend/frontend-fields";
import { initialFieldValues, sections } from "../frontend/frontend-helpers";
import { addField, moveField, removeField, renameFieldKey, updateField } from "./frontend-editor-ops";
import { useBuilderStore } from "./store";

export { addField, moveField, removeField, renameFieldKey, updateField };

const NEEDS_OPTIONS: FrontendFieldType[] = ["select", "multiselect"];
const NEEDS_ACCEPT: FrontendFieldType[] = ["file", "files"];

/**
 * Builder tab "Front end": the start form's field list (drag to reorder,
 * add/remove, per-field settings), the output and after-run settings, and a
 * live preview of the page on the right.
 */
export function FrontendEditor({ meta }: { meta: WorkflowMeta | null }) {
  const fe = useBuilderStore((s) => s.meta.frontend);
  const name = useBuilderStore((s) => s.meta.name);
  const workflowId = useBuilderStore((s) => s.workflowId);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const set = React.useCallback((next: WorkflowFrontend | null) => setMeta({ frontend: next }), [setMeta]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (!fe) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <div className="text-[13px] font-medium">No front end yet</div>
          <p className="text-[12px] text-muted-foreground">A front end is the one-page form people fill in to start this workflow: files, matter, choices, the output format and where it is filed. Without one, the run dialog is generated from the inputs list.</p>
          <Button size="sm" onClick={() => set(emptyFrontend(name || "Start"))}><Plus className="size-3.5" /> Create a front end</Button>
        </div>
      </div>
    );
  }

  const selected = fe.fields.find((f) => f.key === selectedKey) ?? null;
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = fe.fields.findIndex((f) => f.key === active.id);
    const to = fe.fields.findIndex((f) => f.key === over.id);
    set(moveField(fe, from, to));
  };
  const add = (type: FrontendFieldType) => {
    const label = FRONTEND_FIELD_TYPES.find((t) => t.value === type)?.label ?? "Field";
    const next = addField(fe, type, label);
    set(next);
    setSelectedKey(next.fields[next.fields.length - 1].key);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Editor */}
      <div className="min-h-0 overflow-y-auto scrollbar-thin border-r">
        <div className="space-y-5 p-4">
          <FieldGroup title="Page">
            <Field label="Title" htmlFor="fe_title"><Input id="fe_title" size="xs" value={fe.title} onChange={(e) => set({ ...fe, title: e.target.value })} className="max-w-md" /></Field>
            <Field label="Intro" help="One or two sentences above the form." htmlFor="fe_intro"><Textarea id="fe_intro" value={fe.intro ?? ""} onChange={(e) => set({ ...fe, intro: e.target.value })} rows={2} className="min-h-0 text-[12.5px]" /></Field>
            <Field label="Submit button" htmlFor="fe_submit"><Input id="fe_submit" size="xs" value={fe.submitLabel ?? ""} onChange={(e) => set({ ...fe, submitLabel: e.target.value })} placeholder="Run" className="w-56" /></Field>
          </FieldGroup>

          <FieldGroup title="Fields" description="Values arrive as inputs.<key>; files as the extracted text plus <key>_file.">
            <div className="rounded-md border">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={fe.fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
                  <ul className="divide-y divide-line-quiet" aria-label="Front-end fields">
                    {fe.fields.map((f, i) => <FieldRow key={f.key} field={f} index={i} count={fe.fields.length} selected={f.key === selectedKey} onSelect={() => setSelectedKey(f.key)} onMove={(d) => set(moveField(fe, i, i + d))} onRemove={() => { set(removeField(fe, f.key)); if (selectedKey === f.key) setSelectedKey(null); }} />)}
                  </ul>
                </SortableContext>
              </DndContext>
              {fe.fields.length === 0 && <div className="px-3 py-4 text-center text-[11.5px] text-muted-foreground">No fields yet. Add one below.</div>}
              <div className="flex flex-wrap items-center gap-1 border-t p-1.5">
                <span className="px-1 text-[11px] text-muted-foreground">Add</span>
                {FRONTEND_FIELD_TYPES.map((t) => <Button key={t.value} variant="ghost" size="xs" onClick={() => add(t.value)} title={t.hint}>{t.label}</Button>)}
              </div>
            </div>
            {selected && <FieldSettings key={selected.key} field={selected} fe={fe} onChange={set} meta={meta} onRenamed={setSelectedKey} />}
          </FieldGroup>

          <FieldGroup title="Output" description="Offered formats, the default label template and where the deliverable is filed.">
            <Field label="Formats">
              <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Offered formats">
                {OUTPUT_FORMATS.map((f) => {
                  const list = fe.output?.formats ?? [];
                  const on = list.includes(f);
                  return <label key={f} className="flex h-7 items-center gap-1.5 text-[12.5px]"><Checkbox size="sm" checked={on} onCheckedChange={(c) => set({ ...fe, output: { ...(fe.output ?? {}), formats: c ? [...list, f] : list.filter((x) => x !== f), defaultFormat: c || fe.output?.defaultFormat !== f ? fe.output?.defaultFormat : undefined } })} />{OUTPUT_FORMAT_LABEL[f]}</label>;
                })}
              </div>
            </Field>
            <Field label="Default format" htmlFor="fe_def_format">
              <Select value={fe.output?.defaultFormat ?? ""} onValueChange={(v) => set({ ...fe, output: { ...(fe.output ?? {}), defaultFormat: v as OutputFormat } })}>
                <SelectTrigger id="fe_def_format" size="xs" className="w-56"><SelectValue placeholder="First offered format" /></SelectTrigger>
                <SelectContent>{(fe.output?.formats?.length ? fe.output.formats : OUTPUT_FORMATS).map((f) => <SelectItem key={f} value={f}>{OUTPUT_FORMAT_LABEL[f]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Default label" help="Template for the file name, e.g. Privilege log — {{matter.shortName}} — {{now | date:short}}." htmlFor="fe_def_label"><Input id="fe_def_label" size="xs" value={fe.output?.defaultLabel ?? ""} onChange={(e) => set({ ...fe, output: { ...(fe.output ?? {}), defaultLabel: e.target.value } })} className="max-w-md font-mono text-[11.5px]" /></Field>
            <Field label="Library folder" help="Leave empty to file under the matter folder." htmlFor="fe_folder"><FolderSelect id="fe_folder" size="xs" value={fe.output?.libraryFolderId || null} onChange={(v) => set({ ...fe, output: { ...(fe.output ?? {}), libraryFolderId: v ?? undefined } })} allowNone noneLabel="Matter folder (default)" className="max-w-sm" /></Field>
            <Field label="Notify when done">
              <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Notify people">
                {(meta?.people ?? []).map((p) => {
                  const list = fe.output?.notifyPeopleIds ?? [];
                  const on = list.includes(p.id);
                  return <label key={p.id} className="flex h-7 items-center gap-1.5 text-[12.5px]"><Checkbox size="sm" checked={on} onCheckedChange={(c) => set({ ...fe, output: { ...(fe.output ?? {}), notifyPeopleIds: c ? [...list, p.id] : list.filter((x) => x !== p.id) } })} />{p.name}</label>;
                })}
                {!meta?.people.length && <span className="text-[11.5px] text-muted-foreground">Loading people…</span>}
              </div>
            </Field>
          </FieldGroup>

          <FieldGroup title="After the run" description="Executed once the run succeeds.">
            <Field label="Create a task" help="Title template; leave empty for no task." htmlFor="fe_task_title"><Input id="fe_task_title" size="xs" value={fe.after?.createTask?.title ?? ""} onChange={(e) => set({ ...fe, after: { ...(fe.after ?? {}), createTask: e.target.value ? { ...(fe.after?.createTask ?? { title: "" }), title: e.target.value } : undefined } })} placeholder="Review {{run.workflowName}} output" className="max-w-md" /></Field>
            {fe.after?.createTask?.title && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Assignee" htmlFor="fe_task_assignee"><PersonSelect id="fe_task_assignee" size="xs" value={fe.after.createTask.assigneeId || null} onChange={(v) => set({ ...fe, after: { ...fe.after, createTask: { ...fe.after!.createTask!, assigneeId: v ?? undefined } } })} people={meta?.people.map((p) => ({ id: p.id, name: p.name, title: p.title }))} allowNone noneLabel="Whoever ran it" /></Field>
                <Field label="Due" help="+3d, +1bd (business day), next monday" htmlFor="fe_task_due"><Input id="fe_task_due" size="xs" value={fe.after.createTask.dueRule ?? ""} onChange={(e) => set({ ...fe, after: { ...fe.after, createTask: { ...fe.after!.createTask!, dueRule: e.target.value || undefined } } })} placeholder="+3d" className="w-32 font-mono" /></Field>
              </div>
            )}
            <Field label="Then start">
              <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Workflows to start afterwards">
                {(meta?.workflows ?? []).filter((w) => w.id !== workflowId && !w.system).map((w) => {
                  const list = fe.after?.triggerWorkflowIds ?? [];
                  const on = list.includes(w.id);
                  return <label key={w.id} className="flex h-7 items-center gap-1.5 text-[12.5px]"><Checkbox size="sm" checked={on} onCheckedChange={(c) => set({ ...fe, after: { ...(fe.after ?? {}), triggerWorkflowIds: c ? [...list, w.id] : list.filter((x) => x !== w.id) } })} />{w.name}</label>;
                })}
                {!meta?.workflows?.length && <span className="text-[11.5px] text-muted-foreground">No other workflows yet.</span>}
              </div>
            </Field>
          </FieldGroup>

          <div className="flex items-center justify-between border-t pt-3 text-[11.5px] text-muted-foreground">
            <span>Saving the workflow also refreshes its inputs list from these fields.</span>
            <Button variant="ghost" size="xs" className="text-destructive" onClick={() => { if (confirm("Remove the front end? The run dialog will be generated from the inputs list instead.")) { set(null); setSelectedKey(null); } }}><Trash2 className="size-3" /> Remove front end</Button>
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="hidden min-h-0 overflow-y-auto scrollbar-thin bg-background xl:block">
        <FrontendPreview fe={fe} meta={meta} workflowId={workflowId} />
      </div>
    </div>
  );
}

function FieldRow({ field, index, count, selected, onSelect, onMove, onRemove }: { field: WorkflowFrontendField; index: number; count: number; selected: boolean; onSelect: () => void; onMove: (delta: number) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const type = FRONTEND_FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type;
  return (
    <li ref={setNodeRef} style={style} className={cn("flex h-8 items-center gap-1.5 pr-1 text-[12px]", selected ? "row-selected" : "row-hover")} data-key={field.key} onClick={onSelect}>
      <button type="button" className="flex h-full w-6 cursor-grab items-center justify-center text-muted-foreground/60 hover:text-foreground" aria-label={`Drag ${field.label}`} {...attributes} {...listeners}><GripVertical className="size-3.5" /></button>
      <span className="min-w-0 flex-1 truncate font-medium">{field.label}{field.required && <span className="ml-0.5 text-destructive">*</span>}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{type}</span>
      <span className="hidden shrink-0 font-mono text-[10.5px] text-muted-foreground md:inline">{field.key}</span>
      <Button variant="ghost" size="icon-xs" className="size-6" onClick={(e) => { e.stopPropagation(); onMove(-1); }} disabled={index === 0} aria-label="Move up"><ChevronUp className="size-3" /></Button>
      <Button variant="ghost" size="icon-xs" className="size-6" onClick={(e) => { e.stopPropagation(); onMove(1); }} disabled={index >= count - 1} aria-label="Move down"><ChevronDown className="size-3" /></Button>
      <Button variant="ghost" size="icon-xs" className="size-6" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${field.label}`}><Trash2 className="size-3" /></Button>
    </li>
  );
}

function FieldSettings({ field, fe, onChange, meta, onRenamed }: { field: WorkflowFrontendField; fe: WorkflowFrontend; onChange: (fe: WorkflowFrontend) => void; meta: WorkflowMeta | null; onRenamed: (key: string) => void }) {
  const patch = (p: Partial<WorkflowFrontendField>) => onChange(updateField(fe, field.key, p));
  const [keyDraft, setKeyDraft] = React.useState(field.key);
  void meta;
  return (
    <div className="space-y-3 rounded-md border bg-card p-3" aria-label={`Settings for ${field.label}`}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Label" htmlFor={`fs_label_${field.key}`}><Input id={`fs_label_${field.key}`} size="xs" value={field.label} onChange={(e) => patch({ label: e.target.value })} /></Field>
        <Field label="Type" htmlFor={`fs_type_${field.key}`}>
          <Select value={field.type} onValueChange={(v) => patch({ type: v as FrontendFieldType, options: NEEDS_OPTIONS.includes(v as FrontendFieldType) ? (field.options ?? ["Option A", "Option B"]) : undefined, accept: NEEDS_ACCEPT.includes(v as FrontendFieldType) ? (field.accept ?? [".docx", ".pdf", ".txt", ".md"]) : undefined })}>
            <SelectTrigger id={`fs_type_${field.key}`} size="xs"><SelectValue /></SelectTrigger>
            <SelectContent>{FRONTEND_FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Key" help="inputs.<key> in step templates" htmlFor={`fs_key_${field.key}`}><Input id={`fs_key_${field.key}`} size="xs" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} onBlur={() => { const next = renameFieldKey(fe, field.key, keyDraft); if (next !== fe) { onChange(next); onRenamed(next.fields.find((f) => f.label === field.label)?.key ?? field.key); } else setKeyDraft(field.key); }} className="font-mono" /></Field>
        <Field label="Group heading" help="Optional section title" htmlFor={`fs_group_${field.key}`}><Input id={`fs_group_${field.key}`} size="xs" value={field.group ?? ""} onChange={(e) => patch({ group: e.target.value || undefined })} /></Field>
        <Field label="Placeholder" htmlFor={`fs_ph_${field.key}`}><Input id={`fs_ph_${field.key}`} size="xs" value={field.placeholder ?? ""} onChange={(e) => patch({ placeholder: e.target.value || undefined })} /></Field>
        <Field label="Help" htmlFor={`fs_help_${field.key}`}><Input id={`fs_help_${field.key}`} size="xs" value={field.help ?? ""} onChange={(e) => patch({ help: e.target.value || undefined })} /></Field>
      </div>
      {NEEDS_OPTIONS.includes(field.type) && <Field label="Options" help="One per line" htmlFor={`fs_opts_${field.key}`}><Textarea id={`fs_opts_${field.key}`} value={(field.options ?? []).join("\n")} onChange={(e) => patch({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} rows={3} className="min-h-0 text-[12px]" /></Field>}
      {NEEDS_ACCEPT.includes(field.type) && <Field label="Accepted types" help="Extensions or MIME types, comma-separated" htmlFor={`fs_accept_${field.key}`}><Input id={`fs_accept_${field.key}`} size="xs" value={(field.accept ?? []).join(", ")} onChange={(e) => patch({ accept: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className="font-mono" /></Field>}
      {(field.type === "text" || field.type === "textarea" || field.type === "number" || field.type === "date" || field.type === "label" || field.type === "bates-prefix" || field.type === "select") && <Field label="Default" htmlFor={`fs_def_${field.key}`}><Input id={`fs_def_${field.key}`} size="xs" value={field.default == null ? "" : String(field.default)} onChange={(e) => patch({ default: e.target.value === "" ? undefined : field.type === "number" ? Number(e.target.value) : e.target.value })} className="max-w-xs" /></Field>}
      <label className="flex h-7 items-center gap-2 text-[12.5px]"><Switch size="sm" checked={Boolean(field.required)} onCheckedChange={(v) => patch({ required: v })} /> Required</label>
    </div>
  );
}

function FrontendPreview({ fe, meta, workflowId }: { fe: WorkflowFrontend; meta: WorkflowMeta | null; workflowId: string }) {
  const [values, setValues] = React.useState<Record<string, unknown>>(() => initialFieldValues(fe));
  React.useEffect(() => { setValues((v) => ({ ...initialFieldValues(fe), ...v })); }, [fe]);
  const formats = fe.output?.formats?.length ? fe.output.formats : OUTPUT_FORMATS;
  return (
    <div className="mx-auto max-w-[640px] space-y-5 px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview</div>
      <div>
        <div className="text-[15px] font-semibold tracking-tight">{fe.title || "Start"}</div>
        {fe.intro && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{fe.intro}</p>}
      </div>
      {sections(fe).map((sec, i) => (
        <FieldGroup key={`${sec.group ?? "main"}-${i}`} title={sec.group}>
          {sec.fields.map((f) => <FrontendFieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} meta={meta} workflowId={workflowId} formats={formats} />)}
        </FieldGroup>
      ))}
      {fe.fields.length === 0 && <div className="rounded-md border border-dashed px-3 py-6 text-center text-[12px] text-muted-foreground">Fields appear here as you add them.</div>}
      {fe.output && (
        <FieldGroup title="Output">
          <div className="text-[12px] text-muted-foreground">{formats.map((f) => OUTPUT_FORMAT_LABEL[f]).join(" · ")}{fe.output.defaultLabel ? <><br />Label: <span className="font-mono text-[11.5px]">{fe.output.defaultLabel}</span></> : null}</div>
        </FieldGroup>
      )}
      <div className="border-t pt-3"><Button size="sm" disabled>{fe.submitLabel || "Run"}</Button></div>
    </div>
  );
}
