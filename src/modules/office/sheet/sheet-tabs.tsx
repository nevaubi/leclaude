"use client";
import * as React from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tip } from "@/components/ui/tooltip";
import type { Sheet } from "./model";
import { useSheetStore } from "./store";

const TAB_COLORS = ["#1F3A5F", "#2563EB", "#059669", "#D97706", "#DC2626", "#7C3AED", "#0891B2"];

function Tab({ sheet, active, onSelect, onRename }: { sheet: Sheet; active: boolean; onSelect: () => void; onRename: (name: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sheet.id });
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(sheet.name);
  const store = useSheetStore;
  const wb = useSheetStore((s) => s.workbook);
  React.useEffect(() => setName(sheet.name), [sheet.name]);
  const commit = () => { setEditing(false); if (name.trim() && name.trim() !== sheet.name) onRename(name.trim()); else setName(sheet.name); };
  const idx = wb.sheets.findIndex((s) => s.id === sheet.id);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }} {...attributes} {...listeners} onClick={onSelect} onDoubleClick={() => setEditing(true)} className={cn("group relative flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-xs select-none cursor-pointer", active ? "bg-background font-medium text-foreground shadow-[0_1px_0_var(--background)]" : "bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground")}>
          {sheet.color && <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: sheet.color }} />}
          {editing ? <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setName(sheet.name); setEditing(false); } }} onPointerDown={(e) => e.stopPropagation()} className="h-5 w-32 rounded border bg-background px-1 text-xs outline-none" /> : <span className="truncate">{sheet.name}</span>}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => setEditing(true)}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={() => { const st = store.getState(); const wb2 = st.workbook; const copy: Sheet = { ...sheet, id: `sh_${Math.random().toString(36).slice(2, 8)}`, name: `${sheet.name} (copy)`, cells: { ...sheet.cells } }; st.apply({ type: "replace_workbook", workbook: { ...wb2, sheets: [...wb2.sheets.slice(0, idx + 1), copy, ...wb2.sheets.slice(idx + 1)], activeSheet: idx + 1 } }); }}>Duplicate</ContextMenuItem>
        <ContextMenuItem onSelect={() => { try { store.getState().apply({ type: "delete_sheet", sheet: sheet.id }); } catch (e) { toast.error((e as Error).message); } }} className="text-destructive" disabled={wb.sheets.length <= 1}>Delete</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => store.getState().apply({ type: "reorder_sheet", sheet: sheet.id, index: Math.max(0, idx - 1) })} disabled={idx === 0}><ChevronLeft className="size-3.5" /> Move left</ContextMenuItem>
        <ContextMenuItem onSelect={() => store.getState().apply({ type: "reorder_sheet", sheet: sheet.id, index: Math.min(wb.sheets.length - 1, idx + 1) })} disabled={idx === wb.sheets.length - 1}><ChevronRight className="size-3.5" /> Move right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Tab color</ContextMenuSubTrigger>
          <ContextMenuSubContent className="p-2"><div className="grid grid-cols-4 gap-1">{TAB_COLORS.map((c) => <button key={c} onClick={() => store.getState().apply({ type: "set_sheet_color", sheet: sheet.id, color: c })} className="size-6 rounded border cursor-pointer hover:scale-110 transition-transform" style={{ background: c }} aria-label={c} />)}<button onClick={() => store.getState().apply({ type: "set_sheet_color", sheet: sheet.id, color: null })} className="col-span-4 mt-1 rounded border px-2 py-0.5 text-[11px] hover:bg-accent cursor-pointer">None</button></div></ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SheetTabs() {
  const wb = useSheetStore((s) => s.workbook);
  const store = useSheetStore;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = wb.sheets.findIndex((s) => s.id === active.id), to = wb.sheets.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const sheets = arrayMove(wb.sheets, from, to);
    store.getState().apply({ type: "replace_workbook", workbook: { ...wb, sheets, activeSheet: sheets.findIndex((s) => s.id === wb.sheets[wb.activeSheet].id) } });
  };
  return (
    <div className="flex h-8 shrink-0 items-end gap-1 border-t bg-muted/40 px-2">
      <Tip label="Add sheet"><button onClick={() => store.getState().apply({ type: "add_sheet", name: `Sheet${wb.sheets.length + 1}` })} className="mb-0.5 flex size-6 items-center justify-center rounded border bg-background text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Add sheet"><Plus className="size-3.5" /></button></Tip>
      <DndContext id="sheet-tabs" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={wb.sheets.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex min-w-0 items-end gap-0.5 overflow-x-auto scrollbar-none">
            {wb.sheets.map((s, i) => <Tab key={s.id} sheet={s} active={i === wb.activeSheet} onSelect={() => store.getState().setActiveSheet(i)} onRename={(name) => { try { store.getState().apply({ type: "rename_sheet", sheet: s.id, name }); } catch (e) { toast.error((e as Error).message); } }} />)}
          </div>
        </SortableContext>
      </DndContext>
      <div className="ml-auto mb-1 hidden text-[10px] text-muted-foreground md:block">{wb.sheets.length} sheet{wb.sheets.length === 1 ? "" : "s"} · double-click a tab to rename · drag to reorder</div>
    </div>
  );
}
