"use client";
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Paperclip, MessagesSquare, Copy, Files, FileSearch, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ScoreBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import type { DocRow } from "../types";
import { DEFAULT_COLUMNS, useReviewStore, type ColumnDef } from "./store";
import { useReview } from "./review-page";
import { CodingBadges, IssueChip, TypeIcon, formatShortDate } from "./shared";

export function DocTable({ hits, loading, total, totalWorkspace, tookMs, semantic }: { hits: DocRow[]; loading: boolean; total: number; totalWorkspace: number; tookMs?: number; semantic: boolean }) {
  const { issueCodes } = useReview();
  const density = useReviewStore((s) => s.density);
  const columnWidths = useReviewStore((s) => s.columnWidths);
  const setColumnWidth = useReviewStore((s) => s.setColumnWidth);
  const sort = useReviewStore((s) => s.sort);
  const dir = useReviewStore((s) => s.dir);
  const setSort = useReviewStore((s) => s.setSort);
  const selected = useReviewStore((s) => s.selected);
  const setSelected = useReviewStore((s) => s.setSelected);
  const toggleSelected = useReviewStore((s) => s.toggleSelected);
  const activeId = useReviewStore((s) => s.activeId);
  const setActiveId = useReviewStore((s) => s.setActiveId);
  const openDocId = useReviewStore((s) => s.openDocId);
  const setOpenDocId = useReviewStore((s) => s.setOpenDocId);
  const lastClickedId = useReviewStore((s) => s.lastClickedId);
  const setLastClickedId = useReviewStore((s) => s.setLastClickedId);
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);

  const columns = React.useMemo<ColumnDef[]>(() => DEFAULT_COLUMNS.map((c) => ({ ...c, width: hydrated ? (columnWidths[c.id] ?? c.width) : c.width })), [columnWidths, hydrated]);
  const totalWidth = columns.reduce((n, c) => n + c.width, 0);
  const rowH = density === "compact" ? 30 : 40;
  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: hits.length, getScrollElement: () => parentRef.current, estimateSize: () => rowH, overscan: 12, getItemKey: (i) => hits[i]?.id ?? i });
  React.useEffect(() => { virtualizer.measure(); }, [rowH, virtualizer]);

  // Keep the active row visible.
  React.useEffect(() => {
    if (!activeId) return;
    const idx = hits.findIndex((h) => h.id === activeId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [activeId, hits, virtualizer]);

  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const allSelected = hits.length > 0 && hits.every((h) => selectedSet.has(h.id));
  const someSelected = hits.some((h) => selectedSet.has(h.id));

  const onRowClick = (e: React.MouseEvent, row: DocRow) => {
    if (e.shiftKey && lastClickedId) {
      const a = hits.findIndex((h) => h.id === lastClickedId);
      const b = hits.findIndex((h) => h.id === row.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = hits.slice(lo, hi + 1).map((h) => h.id);
        setSelected(Array.from(new Set([...selected, ...range])));
        setActiveId(row.id);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) { toggleSelected(row.id); setLastClickedId(row.id); setActiveId(row.id); return; }
    setLastClickedId(row.id);
    setActiveId(row.id);
    setOpenDocId(row.id);
  };

  const onCheck = (e: React.MouseEvent, row: DocRow) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedId) { onRowClick(e, row); return; }
    toggleSelected(row.id);
    setLastClickedId(row.id);
    setActiveId(row.id);
  };

  const startResize = (e: React.PointerEvent, col: ColumnDef) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.width;
    const move = (ev: PointerEvent) => setColumnWidth(col.id, Math.max(col.min, startW + (ev.clientX - startX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-doc-table>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin" role="grid" aria-rowcount={hits.length} aria-label="Documents">
        <div style={{ minWidth: totalWidth }}>
          {/* header */}
          <div className="sticky top-0 z-10 flex h-8 border-b bg-background/95 text-[11px] font-medium text-muted-foreground backdrop-blur" role="row">
            {columns.map((col) => (
              <div key={col.id} style={{ width: col.width }} className={cn("relative flex shrink-0 items-center gap-1 px-2", col.align === "right" && "justify-end")} role="columnheader" aria-sort={sort === col.sort ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                {col.id === "select" ? (
                  <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={() => setSelected(allSelected ? [] : hits.map((h) => h.id))} className="size-3.5" aria-label="Select all in view" />
                ) : col.sort ? (
                  <button onClick={() => setSort(col.sort!)} className="flex items-center gap-1 hover:text-foreground cursor-pointer" title={`Sort by ${col.label}`}>
                    {col.label}
                    {sort === col.sort ? (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />) : <ChevronsUpDown className="size-3 opacity-0 group-hover:opacity-100" />}
                  </button>
                ) : (
                  <span>{col.label}</span>
                )}
                {col.id !== "select" && <div onPointerDown={(e) => startResize(e, col)} className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-ring/50" aria-hidden />}
              </div>
            ))}
          </div>
          {/* body */}
          {loading ? (
            <div className="space-y-px p-1">{Array.from({ length: 16 }).map((_, i) => <Skeleton key={i} className="w-full" style={{ height: rowH - 2 }} />)}</div>
          ) : hits.length === 0 ? (
            <div className="p-8"><EmptyState icon={FileSearch} title="No documents match" description="Adjust the query, saved search or facets. Bates ranges and field prefixes are exact; try Semantic for concept searches." /></div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = hits[vi.index];
                const isSel = selectedSet.has(row.id);
                const isActive = activeId === row.id;
                const isOpen = openDocId === row.id;
                return (
                  <div
                    key={row.id}
                    role="row"
                    aria-selected={isSel}
                    data-active={isActive || undefined}
                    onClick={(e) => onRowClick(e, row)}
                    onDoubleClick={() => { setOpenDocId(row.id); useReviewStore.getState().setFullscreen(true); }}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
                    className={cn("flex cursor-pointer select-none items-center border-b border-border/60 text-[12.5px] transition-colors", isOpen ? "bg-primary/10" : isSel ? "bg-accent/70" : "hover:bg-accent/40", isActive && "ring-1 ring-inset ring-primary/50")}
                  >
                    {columns.map((col) => (
                      <div key={col.id} style={{ width: col.width }} className={cn("flex h-full shrink-0 items-center gap-1.5 overflow-hidden px-2", col.align === "right" && "justify-end")} role="gridcell">
                        {col.id === "select" && <span onClick={(e) => onCheck(e, row)} className="flex items-center"><Checkbox checked={isSel} className="size-3.5 pointer-events-none" tabIndex={-1} aria-label={`Select ${row.bates}`} /></span>}
                        {col.id === "bates" && <span className="truncate font-mono text-[11.5px] tabular text-foreground/90">{row.bates}{row.pages && row.pages > 1 ? <span className="text-muted-foreground"> +{row.pages - 1}</span> : null}</span>}
                        {col.id === "date" && <span className="truncate tabular text-muted-foreground">{formatShortDate(row.date)}</span>}
                        {col.id === "custodian" && <span className="truncate">{row.custodianName}</span>}
                        {col.id === "type" && <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground"><TypeIcon type={row.type} /><span className="truncate">{row.type}</span></span>}
                        {col.id === "subject" && <SubjectCell row={row} density={density} />}
                        {col.id === "score" && (row.aiScore != null ? <ScoreBar value={row.aiScore} className="justify-end" /> : <span className="text-[11px] text-muted-foreground/60">—</span>)}
                        {col.id === "coding" && (
                          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                            <CodingBadges coding={row.coding} compact={col.width < 200} />
                            {density === "comfortable" && (row.coding.issues ?? []).slice(0, 3).map((c) => <IssueChip key={c} code={c} codes={issueCodes} size="xs" />)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-muted/30 px-3 text-[11px] text-muted-foreground">
        <span className="tabular">
          {loading ? "Searching…" : <><span className="text-foreground">{hits.length.toLocaleString()}</span> of <span className="text-foreground">{total.toLocaleString()}</span> in view · {totalWorkspace.toLocaleString()} total in workspace</>}
          {selected.length > 0 && <span className="ml-2 rounded bg-primary/10 px-1.5 py-px text-primary">{selected.length} selected</span>}
        </span>
        <span className="hidden items-center gap-3 sm:flex">
          {semantic && <span className="text-primary">semantic ranking</span>}
          {tookMs != null && <span>{tookMs} ms</span>}
          <span className="hidden lg:inline"><kbd className="px-1 py-px text-[10px]">j</kbd> <kbd className="px-1 py-px text-[10px]">k</kbd> navigate · <kbd className="px-1 py-px text-[10px]">⏎</kbd> open · <kbd className="px-1 py-px text-[10px]">space</kbd> select</span>
        </span>
      </footer>
    </div>
  );
}

function SubjectCell({ row, density }: { row: DocRow; density: "compact" | "comfortable" }) {
  const f = row.family2;
  return (
    <span className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium text-foreground/95">{row.subject}</span>
        {f.attachmentCount > 0 && <Tip label={`${f.attachmentCount} attachment${f.attachmentCount === 1 ? "" : "s"}`}><Paperclip className="size-3 shrink-0 text-muted-foreground" /></Tip>}
        {f.isAttachment && <Tip label="Attachment (has a parent)"><Paperclip className="size-3 shrink-0 rotate-45 text-muted-foreground" /></Tip>}
        {f.inThread && <Tip label={`Thread of ${f.threadSize}`}><MessagesSquare className="size-3 shrink-0 text-muted-foreground" /></Tip>}
        {f.isDuplicate && <Tip label="Exact duplicate"><Copy className="size-3 shrink-0 text-muted-foreground" /></Tip>}
        {f.nearDuplicateCount > 0 && <Tip label={`${f.nearDuplicateCount} near-duplicate${f.nearDuplicateCount === 1 ? "" : "s"}`}><Files className="size-3 shrink-0 text-muted-foreground" /></Tip>}
      </span>
      {density === "comfortable" && row.snippet && <span className="truncate text-[11px] text-muted-foreground">{row.snippet}</span>}
    </span>
  );
}
