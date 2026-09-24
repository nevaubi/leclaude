"use client";
/** Version history: checkpoints, agent edits and autosaves with a model-level diff (pages, annotations, Bates) and restore. */
import * as React from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Bookmark, Clock, History, Loader2, RotateCcw, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OfficeVersion } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { ANNOTATION_LABEL, activePages, annotationStats, normalizeModel, type AnnotationType, type PdfModel } from "./model";

export interface VersionsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  list: () => Promise<Omit<OfficeVersion, "content">[]>;
  get: (id: string) => Promise<OfficeVersion>;
  checkpoint: (label: string) => Promise<boolean>;
  restore: (id: string) => Promise<unknown>;
  currentModel: () => PdfModel;
}

function describe(m: PdfModel) {
  const st = annotationStats(m);
  return { pages: activePages(m).length, deleted: m.pages.filter((p) => p.deleted).length, rotated: m.pages.filter((p) => p.rotation).length, blank: m.pages.filter((p) => p.blank).length, annotations: st.total, byType: st.byType, bates: m.bates ? `${m.bates.prefix}${String(m.bates.start).padStart(m.bates.digits, "0")}${m.bates.applied ? " (applied)" : ""}` : null, bookmarks: m.bookmarks?.length ?? 0, source: m.sourceBlobId, pending: Boolean(m.meta.pending) };
}

export function VersionsDialog({ open, onOpenChange, list, get, checkpoint, restore, currentModel }: VersionsDialogProps) {
  const [versions, setVersions] = React.useState<Omit<OfficeVersion, "content">[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = React.useState<OfficeVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState<"checkpoint" | "restore" | null>(null);
  const reload = React.useCallback(async () => { try { setVersions(await list()); } catch { setVersions([]); } }, [list]);
  React.useEffect(() => { if (open) { setSelected(null); setSelectedVersion(null); void reload(); } }, [open, reload]);
  React.useEffect(() => {
    if (!selected) { setSelectedVersion(null); return; }
    let cancelled = false;
    setLoadingVersion(true);
    get(selected).then((v) => { if (!cancelled) setSelectedVersion(v); }).catch(() => toast.error("Could not load version")).finally(() => { if (!cancelled) setLoadingVersion(false); });
    return () => { cancelled = true; };
  }, [selected, get]);
  const cur = React.useMemo(() => (open ? describe(currentModel()) : null), [open, currentModel]);
  const vm = selectedVersion ? describe(normalizeModel(selectedVersion.content)) : null;
  const doCheckpoint = async () => { setBusy("checkpoint"); try { const ok = await checkpoint(label.trim() || `Checkpoint ${format(new Date(), "MMM d, h:mm a")}`); if (ok) { toast.success("Checkpoint saved"); setLabel(""); await reload(); } else toast.error("Could not save checkpoint"); } finally { setBusy(null); } };
  const doRestore = async () => { if (!selected) return; setBusy("restore"); try { const r = await restore(selected); if (r) { toast.success("Version restored — the previous state was saved as a checkpoint"); onOpenChange(false); } else toast.error("Restore failed"); } finally { setBusy(null); } };
  const Row = ({ label, a, b }: { label: string; a: React.ReactNode; b: React.ReactNode }) => <tr className="border-t"><td className="py-1.5 pr-3 text-muted-foreground">{label}</td><td className={cn("py-1.5 pr-3 tabular", String(a) !== String(b) && "font-medium text-warning-foreground dark:text-warning")}>{a}</td><td className="py-1.5 tabular">{b}</td></tr>;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="h-[80vh] grid-rows-[auto_1fr] gap-3 p-0">
        <DialogHeader className="px-5 pt-5"><DialogTitle className="flex items-center gap-2"><History className="size-4" /> Version history</DialogTitle><DialogDescription>Every agent edit, checkpoint, source change (merge, apply, compress) and periodic autosave is kept. Select a version to compare it with the current document.</DialogDescription></DialogHeader>
        <div className="grid min-h-0 grid-cols-[320px_1fr] border-t">
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center gap-1.5 border-b p-2">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void doCheckpoint(); }} placeholder="Checkpoint name (e.g. Before production)" className="h-8 text-xs" />
              <Button size="sm" onClick={() => void doCheckpoint()} disabled={busy === "checkpoint"}>{busy === "checkpoint" ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />} Save</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-1.5">
              {versions === null && <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
              {versions?.length === 0 && <EmptyState icon={Clock} title="No versions yet" className="m-2 p-6" />}
              <ul className="space-y-1">
                {versions?.map((v, i) => { const agent = v.summary?.startsWith("Agent edit") || v.authorName === "Drafting assistant"; return (
                  <li key={v.id}>
                    <button onClick={() => setSelected(v.id)} className={cn("w-full rounded-md border px-2 py-2 text-left transition-colors cursor-pointer", selected === v.id ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-accent")}>
                      <div className="flex items-center gap-1.5"><Badge variant={i === 0 ? "success" : "muted"} className="py-0 tabular">v{v.version}</Badge>{v.label && <span className="truncate text-xs font-medium">{v.label}</span>}{i === 0 && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}</div>
                      <div className={cn("mt-0.5 line-clamp-2 text-[12px]", v.label ? "text-muted-foreground" : "text-foreground")}>{v.summary}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">{agent ? <Sparkles className="size-3 text-primary" /> : <User className="size-3" />}<span>{v.authorName ?? "Unknown"}</span><span>·</span><span title={new Date(v.createdAt).toLocaleString()}>{formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>{typeof v.changedFields === "number" && v.changedFields > 0 && <span className="ml-auto tabular">{v.changedFields} changes</span>}</div>
                    </button>
                  </li>
                ); })}
              </ul>
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            {!selected && <div className="flex flex-1 items-center justify-center p-6"><EmptyState icon={History} title="Select a version" description="Compare pages, annotations and Bates configuration with the current document before restoring." className="border-0" /></div>}
            {selected && (
              <>
                <div className="flex items-center gap-2 border-b px-3 py-2 text-xs"><span className="font-medium">v{selectedVersion?.version ?? "…"}</span><span className="text-muted-foreground">vs current</span><div className="flex-1" /><Button size="sm" variant="outline" onClick={() => void doRestore()} disabled={busy === "restore" || loadingVersion || !selectedVersion}>{busy === "restore" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Restore this version</Button></div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
                  {loadingVersion || !vm || !cur ? <Skeleton className="h-40 w-full" /> : (
                    <table className="w-full"><thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="pb-1">Property</th><th className="pb-1">v{selectedVersion?.version}</th><th className="pb-1">Current</th></tr></thead><tbody>
                      <Row label="Active pages" a={vm.pages} b={cur.pages} />
                      <Row label="Deleted pages" a={vm.deleted} b={cur.deleted} />
                      <Row label="Rotated pages" a={vm.rotated} b={cur.rotated} />
                      <Row label="Inserted blank pages" a={vm.blank} b={cur.blank} />
                      <Row label="Annotations" a={vm.annotations} b={cur.annotations} />
                      {(Object.keys(ANNOTATION_LABEL) as AnnotationType[]).filter((t) => (vm.byType[t] ?? 0) || (cur.byType[t] ?? 0)).map((t) => <Row key={t} label={`· ${ANNOTATION_LABEL[t]}`} a={vm.byType[t] ?? 0} b={cur.byType[t] ?? 0} />)}
                      <Row label="Bookmarks" a={vm.bookmarks} b={cur.bookmarks} />
                      <Row label="Bates" a={vm.bates ?? "—"} b={cur.bates ?? "—"} />
                      <Row label="Source file" a={vm.pending ? "not generated" : vm.source.slice(0, 12)} b={cur.pending ? "not generated" : cur.source.slice(0, 12)} />
                    </tbody></table>
                  )}
                  {selectedVersion && <div className="mt-4 rounded-md border bg-muted/30 p-3 text-muted-foreground"><div className="font-medium text-foreground">{selectedVersion.label ?? selectedVersion.summary}</div>{selectedVersion.label && <div>{selectedVersion.summary}</div>}<div className="mt-1">{selectedVersion.authorName} · {new Date(selectedVersion.createdAt).toLocaleString()}</div></div>}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
