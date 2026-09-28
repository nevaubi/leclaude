"use client";
import * as React from "react";
import { AlertCircle, Check, ChevronRight, Loader2, RotateCcw, SkipForward, Square, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FAILURE_LABEL } from "@/lib/ai/events";
import type { ResearchSource } from "../engine/types";
import type { ActivityRow, LaneView, PendingTurn } from "./use-research";

/**
 * Agent activity strip (constitution §33): one meaningful row at a time, expandable
 * details (lanes, recent steps, verification, coverage), Stop and Retry. No timeline.
 */
export function ActivityStrip({ pending, lanes, sources, onStop, onRetry, className }: { pending: PendingTurn; lanes: LaneView[]; sources: ResearchSource[]; onStop: () => void; onRetry?: () => void; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  const live = pending.stage !== "settled" && pending.stage !== "error" && pending.stage !== "cancelled" && pending.stage !== "denied";
  React.useEffect(() => { if (!live) return; const t = setInterval(tick, 1000); return () => clearInterval(t); }, [live]);
  const read = sources.filter((s) => s.read).length;
  const settledLanes = lanes.filter((l) => l.status === "done" || l.status === "error" || l.status === "stopped" || l.status === "timeout" || l.status === "skipped");
  const failedLanes = lanes.filter((l) => l.status === "error" || l.status === "timeout" || l.status === "skipped");
  const elapsed = Math.max(0, Math.round((Date.now() - pending.startedAt) / 1000));
  const claimsTotal = pending.claims.supported + pending.claims.unsupported + pending.claims.contradicted;
  const failed = pending.stage === "error";
  const icon = failed ? <AlertCircle className="size-3.5 shrink-0 text-destructive" /> : live ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : <Check className="size-3.5 shrink-0 text-muted-foreground" />;
  const label = failed ? (pending.outcome?.reason ?? "The run failed") : pending.current;
  return (
    <div className={cn("rounded-md border bg-card font-sans text-xs", live && "border-primary/30", failed && "border-destructive/40", className)} data-activity-strip role="status" aria-live="polite">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {icon}
        {pending.mode && <span data-mode={pending.mode} className={cn("shrink-0 rounded px-1 py-px text-[10px] font-medium uppercase tracking-wide", pending.mode === "fast" ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-muted text-muted-foreground")} title={pending.mode === "fast" ? "Fast orientation: one lane, at most two sources read, lighter verification" : "Deep research: parallel lanes including adverse authority, sources read in full, claims checked"}>{pending.mode === "fast" ? "Fast" : "Deep"}</span>}
        <span className={cn("min-w-0 flex-1 truncate", failed ? "text-destructive" : "text-foreground")} title={label}>{label}</span>
        <span className="hidden items-center gap-2 tabular text-[11px] text-muted-foreground sm:flex">
          {lanes.length > 0 && <span>{settledLanes.length}/{lanes.length} lanes</span>}
          <span>{sources.length} sources</span>
          <span>{read} read</span>
          {claimsTotal > 0 && <span className={cn(pending.claims.contradicted ? "text-destructive" : pending.claims.unsupported ? "text-warning-foreground dark:text-warning" : undefined)}>{pending.claims.supported}/{claimsTotal} claims</span>}
          {(pending.toolFailures > 0 || failedLanes.length > 0) && <span className="text-warning-foreground dark:text-warning">{pending.toolFailures + failedLanes.length} failed</span>}
        </span>
        <span className="tabular text-[11px] text-muted-foreground">{elapsed}s</span>
        {live ? (
          <Button size="xs" variant="outline" onClick={onStop} aria-label="Stop the run"><Square className="size-3 fill-current" /> Stop</Button>
        ) : onRetry ? (
          <Button size="xs" variant="outline" onClick={onRetry} aria-label="Retry the run"><RotateCcw className="size-3" /> Retry</Button>
        ) : null}
        <button onClick={() => setOpen((o) => !o)} className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"}>
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
      </div>
      {open && (
        <div className="space-y-2 border-t px-2.5 py-2">
          {lanes.length > 0 && (
            <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {lanes.map((l) => <LaneRow key={l.lane.id} lane={l} />)}
            </ul>
          )}
          {pending.activity.length > 0 && (
            <ul className="space-y-0.5">
              {pending.activity.slice(-6).map((r) => <StepRow key={r.id} row={r} />)}
            </ul>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>Round {pending.round}</span>
            {pending.verification && <span>{pending.verification.supported} supported · {pending.verification.unsupported} unsupported · {pending.verification.contradicted} contradicted</span>}
            {pending.verificationNote && <span className="text-warning-foreground dark:text-warning">{pending.verificationNote}</span>}
            {pending.correction && <span className="basis-full">{pending.correction}</span>}
            {pending.coverage && !pending.coverage.complete && <span className="basis-full" title={pending.coverage.gaps.join("\n")}>Coverage: {pending.coverage.reason}</span>}
            {pending.roundReason && (!pending.coverage || pending.coverage.complete) && <span className="basis-full truncate" title={pending.roundReason}>{pending.roundReason}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function LaneRow({ lane }: { lane: LaneView }) {
  const active = lane.status === "queued" || lane.status === "retrieving" || lane.status === "reading";
  const statusText = lane.status === "queued" ? (lane.lane.dependsOn?.length ? "waiting" : "queued") : lane.status === "retrieving" && lane.lane.after?.length ? "searching · targets leading cases" : lane.status === "retrieving" ? "searching" : lane.status === "reading" ? "reading" : lane.status === "timeout" ? "timed out" : lane.status === "skipped" ? "skipped" : lane.status === "stopped" ? "stopped" : lane.status === "error" ? "failed" : lane.error ? "done, with failures" : "done";
  return (
    <li className="flex min-w-0 items-center gap-1.5" title={lane.error}>
      {lane.status === "timeout" ? <TimerOff className="size-3 shrink-0 text-warning-foreground dark:text-warning" /> : lane.status === "skipped" ? <SkipForward className="size-3 shrink-0 text-muted-foreground" /> : <span className={cn("size-1.5 shrink-0 rounded-full", lane.status === "done" && !lane.error ? "bg-success" : lane.status === "done" ? "bg-warning" : lane.status === "error" ? "bg-destructive" : lane.status === "stopped" ? "bg-muted-foreground" : active ? "bg-primary animate-pulse-soft" : "bg-muted-foreground/50")} />}
      <span className="truncate">{lane.lane.name}</span>
      <span className="truncate text-[10.5px] text-muted-foreground">{statusText}</span>
      <span className="ml-auto shrink-0 tabular text-[10.5px] text-muted-foreground">{lane.read}/{lane.sourceIds.length}{lane.durationMs != null ? ` · ${(lane.durationMs / 1000).toFixed(1)}s` : ""}</span>
    </li>
  );
}

function StepRow({ row }: { row: ActivityRow }) {
  return (
    <li className={cn("flex items-center gap-1.5 truncate text-[11px]", row.status === "error" ? "text-destructive" : "text-muted-foreground")} title={row.failure ? `${row.label} (${FAILURE_LABEL[row.failure]})` : row.label}>
      {row.status === "running" ? <Loader2 className="size-3 shrink-0 animate-spin" /> : row.status === "error" ? <AlertCircle className="size-3 shrink-0" /> : <Check className="size-3 shrink-0" />}
      <span className="truncate">{row.label}</span>
      {row.retrying && <span className="shrink-0 text-[11.5px]">retrying</span>}
    </li>
  );
}
