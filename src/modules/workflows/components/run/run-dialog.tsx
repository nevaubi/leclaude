"use client";
import * as React from "react";
import { FileText, Loader2, Play, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { Workflow } from "@/lib/types/domain";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiJson, ApiError, type WorkflowMeta } from "../../hooks";
import { InlineAlert } from "../shared";

type WorkflowInput = NonNullable<Workflow["inputs"]>[number];
export interface FileInputValue { blobId: string; name: string; size: number; text: string; method?: string; pages?: number; truncated?: boolean }

export interface RunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: { id: string; name: string; inputs?: Workflow["inputs"]; usesAI?: boolean; usesNetwork?: boolean };
  meta: WorkflowMeta | null;
  onStarted: (runId: string) => void;
  initialValues?: Record<string, unknown>;
}

export function RunDialog({ open, onOpenChange, workflow, meta, onStarted, initialValues }: RunDialogProps) {
  const inputs = workflow.inputs ?? [];
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [starting, setStarting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!open) return;
    const init: Record<string, unknown> = { ...(initialValues ?? {}) };
    for (const i of inputs) if (init[i.key] === undefined) init[i.key] = i.type === "select" ? (i.options?.[0] ?? "") : i.type === "matter" && meta?.matters.length === 1 ? meta.matters[0].id : "";
    setValues(init);
    setErrors({});
  }, [open, workflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    const errs: Record<string, string> = {};
    for (const i of inputs) {
      const v = values[i.key];
      const empty = v == null || v === "" || (typeof v === "object" && !(v as FileInputValue).text);
      if (i.required && empty) errs[i.key] = "Required";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setStarting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const i of inputs) {
        const v = values[i.key];
        payload[i.key] = i.type === "file" ? ((v as FileInputValue | undefined)?.text ?? "") : i.type === "number" ? (v === "" ? undefined : Number(v)) : v;
        if (i.type === "file" && v && typeof v === "object") payload[`${i.key}_file`] = { blobId: (v as FileInputValue).blobId, name: (v as FileInputValue).name, size: (v as FileInputValue).size };
      }
      const matterInput = inputs.find((i) => i.type === "matter");
      const res = await apiJson<{ run: { id: string } }>(`/api/workflows/${workflow.id}/run`, { method: "POST", body: JSON.stringify({ inputs: payload, matterId: matterInput ? (values[matterInput.key] as string) || null : null }) });
      onOpenChange(false);
      onStarted(res.run.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start the run");
    } finally { setStarting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="size-4 text-primary" /> Run “{workflow.name}”</DialogTitle>
          <DialogDescription>{inputs.length ? "Fill in the inputs. Files are uploaded and their text is extracted for the AI steps." : "This workflow needs no inputs."}</DialogDescription>
        </DialogHeader>
        {workflow.usesAI && meta && !meta.aiConfigured && (
          <InlineAlert tone="warning" title="OpenAI key required">AI steps will fail until OPENAI_API_KEY is set in .env.local. Data and action steps still run.</InlineAlert>
        )}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto scrollbar-thin pr-1" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}>
          {inputs.map((i) => (
            <div key={i.key} className="space-y-1">
              <Label htmlFor={`in_${i.key}`} className="text-xs">{i.label}{i.required && <span className="ml-0.5 text-destructive">*</span>}</Label>
              <InputControl input={i} value={values[i.key]} onChange={(v) => set(i.key, v)} meta={meta} />
              {errors[i.key] && <div className="text-[11px] text-destructive">{errors[i.key]}</div>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={starting}>{starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run workflow <kbd className="ml-1 hidden bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30 sm:inline">⌘↵</kbd></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InputControl({ input, value, onChange, meta }: { input: WorkflowInput; value: unknown; onChange: (v: unknown) => void; meta: WorkflowMeta | null }) {
  const id = `in_${input.key}`;
  switch (input.type) {
    case "textarea": return <Textarea id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={input.placeholder} rows={5} className="text-sm" />;
    case "number": return <Input id={id} type="number" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} placeholder={input.placeholder} className="w-48" />;
    case "date": return <Input id={id} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="w-48" />;
    case "select":
      return (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder={input.placeholder ?? "Select…"} /></SelectTrigger>
          <SelectContent>{(input.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    case "matter":
      return (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder="Select a matter…" /></SelectTrigger>
          <SelectContent>{(meta?.matters ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName} <span className="text-muted-foreground">· {m.client}</span></SelectItem>)}</SelectContent>
        </Select>
      );
    case "file": return <FileInput id={id} value={value as FileInputValue | string | undefined} onChange={onChange} placeholder={input.placeholder} />;
    default: return <Input id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={input.placeholder} />;
  }
}

function FileInput({ id, value, onChange, placeholder }: { id: string; value: FileInputValue | string | undefined; onChange: (v: unknown) => void; placeholder?: string }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"upload" | "paste">(typeof value === "string" && value ? "paste" : "upload");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const file = typeof value === "object" && value ? value : null;

  const handle = async (f: File) => {
    setBusy(`Uploading ${f.name}…`);
    try {
      const form = new FormData();
      form.append("file", f);
      const up = await apiJson<{ id: string; size: number; name?: string }>("/api/blobs", { method: "POST", body: form });
      setBusy("Extracting text…");
      const ex = await apiJson<{ text: string; method: string; pages?: number; truncated: boolean }>("/api/workflows/extract-text", { method: "POST", body: JSON.stringify({ blobId: up.id }) });
      onChange({ blobId: up.id, name: f.name, size: f.size, text: ex.text, method: ex.method, pages: ex.pages, truncated: ex.truncated } satisfies FileInputValue);
      if (!ex.text.trim()) toast.warning("No text could be extracted; paste the text instead.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setMode("paste");
    } finally { setBusy(null); }
  };

  if (mode === "paste") {
    return (
      <div className="space-y-1">
        <Textarea id={id} value={typeof value === "string" ? value : (file?.text ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "Paste the document text"} rows={7} className="font-mono text-[12px]" />
        <button type="button" onClick={() => setMode("upload")} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer">Upload a file instead</button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div
        className={cn("flex items-center gap-3 rounded-md border border-dashed px-3 py-3 text-sm transition-colors", file ? "border-success/50 bg-success/5" : "hover:border-foreground/40 hover:bg-accent/40")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handle(f); }}
      >
        <input ref={fileRef} id={id} type="file" className="hidden" accept=".docx,.pdf,.txt,.md,.csv,.json,.xlsx,.pptx,.html" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); e.target.value = ""; }} />
        {busy ? (
          <><Loader2 className="size-4 animate-spin text-muted-foreground" /><span className="text-xs text-muted-foreground">{busy}</span></>
        ) : file ? (
          <>
            <FileText className="size-4 text-success" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{file.name}</div>
              <div className="text-[11px] text-muted-foreground">{formatBytes(file.size)} · {file.text.length.toLocaleString()} characters extracted{file.pages ? ` · ${file.pages} pages` : ""}{file.truncated ? " · truncated" : ""}</div>
            </div>
            <Button variant="ghost" size="icon-xs" onClick={() => onChange("")} aria-label="Remove file"><X className="size-3.5" /></Button>
          </>
        ) : (
          <>
            <Upload className="size-4 text-muted-foreground" />
            <div className="flex-1 text-xs text-muted-foreground">Drop a .docx, .pdf, .xlsx, .pptx, .txt or .md here, or <button type="button" onClick={() => fileRef.current?.click()} className="text-primary underline-offset-2 hover:underline cursor-pointer">browse</button>.</div>
          </>
        )}
      </div>
      <button type="button" onClick={() => setMode("paste")} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline cursor-pointer">Paste text instead</button>
    </div>
  );
}
