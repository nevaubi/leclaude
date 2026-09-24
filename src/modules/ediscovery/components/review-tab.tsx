"use client";
import * as React from "react";
import { PanelLeftClose } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { SearchRequest } from "../types";
import { useReviewStore } from "./store";
import { api, useSearch } from "./use-review-data";
import { useReview } from "./review-page";
import { SearchRail, SearchRailCollapsed } from "./search-rail";
import { SearchBox } from "./search-box";
import { DocTable } from "./doc-table";
import { BulkBar } from "./bulk-bar";
import { DocViewer } from "./doc-viewer";
import type { CodingDecision } from "@/lib/types/domain";

export interface ReviewListApi {
  ids: string[];
  patchCoding: (ids: string[], coding: CodingDecision) => void;
  refresh: () => void;
}

export const ReviewListContext = React.createContext<ReviewListApi>({ ids: [], patchCoding: () => {}, refresh: () => {} });

/** True while the viewport is narrower than `px` (false during SSR and before mount). */
export function useNarrowViewport(px: number) {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return narrow;
}

export function ReviewTab() {
  const { matterId, refreshStats } = useReview();
  const s = useReviewStore();
  const req = React.useMemo<SearchRequest>(() => ({ matterId, q: s.q, semantic: s.semantic, view: s.view, filters: s.filters, sort: s.sort, dir: s.dir, offset: 0, limit: 500 }), [matterId, s.q, s.semantic, s.view, s.filters, s.sort, s.dir]);
  const search = useSearch(req);
  const hits = React.useMemo(() => search.data?.hits ?? [], [search.data]);
  const ids = React.useMemo(() => hits.map((h) => h.id), [hits]);
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);

  React.useEffect(() => { if (search.error) toast.error("Search failed", { description: search.error.message }); }, [search.error]);

  // Keep the cursor inside the result set.
  React.useEffect(() => {
    if (!hits.length) return;
    if (!s.activeId || !ids.includes(s.activeId)) useReviewStore.getState().setActiveId(hits[0].id);
  }, [hits, ids, s.activeId]);

  // Coding changes: patch rows optimistically, then refetch so facet counts (status / issues / views) catch up.
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = React.useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; search.refresh(); }, 400);
  }, [search]);
  React.useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  const listTick = useReviewStore((st) => st.listTick);
  const firstTick = React.useRef(true);
  const searchRefresh = search.refresh;
  React.useEffect(() => { if (firstTick.current) { firstTick.current = false; return; } searchRefresh(); }, [listTick, searchRefresh]);

  const listApi = React.useMemo<ReviewListApi>(() => ({
    ids,
    patchCoding: (docIds, coding) => { search.patchRows(docIds, (r) => ({ ...r, coding })); refreshStats(); scheduleRefresh(); },
    refresh: () => { search.refresh(); refreshStats(); },
  }), [ids, search, refreshStats, scheduleRefresh]);

  const move = React.useCallback((delta: number) => {
    const st = useReviewStore.getState();
    if (!ids.length) return;
    const idx = Math.max(0, ids.indexOf(st.activeId ?? ""));
    const next = ids[Math.min(ids.length - 1, Math.max(0, idx + delta))];
    st.setActiveId(next);
    if (st.openDocId) st.setOpenDocId(next);
  }, [ids]);

  // Keyboard: j/k/Enter/Space/Esc/⌘A/F
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape that just closed a popover / select / dialog (Radix marks it handled) must not also close the viewer.
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || t.getAttribute("role") === "combobox");
      const st = useReviewStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !typing) { e.preventDefault(); st.setSelected(ids); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "j": case "ArrowDown": if (t?.closest("[data-doc-table]") || !t?.closest("[data-doc-viewer]")) { e.preventDefault(); move(1); } break;
        case "k": case "ArrowUp": if (t?.closest("[data-doc-table]") || !t?.closest("[data-doc-viewer]")) { e.preventDefault(); move(-1); } break;
        case "Enter": if (st.activeId && !st.openDocId) { e.preventDefault(); st.setOpenDocId(st.activeId); } break;
        case " ": if (st.activeId && !t?.closest("button")) { e.preventDefault(); st.toggleSelected(st.activeId); } break;
        case "Escape": if (st.openDocId) st.setOpenDocId(null); else if (st.selected.length) st.setSelected([]); break;
        case "f": if (st.openDocId) { e.preventDefault(); st.setFullscreen(!st.fullscreen); } break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, move]);

  const bulk = async (patch: Partial<CodingDecision>, extra: { addIssues?: string[]; removeIssues?: string[]; reviewerId?: string } = {}) => {
    const st = useReviewStore.getState();
    const selected = st.selected;
    if (!selected.length) return;
    try {
      await api("/api/ediscovery/docs/bulk", { method: "POST", json: { ids: selected, patch, ...extra } });
      search.patchRows(selected, (r) => {
        let issues = r.coding.issues ?? [];
        if (extra.addIssues) issues = Array.from(new Set([...issues, ...extra.addIssues]));
        if (extra.removeIssues) issues = issues.filter((i) => !extra.removeIssues!.includes(i));
        const coding = { ...r.coding, ...patch, issues };
        if (coding.privileged !== true) delete coding.privilegeBasis;
        return { ...r, coding };
      });
      refreshStats();
      scheduleRefresh();
      toast.success(`Coded ${selected.length} document${selected.length === 1 ? "" : "s"}`);
    } catch (e) { toast.error("Bulk coding failed", { description: (e as Error).message }); }
  };

  const fullscreen = s.fullscreen && !!s.openDocId;
  // Below 1440px the rail (248px) plus list plus viewer plus coding panel do not fit, so the rail folds to its
  // icon column automatically while a document is open (the user's persisted preference is left untouched).
  const narrow = useNarrowViewport(1440);
  const railCollapsed = hydrated && (s.railCollapsed || (narrow && !!s.openDocId));

  return (
    <ReviewListContext.Provider value={listApi}>
      <div className="flex h-full min-h-0">
        {!fullscreen && (
          <aside className={cn("relative hidden h-full shrink-0 flex-col border-r bg-sidebar/40 md:flex transition-[width]", railCollapsed ? "w-11" : "w-[248px]")} aria-label="Saved searches and filters">
            {railCollapsed ? (
              <SearchRailCollapsed onExpand={() => s.setRailCollapsed(false)} />
            ) : (
              <>
                <SearchRail response={search.data} loading={search.loading && !search.data} />
                <div className="absolute right-1 top-1.5"><Tip label="Collapse rail"><Button variant="ghost" size="icon-xs" onClick={() => s.setRailCollapsed(true)} aria-label="Collapse rail"><PanelLeftClose className="size-3.5" /></Button></Tip></div>
              </>
            )}
          </aside>
        )}
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          {!fullscreen && (
            <ResizablePanel defaultSize={s.openDocId ? "42" : "100"} minSize={340} className="flex min-w-0 flex-col">
              <SearchBox response={search.data} loading={search.loading} />
              <BulkBar hits={hits} onCode={bulk} />
              <DocTable hits={hits} loading={search.loading && !search.data} total={search.data?.total ?? 0} totalWorkspace={search.data?.totalWorkspace ?? 0} tookMs={search.data?.tookMs} semantic={!!search.data?.semantic} onLoadMore={search.loadMore} loadingMore={search.loadingMore} />
            </ResizablePanel>
          )}
          {s.openDocId && (
            <>
              {!fullscreen && <ResizableHandle withHandle />}
              <ResizablePanel defaultSize={fullscreen ? "100" : "58"} minSize={fullscreen ? undefined : 420} className="min-w-0">
                <DocViewer docId={s.openDocId} terms={search.data?.parsed.terms ?? []} onNavigate={move} onClose={() => s.setOpenDocId(null)} index={ids.indexOf(s.openDocId)} count={ids.length} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </ReviewListContext.Provider>
  );
}
