"use client";
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ArrowDownAZ, Clock, Filter, Loader2, RotateCcw, SearchX, Sparkles, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { sortHits } from "../normalize";
import { SOURCE_SHORT, type SearchHit, type SearchOrder, type SearchSource } from "../types";
import type { RunState, SourceState } from "./use-search";
import { ResultCard, SOURCE_ICON } from "./result-card";

export interface ResultsPaneProps {
  run: RunState;
  terms: string[];
  order: SearchOrder;
  onOrderChange: (o: SearchOrder) => void;
  activeSource: SearchSource | null;
  onActiveSourceChange: (s: SearchSource) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  memoIds: Set<string>;
  onOpen: (hit: SearchHit) => void;
  onCite: (hit: SearchHit) => void;
  onSave: (hit: SearchHit) => void;
  onMemo: (hit: SearchHit) => void;
  onRetry: (source: SearchSource) => void;
  filter: string;
  onFilterChange: (v: string) => void;
  /** Called with the visible (sorted, filtered) list so the page can drive j/k navigation. */
  onVisibleChange?: (hits: SearchHit[]) => void;
}

export function visibleHits(state: SourceState | undefined, order: SearchOrder, filter: string): SearchHit[] {
  if (!state) return [];
  const f = filter.trim().toLowerCase();
  const list = f ? state.hits.filter((h) => `${h.title} ${h.snippet ?? ""} ${h.cite ?? ""} ${h.subtitle ?? ""}`.toLowerCase().includes(f)) : state.hits;
  return sortHits(list, order);
}

export function ResultsPane(p: ResultsPaneProps) {
  const tabs = React.useMemo(() => (p.run.settings?.sources ?? []).filter((s) => s !== "web" || p.run.settings?.sources.includes("web")), [p.run.settings]);
  const active = p.activeSource && tabs.includes(p.activeSource) ? p.activeSource : tabs[0] ?? null;
  const state = active ? p.run.sources[active] : undefined;
  const hits = React.useMemo(() => visibleHits(state, p.order, p.filter), [state, p.order, p.filter]);
  const onVisible = p.onVisibleChange;
  React.useEffect(() => { onVisible?.(hits); }, [hits, onVisible]);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: hits.length, getScrollElement: () => parentRef.current, estimateSize: () => 150, overscan: 8, getItemKey: (i) => hits[i]?.id ?? i });

  // keep the selected card in view when navigating with j/k
  React.useEffect(() => {
    if (!p.selectedId) return;
    const idx = hits.findIndex((h) => h.id === p.selectedId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [p.selectedId, hits, virtualizer]);

  const total = tabs.reduce((n, s) => n + p.run.sources[s].hits.length, 0);
  const loading = tabs.some((s) => p.run.sources[s].status === "loading");

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 no-scrollbar">
        {tabs.map((s) => {
          const st = p.run.sources[s];
          const Icon = SOURCE_ICON[s];
          const isActive = s === active;
          return (
            <button
              key={s}
              onClick={() => p.onActiveSourceChange(s)}
              className={cn("flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition-colors cursor-pointer", isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              <Icon className="size-3.5" />
              {SOURCE_SHORT[s]}
              {st.status === "loading" ? (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              ) : st.status === "error" || st.status === "stopped" ? (
                <Tip label={st.error ?? "Error"}><span className="inline-flex size-4 items-center justify-center rounded-full bg-destructive/10 text-destructive"><WifiOff className="size-2.5" /></span></Tip>
              ) : (
                <span className={cn("rounded-full px-1.5 py-px tabular text-[10px]", isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{st.hits.length}{st.total > st.hits.length ? `/${st.total > 9999 ? "9999+" : st.total}` : ""}</span>
              )}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1 pl-2">
          <div className="relative hidden md:block">
            <Filter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input value={p.filter} onChange={(e) => p.onFilterChange(e.target.value)} placeholder="Filter results" className="h-7 w-40 pl-6 text-xs" />
          </div>
          <div className="flex items-center rounded-md border p-0.5">
            <Tip label="Precision (relevance score)"><button onClick={() => p.onOrderChange("score")} className={cn("flex h-6 items-center gap-1 rounded px-1.5 text-[11px] cursor-pointer", p.order === "score" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}><ArrowDownAZ className="size-3" /> Precision</button></Tip>
            <Tip label="Recency (newest first)"><button onClick={() => p.onOrderChange("date")} className={cn("flex h-6 items-center gap-1 rounded px-1.5 text-[11px] cursor-pointer", p.order === "date" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}><Clock className="size-3" /> Recency</button></Tip>
          </div>
        </div>
      </div>

      {p.run.cached && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="size-3" /> Showing cached top results from {new Date(p.run.cached.createdAt).toLocaleString()} · re-run the search for the full list.
        </div>
      )}

      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Search results">
        {!active ? (
          <div className="p-6"><EmptyState icon={SearchX} title="No sources selected" description="Pick at least one source chip above the query bar." /></div>
        ) : state?.status === "loading" && hits.length === 0 ? (
          <div className="p-2 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="mx-2 rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2"><Skeleton className="size-6 rounded-md" /><Skeleton className="h-3.5 w-2/3" /></div>
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </div>
        ) : state?.status === "error" || state?.status === "stopped" ? (
          <div className="p-6">
            <EmptyState
              icon={state.status === "stopped" ? AlertTriangle : WifiOff}
              title={state.status === "stopped" ? "Search stopped" : "Provider unreachable"}
              description={state.error}
              action={<Button size="sm" variant="outline" onClick={() => p.onRetry(active)}><RotateCcw className="size-3.5" /> Retry {SOURCE_SHORT[active]}</Button>}
            />
          </div>
        ) : hits.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={SearchX} title={p.filter ? "Nothing matches the filter" : active === "web" ? "No web sources yet" : `No ${SOURCE_SHORT[active].toLowerCase()} results`} description={active === "web" ? "Web pages the research agent cites while it works appear here (requires the Web chip and an OpenAI key)." : "Try broader terms, remove a jurisdiction filter, or widen the date range."} />
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const hit = hits[vi.index];
              return (
                <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}>
                  <ResultCard
                    hit={hit}
                    index={vi.index}
                    terms={p.terms}
                    selected={p.selectedId === hit.id}
                    inMemo={p.memoIds.has(hit.id)}
                    onSelect={() => p.onSelect(hit.id)}
                    onOpen={() => p.onOpen(hit)}
                    onCite={() => p.onCite(hit)}
                    onSave={() => p.onSave(hit)}
                    onMemo={() => p.onMemo(hit)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/30 px-3 text-[10.5px] text-muted-foreground">
        <span className="tabular">{total} result{total === 1 ? "" : "s"} across {tabs.length} source{tabs.length === 1 ? "" : "s"}</span>
        {loading && <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> loading</span>}
        {state?.durationMs != null && state.status === "done" && <span className="tabular">{SOURCE_SHORT[active!]} in {(state.durationMs / 1000).toFixed(1)}s</span>}
        <div className="flex-1" />
        <span className="hidden lg:inline"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>↵</kbd> open · <kbd>c</kbd> cite · <kbd>m</kbd> memo</span>
      </div>
    </div>
  );
}
