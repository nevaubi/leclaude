"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/form";
import { FileDrop, type DroppedFile } from "@/components/ui/file-drop";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "./use-review-data";

export const UPLOAD_ACCEPT = [".pdf", ".docx", ".txt", ".md", ".eml", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp"];

interface Settings { batesPrefix: string; batesWidth: number; nextBates: number }
interface Limits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number }

export type UploadFileResult =
  | { name: string; status: "created"; docId: string; bates: string; batesEnd?: string; pages: number; type: string; textStatus: "extracted" | "needs_ocr" | "empty"; duplicateTextOf?: string }
  | { name: string; status: "duplicate"; existingId: string; existingBates: string }
  | { name: string; status: "rejected"; code: string; reason: string };

export interface UploadResponse { results: UploadFileResult[]; created: number; duplicates: number; rejected: number; indexed: number; settings: Settings }

function preview(s: Settings, prefix: string) {
  const p = prefix.trim().toUpperCase() || s.batesPrefix;
  const n = p === s.batesPrefix ? s.nextBates : 1;
  return `${p}-${String(n).padStart(s.batesWidth, "0")}`;
}

/**
 * Upload documents into the matter: files are validated and hashed on the server, deduplicated by file hash,
 * text-extracted (images and scanned PDFs are kept and flagged for OCR), Bates-numbered from the matter's prefix
 * and indexed. Every file gets its own result line; nothing is silently dropped.
 */
export function UploadDialog({ open, onOpenChange, matterId, onUploaded, onOpenDocument }: { open: boolean; onOpenChange: (open: boolean) => void; matterId: string; onUploaded?: (r: UploadResponse) => void; onOpenDocument?: (id: string) => void }) {
  const [files, setFiles] = React.useState<DroppedFile[]>([]);
  const [custodian, setCustodian] = React.useState("");
  const [prefix, setPrefix] = React.useState("");
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [limits, setLimits] = React.useState<Limits | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<UploadResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFiles([]); setResult(null); setError(null);
    let alive = true;
    api<{ settings: Settings; limits: Limits }>(`/api/ediscovery/ingest?matter=${encodeURIComponent(matterId)}`)
      .then((r) => { if (alive) { setSettings(r.settings); setLimits(r.limits); setPrefix(r.settings.batesPrefix); } })
      .catch((e) => { if (alive) setError(e instanceof ApiError && e.status === 403 ? "You do not have permission to add documents to this matter." : (e as Error).message); });
    return () => { alive = false; };
  }, [open, matterId]);

  const prefixValid = /^[A-Za-z]{2,8}$/.test(prefix.trim());
  const submit = async () => {
    if (!files.length || !prefixValid) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      for (const f of files) if (f.file) form.append("file", f.file, f.name);
      form.append("lastModified", JSON.stringify(files.map((f) => f.file?.lastModified ?? null)));
      if (custodian.trim()) form.append("custodian", custodian.trim());
      form.append("batesPrefix", prefix.trim().toUpperCase());
      const res = await fetch(`/api/ediscovery/ingest?matter=${encodeURIComponent(matterId)}`, { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as (UploadResponse & { error?: string }) | null;
      if (!res.ok || !data) throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status);
      setResult(data);
      setSettings(data.settings);
      setFiles([]);
      onUploaded?.(data);
      if (data.created) toast.success(`${data.created} document${data.created === 1 ? "" : "s"} added`, { description: [data.duplicates && `${data.duplicates} duplicate${data.duplicates === 1 ? "" : "s"} skipped`, data.rejected && `${data.rejected} rejected`].filter(Boolean).join(" · ") || undefined });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You do not have permission to add documents to this matter." : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>PDF, Word (.docx), text, Markdown, email (.eml), CSV and images. Each file is hashed, deduplicated within the matter, text-extracted and given a Bates number.</DialogDescription>
        </DialogHeader>
        {result ? (
          <UploadResults result={result} onOpenDocument={onOpenDocument ? (id) => { onOpenChange(false); onOpenDocument(id); } : undefined} />
        ) : (
          <div className="space-y-3">
            <FileDrop files={files} onChange={(f, rejected) => { setFiles(f); if (rejected.length) toast.error(`${rejected.length} file${rejected.length === 1 ? "" : "s"} not added`, { description: rejected.slice(0, 3).map((r) => `${r.name}: ${r.reason === "type" ? "unsupported type" : r.reason === "size" ? "too large" : r.reason === "count" ? "too many files" : "already added"}`).join("; ") }); }} accept={UPLOAD_ACCEPT} maxFiles={limits?.maxFiles ?? 50} maxSize={limits?.maxFileBytes ?? 50 * 1024 * 1024} disabled={busy} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Custodian" help="Whose files these are. Leave blank for unassigned." htmlFor="ed-upload-custodian">
                <Input id="ed-upload-custodian" size="sm" value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="e.g. Jane Doe" disabled={busy} maxLength={120} />
              </Field>
              <Field label="Bates prefix" htmlFor="ed-upload-prefix" error={prefix && !prefixValid ? "2–8 letters" : undefined} help={settings ? `Next number ${preview(settings, prefix)}` : "Loading numbering…"}>
                <Input id="ed-upload-prefix" size="sm" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z]/g, "").slice(0, 8).toUpperCase())} disabled={busy || !settings} className="font-mono" />
              </Field>
            </div>
            {error && <p className="text-[12px] text-destructive" role="alert">{error}</p>}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setResult(null)}>Upload more</Button>
              <Button size="sm" onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={() => void submit()} disabled={busy || !files.length || !prefixValid || !settings}>{busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Uploading…" : files.length ? `Upload ${files.length} file${files.length === 1 ? "" : "s"}` : "Upload"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadResults({ result, onOpenDocument }: { result: UploadResponse; onOpenDocument?: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted-foreground">
        {result.created} added · {result.duplicates} duplicate{result.duplicates === 1 ? "" : "s"} · {result.rejected} rejected
      </p>
      <ul className="max-h-[320px] divide-y overflow-y-auto rounded-md border text-[12.5px]" aria-label="Upload results">
        {result.results.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex items-start gap-2 px-3 py-2">
            <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", r.status === "created" ? "bg-success/75" : r.status === "duplicate" ? "bg-muted-foreground/50" : "bg-destructive")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={r.name}>{r.name}</div>
              <div className="text-[11.5px] text-muted-foreground">
                {r.status === "created" && <>Added as <span className="font-mono">{r.batesEnd ? `${r.bates} – ${r.batesEnd}` : r.bates}</span>{r.textStatus === "needs_ocr" ? " · no text layer, needs OCR" : r.textStatus === "empty" ? " · no text found" : ""}{r.duplicateTextOf ? " · same text as an existing document" : ""}</>}
                {r.status === "duplicate" && <>Already in this matter as <span className="font-mono">{r.existingBates}</span> · not added again</>}
                {r.status === "rejected" && <>Rejected · {r.reason}</>}
              </div>
            </div>
            {r.status !== "rejected" && onOpenDocument && <Button variant="ghost" size="xs" onClick={() => onOpenDocument(r.status === "created" ? r.docId : r.existingId)}>Open</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
