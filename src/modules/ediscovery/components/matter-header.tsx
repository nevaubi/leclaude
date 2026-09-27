"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { deadlineChip, deadlineLabel } from "./matter-header-helpers";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MatterOption } from "./review-page";
import type { StatsResponse } from "./use-review-data";

export { deadlineLabel, deadlineChip };

/** A plain-text fact in the header row; clickable facts read as links on hover, not as pills. */
function Fact({ children, onClick, title, tone }: { children: React.ReactNode; onClick?: () => void; title?: string; tone?: "danger" | "warning" }) {
  const cls = cn("shrink-0 whitespace-nowrap text-[12px] tabular text-muted-foreground", tone === "danger" && "text-destructive", tone === "warning" && "text-warning-foreground dark:text-warning");
  if (onClick) return <button type="button" onClick={onClick} title={title} className={cn(cls, "cursor-pointer rounded-sm hover:text-foreground hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}>{children}</button>;
  return <span className={cls} title={title}>{children}</span>;
}

const Sep = () => <span className="shrink-0 text-muted-foreground/40" aria-hidden>·</span>;

/**
 * One quiet row: matter name, then a few facts as plain text (documents, review progress, hot, privileged,
 * the next production deadline). Custodians, suggestion coverage and the index sit in a Details popover.
 */
export function MatterHeader({ matter, stats, loading, onOpenCodes, onOpenHot, onOpenPrivileged, actions }: { matter?: MatterOption; stats: StatsResponse | null; loading: boolean; onOpenCodes: () => void; onOpenHot?: () => void; onOpenPrivileged?: () => void; actions?: React.ReactNode }) {
  const deadline = stats?.productionDeadline;
  const dl = deadline ? deadlineLabel(deadline.daysLeft) : null;
  const empty = !!stats && stats.total === 0;
  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 overflow-hidden border-b px-4" aria-label="Matter summary">
      <h1 className="min-w-[120px] max-w-[30vw] shrink truncate text-[13.5px] font-semibold tracking-tight" title={matter ? `${matter.name}${matter.caption ? ` · ${matter.caption}` : ""}` : undefined}>{matter?.name ?? "Matter"}</h1>
      {loading && !stats ? (
        <Skeleton className="h-4 w-56" />
      ) : stats ? (
        <>
          {empty ? (
            <Fact>No documents yet</Fact>
          ) : (
            <>
              <Fact>{stats.total.toLocaleString()} document{stats.total === 1 ? "" : "s"}</Fact>
              <Sep />
              <Fact title={`${stats.reviewed.toLocaleString()} of ${stats.total.toLocaleString()} reviewed · ${stats.needsReview.toLocaleString()} remaining`}>{stats.pctReviewed}% reviewed</Fact>
              {stats.hot > 0 && <><Sep /><Fact onClick={onOpenHot} title="Show hot documents">{stats.hot.toLocaleString()} hot</Fact></>}
              {stats.privileged > 0 && <><Sep /><Fact onClick={onOpenPrivileged ?? onOpenCodes} title="Show privileged documents">{stats.privileged.toLocaleString()} privileged</Fact></>}
            </>
          )}
          {deadline && dl && (
            <>
              <Sep />
              <Tip label={`${deadline.label} · ${new Date(deadline.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`}>
                <span className="flex min-w-0 shrink items-center gap-1 text-[12px]">
                  <span className="hidden max-w-[160px] truncate text-muted-foreground xl:inline">{deadline.label}</span>
                  <Fact tone={dl.tone === "destructive" ? "danger" : dl.tone === "warning" ? "warning" : undefined}>{dl.label}</Fact>
                </span>
              </Tip>
            </>
          )}
          <div className="flex-1" />
          {actions}
          {!empty && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Matter details">
                  <span className="hidden sm:inline">Details</span><ChevronDown className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-3">
                <div className="text-[12.5px] font-medium">{matter?.shortName ?? "Matter"}</div>
                {matter?.caption && <div className="mt-0.5 text-[12px] text-muted-foreground">{matter.caption}</div>}
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                  <dt className="text-muted-foreground">Client</dt><dd className="truncate">{matter?.client || "—"}</dd>
                  <dt className="text-muted-foreground">Custodians</dt><dd className="tabular">{stats.custodians}</dd>
                  <dt className="text-muted-foreground">Reviewed</dt><dd className="tabular">{stats.reviewed.toLocaleString()} of {stats.total.toLocaleString()} · {stats.needsReview.toLocaleString()} remaining</dd>
                  <dt className="text-muted-foreground">Suggested scores</dt><dd className="tabular">{stats.aiScored.toLocaleString()} of {stats.total.toLocaleString()}</dd>
                  <dt className="text-muted-foreground">Search index</dt><dd className="tabular">{stats.indexed.docs.toLocaleString()} docs{stats.indexed.embedded ? ` · ${stats.indexed.embedded.toLocaleString()} embedded` : " · keyword only"}</dd>
                </dl>
              </PopoverContent>
            </Popover>
          )}
        </>
      ) : null}
    </header>
  );
}
