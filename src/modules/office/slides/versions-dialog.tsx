"use client";
/** Version history with a first-slide thumbnail, slide-title diff, checkpoints and restore. */
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
import { deckStats, normalizeDeck, slideTitle, type DeckContent } from "./model";
import { ScaledSlide } from "./slide-view";

export interface VersionsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  list: () => Promise<Omit<OfficeVersion, "content">[]>;
  get: (id: string) => Promise<OfficeVersion>;
  checkpoint: (label: string) => Promise<boolean>;
  restore: (id: string) => Promise<unknown>;
  currentDeck: () => DeckContent;
}

function titlesDiff(a: DeckContent, b: DeckContent) {
  const ta = a.slides.map((s) => slideTitle(s) || "(untitled)"), tb = b.slides.map((s) => slideTitle(s) || "(untitled)");
  const removed = ta.filter((t) => !tb.includes(t)), added = tb.filter((t) => !ta.includes(t));
  return { removed, added, same: ta.filter((t) => tb.includes(t)).length };
}

export function VersionsDialog({ open, onOpenChange, list, get, checkpoint, restore, currentDeck }: VersionsDialogProps) {
  const [versions, setVersions] = React.useState<Omit<OfficeVersion, "content">[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = React.useState<OfficeVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState<"checkpoint" | "restore" | null>(null);
  const [thumbs, setThumbs] = React.useState<Record<string, DeckContent>>({});

  const reload = React.useCallback(async () => { try { setVersions(await list()); } catch { setVersions([]); } }, [list]);
  React.useEffect(() => { if (open) { setSelected(null); setSelectedVersion(null); setThumbs({}); void reload(); } }, [open, reload]);
  React.useEffect(() => {
    if (!selected) { setSelectedVersion(null); return; }
    let cancelled = false;
    setLoadingVersion(true);
    get(selected).then((v) => { if (!cancelled) { setSelectedVersion(v); setThumbs((t) => ({ ...t, [v.id]: normalizeDeck(v.content) })); } }).catch(() => toast.error("Could not load version")).finally(() => { if (!cancelled) setLoadingVersion(false); });
    return () => { cancelled = true; };
  }, [selected, get]);
  // lazily load thumbnails for the first few versions
  React.useEffect(() => {
    if (!open || !versions) return;
    let cancelled = false;
    (async () => { for (const v of versions.slice(0, 8)) { if (cancelled) return; if (thumbs[v.id]) continue; try { const full = await get(v.id); if (!cancelled) setThumbs((t) => ({ ...t, [v.id]: normalizeDeck(full.content) })); } catch { /* ignore */ } } })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, versions]);

  const cur = React.useMemo(() => (open ? currentDeck() : null), [open, currentDeck]);
  const vDeck = selectedVersion ? thumbs[selectedVersion.id] : null;
  const diff = vDeck && cur ? titlesDiff(vDeck, cur) : null;

  const doCheckpoint = async () => { setBusy("checkpoint"); try { const ok = await checkpoint(label.trim() || `Checkpoint ${format(new Date(), "MMM d, h:mm a")}`); if (ok) { toast.success("Checkpoint saved"); setLabel(""); await reload(); } else toast.error("Could not save checkpoint"); } finally { setBusy(null); } };
  const doRestore = async () => { if (!selected) return; setBusy("restore"); try { const r = await restore(selected); if (r) { toast.success("Version restored — the previous state was saved as a checkpoint"); onOpenChange(false); } else toast.error("Restore failed"); } finally { setBusy(null); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="h-[84vh] grid-rows-[auto_1fr] gap-3 p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2"><History className="size-4" /> Version history</DialogTitle>
          <DialogDescription>Every agent edit, checkpoint and periodic autosave is kept. Select a version to preview it and compare slide titles with the current deck.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[320px_1fr] border-t">
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center gap-1.5 border-b p-2">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void doCheckpoint(); }} placeholder="Checkpoint name (e.g. Before partner review)" className="h-8 text-xs" />
              <Button size="sm" onClick={() => void doCheckpoint()} disabled={busy === "checkpoint"}>{busy === "checkpoint" ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />} Save</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-1.5">
              {versions === null && <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
              {versions?.length === 0 && <EmptyState icon={Clock} title="No versions yet" className="m-2 p-6" />}
              <ul className="space-y-1">
                {versions?.map((v, i) => {
                  const agent = v.summary?.startsWith("Agent edit") || v.authorName === "Drafting assistant";
                  const d = thumbs[v.id];
                  return (
                    <li key={v.id}>
                      <button onClick={() => setSelected(v.id)} className={cn("flex w-full gap-2 rounded-md border px-2 py-2 text-left transition-colors cursor-pointer", selected === v.id ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-accent")}>
                        <div className="h-[45px] w-[80px] shrink-0 overflow-hidden rounded border bg-paper">{d?.slides[0] ? <ScaledSlide slide={d.slides[0]} theme={d.theme} width={80} lite /> : <Skeleton className="h-full w-full" />}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={i === 0 ? "success" : "muted"} className="py-0 tabular">v{v.version}</Badge>
                            {v.label && <span className="truncate text-xs font-medium">{v.label}</span>}
                            {i === 0 && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                          </div>
                          <div className={cn("mt-0.5 line-clamp-2 text-[12px]", v.label ? "text-muted-foreground" : "text-foreground")}>{v.summary}</div>
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            {agent ? <Sparkles className="size-3 text-primary" /> : <User className="size-3" />}
                            <span>{v.authorName ?? "Unknown"}</span><span>·</span><span title={new Date(v.createdAt).toLocaleString()}>{formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>
                            {d && <span className="ml-auto tabular">{d.slides.length} slides</span>}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            {!selected && <div className="flex flex-1 items-center justify-center p-6"><EmptyState icon={History} title="Select a version" description="Preview its slides and compare with the current deck before restoring." className="border-0" /></div>}
            {selected && (
              <>
                <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
                  <span className="font-medium">v{selectedVersion?.version ?? "…"}</span>
                  <span className="text-muted-foreground">vs current</span>
                  {diff && <span className="ml-2 flex items-center gap-2 tabular"><span className="text-success">+{diff.added.length} slides</span><span className="text-destructive">−{diff.removed.length} slides</span><span className="text-muted-foreground">{diff.same} shared titles</span></span>}
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" onClick={() => void doRestore()} disabled={busy === "restore" || !selectedVersion}>{busy === "restore" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Restore this version</Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-4">
                  {loadingVersion && !vDeck && <div className="text-xs text-muted-foreground">Loading…</div>}
                  {vDeck && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-4">
                        <div className="overflow-hidden rounded-lg border bg-paper shadow-paper">{vDeck.slides[0] ? <ScaledSlide slide={vDeck.slides[0]} theme={vDeck.theme} width={560} /> : <div className="p-6 text-xs text-muted-foreground">Empty deck</div>}</div>
                        <div className="space-y-2 text-xs">
                          <div className="rounded-md border p-2"><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">This version</div><div className="mt-1 tabular">{deckStats(vDeck).slides} slides · {deckStats(vDeck).words} words · theme {vDeck.theme.name}</div></div>
                          {diff && diff.added.length > 0 && <div className="rounded-md border p-2"><div className="text-[10px] font-medium uppercase tracking-wider text-success">Only in current</div><ul className="mt-1 space-y-0.5">{diff.added.map((t) => <li key={t} className="truncate">+ {t}</li>)}</ul></div>}
                          {diff && diff.removed.length > 0 && <div className="rounded-md border p-2"><div className="text-[10px] font-medium uppercase tracking-wider text-destructive">Only in this version</div><ul className="mt-1 space-y-0.5">{diff.removed.map((t) => <li key={t} className="truncate">− {t}</li>)}</ul></div>}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {vDeck.slides.map((s, i) => (
                          <div key={s.id} className="overflow-hidden rounded border bg-paper"><ScaledSlide slide={s} theme={vDeck.theme} width={200} lite /><div className="truncate border-t px-1.5 py-1 text-[10px] text-muted-foreground"><span className="tabular">{i + 1}.</span> {slideTitle(s) || "(untitled)"}</div></div>
                        ))}
                      </div>
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
