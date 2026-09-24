"use client";
import * as React from "react";
import { ChevronDown, Clock, Files, Flame, ShieldAlert, Sparkles, CircleDashed, X, PanelLeftOpen, ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { SAVED_VIEWS, type FacetBucket, type SavedView, type SearchFilters, type SearchResponse } from "../types";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { SectionLabel, issueColorClasses } from "./shared";

const VIEW_ICONS: Record<SavedView, React.ElementType> = { all: Files, needs_review: CircleDashed, hot: Flame, privileged: ShieldAlert, ai_responsive: Sparkles, recent: Clock };

/** Number of active facet values (pure, tested). */
export function activeFacetCount(filters: SearchFilters): number {
  return Object.values(filters).reduce((n, v) => n + (v?.length ?? 0), 0);
}

export function SearchRail({ response, loading }: { response: SearchResponse | null; loading: boolean }) {
  const { issueCodes, viewCounts } = useReview();
  const view = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);
  const filters = useReviewStore((s) => s.filters);
  const toggleFilter = useReviewStore((s) => s.toggleFilter);
  const clearFilters = useReviewStore((s) => s.clearFilters);
  // Counts come from the page-level stats fetch so they refresh with the header after every coding change.
  const counts = React.useMemo(() => new Map(viewCounts?.map((v) => [v.view, v.count]) ?? []), [viewCounts]);
  const activeCount = activeFacetCount(filters);
  const facets = response?.facets;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-thin pb-4">
      <SectionLabel>Saved searches</SectionLabel>
      <nav className="px-1.5" aria-label="Saved searches">
        {SAVED_VIEWS.map((v) => {
          const Icon = VIEW_ICONS[v.id];
          const n = counts.get(v.id);
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              title={v.hint}
              className={cn("group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors cursor-pointer", view === v.id ? "bg-accent text-accent-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent")}
              aria-current={view === v.id ? "true" : undefined}
            >
              <Icon className={cn("size-3.5 shrink-0", view === v.id ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0 flex-1 truncate">{v.label}</span>
              {n != null ? <span className={cn("tabular text-[11px]", view === v.id ? "text-accent-foreground/80" : "text-muted-foreground")}>{n.toLocaleString()}</span> : <Skeleton className="h-3 w-6" />}
            </button>
          );
        })}
      </nav>

      <SectionLabel className="pt-4" action={activeCount > 0 ? <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[11px]" onClick={clearFilters}><X className="size-3" /> Clear {activeCount}</Button> : undefined}>Facets</SectionLabel>
      {loading || !facets ? (
        <div className="space-y-2 px-3 pt-1">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
      ) : (
        <>
          <FacetGroup title="Custodian" facetKey="custodians" buckets={facets.custodian} filters={filters} onToggle={toggleFilter} />
          <FacetGroup title="Document type" facetKey="types" buckets={facets.type} filters={filters} onToggle={toggleFilter} />
          <YearHistogram years={facets.years} selected={filters.years ?? []} onToggle={(y) => toggleFilter("years", y)} />
          <FacetGroup title="Coding status" facetKey="statuses" buckets={facets.status} filters={filters} onToggle={toggleFilter} hideZero={false} />
          <FacetGroup title="Issue codes" facetKey="issues" buckets={facets.issues} filters={filters} onToggle={toggleFilter} renderLabel={(b) => { const ic = issueCodes.find((c) => c.code === b.value); const cls = issueColorClasses(ic?.color); return <span className="flex min-w-0 items-center gap-1.5"><span className={cn("size-1.5 shrink-0 rounded-full", cls.dot)} /><span className="font-mono text-[11px]">{b.value}</span><span className="truncate text-muted-foreground">{b.label}</span></span>; }} />
          <FacetGroup title="AI score" facetKey="scores" buckets={facets.score} filters={filters} onToggle={toggleFilter} hideZero={false} />
        </>
      )}
    </div>
  );
}

/** Collapsed rail: the saved views as an icon column with counts, plus a badge for active facets. */
export function SearchRailCollapsed({ onExpand }: { onExpand: () => void }) {
  const { viewCounts } = useReview();
  const view = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);
  const filters = useReviewStore((s) => s.filters);
  const counts = React.useMemo(() => new Map(viewCounts?.map((v) => [v.view, v.count]) ?? []), [viewCounts]);
  const active = activeFacetCount(filters);
  return (
    <div className="flex h-full flex-col items-center gap-1 py-2" aria-label="Saved searches (collapsed)">
      <Tip label="Show saved searches and facets" side="right"><Button variant="ghost" size="icon-xs" onClick={onExpand} aria-label="Expand rail"><PanelLeftOpen className="size-4" /></Button></Tip>
      <span className="my-1 h-px w-6 bg-border" aria-hidden />
      {SAVED_VIEWS.map((v) => {
        const Icon = VIEW_ICONS[v.id];
        const n = counts.get(v.id);
        const on = view === v.id;
        return (
          <Tip key={v.id} label={`${v.label}${n != null ? ` · ${n.toLocaleString()}` : ""}`} side="right">
            <button onClick={() => setView(v.id)} aria-label={v.label} aria-current={on ? "true" : undefined} className={cn("relative flex size-8 items-center justify-center rounded-md transition-colors cursor-pointer", on ? "bg-accent text-primary" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground")}>
              <Icon className="size-4" />
              {n != null && n > 0 && <span className={cn("absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full px-0.5 text-center text-[9px] font-medium tabular leading-[14px]", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{n > 999 ? "1k" : n}</span>}
            </button>
          </Tip>
        );
      })}
      {active > 0 && (
        <>
          <span className="my-1 h-px w-6 bg-border" aria-hidden />
          <Tip label={`${active} facet filter${active === 1 ? "" : "s"} active · expand to edit`} side="right">
            <button onClick={onExpand} className="relative flex size-8 items-center justify-center rounded-md text-primary hover:bg-sidebar-accent cursor-pointer" aria-label="Active filters"><ListFilter className="size-4" /><span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-primary px-0.5 text-center text-[9px] font-medium tabular leading-[14px] text-primary-foreground">{active}</span></button>
          </Tip>
        </>
      )}
    </div>
  );
}

function FacetGroup({ title, facetKey, buckets, filters, onToggle, hideZero = true, renderLabel }: { title: string; facetKey: keyof SearchFilters; buckets: FacetBucket[]; filters: SearchFilters; onToggle: (k: keyof SearchFilters, v: string) => void; hideZero?: boolean; renderLabel?: (b: FacetBucket) => React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  const [showAll, setShowAll] = React.useState(false);
  const active = (filters[facetKey] as string[] | undefined) ?? [];
  const visible = buckets.filter((b) => !hideZero || b.count > 0 || active.includes(b.value));
  const list = showAll ? visible : visible.slice(0, 8);
  if (!visible.length) return null;
  return (
    <div className="border-t border-border/60 px-1.5 pt-1.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer" aria-expanded={open}>
        <span>{title}{active.length > 0 && <span className="ml-1.5 rounded bg-primary/15 px-1 py-px font-mono text-[10px] normal-case tracking-normal text-primary">{active.length}</span>}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <ul className="pb-1">
          {list.map((b) => {
            const checked = active.includes(b.value);
            return (
              <li key={b.value}>
                <label className={cn("flex cursor-pointer items-center gap-2 rounded px-1.5 py-[3px] text-xs hover:bg-sidebar-accent", checked && "bg-accent/60")}>
                  <Checkbox checked={checked} onCheckedChange={() => onToggle(facetKey, b.value)} className="size-3.5" aria-label={b.label} />
                  <span className="min-w-0 flex-1 truncate">{renderLabel ? renderLabel(b) : b.label}</span>
                  <span className={cn("tabular text-[11px]", b.count === 0 ? "text-muted-foreground/50" : "text-muted-foreground")}>{b.count.toLocaleString()}</span>
                </label>
              </li>
            );
          })}
          {visible.length > 8 && <li><button onClick={() => setShowAll(!showAll)} className="px-1.5 py-1 text-[11px] text-primary hover:underline cursor-pointer">{showAll ? "Show fewer" : `Show all ${visible.length}`}</button></li>}
        </ul>
      )}
    </div>
  );
}

function YearHistogram({ years, selected, onToggle }: { years: { year: string; count: number }[]; selected: string[]; onToggle: (y: string) => void }) {
  const [open, setOpen] = React.useState(true);
  if (!years.length) return null;
  const max = Math.max(...years.map((y) => y.count), 1);
  // Fill gaps so the histogram reads as a timeline.
  const first = Number(years[0].year), last = Number(years[years.length - 1].year);
  const byYear = new Map(years.map((y) => [y.year, y.count]));
  const range = Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
  return (
    <div className="border-t border-border/60 px-1.5 pt-1.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer" aria-expanded={open}>
        <span>Date range{selected.length > 0 && <span className="ml-1.5 rounded bg-primary/15 px-1 py-px font-mono text-[10px] normal-case tracking-normal text-primary">{selected.length}</span>}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="px-1.5 pb-2 pt-1">
          <div className="flex h-12 items-end gap-px" role="group" aria-label="Documents per year">
            {range.map((y) => {
              const n = byYear.get(y) ?? 0;
              const on = selected.includes(y);
              return (
                <button key={y} onClick={() => n > 0 && onToggle(y)} title={`${y}: ${n} document${n === 1 ? "" : "s"}`} disabled={n === 0} className={cn("group relative flex-1 rounded-sm transition-colors cursor-pointer disabled:cursor-default", on ? "bg-primary" : n ? "bg-chart-2/60 hover:bg-chart-2" : "bg-muted")} style={{ height: `${Math.max(n ? 12 : 4, (n / max) * 100)}%` }} aria-pressed={on} aria-label={`${y} (${n})`} />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular text-muted-foreground"><span>{first}</span>{range.length > 2 && <span>{range[Math.floor(range.length / 2)]}</span>}<span>{last}</span></div>
          {selected.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{[...selected].sort().map((y) => <button key={y} onClick={() => onToggle(y)} className="rounded border border-primary/30 bg-primary/10 px-1.5 py-px font-mono text-[10px] text-primary hover:bg-primary/20 cursor-pointer">{y} ×</button>)}</div>}
        </div>
      )}
    </div>
  );
}
