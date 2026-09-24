"use client";
import * as React from "react";
import { CalendarClock, ChevronDown, Database, Flame, ShieldAlert, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { Chip } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MatterOption } from "./review-page";
import type { StatsResponse } from "./use-review-data";

/** Countdown label and tone for a production deadline, from days left. */
export function deadlineLabel(daysLeft: number): { label: string; tone: "destructive" | "warning" | "outline" } {
  if (daysLeft < 0) return { label: `${Math.abs(daysLeft)}d overdue`, tone: "destructive" };
  if (daysLeft === 0) return { label: "due today", tone: "destructive" };
  if (daysLeft <= 7) return { label: `in ${daysLeft}d`, tone: "destructive" };
  if (daysLeft <= 30) return { label: `in ${daysLeft}d`, tone: "warning" };
  if (daysLeft < 60) return { label: `in ${Math.round(daysLeft / 7)} wk`, tone: "outline" };
  return { label: `in ${Math.round(daysLeft / 30)} mo`, tone: "outline" };
}

/**
 * One-row matter header: matter · stage · review progress · next deadline ·
 * hot / privileged as quiet chips. Custodians, AI coverage and the index live
 * in a "Details" popover so the row stays calm.
 */
export function MatterHeader({ matter, stats, loading, onOpenCodes, onOpenHot, onOpenPrivileged }: { matter?: MatterOption; stats: StatsResponse | null; loading: boolean; onOpenCodes: () => void; onOpenHot?: () => void; onOpenPrivileged?: () => void }) {
  const pct = stats?.pctReviewed ?? 0;
  const deadline = stats?.productionDeadline;
  const dl = deadline ? deadlineLabel(deadline.daysLeft) : null;
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b bg-card/40 px-4 no-scrollbar" aria-label="Matter summary">
      <h1 className="min-w-0 max-w-[36vw] truncate text-[13px] font-semibold tracking-tight" title={matter ? `${matter.name}${matter.caption ? ` · ${matter.caption}` : ""}` : undefined}>{matter?.name ?? "Matter"}</h1>
      {matter?.stage && <Chip tone="muted" title="Matter stage">{matter.stage}</Chip>}
      <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
      {loading && !stats ? (
        <Skeleton className="h-4 w-56" />
      ) : stats ? (
        <>
          <Tip label={`${stats.reviewed.toLocaleString()} of ${stats.total.toLocaleString()} reviewed · ${stats.needsReview.toLocaleString()} remaining`}>
            <span className="flex shrink-0 items-center gap-2 text-[12px]">
              <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Review progress">
                <span className={cn("absolute inset-y-0 left-0 rounded-full", pct >= 90 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
              </span>
              <span className="tabular font-medium">{pct}%</span>
              <span className="hidden text-muted-foreground lg:inline">reviewed</span>
            </span>
          </Tip>
          {deadline && dl && (
            <Tip label={`${deadline.label} · ${new Date(deadline.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`}>
              <span className="flex shrink-0 items-center gap-1.5 text-[12px]">
                <CalendarClock className={cn("size-3.5", dl.tone === "destructive" ? "text-destructive" : dl.tone === "warning" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")} />
                <span className="hidden truncate text-muted-foreground md:inline">{deadline.label}</span>
                <Chip tone={dl.tone}>{dl.label}</Chip>
              </span>
            </Tip>
          )}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
          <Chip icon={Flame} tone={stats.hot ? "destructive" : "outline"} onClick={onOpenHot} title="Hot documents">{stats.hot} hot</Chip>
          <Chip icon={ShieldAlert} tone={stats.privileged ? "info" : "outline"} onClick={onOpenPrivileged ?? onOpenCodes} title="Privileged documents · open the privilege log">{stats.privileged} priv</Chip>
          <div className="flex-1" />
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Matter details">
                <span className="hidden sm:inline">Details</span><ChevronDown className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{matter?.shortName ?? "Matter"}</div>
              {matter?.caption && <div className="mt-0.5 text-[12px] text-muted-foreground">{matter.caption}</div>}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                <dt className="flex items-center gap-1.5 text-muted-foreground"><Users className="size-3.5" /> Client</dt><dd className="truncate">{matter?.client ?? "—"}</dd>
                <dt className="flex items-center gap-1.5 text-muted-foreground"><Users className="size-3.5" /> Custodians</dt><dd className="tabular">{stats.custodians}</dd>
                <dt className="flex items-center gap-1.5 text-muted-foreground"><Sparkles className="size-3.5" /> AI scored</dt><dd className="tabular">{stats.aiScored.toLocaleString()} <span className="text-muted-foreground">of {stats.total.toLocaleString()}</span></dd>
                <dt className="flex items-center gap-1.5 text-muted-foreground"><Database className="size-3.5" /> Index</dt><dd className="tabular">{stats.indexed.docs.toLocaleString()} docs{stats.indexed.embedded ? ` · ${stats.indexed.embedded.toLocaleString()} embedded` : " · keyword only"}</dd>
                <dt className="text-muted-foreground">Reviewed</dt><dd className="tabular">{stats.reviewed.toLocaleString()} / {stats.total.toLocaleString()} · {stats.needsReview.toLocaleString()} remaining</dd>
              </dl>
            </PopoverContent>
          </Popover>
        </>
      ) : null}
    </header>
  );
}
