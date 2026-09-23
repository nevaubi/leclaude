"use client";
import * as React from "react";
import { Bookmark, Clock, History, KeyRound, Pin, PinOff, Play, RotateCcw, Trash2, WifiOff } from "lucide-react";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { jurisdictionByKey } from "../jurisdictions";
import { SOURCE_SHORT, type SavedSearch, type SearchRun } from "../types";
import { SOURCE_ICON } from "./result-card";

export interface HistoryPanelProps {
  saved: SavedSearch[];
  runs: SearchRun[];
  matters: { id: string; shortName: string }[];
  onRunSaved: (s: SavedSearch) => void;
  onTogglePin: (s: SavedSearch) => void;
  onDeleteSaved: (s: SavedSearch) => void;
  onRestore: (r: SearchRun) => void;
  onRerun: (r: SearchRun) => void;
  onDeleteRun: (r: SearchRun) => void;
  layout: "columns" | "stack";
  className?: string;
}

/** Relative time that renders an absolute date on the server and switches to "n minutes ago" after mount (hydration-safe). */
export function RelTime({ iso }: { iso: string }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return <span suppressHydrationWarning title={new Date(iso).toLocaleString()}>{mounted ? relativeTime(iso) : formatDate(iso)}</span>;
}

export function HistoryPanel(p: HistoryPanelProps) {
  const matterName = (id?: string | null) => p.matters.find((m) => m.id === id)?.shortName;
  return (
    <div className={cn(p.layout === "columns" ? "grid gap-6 lg:grid-cols-2" : "space-y-6", p.className)}>
      <section>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Bookmark className="size-3.5" /> Saved searches <Badge variant="muted" className="py-0 tabular">{p.saved.length}</Badge></div>
        {p.saved.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Save a search from the results toolbar to keep its query, sources and jurisdiction.</div>
        ) : (
          <ul className="space-y-1.5">
            {p.saved.map((s) => (
              <li key={s.id} className="group flex items-start gap-2 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-foreground/20">
                <button onClick={() => p.onRunSaved(s)} className="min-w-0 flex-1 text-left cursor-pointer">
                  <div className="flex items-center gap-1.5">
                    {s.pinned && <Pin className="size-3 text-primary" />}
                    <span className="truncate text-[13px] font-medium group-hover:text-primary">{s.name}</span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={s.query}>{s.query}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
                    <span>{jurisdictionByKey(s.settings.jurisdiction).label.split(" (")[0]}</span>
                    {matterName(s.matterId) && <><span>·</span><span>{matterName(s.matterId)}</span></>}
                    <span>·</span>
                    <span className="inline-flex items-center gap-0.5">{s.settings.sources.slice(0, 5).map((src) => { const I = SOURCE_ICON[src]; return <Tip key={src} label={SOURCE_SHORT[src]}><I className="size-3" /></Tip>; })}{s.settings.sources.length > 5 ? ` +${s.settings.sources.length - 5}` : ""}</span>
                    {s.lastRunAt && <><span>·</span><span>ran <RelTime iso={s.lastRunAt} />{s.runCount ? ` (${s.runCount}×)` : ""}</span></>}
                  </div>
                  {s.notes && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/90">{s.notes}</div>}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Tip label="Run"><Button variant="ghost" size="icon-xs" onClick={() => p.onRunSaved(s)} aria-label="Run saved search"><Play className="size-3.5" /></Button></Tip>
                  <Tip label={s.pinned ? "Unpin" : "Pin"}><Button variant="ghost" size="icon-xs" onClick={() => p.onTogglePin(s)} aria-label="Pin">{s.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</Button></Tip>
                  <Tip label="Delete"><Button variant="ghost" size="icon-xs" onClick={() => p.onDeleteSaved(s)} aria-label="Delete saved search"><Trash2 className="size-3.5" /></Button></Tip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><History className="size-3.5" /> Recent research <Badge variant="muted" className="py-0 tabular">{p.runs.length}</Badge></div>
        {p.runs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Your runs appear here with result counts and a cached synthesis.</div>
        ) : (
          <ul className="space-y-1.5">
            {p.runs.map((r) => {
              const total = Object.values(r.counts).reduce((a, b) => a + (b ?? 0), 0);
              return (
                <li key={r.id} className="group flex items-start gap-2 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-foreground/20">
                  <button onClick={() => p.onRestore(r)} className="min-w-0 flex-1 text-left cursor-pointer">
                    <div className="truncate font-mono text-[12px] font-medium group-hover:text-primary" title={r.query}>{r.query}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
                      <Clock className="size-3" /> <RelTime iso={r.createdAt} />
                      <span>·</span><span className="tabular">{total} results</span>
                      <span>·</span><span>{jurisdictionByKey(r.settings.jurisdiction).label.split(" (")[0]}</span>
                      {matterName(r.matterId) && <><span>·</span><span>{matterName(r.matterId)}</span></>}
                      {r.settings.fast && <Badge variant="warning" className="py-0">fast</Badge>}
                      {r.aiStatus === "no_api_key" && <Tip label="No OpenAI key when this ran"><KeyRound className="size-3 text-warning-foreground dark:text-warning" /></Tip>}
                      {r.errors?.length ? <Tip label={r.errors.map((e) => `${SOURCE_SHORT[e.source]}: ${e.message}`).join("\n")}><WifiOff className="size-3 text-destructive" /></Tip> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(r.counts).map(([src, n]) => <span key={src} className="rounded bg-muted px-1.5 py-px text-[10px] tabular text-muted-foreground">{SOURCE_SHORT[src as keyof typeof SOURCE_SHORT]} {n}</span>)}
                    </div>
                    {r.synthesis && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/90">{r.synthesis.replace(/^#+\s*Answer\s*/i, "").replace(/[#*]/g, "").slice(0, 220)}</div>}
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Tip label="Re-run"><Button variant="ghost" size="icon-xs" onClick={() => p.onRerun(r)} aria-label="Re-run"><RotateCcw className="size-3.5" /></Button></Tip>
                    <Tip label="Delete"><Button variant="ghost" size="icon-xs" onClick={() => p.onDeleteRun(r)} aria-label="Delete run"><Trash2 className="size-3.5" /></Button></Tip>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
