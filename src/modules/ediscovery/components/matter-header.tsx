"use client";
import * as React from "react";
import { CalendarClock, Flame, ShieldAlert, Users, Sparkles, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import type { MatterOption } from "./review-page";
import type { StatsResponse } from "./use-review-data";

export function MatterHeader({ matter, stats, loading, onOpenCodes }: { matter?: MatterOption; stats: StatsResponse | null; loading: boolean; onOpenCodes: () => void }) {
  const pct = stats?.pctReviewed ?? 0;
  const deadline = stats?.productionDeadline;
  const urgency = deadline ? (deadline.daysLeft <= 7 ? "text-destructive" : deadline.daysLeft <= 30 ? "text-warning-foreground dark:text-warning" : "text-foreground") : "";
  return (
    <header className="shrink-0 border-b bg-card/40 px-4 pt-3 pb-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{matter?.name ?? "Matter"}</h1>
            {matter?.caption && <span className="shrink-0 text-xs text-muted-foreground">{matter.caption}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{matter?.client}</span>
            {matter?.stage && <><span aria-hidden>·</span><span>{matter.stage}</span></>}
            {stats && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><Users className="size-3" />{stats.custodians} custodians</span></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading && !stats ? (
            <>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-32" />)}</>
          ) : stats ? (
            <>
              <Stat label="Batch progress" hint={`${stats.reviewed.toLocaleString()} of ${stats.total.toLocaleString()} reviewed · ${stats.needsReview.toLocaleString()} remaining`} className="min-w-[180px]">
                <div className="flex items-center gap-2">
                  <span className="tabular text-base font-semibold leading-none">{pct}%</span>
                  <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <span className={cn("absolute inset-y-0 left-0 rounded-full", pct >= 90 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </span>
                </div>
              </Stat>
              <Stat label="Hot" hint="Flagged hot by a reviewer" icon={<Flame className="size-3.5 text-destructive" />}>{stats.hot}</Stat>
              <Stat label="Privileged" hint="Open Codes & privilege for the log" icon={<ShieldAlert className="size-3.5 text-info" />} onClick={onOpenCodes}>{stats.privileged}</Stat>
              <Stat label="AI scored" hint={`${stats.aiScored} of ${stats.total} documents have a responsiveness score`} icon={<Sparkles className="size-3.5 text-chart-3" />}>{stats.aiScored}</Stat>
              <Stat label="Index" hint={stats.indexed.embedded ? `${stats.indexed.embedded} embedded chunks` : "Keyword index only (no embeddings)"} icon={<Database className="size-3.5 text-muted-foreground" />}>{stats.indexed.docs}</Stat>
              {deadline && (
                <Stat label={deadline.label} hint={new Date(deadline.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} icon={<CalendarClock className={cn("size-3.5", urgency)} />}>
                  <span className={urgency}>{deadline.daysLeft < 0 ? `${Math.abs(deadline.daysLeft)}d overdue` : deadline.daysLeft === 0 ? "Today" : `${deadline.daysLeft}d`}</span>
                </Stat>
              )}
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Stat({ label, hint, children, icon, className, onClick }: { label: string; hint?: string; children: React.ReactNode; icon?: React.ReactNode; className?: string; onClick?: () => void }) {
  const body = (
    <div className={cn("flex h-11 flex-col justify-center rounded-md border bg-card px-3", onClick && "cursor-pointer transition-colors hover:bg-accent/60", className)} onClick={onClick} role={onClick ? "button" : undefined}>
      <div className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className="mt-0.5 tabular text-base font-semibold leading-none">{children}</div>
    </div>
  );
  return hint ? <Tip label={hint}>{body}</Tip> : body;
}
