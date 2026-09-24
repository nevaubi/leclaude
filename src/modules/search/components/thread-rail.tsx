"use client";
import * as React from "react";
import { Bookmark, History, PanelLeftClose, Pin, Plus, Search, Trash2 } from "lucide-react";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { jurisdictionByKey } from "../jurisdictions";
import type { SavedSearch, SearchRun } from "../types";

export interface ThreadSummary { id: string; title: string; matterId: string | null; updatedAt: string; createdAt: string; messages: number; sources: number; pins: number; lastQuestion: string }

export interface ThreadRailProps {
  threads: ThreadSummary[];
  runs: SearchRun[];
  saved: SavedSearch[];
  matters: { id: string; shortName: string }[];
  activeThreadId: string | null;
  onNew: () => void;
  onOpenThread: (id: string) => void;
  onOpenRun: (r: SearchRun) => void;
  onRunSaved: (s: SavedSearch) => void;
  onDeleteThread: (id: string) => void;
  onDeleteSaved: (s: SavedSearch) => void;
  onTogglePin: (s: SavedSearch) => void;
  onClose: () => void;
}

export function RelTime({ iso }: { iso: string }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return <span suppressHydrationWarning title={new Date(iso).toLocaleString()}>{mounted ? relativeTime(iso) : formatDate(iso)}</span>;
}

export function ThreadRail(p: ThreadRailProps) {
  const [filter, setFilter] = React.useState("");
  const matterName = (id?: string | null) => p.matters.find((m) => m.id === id)?.shortName;
  const f = filter.trim().toLowerCase();
  const threads = p.threads.filter((t) => !f || t.title.toLowerCase().includes(f));
  const threadRunIds = new Set(p.threads.map((t) => t.id));
  // Legacy history runs (no thread) still show so seeded history stays reachable.
  const legacyRuns = p.runs.filter((r) => !r.threadId || !threadRunIds.has(r.threadId)).filter((r) => !f || r.query.toLowerCase().includes(f)).slice(0, 12);
  const saved = p.saved.filter((s) => !f || `${s.name} ${s.query}`.toLowerCase().includes(f));
  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r bg-sidebar" aria-label="Research threads">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <Button size="sm" variant="outline" className="flex-1 justify-start" onClick={p.onNew}><Plus className="size-3.5" /> New research</Button>
        <Tip label="Hide threads" shortcut="["><Button variant="ghost" size="icon-xs" onClick={p.onClose} aria-label="Hide threads"><PanelLeftClose className="size-4" /></Button></Tip>
      </div>
      <div className="px-2 pb-1"><div className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter threads" className="h-7 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none focus:border-ring" /></div></div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <Section icon={History} title="Recent" count={threads.length + legacyRuns.length}>
          {threads.length === 0 && legacyRuns.length === 0 && <Empty>Your research threads appear here.</Empty>}
          {threads.map((t) => (
            <Row key={t.id} active={t.id === p.activeThreadId} onClick={() => p.onOpenThread(t.id)} title={t.title} meta={[matterName(t.matterId), `${t.sources} src`, t.pins ? `${t.pins} pins` : null].filter(Boolean).join(" · ")} time={t.updatedAt} onDelete={() => p.onDeleteThread(t.id)} />
          ))}
          {legacyRuns.map((r) => (
            <Row key={r.id} active={false} onClick={() => p.onOpenRun(r)} title={r.query} meta={[matterName(r.matterId), `${Object.values(r.counts).reduce((x, y) => x + (y ?? 0), 0)} src`, r.aiStatus === "no_api_key" ? "no key" : null].filter(Boolean).join(" · ")} time={r.createdAt} />
          ))}
        </Section>
        <Section icon={Bookmark} title="Saved searches" count={saved.length}>
          {saved.length === 0 && <Empty>Save a search from the answer&apos;s action row.</Empty>}
          {saved.map((s) => (
            <Row key={s.id} active={false} onClick={() => p.onRunSaved(s)} title={s.name} meta={[s.pinned ? "pinned" : null, jurisdictionByKey(s.settings.jurisdiction).label.split(" (")[0], matterName(s.matterId), s.runCount ? `${s.runCount}×` : null].filter(Boolean).join(" · ")} time={s.lastRunAt ?? s.updatedAt} pinned={s.pinned} onPin={() => p.onTogglePin(s)} onDelete={() => p.onDeleteSaved(s)} />
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Section({ icon: Icon, title, count, children }: { icon: React.ComponentType<{ className?: string }>; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="pb-2">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><Icon className="size-3" /> {title} <span className="tabular font-normal">{count}</span></div>
      <ul className="space-y-px px-1">{children}</ul>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) { return <li className="px-2 py-2 text-[11px] text-muted-foreground">{children}</li>; }

function Row({ active, onClick, title, meta, time, onDelete, onPin, pinned }: { active: boolean; onClick: () => void; title: string; meta: string; time: string; onDelete?: () => void; onPin?: () => void; pinned?: boolean }) {
  return (
    <li className={cn("group relative rounded-md transition-colors", active ? "bg-primary/10" : "hover:bg-sidebar-accent")}>
      <button onClick={onClick} className="block w-full px-2 py-1.5 text-left cursor-pointer">
        <div className={cn("truncate text-[12.5px]", active ? "font-medium text-primary" : "text-foreground")}>{title}</div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-muted-foreground"><span className="truncate">{meta}</span>{meta && <span>·</span>}<RelTime iso={time} /></div>
      </button>
      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {onPin && <Tip label={pinned ? "Unpin" : "Pin"}><Button variant="ghost" size="icon-xs" onClick={onPin} aria-label="Pin saved search"><Pin className={cn("size-3", pinned && "fill-current text-primary")} /></Button></Tip>}
        {onDelete && <Tip label="Delete"><Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label="Delete"><Trash2 className="size-3" /></Button></Tip>}
      </div>
    </li>
  );
}
