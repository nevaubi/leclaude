"use client";
import * as React from "react";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { WorkflowFrontendField } from "@/lib/types/domain";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDrop, type DroppedFile } from "@/components/ui/file-drop";
import { Field, SegmentedControl } from "@/components/ui/form";
import { FolderSelect, MatterSelect, PersonSelect } from "@/components/ui/entity-selects";
import { DEFAULT_ACCEPT, isUploadedFile, OUTPUT_FORMAT_LABEL, OUTPUT_FORMATS, type OutputFormat, type UploadedFileValue } from "../../frontend";
import { apiJson, type WorkflowMeta } from "../../hooks";
import { fieldControlId } from "./frontend-helpers";

/** Upload one file through the workflow uploads route and extract its text. */
export async function uploadForWorkflow(file: File, opts: { workflowId?: string; matterId?: string | null } = {}): Promise<UploadedFileValue> {
  const form = new FormData();
  form.append("file", file);
  if (opts.workflowId) form.append("workflowId", opts.workflowId);
  if (opts.matterId) form.append("matterId", opts.matterId);
  const up = await apiJson<{ blobId: string; name: string; mime: string; size: number }>("/api/workflows/uploads", { method: "POST", body: form });
  let text = "";
  let method: string | undefined;
  let pages: number | undefined;
  let truncated: boolean | undefined;
  try {
    const ex = await apiJson<{ text: string; method: string; pages?: number; truncated: boolean }>("/api/workflows/extract-text", { method: "POST", body: JSON.stringify({ blobId: up.blobId }) });
    text = ex.text; method = ex.method; pages = ex.pages; truncated = ex.truncated;
  } catch {
    // Binary uploads (images, load files) may have no extractable text; the blob still travels with the run.
  }
  return { blobId: up.blobId, name: up.name || file.name, mime: up.mime || file.type, size: up.size || file.size, text, method, pages, truncated };
}

export interface FrontendFieldProps {
  field: WorkflowFrontendField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  meta: WorkflowMeta | null;
  workflowId?: string;
  matterId?: string | null;
  disabled?: boolean;
  /** Reports uploads in flight so the page can hold the submit button. */
  onBusy?: (busy: boolean) => void;
  formats?: OutputFormat[];
}

export function FrontendFieldControl({ field, value, onChange, error, meta, workflowId, matterId, disabled, onBusy, formats }: FrontendFieldProps) {
  const id = fieldControlId(field.key);
  const common = { label: field.label, help: field.help, error, required: field.required, htmlFor: id };
  switch (field.type) {
    case "file":
      return <Field {...common}><SingleFileControl id={id} field={field} value={value} onChange={onChange} workflowId={workflowId} matterId={matterId} disabled={disabled} onBusy={onBusy} /></Field>;
    case "files":
      return <Field {...common}><MultiFileControl id={id} field={field} value={value} onChange={onChange} workflowId={workflowId} matterId={matterId} disabled={disabled} onBusy={onBusy} /></Field>;
    case "textarea":
      return <Field {...common}><Textarea id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={4} disabled={disabled} className="text-[13px]" /></Field>;
    case "number":
      return <Field {...common}><Input id={id} size="xs" type="number" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} disabled={disabled} className="w-40" /></Field>;
    case "date":
      return <Field {...common}><Input id={id} size="xs" type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-44" /></Field>;
    case "toggle":
      return (
        <Field {...common} htmlFor={undefined}>
          <label className="flex h-7 items-center gap-2 text-[12.5px]"><Switch size="sm" checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} aria-label={field.label} /><span className="text-muted-foreground">{Boolean(value) ? "Yes" : "No"}</span></label>
        </Field>
      );
    case "select":
      return (
        <Field {...common}>
          <Select value={String(value ?? "")} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} size="xs" className="w-full max-w-sm"><SelectValue placeholder={field.placeholder ?? "Choose…"} /></SelectTrigger>
            <SelectContent>{(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? value.map(String) : [];
      return (
        <Field {...common} htmlFor={undefined}>
          <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label={field.label}>
            {(field.options ?? []).map((o) => (
              <label key={o} className="flex h-7 items-center gap-1.5 text-[12.5px]">
                <Checkbox size="sm" checked={list.includes(o)} disabled={disabled} onCheckedChange={(c) => onChange(c ? [...list, o] : list.filter((x) => x !== o))} />
                {o}
              </label>
            ))}
          </div>
        </Field>
      );
    }
    case "matter":
      return <Field {...common}><MatterSelect id={id} size="xs" value={typeof value === "string" && value ? value : null} onChange={(v) => onChange(v ?? "")} matters={meta?.matters.map((m) => ({ id: m.id, shortName: m.shortName, name: m.name }))} disabled={disabled} allowNone={!field.required} className="max-w-sm" /></Field>;
    case "person":
      return <Field {...common}><PersonSelect id={id} size="xs" value={typeof value === "string" && value ? value : null} onChange={(v) => onChange(v ?? "")} people={meta?.people.map((p) => ({ id: p.id, name: p.name, title: p.title }))} disabled={disabled} allowNone={!field.required} className="max-w-sm" /></Field>;
    case "library-folder":
      return <Field {...common}><FolderSelect id={id} size="xs" value={typeof value === "string" && value ? value : null} onChange={(v) => onChange(v ?? "")} disabled={disabled} allowNone className="max-w-sm" /></Field>;
    case "bates-prefix":
      return <Field {...common}><Input id={id} size="xs" value={String(value ?? "")} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder={field.placeholder ?? "MFC-"} disabled={disabled} className="w-40 font-mono" /></Field>;
    case "output-format": {
      const list = formats?.length ? formats : [...OUTPUT_FORMATS];
      return <Field {...common} htmlFor={undefined}><SegmentedControl size="xs" options={list.map((f) => ({ value: f, label: OUTPUT_FORMAT_LABEL[f] }))} value={(typeof value === "string" && list.includes(value as OutputFormat) ? value : list[0]) as OutputFormat} onChange={onChange} ariaLabel={field.label} /></Field>;
    }
    case "label":
    default:
      return <Field {...common}><Input id={id} size="xs" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} disabled={disabled} className="max-w-md" /></Field>;
  }
}

function UploadedRow({ file, onRemove, disabled }: { file: UploadedFileValue; onRemove: () => void; disabled?: boolean }) {
  const chars = (file.text ?? "").length;
  return (
    <li className="flex h-7 items-center gap-2 px-2 text-[12px]">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
      <span className="shrink-0 tabular text-[11px] text-muted-foreground">{formatBytes(file.size)}{chars ? ` · ${chars.toLocaleString()} chars` : " · no text"}{file.pages ? ` · ${file.pages} pp` : ""}{file.truncated ? " · truncated" : ""}</span>
      {!disabled && <Button variant="ghost" size="icon-xs" className="size-5" onClick={onRemove} aria-label={`Remove ${file.name}`}><X className="size-3" /></Button>}
    </li>
  );
}

function SingleFileControl({ id, field, value, onChange, workflowId, matterId, disabled, onBusy }: { id: string; field: WorkflowFrontendField; value: unknown; onChange: (v: unknown) => void; workflowId?: string; matterId?: string | null; disabled?: boolean; onBusy?: (b: boolean) => void }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"upload" | "paste">(typeof value === "string" && value ? "paste" : "upload");
  const file = isUploadedFile(value) ? value : null;
  const accept = field.accept?.length ? field.accept : DEFAULT_ACCEPT;
  const take = async (dropped: DroppedFile[], rejected: { name: string; reason: string }[]) => {
    for (const r of rejected) toast.error(`${r.name}: ${r.reason === "type" ? "file type not accepted" : r.reason === "size" ? "too large" : r.reason}`);
    const f = dropped.find((d) => d.file)?.file;
    if (!f) return;
    setBusy(`Uploading ${f.name}…`); onBusy?.(true);
    try {
      const up = await uploadForWorkflow(f, { workflowId, matterId });
      onChange(up);
      if (!up.text?.trim()) toast.warning("No text could be extracted from the file; paste the text instead if a step needs it.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(null); onBusy?.(false); }
  };
  if (mode === "paste") {
    return (
      <div className="space-y-1">
        <Textarea id={id} value={typeof value === "string" ? value : (file?.text ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? "Paste the text"} rows={7} disabled={disabled} className="font-mono text-[12px]" />
        <button type="button" onClick={() => { setMode("upload"); if (typeof value === "string") onChange(""); }} className="text-[11.5px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer">Upload a file instead</button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {busy ? (
        <div className="flex h-9 items-center gap-2 rounded-md border border-dashed px-3 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {busy}</div>
      ) : file ? (
        <ul className="rounded-md border"><UploadedRow file={file} onRemove={() => onChange("")} disabled={disabled} /></ul>
      ) : (
        <FileDrop id={id} files={[]} onChange={(f, r) => void take(f, r)} accept={accept} multiple={false} maxFiles={1} maxSize={60 * 1024 * 1024} disabled={disabled} compact />
      )}
      <button type="button" onClick={() => setMode("paste")} className="text-[11.5px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer">Paste text instead</button>
    </div>
  );
}

function MultiFileControl({ id, field, value, onChange, workflowId, matterId, disabled, onBusy }: { id: string; field: WorkflowFrontendField; value: unknown; onChange: (v: unknown) => void; workflowId?: string; matterId?: string | null; disabled?: boolean; onBusy?: (b: boolean) => void }) {
  const [pending, setPending] = React.useState<string[]>([]);
  const list = (Array.isArray(value) ? value : []).filter(isUploadedFile);
  const accept = field.accept?.length ? field.accept : DEFAULT_ACCEPT;
  const listRef = React.useRef(list);
  listRef.current = list;
  const take = async (dropped: DroppedFile[], rejected: { name: string; reason: string }[]) => {
    for (const r of rejected) toast.error(`${r.name}: ${r.reason === "type" ? "file type not accepted" : r.reason === "size" ? "too large" : r.reason === "duplicate" ? "already added" : r.reason}`);
    const files = dropped.map((d) => d.file).filter((f): f is File => Boolean(f));
    if (!files.length) return;
    setPending((p) => [...p, ...files.map((f) => f.name)]); onBusy?.(true);
    try {
      for (const f of files) {
        try {
          const up = await uploadForWorkflow(f, { workflowId, matterId });
          onChange([...listRef.current.filter((x) => x.name !== up.name), up]);
          listRef.current = [...listRef.current.filter((x) => x.name !== up.name), up];
        } catch (e) { toast.error(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`); }
        setPending((p) => p.filter((n) => n !== f.name));
      }
    } finally { onBusy?.(false); }
  };
  return (
    <div className="space-y-1.5">
      <FileDrop id={id} files={[]} onChange={(f, r) => void take(f, r)} accept={accept} multiple maxFiles={25} maxSize={60 * 1024 * 1024} disabled={disabled} compact label={list.length ? "Add more files" : undefined} />
      {(list.length > 0 || pending.length > 0) && (
        <ul className="divide-y divide-line-quiet rounded-md border" aria-label="Uploaded files">
          {list.map((f) => <UploadedRow key={f.blobId} file={f} onRemove={() => onChange(list.filter((x) => x.blobId !== f.blobId))} disabled={disabled} />)}
          {pending.map((n) => <li key={`p-${n}`} className={cn("flex h-7 items-center gap-2 px-2 text-[12px] text-muted-foreground")}><Loader2 className="size-3.5 animate-spin" /> Uploading {n}…</li>)}
        </ul>
      )}
    </div>
  );
}
