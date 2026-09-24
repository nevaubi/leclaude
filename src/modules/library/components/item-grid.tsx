"use client";
import * as React from "react";
import { Copy, Download, ExternalLink, FolderInput, FolderOpen, Info, MoreHorizontal, Pencil, Star, Trash2, Upload, ChevronRight, SearchX, Inbox } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { RelativeTime } from "@/components/ui/relative-time";
import { PersonAvatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/misc";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OFFICE_KIND_LABEL } from "@/modules/office/shared/types";
import { TYPE_LABEL, type LibraryItemView, type LibrarySearchHit, type LibrarySort } from "../types";
import { isSystemFolder } from "../ids";
import { useLibrary } from "./library-provider";
import { useLibraryUI } from "./store";
import { TypeGlyph, TypeIcon } from "./icons";
import { Highlight } from "./highlight";
import { ITEM_DRAG_MIME, isFileDrag, readItemDrag } from "./use-uploads";

/** Main content: grid cards, list table or search results, with selection, drag-and-drop and context menus. */
export function ItemGrid() {
  const lib = useLibrary();
  const { items, list, listLoading, isSearching, search, searchLoading, selected, clearSelection, dragging, setDragging, setDragOverId, dragOverId, actions, folderId, view, openDialog } = lib;
  const viewMode = useLibraryUI((s) => s.viewMode);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [fileOver, setFileOver] = React.useState(false);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setFileOver(false); setDragOverId(null); setDragging(false);
    if (isFileDrag(e)) { if (e.dataTransfer.files.length) await actions.upload(e.dataTransfer.files); return; }
    // Dropping items on empty space moves them into the current folder (only from search/virtual views).
    const ids = readItemDrag(e);
    if (ids.length && (isSearching || view !== "folder")) await actions.move(ids, folderId);
  };

  const loading = isSearching ? searchLoading && !search : listLoading && !list;

  return (
    <div
      ref={containerRef}
      className={cn("relative flex min-h-0 flex-1 flex-col", viewMode === "list" && !isSearching && items.length > 0 && !loading ? "overflow-hidden" : "overflow-y-auto scrollbar-thin", fileOver && "bg-primary/5")}
      onDragOver={(e) => { e.preventDefault(); if (isFileDrag(e)) { e.dataTransfer.dropEffect = "copy"; setFileOver(true); } }}
      onDragLeave={(e) => { if (!containerRef.current?.contains(e.relatedTarget as Node)) setFileOver(false); }}
      onDrop={onDrop}
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.surface === "1") clearSelection(); }}
    >
      {fileOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary/60 bg-background/80">
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-[12.5px]"><Upload className="size-4 text-primary" /> Drop to upload into <strong>{list?.folder?.name ?? "Library"}</strong></div>
        </div>
      )}
      {dragging && !fileOver && (isSearching || view !== "folder") && (
        <div className="pointer-events-none absolute inset-x-3 top-2 z-10 rounded-md border border-dashed bg-background/80 px-3 py-1.5 text-center text-xs text-muted-foreground">Drop on a folder in the tree to move</div>
      )}
      {loading ? (
        <GridSkeleton mode={viewMode} />
      ) : items.length === 0 ? (
        <div className="p-8" data-surface="1">
          {isSearching ? (
            <EmptyState icon={SearchX} title={`No results for “${search?.query ?? ""}”`} description="Try fewer words, a different spelling, or clear the active filters. Semantic search needs an OpenAI key and a rebuilt index." />
          ) : view !== "folder" ? (
            <EmptyState icon={Inbox} title={view === "starred" ? "Nothing starred yet" : view === "recent" ? "Nothing updated in the last 30 days" : "Nothing shared with you"} description={view === "starred" ? "Star notes, clauses and documents you come back to often." : undefined} />
          ) : (
            <EmptyState icon={FolderOpen} title="This folder is empty" description="Drag files here to upload, or create a note, clause or link." action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openDialog({ kind: "note", parentId: folderId })}>New note</Button><Button size="sm" variant="outline" onClick={() => openDialog({ kind: "folder", parentId: folderId })}>New folder</Button></div>} />
          )}
        </div>
      ) : isSearching && search ? (
        <SearchResults hits={search.hits} query={search.query} />
      ) : viewMode === "grid" ? (
        <CardGrid items={items} selected={selected} dragOverId={dragOverId} />
      ) : (
        <ListTable items={items} selected={selected} dragOverId={dragOverId} />
      )}
    </div>
  );
}

function GridSkeleton({ mode }: { mode: "grid" | "list" }) {
  return mode === "grid" ? (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(224px,1fr))] gap-3 p-3">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-md" />)}</div>
  ) : (
    <div className="space-y-1 p-3">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
  );
}

// ---------------------------------------------------------------------------
// Shared per-item behaviour (click/select/drag/context)
// ---------------------------------------------------------------------------
function useItemHandlers(item: LibraryItemView) {
  const { selected, toggleSelected, openItem, openPreview, setDragging, setDragOverId, dragOverId, actions } = useLibrary();
  const isFolder = item.type === "folder";
  const onClick = (e: React.MouseEvent) => { e.stopPropagation(); toggleSelected(item.id, { additive: e.metaKey || e.ctrlKey, range: e.shiftKey }); };
  const onDoubleClick = (e: React.MouseEvent) => { e.stopPropagation(); openItem(item); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); openItem(item); }
    if (e.key === " ") { e.preventDefault(); openPreview(item.id); }
  };
  const onDragStart = (e: React.DragEvent) => {
    const ids = selected.has(item.id) ? Array.from(selected) : [item.id];
    e.dataTransfer.setData(ITEM_DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };
  const onDragEnd = () => { setDragging(false); setDragOverId(null); };
  const folderDrop = isFolder ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = isFileDrag(e) ? "copy" : "move"; if (dragOverId !== item.id) setDragOverId(item.id); },
    onDragLeave: () => { if (dragOverId === item.id) setDragOverId(null); },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDragOverId(null); setDragging(false);
      if (isFileDrag(e)) { if (e.dataTransfer.files.length) await actions.upload(e.dataTransfer.files, { folderId: item.id, matterId: item.matterId ?? null }); return; }
      const ids = readItemDrag(e).filter((id) => id !== item.id);
      if (ids.length) await actions.move(ids, item.id);
    },
  } : {};
  return { onClick, onDoubleClick, onKeyDown, onDragStart, onDragEnd, ...folderDrop, isOver: dragOverId === item.id };
}

function ItemContextMenu({ item, children }: { item: LibraryItemView; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ItemContextMenuContent item={item} />
    </ContextMenu>
  );
}

function ItemContextMenuContent({ item }: { item: LibraryItemView }) {
  const { selected, openItem, openPreview, setRenamingId, openDialog, actions } = useLibrary();
  const ids = selected.has(item.id) && selected.size > 1 ? Array.from(selected) : [item.id];
  const many = ids.length > 1;
  const system = item.type === "folder" && isSystemFolder(item.id);
  return (
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => openItem(item)}><FolderOpen /> Open{item.officeDocId ? " in editor" : item.type === "link" ? " link" : ""}</ContextMenuItem>
        {item.officeDocId && <ContextMenuItem onClick={() => openItem(item, { newTab: true })}><ExternalLink /> Open in new tab</ContextMenuItem>}
        <ContextMenuItem onClick={() => openPreview(item.id)}><Info /> Details <span className="ml-auto text-[10px] text-muted-foreground">Space</span></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={system || many} onClick={() => setRenamingId(item.id)}><Pencil /> Rename <span className="ml-auto text-[10px] text-muted-foreground">F2</span></ContextMenuItem>
        <ContextMenuItem disabled={system} onClick={() => openDialog({ kind: "move", ids })}><FolderInput /> Move{many ? ` ${ids.length} items` : ""}…</ContextMenuItem>
        <ContextMenuItem disabled={many} onClick={() => void actions.duplicate(item.id)}><Copy /> Duplicate</ContextMenuItem>
        <ContextMenuItem onClick={() => { for (const id of ids) void actions.star(id, !item.starred); }}><Star className={cn(item.starred && "fill-current text-warning")} /> {item.starred ? "Unstar" : "Star"} <span className="ml-auto text-[10px] text-muted-foreground">S</span></ContextMenuItem>
        <ContextMenuItem disabled={many || item.type === "folder"} onClick={() => void actions.download(item)}><Download /> Download</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive disabled={system} onClick={() => openDialog({ kind: "delete", ids })}><Trash2 /> Delete{many ? ` ${ids.length} items` : ""} <span className="ml-auto text-[10px] opacity-70">⌫</span></ContextMenuItem>
      </ContextMenuContent>
  );
}

function RenameInput({ item, className }: { item: LibraryItemView; className?: string }) {
  const { actions, setRenamingId } = useLibrary();
  const [value, setValue] = React.useState(item.name);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { const el = ref.current; if (!el) return; el.focus(); const dot = item.name.lastIndexOf("."); el.setSelectionRange(0, dot > 0 && item.type !== "folder" ? dot : item.name.length); }, [item.name, item.type]);
  const commit = () => { setRenamingId(null); void actions.rename(item.id, value); };
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") setRenamingId(null); }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn("w-full rounded border border-ring bg-background px-1 py-0.5 text-sm outline-none ring-2 ring-ring/30", className)}
      aria-label="Rename"
    />
  );
}

function ItemName({ item, className, query }: { item: LibraryItemView; className?: string; query?: string }) {
  const { renamingId } = useLibrary();
  if (renamingId === item.id) return <RenameInput item={item} className={className} />;
  return <span className={className} title={item.name}>{query ? <Highlight text={item.name} query={query} /> : item.name}</span>;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
function CardGrid({ items, selected, dragOverId }: { items: LibraryItemView[]; selected: Set<string>; dragOverId: string | null }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(224px,1fr))] gap-3 p-3" data-surface="1" role="grid" aria-label="Items">
      {items.map((item) => <ItemCard key={item.id} item={item} selected={selected.has(item.id)} over={dragOverId === item.id} />)}
    </div>
  );
}

function ItemCard({ item, selected, over }: { item: LibraryItemView; selected: boolean; over: boolean }) {
  const h = useItemHandlers(item);
  const { actions, openPreview } = useLibrary();
  const isFolder = item.type === "folder";
  return (
    <ItemContextMenu item={item}>
      <div
        role="row"
        tabIndex={0}
        data-item-id={item.id}
        draggable={!(isFolder && isSystemFolder(item.id))}
        aria-selected={selected}
        onClick={h.onClick}
        onDoubleClick={h.onDoubleClick}
        onKeyDown={h.onKeyDown}
        onDragStart={h.onDragStart}
        onDragEnd={h.onDragEnd}
        onDragOver={h.onDragOver}
        onDragLeave={h.onDragLeave}
        onDrop={h.onDrop}
        className={cn(
          "group relative flex h-[132px] cursor-default select-none flex-col rounded-md border bg-card p-2.5 text-left outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring/60",
          selected && "border-primary/60 bg-accent/50 ring-2 ring-primary/30",
          over && "border-primary ring-2 ring-primary/50 bg-primary/5",
          isFolder && "bg-muted/30",
        )}
      >
        <div className="flex items-start gap-2.5">
          <TypeGlyph type={item.type} size="sm" />
          <div className="min-w-0 flex-1">
            <ItemName item={item} className="line-clamp-2 text-[13px] font-medium leading-snug" />
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {isFolder ? `${item.childCount ?? 0} item${item.childCount === 1 ? "" : "s"}` : item.officeKind ? `${OFFICE_KIND_LABEL[item.officeKind]}${item.contentVersion ? ` · v${item.contentVersion}` : ""}` : item.type === "clause" ? item.clause?.category ?? "clause" : item.type === "template" ? `Template · ${item.tags?.[0] ?? ""}` : TYPE_LABEL[item.type]}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); void actions.star(item.id, !item.starred); }}
            className={cn("rounded p-0.5 transition-opacity cursor-pointer", item.starred ? "text-warning opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground")}
            aria-label={item.starred ? "Unstar" : "Star"}
          >
            <Star className={cn("size-3.5", item.starred && "fill-current")} />
          </button>
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-hidden">
          {item.excerpt && !isFolder && <p className="line-clamp-3 text-[11.5px] leading-snug text-muted-foreground">{item.excerpt}</p>}
          {isFolder && item.description && <p className="line-clamp-3 text-[11.5px] leading-snug text-muted-foreground">{item.description}</p>}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {item.matterShortName && <span className="max-w-[120px] truncate text-[11px] text-muted-foreground" title={item.matterShortName}>{item.matterShortName}</span>}
          {item.status === "draft" && <Badge variant="warning" size="xs">Draft</Badge>}
          <span className="flex-1" />
          {item.ownerName && <PersonAvatar name={item.ownerName} size="xs" />}
          <RelativeTime value={item.updatedAt} className="tabular" />
        </div>
        <button onClick={(e) => { e.stopPropagation(); openPreview(item.id); }} className="absolute bottom-2 right-2 hidden rounded-md border bg-background p-1 text-muted-foreground shadow-sm hover:text-foreground group-hover:block cursor-pointer" aria-label="Details"><Info className="size-3.5" /></button>
      </div>
    </ItemContextMenu>
  );
}

// ---------------------------------------------------------------------------
// List (DataTable)
// ---------------------------------------------------------------------------
const LIST_SORTABLE = new Set<string>(["name", "type", "updated", "size", "created"]);

function ListTable({ items, selected, dragOverId }: { items: LibraryItemView[]; selected: Set<string>; dragOverId: string | null }) {
  const lib = useLibrary();
  const { setSelected, openItem, openPreview, setRenamingId, openDialog, actions, setDragging, setDragOverId } = lib;
  const sort = useLibraryUI((s) => s.sort);
  const dir = useLibraryUI((s) => s.dir);
  const setSort = useLibraryUI((s) => s.setSort);
  const [ctxItem, setCtxItem] = React.useState<LibraryItemView | null>(null);
  const selectedIds = React.useMemo(() => Array.from(selected), [selected]);

  const columns = React.useMemo<DataTableColumn<LibraryItemView>[]>(() => [
    {
      id: "name", header: "Name", width: 320, minWidth: 180, sortable: true, locked: true, accessor: (i) => i.name,
      render: (i) => (
        <span className="flex min-w-0 items-center gap-2">
          <TypeIcon type={i.type} />
          <ItemName item={i} className="truncate font-medium" />
          {i.starred && <Star className="size-3 shrink-0 fill-current text-warning" />}
          {i.status === "draft" && <Badge variant="warning" size="xs">Draft</Badge>}
        </span>
      ),
    },
    { id: "type", header: "Type", width: 130, minWidth: 80, sortable: true, accessor: (i) => i.officeKind ? OFFICE_KIND_LABEL[i.officeKind] : i.type === "clause" ? i.clause?.category ?? "Clause" : TYPE_LABEL[i.type], render: (i) => <span className="truncate text-muted-foreground">{i.officeKind ? OFFICE_KIND_LABEL[i.officeKind] : i.type === "clause" ? i.clause?.category ?? "Clause" : TYPE_LABEL[i.type]}</span> },
    { id: "matter", header: "Matter", width: 140, minWidth: 80, accessor: (i) => i.matterShortName ?? "", render: (i) => i.matterShortName ? <span className="truncate">{i.matterShortName}</span> : <span className="text-muted-foreground">—</span> },
    { id: "owner", header: "Owner", width: 150, minWidth: 90, accessor: (i) => i.ownerName ?? "", render: (i) => i.ownerName ? <span className="flex min-w-0 items-center gap-1.5"><PersonAvatar name={i.ownerName} size="xs" /><span className="truncate">{i.ownerName}</span></span> : <span className="text-muted-foreground">—</span> },
    { id: "updated", header: "Updated", width: 120, minWidth: 90, sortable: true, accessor: (i) => i.updatedAt, render: (i) => <span className="text-muted-foreground"><RelativeTime value={i.updatedAt} /></span> },
    { id: "size", header: "Size", width: 90, minWidth: 60, align: "right", sortable: true, accessor: (i) => i.size ?? 0, render: (i) => <span className="tabular text-muted-foreground">{i.type === "folder" ? `${i.childCount ?? 0} items` : i.size ? formatBytes(i.size) : "—"}</span> },
    { id: "tags", header: "Tags", width: 200, minWidth: 100, accessor: (i) => (i.tags ?? []).join(", "), render: (i) => <span className="truncate text-[11px] text-muted-foreground">{(i.tags ?? []).slice(0, 4).join(" · ")}{(i.tags?.length ?? 0) > 4 ? ` +${i.tags!.length - 4}` : ""}</span> },
    { id: "created", header: "Created", width: 120, minWidth: 90, sortable: true, defaultHidden: true, accessor: (i) => i.createdAt, render: (i) => <span className="text-muted-foreground"><RelativeTime value={i.createdAt} /></span> },
  ], []);

  const rowProps = React.useCallback((item: LibraryItemView): React.HTMLAttributes<HTMLDivElement> => {
    const isFolder = item.type === "folder";
    const system = isFolder && isSystemFolder(item.id);
    const over = dragOverId === item.id;
    return {
      draggable: !system,
      "data-item-id": item.id,
      className: cn(over && "bg-primary/10 ring-2 ring-inset ring-primary/50"),
      onDragStart: (e) => { const ids = selected.has(item.id) ? Array.from(selected) : [item.id]; e.dataTransfer.setData(ITEM_DRAG_MIME, JSON.stringify(ids)); e.dataTransfer.effectAllowed = "move"; setDragging(true); },
      onDragEnd: () => { setDragging(false); setDragOverId(null); },
      ...(isFolder ? {
        onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = isFileDrag(e) ? "copy" : "move"; if (dragOverId !== item.id) setDragOverId(item.id); },
        onDragLeave: () => { if (dragOverId === item.id) setDragOverId(null); },
        onDrop: (e) => {
          e.preventDefault(); e.stopPropagation(); setDragOverId(null); setDragging(false);
          if (isFileDrag(e)) { if (e.dataTransfer.files.length) void actions.upload(e.dataTransfer.files, { folderId: item.id, matterId: item.matterId ?? null }); return; }
          const ids = readItemDrag(e).filter((id) => id !== item.id);
          if (ids.length) void actions.move(ids, item.id);
        },
      } : {}),
    } as React.HTMLAttributes<HTMLDivElement>;
  }, [selected, dragOverId, setDragging, setDragOverId, actions]);

  return (
    <ContextMenu onOpenChange={(o) => { if (!o) setCtxItem(null); }}>
      <ContextMenuTrigger asChild>
        <div
          className="flex h-full min-h-0 flex-col"
          data-surface="1"
          onContextMenuCapture={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-row-id]");
            const item = el ? items.find((i) => i.id === el.dataset.rowId) ?? null : null;
            if (!item) { e.stopPropagation(); return; }
            setCtxItem(item);
            if (!selected.has(item.id)) setSelected(new Set([item.id]));
          }}
        >
          <DataTable
            rows={items}
            columns={columns}
            rowId={(i) => i.id}
            noun="item"
            ariaLabel="Items"
            selectionMode="multi"
            selected={selectedIds}
            onSelectedChange={(ids) => setSelected(new Set(ids))}
            sort={{ columnId: sort, dir }}
            onSortChange={(s) => { if (s && LIST_SORTABLE.has(s.columnId)) setSort(s.columnId as LibrarySort, s.dir); }}
            serverSort
            onRowActivate={(i) => openItem(i)}
            rowProps={rowProps}
            rowActions={(item) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="size-6" data-row-action onClick={(e) => e.stopPropagation()} aria-label="Actions"><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => openItem(item)}><FolderOpen /> Open</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openPreview(item.id)}><Info /> Details</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={item.type === "folder" && isSystemFolder(item.id)} onClick={() => setRenamingId(item.id)}><Pencil /> Rename</DropdownMenuItem>
                  <DropdownMenuItem disabled={item.type === "folder" && isSystemFolder(item.id)} onClick={() => openDialog({ kind: "move", ids: [item.id] })}><FolderInput /> Move…</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void actions.duplicate(item.id)}><Copy /> Duplicate</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void actions.star(item.id, !item.starred)}><Star /> {item.starred ? "Unstar" : "Star"}</DropdownMenuItem>
                  {item.type !== "folder" && <DropdownMenuItem onClick={() => void actions.download(item)}><Download /> Download</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive disabled={item.type === "folder" && isSystemFolder(item.id)} onClick={() => openDialog({ kind: "delete", ids: [item.id] })}><Trash2 /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          />
        </div>
      </ContextMenuTrigger>
      {ctxItem && <ItemContextMenuContent item={ctxItem} />}
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------
function SearchResults({ hits, query }: { hits: LibrarySearchHit[]; query: string }) {
  const { selected, openFolder } = useLibrary();
  return (
    <div className="mx-auto max-w-5xl space-y-1.5 p-3" data-surface="1">
      {hits.map((h) => <SearchHitRow key={h.item.id} hit={h} query={query} selected={selected.has(h.item.id)} openFolder={openFolder} />)}
    </div>
  );
}

function SearchHitRow({ hit, query, selected, openFolder }: { hit: LibrarySearchHit; query: string; selected: boolean; openFolder: (id: string) => void }) {
  const item = hit.item;
  const h = useItemHandlers(item);
  return (
    <ItemContextMenu item={item}>
      <div
        role="row"
        tabIndex={0}
        data-item-id={item.id}
        draggable
        aria-selected={selected}
        onClick={h.onClick}
        onDoubleClick={h.onDoubleClick}
        onKeyDown={h.onKeyDown}
        onDragStart={h.onDragStart}
        onDragEnd={h.onDragEnd}
        className={cn("group flex cursor-default select-none gap-3 rounded-md border bg-card p-2.5 outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/60", selected && "border-primary/60 bg-accent/50 ring-2 ring-primary/30")}
      >
        <TypeGlyph type={item.type} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ItemName item={item} className="truncate text-sm font-medium" query={query} />
            {item.matterShortName && <span className="text-[11px] text-muted-foreground">{item.matterShortName}</span>}
            <span className="ml-auto shrink-0 text-[10px] tabular text-muted-foreground">{Math.round(hit.score * 100)}% · {hit.source === "office" ? "document" : TYPE_LABEL[item.type].toLowerCase()}</span>
          </div>
          <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground"><Highlight text={hit.passage} query={query} /></p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {item.path.map((p, i) => (
              <React.Fragment key={p.id}>
                {i > 0 && <ChevronRight className="size-3" />}
                <button onClick={(e) => { e.stopPropagation(); openFolder(p.id); }} className="hover:text-foreground hover:underline cursor-pointer">{p.name}</button>
              </React.Fragment>
            ))}
            {item.tags?.slice(0, 4).map((t) => <span key={t} className="ml-1 text-[10.5px] text-muted-foreground">#{t}</span>)}
            <span className="ml-auto"><RelativeTime value={item.updatedAt} /></span>
          </div>
        </div>
      </div>
    </ItemContextMenu>
  );
}
