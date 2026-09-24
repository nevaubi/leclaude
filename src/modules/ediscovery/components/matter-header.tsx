"use client";
import * as React from "react";
import { CalendarClock, Flame, ShieldAlert, Users, Sparkles, Database, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MatterOption } from "./review-page";
import type { StatsResponse } from "./use-review-data";

/** Deadline chip tone and label from days left (pure, tested). */
export function deadlineChip(daysLeft: number): { tone: "danger" | "warning" | "accent" | "quiet"; label: string } {
  if (daysLeft < 0) return { tone: "danger", label: `${Math.abs(daysLeft)}d overdue` };
  if (daysLeft === 0) return { tone: "danger", label: "today" };
  if (daysLeft <= 7) return { tone: "warning", label: `${daysLeft}d` };
  if (daysLeft <= 30) return { tone: "accent", label: `${daysLeft}d` };
  return { tone: "quiet", label: `${daysLeft}d` };
}

/**
 * One-row matter header: name, stage, review progress, next deadline and the
 * hot / privileged counts as quiet chips. Everything else (custodians, AI
 * scoring, index coverage) sits behind a "more" popover.
 */
export function MatterHeader({ matter, stats, loading, onOpenCodes }: { matter?: MatterOption; stats: StatsResponse | null; loading: boolean; onOpenCodes: () => void }) {
  const pct = stats?.pctReviewed ?? 0;
  const deadline = stats?.productionDeadline;
  const dl = deadline ? deadlineChip(deadline.daysLeft) : null;
  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 overflow-x-auto border-b bg-card/40 px-4 no-scrollbar">
      <div className="flex min-w-0 shrink items-baseline gap-2">
        <h1 className="truncate text-[13px] font-semibold tracking-tight" title={matter?.name}>{matter?.name ?? "Matter"}</h1>
        {matter?.caption && <span className="hidden shrink-0 text-[11px] text-muted-foreground xl:inline">{matter.caption}</span>}
      </div>
      {matter?.stage && <Chip tone="quiet" className="shrink-0">{matter.stage}</Chip>}
      <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
      {loading && !stats ? (
        <Skeleton className="h-4 w-56" />
      ) : stats ? (
        <>
          <Tip label={`${stats.reviewed.toLocaleString()} of ${stats.total.toLocaleString()} reviewed · ${stats.needsReview.toLocaleString()} remaining`}>
            <span className="flex shrink-0 items-center gap-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Review progress">
              <span className="tabular text-[12px] font-semibold">{pct}%</span>
              <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span className={cn("absolute inset-y-0 left-0 rounded-full", pct >= 90 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} /></span>
              <span className="hidden text-[11px] tabular text-muted-foreground md:inline">{stats.reviewed.toLocaleString()}/{stats.total.toLocaleString()}</span>
            </span>
          </Tip>
          {deadline && dl && (
            <Tip label={`${deadline.label} · ${new Date(deadline.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`}>
              <Chip tone={dl.tone} icon={CalendarClock} className="shrink-0 tabular"><span className="hidden lg:inline">{deadline.label} ·</span> {dl.label}</Chip>
            </Tip>
          )}
          <Tip label="Flagged hot by a reviewer"><Chip tone="quiet" icon={Flame} className="shrink-0 tabular">{stats.hot} hot</Chip></Tip>
          <Tip label="Coded privileged · open the privilege log"><Chip tone="quiet" icon={ShieldAlert} onClick={onOpenCodes} className="shrink-0 tabular">{stats.privileged} privileged</Chip></Tip>
          <div className="flex-1" />
          <Popover>
            <Tip label="More about this matter"><PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="More matter details"><MoreHorizontal className="size-4" /></Button></PopoverTrigger></Tip>
            <PopoverContent align="end" className="w-72 p-3 text-xs">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="flex items-center gap-1 text-muted-foreground"><Users className="size-3" /> Custodians</dt><dd className="tabular">{stats.custodians}</dd>
                <dt className="flex items-center gap-1 text-muted-foreground"><Sparkles className="size-3" /> AI scored</dt><dd className="tabular">{stats.aiScored} of {stats.total}</dd>
                <dt className="flex items-center gap-1 text-muted-foreground"><Database className="size-3" /> Index</dt><dd className="tabular">{stats.indexed.docs} docs · {stats.indexed.chunks} chunks{stats.indexed.embedded ? ` · ${stats.indexed.embedded} embedded` : " · keyword only"}</dd>
                <dt className="text-muted-foreground">Responsive</dt><dd className="tabular">{stats.responsive} · {stats.nonResponsive} not</dd>
                {matter?.client && <><dt className="text-muted-foreground">Client</dt><dd className="truncate">{matter.client}</dd></>}
                {matter?.caption && <><dt className="text-muted-foreground">Caption</dt><dd className="truncate">{matter.caption}</dd></>}
              </dl>
            </PopoverContent>
          </Popover>
        </>
      ) : null}
    </header>
  );
}
