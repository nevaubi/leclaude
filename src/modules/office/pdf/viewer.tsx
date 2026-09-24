"use client";
/**
 * Continuous, virtualized page viewer. Computes the effective scale for the
 * fit modes, renders only the pages near the viewport, tracks the current
 * page while scrolling and honours scroll requests (page / rect) from the
 * store (search hits, annotation list, agent locate).
 */
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { activePages, type PdfAnnotation, type PdfPage } from "./model";
import { PageView } from "./page-view";
import type { PDFDocumentProxy } from "./pdfjs";
import { usePdfStore } from "./store";

const GAP = 24;
const PAD_X = 32;
const CSS_PER_PT = 96 / 72;

export interface PdfViewerProps { pdfDoc: PDFDocumentProxy | null; onOpenAnnotation?: (a: PdfAnnotation) => void; className?: string }

export function displayedSize(p: PdfPage) { return p.rotation === 90 || p.rotation === 270 ? { w: p.height, h: p.width } : { w: p.width, h: p.height }; }

export function PdfViewer({ pdfDoc, onOpenAnnotation, className }: PdfViewerProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const model = usePdfStore((s) => s.model);
  const zoom = usePdfStore((s) => s.zoom);
  const scrollRequest = usePdfStore((s) => s.scrollRequest);
  const tool = usePdfStore((s) => s.tool);
  const store = usePdfStore;
  const pages = React.useMemo(() => activePages(model), [model]);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const scale = React.useMemo(() => {
    if (!pages.length || !size.w) return 1;
    const maxW = Math.max(...pages.map((p) => displayedSize(p).w));
    const maxH = Math.max(...pages.map((p) => displayedSize(p).h));
    if (zoom === "fit-width") return Math.max(0.2, (size.w - PAD_X * 2) / maxW);
    if (zoom === "fit-page") return Math.max(0.2, Math.min((size.w - PAD_X * 2) / maxW, (size.h - GAP * 2) / maxH));
    return zoom * CSS_PER_PT;
  }, [pages, size, zoom]);
  React.useEffect(() => { store.getState().setEffectiveScale(scale); }, [scale, store]);

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => Math.round(displayedSize(pages[i]).h * scale) + GAP,
    overscan: 2,
    getItemKey: (i) => pages[i].id,
  });
  const measure = virtualizer.measure;
  React.useEffect(() => { measure(); }, [scale, pages, measure]);

  // current page tracking
  const items = virtualizer.getVirtualItems();
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const probe = el.scrollTop + el.clientHeight * 0.35;
      const vi = virtualizer.getVirtualItems();
      let best = vi[0]?.index ?? 0;
      for (const it of vi) if (it.start <= probe) best = it.index;
      store.getState().setCurrentPage(best + 1);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [virtualizer, store, pages.length]);

  // scroll requests
  const lastNonce = React.useRef(0);
  React.useEffect(() => {
    if (!scrollRequest || scrollRequest.nonce === lastNonce.current) return;
    lastNonce.current = scrollRequest.nonce;
    const idx = Math.max(0, Math.min(pages.length - 1, scrollRequest.display - 1));
    const page = pages[idx];
    if (!page) return;
    if (scrollRequest.rect) {
      const { h } = displayedSize(page);
      // rect y is PDF space (bottom-up, unrotated); approximate for rotated pages by using the page top
      const topPt = page.rotation === 0 ? page.height - (scrollRequest.rect.y + scrollRequest.rect.h) : 0;
      const offset = virtualizer.getOffsetForIndex(idx, "start")?.[0] ?? 0;
      const target = offset + Math.max(0, topPt * scale - Math.min(160, h * scale * 0.3));
      virtualizer.scrollToOffset(target, { behavior: "smooth" });
    } else virtualizer.scrollToIndex(idx, { align: "start", behavior: "smooth" });
  }, [scrollRequest, pages, virtualizer, scale]);

  // hand tool: drag to pan
  const pan = React.useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { if (tool !== "hand" || !scrollRef.current) return; pan.current = { x: e.clientX, y: e.clientY, sl: scrollRef.current.scrollLeft, st: scrollRef.current.scrollTop }; };
  const onPointerMove = (e: React.PointerEvent) => { if (!pan.current || !scrollRef.current) return; scrollRef.current.scrollLeft = pan.current.sl - (e.clientX - pan.current.x); scrollRef.current.scrollTop = pan.current.st - (e.clientY - pan.current.y); };
  const onPointerUp = () => { pan.current = null; };

  // click on empty space clears selection
  const onBackgroundClick = (e: React.MouseEvent) => { if ((e.target as HTMLElement).classList.contains("pdf-scroll-inner") || (e.target as HTMLElement).classList.contains("pdf-scroll")) { store.getState().select(null); store.getState().setSelection(null); } };

  return (
    <div ref={scrollRef} className={cn("pdf-scroll relative h-full min-h-0 flex-1 overflow-auto scrollbar-thin bg-muted/40", tool === "hand" && "cursor-grab active:cursor-grabbing", className)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onClick={onBackgroundClick} tabIndex={0} aria-label="Document pages">
      <div className="pdf-scroll-inner relative w-full" style={{ height: virtualizer.getTotalSize() + GAP }}>
        {items.map((it) => {
          const page = pages[it.index];
          const { w, h } = displayedSize(page);
          const width = Math.round(w * scale), height = Math.round(h * scale);
          return (
            <div key={it.key} data-index={it.index} ref={virtualizer.measureElement} className="absolute left-0 flex w-full justify-center" style={{ top: it.start + GAP / 2, minWidth: width + PAD_X * 2 }}>
              <PageView page={page} display={it.index + 1} pdfDoc={pdfDoc} scale={scale} width={width} height={height} onOpenAnnotation={onOpenAnnotation} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
