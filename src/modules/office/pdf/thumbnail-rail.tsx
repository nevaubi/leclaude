"use client";
/** Page thumbnails: drag to reorder, multi-select, rotate/delete/insert/extract via context menu, restore deleted pages. */
import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FilePlus2, MessageSquare, RotateCcw, RotateCw, Scissors, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { activePages, type PdfPage } from "./model";
import { thumbnail } from "./client-utils";
import type { PDFDocumentProxy } from "./pdfjs";
import { usePdfStore } from "./store";

export interface ThumbnailRailProps { pdfDoc: PDFDocumentProxy | null; cacheKey: string; commentCounts: Record<number, number>; onExtract: (displayPages: number[]) => void }

export function ThumbnailRail({ pdfDoc, cacheKey, commentCounts, onExtract }: ThumbnailRailProps) {
  const model = usePdfStore((s) => s.model);
  const currentPage = usePdfStore((s) => s.currentPage);
  const selectedIds = usePdfStore((s) => s.selectedPageIds);
  const store = usePdfStore;
  const pages = React.useMemo(() => activePages(model), [model]);
  const deleted = React.useMemo(() => model.pages.filter((p) => p.deleted), [model]);
  const annCounts = React.useMemo(() => { const m: Record<number, number> = {}; for (const a of model.annotations) if (!a.resolved) m[a.page] = (m[a.page] ?? 0) + 1; return m; }, [model.annotations]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const listRef = React.useRef<HTMLDivElement>(null);

  // keep the current page in view
  React.useEffect(() => { const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`); el?.scrollIntoView({ block: "nearest" }); }, [currentPage]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = pages.findIndex((p) => p.id === active.id), to = pages.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    const moving = selectedIds.includes(String(active.id)) && selectedIds.length > 1 ? pages.filter((p) => selectedIds.includes(p.id)) : [pages[from]];
    const rest = pages.filter((p) => !moving.includes(p));
    const insertAt = Math.max(0, Math.min(rest.length, rest.findIndex((p) => p.id === over.id) + (to > from ? 1 : 0)));
    const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)].map((p) => p.index);
    store.getState().applyOp({ op: "reorder_pages", order });
  };

  const selectedOr = (page: PdfPage) => (selectedIds.includes(page.id) ? pages.filter((p) => selectedIds.includes(p.id)) : [page]);
  const act = {
    rotate: (page: PdfPage, delta: 90 | -90) => store.getState().applyOp({ op: "rotate_pages", sourcePages: selectedOr(page).map((p) => p.index), delta }),
    del: (page: PdfPage) => { const list = selectedOr(page); if (list.length >= pages.length) return; store.getState().applyOp({ op: "delete_pages", sourcePages: list.map((p) => p.index) }); store.getState().selectPages([]); },
    insert: (page: PdfPage) => store.getState().applyOp({ op: "insert_blank_page", afterDisplay: pages.indexOf(page) + 1 }),
    extract: (page: PdfPage) => onExtract(selectedOr(page).map((p) => pages.indexOf(p) + 1)),
  };

  const onClick = (e: React.MouseEvent, page: PdfPage, i: number) => {
    const st = store.getState();
    if (e.shiftKey && st.selectedPageIds.length) {
      const anchor = pages.findIndex((p) => p.id === st.selectedPageIds[0]);
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      st.selectPages(pages.slice(a, b + 1).map((p) => p.id));
    } else if (e.metaKey || e.ctrlKey) st.selectPages(st.selectedPageIds.includes(page.id) ? st.selectedPageIds.filter((x) => x !== page.id) : [...st.selectedPageIds, page.id]);
    else st.selectPages([page.id]);
    st.scrollTo(i + 1);
  };

  return (
    <div className="flex h-full w-[168px] shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Pages</span><span className="tabular">{pages.length}</span>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2" role="listbox" aria-label="Page thumbnails" aria-multiselectable>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {pages.map((page, i) => (
                <ContextMenu key={page.id}>
                  <ContextMenuTrigger asChild>
                    <li>
                      <Thumb page={page} display={i + 1} pdfDoc={pdfDoc} cacheKey={cacheKey} current={currentPage === i + 1} selected={selectedIds.includes(page.id)} annotations={annCounts[page.index] ?? 0} comments={commentCounts[i + 1] ?? 0} onClick={(e) => onClick(e, page, i)} />
                    </li>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem onClick={() => act.rotate(page, 90)}><RotateCw /> Rotate clockwise</ContextMenuItem>
                    <ContextMenuItem onClick={() => act.rotate(page, -90)}><RotateCcw /> Rotate counter-clockwise</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => act.insert(page)}><FilePlus2 /> Insert blank page after</ContextMenuItem>
                    <ContextMenuItem onClick={() => act.extract(page)}><Scissors /> Extract {selectedIds.includes(page.id) && selectedIds.length > 1 ? `${selectedIds.length} pages` : "page"} to new PDF</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-destructive" onClick={() => act.del(page)} disabled={pages.length <= 1}><Trash2 /> Delete {selectedIds.includes(page.id) && selectedIds.length > 1 ? `${selectedIds.length} pages` : "page"}</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {deleted.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Deleted ({deleted.length})</div>
            <ul className="space-y-1">
              {deleted.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
                  <span className="truncate">{p.blank ? "Blank page" : `Source p. ${p.index}`}</span>
                  <button className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground cursor-pointer" onClick={() => store.getState().applyOp({ op: "restore_pages", sourcePages: [p.index] })} aria-label="Restore page"><Undo2 className="size-3" /> Restore</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Thumb({ page, display, pdfDoc, cacheKey, current, selected, annotations, comments, onClick }: { page: PdfPage; display: number; pdfDoc: PDFDocumentProxy | null; cacheKey: string; current: boolean; selected: boolean; annotations: number; comments: number; onClick: (e: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  const [src, setSrc] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true); }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  React.useEffect(() => {
    if (!visible || !pdfDoc || page.blank) return;
    let cancelled = false;
    thumbnail(pdfDoc, cacheKey, page.index, page.rotation, 136).then((u) => { if (!cancelled) setSrc(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, pdfDoc, cacheKey, page.index, page.rotation, page.blank]);
  const portrait = (page.rotation === 90 || page.rotation === 270 ? page.width >= page.height : page.height >= page.width);
  return (
    <div ref={(n) => { setNodeRef(n); (ref as React.MutableRefObject<HTMLDivElement | null>).current = n; }} style={{ transform: CSS.Transform.toString(transform), transition }} data-thumb={display} {...attributes} {...listeners} onClick={onClick} role="option" aria-selected={selected || current} className={cn("group flex cursor-pointer gap-1.5 rounded-md p-1 transition-colors", (current || selected) ? "bg-accent" : "hover:bg-accent/60", isDragging && "opacity-60")}>
      <span className={cn("w-4 shrink-0 pt-0.5 text-right text-[10px] tabular", current ? "font-semibold text-foreground" : "text-muted-foreground")}>{display}</span>
      <div className={cn("relative flex-1 overflow-hidden rounded-sm border bg-paper", selected ? "border-primary ring-1 ring-primary/40" : current ? "border-primary/50" : "border-border", portrait ? "aspect-[8.5/11]" : "aspect-[11/8.5]")}>
        {src ? <img src={src} alt={`Page ${display}`} className="h-full w-full object-contain" draggable={false} /> : page.blank ? <div className="flex h-full items-center justify-center text-[9px] uppercase text-muted-foreground/60">blank</div> : <div className="h-full w-full animate-pulse bg-muted/50" />}
        {(annotations > 0 || comments > 0) && (
          <div className="absolute bottom-1 right-1 flex gap-0.5">
            {annotations > 0 && <span className="rounded bg-warning/90 px-1 text-[9px] font-medium tabular text-warning-foreground">{annotations}</span>}
            {comments > 0 && <span className="flex items-center gap-0.5 rounded bg-primary/90 px-1 text-[9px] tabular text-primary-foreground"><MessageSquare className="size-2.5" />{comments}</span>}
          </div>
        )}
        {page.rotation ? <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[9px] tabular text-muted-foreground">{page.rotation}°</span> : null}
      </div>
    </div>
  );
}
