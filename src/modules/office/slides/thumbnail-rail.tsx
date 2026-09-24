"use client";
/** Left rail: sortable slide thumbnails with context actions and an add-slide layout picker. */
import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, EyeOff, LayoutTemplate, MessageSquare, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { LAYOUT_LABEL, SLIDE_LAYOUTS, slideTitle, type DeckSlide, type DeckTheme, type SlideLayout } from "./model";
import { ScaledSlide } from "./slide-view";
import { useSlidesStore } from "./store";
import { LayoutGrid } from "./dialogs";

const THUMB_W = 160;

function Thumb({ slide, index, theme, current, commentCount, onSelect, dragging }: { slide: DeckSlide; index: number; theme: DeckTheme; current: boolean; commentCount: number; onSelect: () => void; dragging: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const st = useSlidesStore;
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onSelect} className={cn("group flex cursor-pointer select-none gap-2 rounded-md px-2 py-1.5 transition-colors", current ? "bg-primary/8" : "hover:bg-accent/60")} data-slide-thumb={slide.id} aria-current={current ? "true" : undefined} title={slideTitle(slide) || LAYOUT_LABEL[slide.layout]}>
          <div className="flex w-5 shrink-0 flex-col items-end pt-0.5 text-[11px] tabular text-muted-foreground"><span className={cn(current && "font-semibold text-primary")}>{index + 1}</span></div>
          <div className={cn("sl-thumb relative shrink-0 overflow-hidden rounded-[4px] border bg-paper", current ? "border-primary ring-2 ring-primary/25" : "border-border")}>
            <ScaledSlide slide={slide} theme={theme} width={THUMB_W} lite={dragging} />
            {slide.hidden && <div className="absolute inset-0 flex items-center justify-center bg-background/60"><EyeOff className="size-4 text-muted-foreground" /></div>}
            {commentCount > 0 && <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-medium leading-none text-primary-foreground"><MessageSquare className="size-2.5" />{commentCount}</div>}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuSub>
          <ContextMenuSubTrigger><Plus className="size-4" /> Add slide after</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">{SLIDE_LAYOUTS.map((l) => <ContextMenuItem key={l} onClick={() => st.getState().addSlide(l, slide.id)}>{LAYOUT_LABEL[l]}</ContextMenuItem>)}</ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger><LayoutTemplate className="size-4" /> Apply layout</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">{SLIDE_LAYOUTS.map((l) => <ContextMenuItem key={l} onClick={() => st.getState().setLayout(slide.id, l)} className={cn(slide.layout === l && "bg-accent")}>{LAYOUT_LABEL[l]}</ContextMenuItem>)}</ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => st.getState().duplicateSlide(slide.id)}><Copy className="size-4" /> Duplicate</ContextMenuItem>
        <ContextMenuItem onClick={() => st.getState().toggleHidden(slide.id)}><EyeOff className="size-4" /> {slide.hidden ? "Show slide" : "Hide slide"}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => st.getState().deleteSlide(slide.id)} className="text-destructive focus:text-destructive"><Trash2 className="size-4" /> Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ThumbnailRail({ commentCounts, className }: { commentCounts: Record<string, number>; className?: string }) {
  const deck = useSlidesStore((s) => s.deck);
  const currentSlideId = useSlidesStore((s) => s.currentSlideId);
  const setCurrent = useSlidesStore((s) => s.setCurrent);
  const moveSlide = useSlidesStore((s) => s.moveSlide);
  const addSlide = useSlidesStore((s) => s.addSlide);
  const [dragging, setDragging] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-slide-thumb="${currentSlideId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [currentSlideId]);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = deck.slides.findIndex((s) => s.id === active.id);
    const to = deck.slides.findIndex((s) => s.id === over.id);
    if (from >= 0 && to >= 0) moveSlide(from, to);
  };

  const pick = (l: SlideLayout) => { addSlide(l); setAddOpen(false); };

  return (
    <div className={cn("flex h-full w-[220px] shrink-0 flex-col border-r bg-background", className)} aria-label="Slides">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="text-[13px] font-semibold">Slides <span className="ml-1 text-[11px] font-normal tabular text-muted-foreground">{deck.slides.length}</span></span>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <Tip label="New slide" shortcut="⌘⇧N"><PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Add slide"><Plus className="size-4" /></Button></PopoverTrigger></Tip>
          <PopoverContent align="start" className="w-[340px] p-2"><div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">New slide layout</div><LayoutGrid onPick={pick} /></PopoverContent>
        </Popover>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5 scrollbar-thin">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragging(true)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(false)}>
          <SortableContext items={deck.slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {deck.slides.map((s, i) => <Thumb key={s.id} slide={s} index={i} theme={deck.theme} current={s.id === currentSlideId} commentCount={commentCounts[s.id] ?? 0} onSelect={() => setCurrent(s.id)} dragging={dragging} />)}
          </SortableContext>
        </DndContext>
        {deck.slides.length === 0 && <div className="px-4 py-8 text-center text-xs text-muted-foreground">No slides yet. Add one below.</div>}
      </div>
      <div className="shrink-0 border-t p-2">
        <Popover>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="w-full"><Plus className="size-3.5" /> New slide</Button></PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-[340px] p-2"><div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">New slide layout</div><LayoutGrid onPick={(l) => addSlide(l)} /></PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
