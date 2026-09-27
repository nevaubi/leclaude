"use client";
import * as React from "react";
import { PanelLeftClose } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { BulkCodingRequest, DocRow, SearchRequest } from "../types";
import type { CodingDecision } from "@/lib/types/domain";
import { useReviewStore } from "./store";
import { api, useSearch } from "./use-review-data";
import { useReview } from "./review-page";
import { SearchRail, SearchRailCollapsed } from "./search-rail";
import { BatchModeStrip, SearchBox } from "./search-box";
import { DocTable } from "./doc-table";
import { BulkBar, type BulkExtra } from "./bulk-bar";
import { BulkConfirmDialog } from "./bulk-confirm-dialog";
import { SavedSearchDialog } from "./saved-search-dialog";
import { TermReportDialog } from "./term-report-dialog";
import { BatchDialog } from "./batch-dialog";
import { ProductionDialog } from "./production-dialog";
import { DocViewer } from "./doc-viewer";
import { applyCodingKey, codingKeyAction, nextUncodedRow } from "./review-helpers";

export interface ReviewListApi {
  ids: string[];
  rows: DocRow[];
  patchCoding: (ids: string[], coding: CodingDecision) => void;
  /** Patch any row fields optimistically (redaction counts, scores). */
  patchRow: (id: string, patch: Partial<DocRow>) => void;
  /** Code documents from the grid or the viewer (single PATCH for one id, bulk for many); optimistic row patch + refresh. */
  codeDocs: (ids: string[], patch: Partial<CodingDecision>) => Promise<void>;
  refresh: () => void;
}

export const ReviewListContext = React.createContext<ReviewListApi>({ ids: [], rows: [], patchCoding: () => {}, patchRow: () => {}, codeDocs: async () => {}, refresh: () => {} });

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

const isTyping = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || el.getAttribute("role") === "combobox" || !!el.closest("[role=dialog]")); };

export function ReviewTab() {
  const { matterId, refreshStats, issueCodes, currentUserId, setTab } = useReview();
  const s = useReviewStore();
  const req = React.useMemo<SearchRequest>(() => ({ matterId, q: s.q, semantic: s.semantic, view: s.view, filters: s.filters, sort: s.sort, dir: s.dir, offset: 0, limit: 500, groupBy: s.groupBy, batchId: s.batchId ?? undefined, qc: s.qcMode || undefined }), [matterId, s.q, s.semantic, s.view, s.filters, s.sort, s.dir, s.groupBy, s.batchId, s.qcMode]);
  const search = useSearch(req);
  const hits = React.useMemo(() => search.data?.hits ?? [], [search.data]);
  const ids = React.useMemo(() => hits.map((h) => h.id), [hits]);
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  const [bulkRequest, setBulkRequest] = React.useState<BulkCodingRequest | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [termsOpen, setTermsOpen] = React.useState(false);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [productionOpen, setProductionOpen] = React.useState(false);
  const [savedTick, setSavedTick] = React.useState(0);

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

  const codeDocs = React.useCallback(async (docIds: string[], patch: Partial<CodingDecision>) => {
    if (!docIds.length) return;
    try {
      const st = useReviewStore.getState();
      if (docIds.length === 1) {
        const res = await api<{ doc: { id: string; coding: CodingDecision }; qc?: { agree: boolean } }>(`/api/ediscovery/docs/${encodeURIComponent(docIds[0])}`, { method: "PATCH", json: { coding: patch, reviewerId: currentUserId, ...(st.batchId && st.qcMode ? { batchId: st.batchId, qc: true } : {}) } });
        search.patchRows(docIds, (r) => ({ ...r, coding: res.doc.coding }));
        if (res.qc) toast[res.qc.agree ? "success" : "warning"](res.qc.agree ? "QC: agrees with the first pass" : "QC: disagrees with the first pass", { duration: 1800 });
      } else {
        await api("/api/ediscovery/docs/bulk", { method: "POST", json: { ids: docIds, patch, reviewerId: currentUserId } });
        search.patchRows(docIds, (r) => { const coding = { ...r.coding, ...patch }; if (coding.privileged !== true) delete coding.privilegeBasis; return { ...r, coding }; });
      }
      refreshStats();
      scheduleRefresh();
    } catch (e) { toast.error("Coding failed", { description: (e as Error).message }); }
  }, [search, refreshStats, scheduleRefresh, currentUserId]);

  const listApi = React.useMemo<ReviewListApi>(() => ({
    ids,
    rows: hits,
    patchCoding: (docIds, coding) => { search.patchRows(docIds, (r) => ({ ...r, coding })); refreshStats(); scheduleRefresh(); },
    patchRow: (id, patch) => search.patchRow(id, patch),
    codeDocs,
    refresh: () => { search.refresh(); refreshStats(); },
  }), [ids, hits, search, refreshStats, scheduleRefresh, codeDocs]);

  const move = React.useCallback((delta: number) => {
    const st = useReviewStore.getState();
    if (!ids.length) return;
    const idx = Math.max(0, ids.indexOf(st.activeId ?? ""));
    const next = ids[Math.min(ids.length - 1, Math.max(0, idx + delta))];
    st.setActiveId(next);
    if (st.openDocId) st.setOpenDocId(next);
  }, [ids]);

  /** `x`: the next document without a decision (batch endpoint in batch mode so it wraps over the whole batch, not just the loaded page). */
  const nextUncoded = React.useCallback(async () => {
    const st = useReviewStore.getState();
    let next: string | null = null;
    if (st.batchId) {
      try { next = (await api<{ id: string | null }>(`/api/ediscovery/batches/${encodeURIComponent(st.batchId)}/next?current=${encodeURIComponent(st.activeId ?? "")}${st.qcMode ? "&qc=1" : ""}`)).id; } catch { next = null; }
    } else next = nextUncodedRow(hits, st.activeId);
    if (!next) { toast.message(st.qcMode ? "QC sample complete" : "Nothing left to code in this list"); return; }
    st.setActiveId(next);
    st.setOpenDocId(next);
  }, [hits]);

  // Keyboard: j/k/Enter/Space/Esc/⌘A/F outside the grid (the grid handles its own nav) and coding keys everywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing = isTyping(t);
      const st = useReviewStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !typing && !t?.closest("[role=grid]")) { e.preventDefault(); st.setSelected(ids); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const inGrid = !!t?.closest("[role=grid]");
      const inViewer = !!t?.closest("[data-doc-viewer]");
      switch (e.key) {
        case "j": case "ArrowDown": if (!inGrid && !inViewer) { e.preventDefault(); move(1); return; } if (inViewer && !e.shiftKey) { e.preventDefault(); move(1); return; } break;
        case "k": case "ArrowUp": if (!inGrid && !inViewer) { e.preventDefault(); move(-1); return; } if (inViewer && !e.shiftKey) { e.preventDefault(); move(-1); return; } break;
        case "Enter": if (!inGrid && st.activeId && !st.openDocId) { e.preventDefault(); st.setOpenDocId(st.activeId); } return;
        case " ": if (!inGrid && st.activeId && !t?.closest("button")) { e.preventDefault(); st.toggleSelected(st.activeId); } return;
        case "Escape": if (st.redactMode) st.setRedactMode(false); else if (st.openDocId) st.setOpenDocId(null); else if (st.selected.length) st.setSelected([]); return;
        case "f": if (st.openDocId) { e.preventDefault(); st.setFullscreen(!st.fullscreen); } return;
        case "[": if (st.openDocId && inViewer) { e.preventDefault(); move(-1); } return;
        case "]": if (st.openDocId && inViewer) { e.preventDefault(); move(1); } return;
      }
      // Coding keys: r/n/p/h/1–9 act on the selection when there is one, otherwise on the active (open) document. x = next uncoded.
      const action = codingKeyAction(e.key);
      if (!action) return;
      if (action.kind === "next-uncoded") { e.preventDefault(); void nextUncoded(); return; }
      const targets = st.selected.length ? st.selected : st.activeId ? [st.activeId] : [];
      if (!targets.length) return;
      // The open document's draft (coding panel) owns the keys unless rows are selected in the grid; the viewer listens for the same keys.
      if (inViewer || (st.openDocId && !st.selected.length)) return;
      const row = hits.find((h) => h.id === targets[0]);
      const patch = applyCodingKey(row?.coding ?? {}, action, issueCodes.map((c) => c.code));
      if (!patch) return;
      e.preventDefault();
      void codeDocs(targets, patch);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, hits, move, nextUncoded, codeDocs, issueCodes]);

  const requestBulk = (patch: Partial<CodingDecision>, extra: BulkExtra = {}) => {
    const selected = useReviewStore.getState().selected;
    if (!selected.length) return;
    setBulkRequest({ ids: selected, patch, ...extra, reviewerId: extra.reviewerId ?? currentUserId });
  };
  const onBulkApplied = (applied: string[], request: BulkCodingRequest) => {
    search.patchRows(applied, (r) => {
      let issues = r.coding.issues ?? [];
      if (request.addIssues) issues = Array.from(new Set([...issues, ...request.addIssues]));
      if (request.removeIssues) issues = issues.filter((i) => !request.removeIssues!.includes(i));
      const coding = { ...r.coding, ...request.patch, issues, ...(request.reviewerId ? { reviewerId: request.reviewerId } : {}) };
      if (coding.privileged !== true) delete coding.privilegeBasis;
      return { ...r, coding };
    });
    refreshStats();
    scheduleRefresh();
    setBulkRequest(null);
    toast.success(`Coded ${applied.length} document${applied.length === 1 ? "" : "s"}`);
  };

  const fullscreen = s.fullscreen && !!s.openDocId;
  // Below 1440px the rail plus list plus viewer plus coding panel do not fit, so the rail folds to its
  // icon column automatically while a document is open (the user's persisted preference is left untouched).
  const narrow = useNarrowViewport(1440);
  const railCollapsed = hydrated && (s.railCollapsed || (narrow && !!s.openDocId));

  return (
    <ReviewListContext.Provider value={listApi}>
      <div className="flex h-full min-h-0">
        {!fullscreen && (
          <aside className={cn("relative hidden h-full shrink-0 flex-col border-r bg-sidebar/40 md:flex transition-[width]", railCollapsed ? "w-11" : "w-[248px]")} aria-label="Views, saved searches and facets">
            {railCollapsed ? (
              <SearchRailCollapsed onExpand={() => s.setRailCollapsed(false)} />
            ) : (
              <>
                <SearchRail key={savedTick} response={search.data} loading={search.loading && !search.data} onSaveSearch={() => setSaveOpen(true)} />
                <div className="absolute right-1 top-1.5"><Tip label="Collapse rail"><Button variant="ghost" size="icon-xs" onClick={() => s.setRailCollapsed(true)} aria-label="Collapse rail"><PanelLeftClose className="size-3.5" /></Button></Tip></div>
              </>
            )}
          </aside>
        )}
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          {!fullscreen && (
            <ResizablePanel defaultSize={s.openDocId ? "38" : "100"} minSize={300} className="flex min-w-0 flex-col">
              <SearchBox response={search.data} loading={search.loading} onSaveSearch={() => setSaveOpen(true)} onTermReport={() => setTermsOpen(true)} />
              <BatchModeStrip onNext={() => void nextUncoded()} rows={hits} />
              <BulkBar hits={hits} onCode={requestBulk} onCreateBatch={() => setBatchOpen(true)} onCreateProduction={() => setProductionOpen(true)} />
              <DocTable hits={hits} loading={search.loading && !search.data} error={search.error?.message ?? null} total={search.data?.total ?? 0} totalWorkspace={search.data?.totalWorkspace ?? 0} tookMs={search.data?.tookMs} semantic={!!search.data?.semantic} onLoadMore={search.loadMore} loadingMore={search.loadingMore} />
            </ResizablePanel>
          )}
          {s.openDocId && (
            <>
              {!fullscreen && <ResizableHandle withHandle />}
              <ResizablePanel defaultSize={fullscreen ? "100" : "62"} minSize={fullscreen ? undefined : 560} className="min-w-0">
                <DocViewer docId={s.openDocId} terms={search.data?.parsed.terms ?? []} onNavigate={move} onClose={() => s.setOpenDocId(null)} index={ids.indexOf(s.openDocId)} count={ids.length} onNextUncoded={() => void nextUncoded()} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      <BulkConfirmDialog request={bulkRequest} onClose={() => setBulkRequest(null)} onApplied={onBulkApplied} />
      <SavedSearchDialog open={saveOpen} onOpenChange={setSaveOpen} onSaved={() => setSavedTick((t) => t + 1)} />
      <TermReportDialog open={termsOpen} onOpenChange={setTermsOpen} />
      <BatchDialog open={batchOpen} onOpenChange={setBatchOpen} onCreated={() => { setSavedTick((t) => t + 1); setTab("batches"); }} />
      <ProductionDialog open={productionOpen} onOpenChange={setProductionOpen} onCreated={() => setTab("productions")} />
    </ReviewListContext.Provider>
  );
}
