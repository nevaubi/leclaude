"use client";
import * as React from "react";
import { MATTER_SKIPPED_NOTE } from "../engine/planner";
import { AlertCircle, Check, ChevronRight, Loader2, Monitor, SkipForward, Square, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TrustStateBadge } from "@/components/ai/trust-badge";
import { SOURCE_SHORT } from "../types";
import type { ResearchSource } from "../engine/types";
import { sourceTrustState } from "../engine/trust";
import type { LaneView } from "./use-research";
import { SOURCE_ICON } from "./result-card";
import { useResearchActions } from "./research-context";

export function LivePanel({ lanes, sources, streaming }: { lanes: LaneView[]; sources: Record<string, ResearchSource>; streaming: boolean }) {
  if (!lanes.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Monitor className="size-5" /></span>
        <div className="text-sm font-medium">Live research lanes</div>
        <div className="max-w-[260px] text-xs text-muted-foreground">Each lane gets a card here: the sources it finds or reads, its outcome (done, timed out, failed, stopped) and its note to the synthesis.</div>
      </div>
    );
  }
  return (
    <div className="space-y-2 p-2">
      {lanes.map((l) => <LaneCard key={l.lane.id} lane={l} sources={sources} streaming={streaming} />)}
    </div>
  );
}

function LaneCard({ lane, sources, streaming }: { lane: LaneView; sources: Record<string, ResearchSource>; streaming: boolean }) {
  const a = useResearchActions();
  const [open, setOpen] = React.useState(true);
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  const active = lane.status === "retrieving" || lane.status === "reading" || lane.status === "queued";
  React.useEffect(() => { if (!active || !streaming) return; const t = setInterval(tick, 1000); return () => clearInterval(t); }, [active, streaming]);
  const elapsed = lane.durationMs ?? (lane.startedAt ? Date.now() - lane.startedAt : 0);
  const pages = lane.sourceIds.map((id) => sources[id]).filter(Boolean);
  const read = pages.filter((s) => s.read);
  const shown = [...read, ...pages.filter((s) => !s.read)].slice(0, 12);
  const icon = active && streaming ? <Loader2 className="size-3.5 animate-spin text-primary" />
    : lane.status === "done" && !lane.error ? <Check className="size-3.5 text-success" />
    : lane.status === "done" ? <AlertCircle className="size-3.5 text-warning-foreground dark:text-warning" />
    : lane.status === "timeout" ? <TimerOff className="size-3.5 text-warning-foreground dark:text-warning" />
    : lane.status === "skipped" ? <SkipForward className="size-3.5 text-muted-foreground" />
    : lane.status === "stopped" ? <Square className="size-3 text-muted-foreground" />
    : <AlertCircle className="size-3.5 text-destructive" />;
  return (
    <div className={cn("rounded-lg border bg-card", active && streaming && "border-primary/30")} data-lane-status={lane.status}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer">
        {icon}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{lane.lane.name}</span>
        {lane.lane.round > 1 && <Badge variant="muted" className="py-0">R{lane.lane.round}</Badge>}
        {lane.status === "timeout" && <Badge variant="warning" size="sm">Timed out</Badge>}
        {lane.status === "skipped" && <Badge variant="muted" size="sm">Skipped</Badge>}
        {lane.status === "queued" && lane.lane.dependsOn?.length ? <Badge variant="muted" size="sm">Waiting</Badge> : null}
        <span className="tabular text-[11px] text-muted-foreground">{read.length}/{pages.length}</span>
        <span className="tabular text-[11px] text-muted-foreground">{(elapsed / 1000).toFixed(1)}s</span>
        <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-xs">
          {lane.lane.brief && <div className="mb-1.5 text-[11px] text-muted-foreground">{lane.lane.brief}</div>}
          {lane.lane.note?.startsWith(MATTER_SKIPPED_NOTE) && <div className="mb-1.5 text-[11px] text-muted-foreground" data-state="matter-skipped">{MATTER_SKIPPED_NOTE} Select a matter to include its documents.</div>}
          {lane.error && <div className={cn("mb-1.5 rounded border px-2 py-1 text-[11px]", lane.status === "done" ? "border-warning/50 text-foreground" : "border-destructive/40 text-destructive")}>{lane.error}</div>}
          {shown.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {shown.map((s) => {
                const Icon = SOURCE_ICON[s.kind];
                return (
                  <li key={s.id}>
                    <button onClick={() => a.openSource(s)} onMouseEnter={() => a.setHoverN(s.n ?? null)} onMouseLeave={() => a.setHoverN(null)} className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-accent/60 cursor-pointer">
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-foreground">{s.n != null && <span className="mr-1 tabular font-semibold text-primary">[{s.n}]</span>}{s.title}</span>
                        <span className="block truncate text-[10.5px] text-muted-foreground">{[s.cite, SOURCE_SHORT[s.kind], s.read ? `${((s.chars ?? 0) / 1000).toFixed(1)}k chars` : null, s.readMs != null ? `${(s.readMs / 1000).toFixed(1)}s` : null, s.cached ? "cached" : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      <TrustStateBadge state={sourceTrustState(s, a.trustContext)} size="xs" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-[11px] text-muted-foreground">{active ? (lane.status === "queued" && lane.lane.dependsOn?.length ? "Waiting for the lanes it builds on…" : "Waiting for results…") : "No sources from this lane."}</div>
          )}
          {pages.length > shown.length && <div className="mt-1 text-[10.5px] text-muted-foreground">+{pages.length - shown.length} more in Sources</div>}
          {lane.note && <details className="mt-2"><summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Lane note</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 font-sans text-[11px] leading-relaxed">{lane.note}</pre></details>}
        </div>
      )}
    </div>
  );
}
