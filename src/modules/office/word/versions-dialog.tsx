"use client";
import * as React from "react";
import { diffLines } from "diff";
import { formatDistanceToNow, format } from "date-fns";
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
import { docToLines, type PMNode } from "./doc-model";

export interface VersionsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  list: () => Promise<Omit<OfficeVersion, "content">[]>;
  get: (id: string) => Promise<OfficeVersion>;
  checkpoint: (label: string) => Promise<boolean>;
  restore: (id: string) => Promise<unknown>;
  currentContent: () => PMNode;
}

type Row = { kind: "same" | "add" | "del"; left?: string; right?: string };

function buildRows(oldLines: string[], newLines: string[]): Row[] {
  const parts = diffLines(oldLines.join("\n") + "\n", newLines.join("\n") + "\n");
  const rows: Row[] = [];
  let pendingDel: string[] = [];
  const flushDel = () => { for (const l of pendingDel) rows.push({ kind: "del", left: l }); pendingDel = []; };
  for (const p of parts) {
    const lines = p.value.replace(/\n$/, "").split("\n");
    if (p.removed) { pendingDel.push(...lines); continue; }
    if (p.added) {
      // pair removed/added lines side by side where possible
      for (const l of lines) { const left = pendingDel.shift(); rows.push({ kind: "add", left, right: l }); }
      flushDel();
      continue;
    }
    flushDel();
    for (const l of lines) rows.push({ kind: "same", left: l, right: l });
  }
  flushDel();
  return rows;
}

export function VersionsDialog({ open, onOpenChange, list, get, checkpoint, restore, currentContent }: VersionsDialogProps) {
  const [versions, setVersions] = React.useState<Omit<OfficeVersion, "content">[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = React.useState<OfficeVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState<"checkpoint" | "restore" | null>(null);
  const [onlyChanges, setOnlyChanges] = React.useState(true);

  const reload = React.useCallback(async () => { try { setVersions(await list()); } catch { setVersions([]); } }, [list]);
  React.useEffect(() => { if (open) { setSelected(null); setSelectedVersion(null); void reload(); } }, [open, reload]);
  React.useEffect(() => {
    if (!selected) { setSelectedVersion(null); return; }
    let cancelled = false;
    setLoadingVersion(true);
    get(selected).then((v) => { if (!cancelled) setSelectedVersion(v); }).catch(() => toast.error("Could not load version")).finally(() => { if (!cancelled) setLoadingVersion(false); });
    return () => { cancelled = true; };
  }, [selected, get]);

  const rows = React.useMemo(() => {
    if (!selectedVersion) return null;
    return buildRows(docToLines(selectedVersion.content as PMNode), docToLines(currentContent()));
  }, [selectedVersion, currentContent]);
  const stats = React.useMemo(() => rows ? { add: rows.filter((r) => r.kind === "add").length, del: rows.filter((r) => r.kind === "del" || (r.kind === "add" && r.left != null)).length } : null, [rows]);

  const doCheckpoint = async () => {
    setBusy("checkpoint");
    try { const ok = await checkpoint(label.trim() || `Checkpoint ${format(new Date(), "MMM d, h:mm a")}`); if (ok) { toast.success("Checkpoint saved"); setLabel(""); await reload(); } else toast.error("Could not save checkpoint"); } finally { setBusy(null); }
  };
  const doRestore = async () => {
    if (!selected) return;
    setBusy("restore");
    try { const r = await restore(selected); if (r) { toast.success("Version restored — the previous state was saved as a checkpoint"); onOpenChange(false); } else toast.error("Restore failed"); } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="h-[84vh] grid-rows-[auto_1fr] gap-3 p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2"><History className="size-4" /> Version history</DialogTitle>
          <DialogDescription>Every agent edit, checkpoint and periodic autosave is kept. Select a version to compare it with the current document.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[300px_1fr] border-t">
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center gap-1.5 border-b p-2">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void doCheckpoint(); }} placeholder="Checkpoint name (e.g. Before partner review)" className="h-8 text-xs" />
              <Button size="sm" onClick={() => void doCheckpoint()} disabled={busy === "checkpoint"}>{busy === "checkpoint" ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />} Save</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-1.5">
              {versions === null && <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
              {versions?.length === 0 && <EmptyState icon={Clock} title="No versions yet" className="m-2 p-6" />}
              <ul className="space-y-1">
                {versions?.map((v, i) => {
                  const agent = v.summary?.startsWith("Agent edit") || v.authorName === "Drafting assistant";
                  return (
                    <li key={v.id}>
                      <button onClick={() => setSelected(v.id)} className={cn("w-full rounded-md border px-2.5 py-2 text-left transition-colors cursor-pointer", selected === v.id ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-accent")}>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={i === 0 ? "success" : "muted"} className="py-0 tabular">v{v.version}</Badge>
                          {v.label && <span className="truncate text-xs font-medium">{v.label}</span>}
                          {i === 0 && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                        </div>
                        <div className={cn("mt-0.5 line-clamp-2 text-[12px]", v.label ? "text-muted-foreground" : "text-foreground")}>{v.summary}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {agent ? <Sparkles className="size-3 text-primary" /> : <User className="size-3" />}
                          <span>{v.authorName ?? "Unknown"}</span><span>·</span><span title={new Date(v.createdAt).toLocaleString()}>{formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>
                          {v.changedFields ? <span className="ml-auto tabular">{v.changedFields} changes</span> : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            {!selected && <div className="flex flex-1 items-center justify-center p-6"><EmptyState icon={History} title="Select a version" description="You will see a side-by-side comparison against the current document, paragraph by paragraph." className="border-0" /></div>}
            {selected && (
              <>
                <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
                  <span className="font-medium">v{selectedVersion?.version ?? "…"}</span>
                  <span className="text-muted-foreground">vs current</span>
                  {stats && <span className="ml-2 flex items-center gap-2 tabular"><span className="text-success">+{stats.add}</span><span className="text-destructive">−{stats.del}</span></span>}
                  <label className="ml-3 flex items-center gap-1 text-muted-foreground cursor-pointer"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} className="accent-primary" /> Only changed paragraphs</label>
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" onClick={() => void doRestore()} disabled={busy === "restore" || !selectedVersion}>{busy === "restore" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Restore this version</Button>
                </div>
                <div className="grid shrink-0 grid-cols-2 border-b bg-muted/40 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"><div className="px-3 py-1">Selected version</div><div className="border-l px-3 py-1">Current document</div></div>
                <div className="min-h-0 flex-1 overflow-auto scrollbar-thin font-serif text-[12.5px] leading-relaxed">
                  {loadingVersion && <div className="p-4 text-xs text-muted-foreground">Loading…</div>}
                  {rows && (
                    <div className="grid grid-cols-2">
                      {rows.filter((r) => !onlyChanges || r.kind !== "same").map((r, i) => (
                        <React.Fragment key={i}>
                          <div className={cn("whitespace-pre-wrap border-b px-3 py-1", (r.kind === "del" || (r.kind === "add" && r.left != null)) && "diff-line-del")}>{r.left ?? ""}</div>
                          <div className={cn("whitespace-pre-wrap border-b border-l px-3 py-1", r.kind === "add" && "diff-line-add")}>{r.right ?? ""}</div>
                        </React.Fragment>
                      ))}
                      {onlyChanges && rows.every((r) => r.kind === "same") && <div className="col-span-2 p-6 text-center text-xs text-muted-foreground">No textual differences between this version and the current document.</div>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
