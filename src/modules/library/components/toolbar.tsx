"use client";
import * as React from "react";
import { ArrowDownAZ, ArrowUpDown, Briefcase, ChevronDown, ChevronRight, FilePlus2, FileSpreadsheet, FileType, FolderPlus, LayoutGrid, Link2, List, Loader2, Presentation, StickyNote, TextQuote, Upload } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { SegmentedControl } from "@/components/ui/form";
import { Filterbar, type FilterbarFilter, type FilterValues, type SavedView } from "@/components/ui/filterbar";
import { deleteView, loadViews, saveView, storeViews } from "@/components/ui/filterbar-helpers";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { LibraryItemType } from "@/lib/types/domain";
import { PRACTICE_AREAS, TYPE_LABEL, type LibraryFilters, type LibrarySort } from "../types";
import { LIBRARY_FOLDERS } from "../ids";
import { useLibrary } from "./library-provider";
import { useLibraryUI } from "./store";
import { isFileDrag, readItemDrag } from "./use-uploads";

const SORT_LABEL: Record<LibrarySort, string> = { name: "Name", updated: "Last updated", created: "Created", size: "Size", type: "Type" };
const TYPE_OPTIONS: (LibraryItemType | "office")[] = ["folder", "office", "docx", "xlsx", "pptx", "pdf", "template", "clause", "note", "link"];
const FILTER_IDS = ["type", "matterId", "status", "practiceArea", "ownerId", "tag", "from", "to"] as const;
type FilterId = (typeof FILTER_IDS)[number];
const VIEWS_KEY = "leclaude:library:views";

/** Library filters → Filterbar values (single-value chips; empty strings are dropped). */
export function filterValuesFrom(filters: LibraryFilters): FilterValues {
  const out: FilterValues = {};
  for (const id of FILTER_IDS) { const v = filters[id]; if (v) out[id] = String(v); }
  return out;
}

/** Filterbar values → a LibraryFilters patch (every known key present so cleared chips clear the filter). */
export function filtersPatchFrom(values: FilterValues): Partial<LibraryFilters> {
  const patch: Record<string, string | undefined> = {};
  for (const id of FILTER_IDS) { const v = values[id]; patch[id] = Array.isArray(v) ? v[0] : v || undefined; }
  return patch as Partial<LibraryFilters>;
}

/** One 36px toolbar: breadcrumbs, quick search, chip filters, saved views, sort, view mode, upload and new. */
export function Toolbar() {
  const lib = useLibrary();
  const { filters, setFilters, list, view, isSearching, search, searchLoading, openFolder, openDialog, actions, folderId, matters, people, tree, searchInputRef, setDragOverId, dragOverId, setDragging, currentMatterId } = lib;
  const viewMode = useLibraryUI((s) => s.viewMode);
  const setViewMode = useLibraryUI((s) => s.setViewMode);
  const sort = useLibraryUI((s) => s.sort);
  const dir = useLibraryUI((s) => s.dir);
  const setSort = useLibraryUI((s) => s.setSort);
  const [q, setQ] = React.useState(filters.q ?? "");
  const [views, setViews] = React.useState<SavedView[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setQ(filters.q ?? ""); }, [filters.q]);
  React.useEffect(() => { try { setViews(loadViews(window.localStorage, VIEWS_KEY)); } catch { /* storage unavailable */ } }, []);

  // Debounced URL sync for the search box.
  React.useEffect(() => {
    const t = setTimeout(() => { if ((filters.q ?? "") !== q.trim()) setFilters({ q: q.trim() || undefined }); }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const crumbs = list?.breadcrumbs ?? [];
  const viewTitle = view === "starred" ? "Starred" : view === "recent" ? "Recent" : view === "shared" ? "Shared with me" : view === "all" ? "All items" : null;

  const dropOnCrumb = async (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault(); e.stopPropagation(); setDragOverId(null); setDragging(false);
    if (isFileDrag(e)) { if (e.dataTransfer.files.length) await actions.upload(e.dataTransfer.files, { folderId: targetId }); return; }
    const ids = readItemDrag(e); if (ids.length) await actions.move(ids, targetId);
  };

  const newDocHref = (kind: "word" | "sheet" | "slides" | "pdf") => `/office/${kind}/new${currentMatterId ? `?matter=${currentMatterId}` : ""}`;

  const filterDefs = React.useMemo<FilterbarFilter[]>(() => [
    { id: "type", label: "Type", options: TYPE_OPTIONS.map((t) => ({ value: t, label: t === "office" ? "Office documents" : TYPE_LABEL[t] })) },
    { id: "matterId", label: "Matter", icon: Briefcase, options: matters.map((m) => ({ value: m.id, label: m.shortName })) },
    { id: "status", label: "Status", options: [{ value: "approved", label: "Approved" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }] },
    { id: "practiceArea", label: "Practice area", pinned: false, options: PRACTICE_AREAS.map((p) => ({ value: p, label: p })) },
    { id: "ownerId", label: "Owner", pinned: false, options: people.map((p) => ({ value: p.id, label: p.name })) },
    { id: "tag", label: "Tag", pinned: false, options: (tree?.tags ?? []).map((t) => ({ value: t.tag, label: t.tag, count: t.count })) },
    { id: "from", label: "Updated after", kind: "date", pinned: false, options: [] },
    { id: "to", label: "Updated before", kind: "date", pinned: false, options: [] },
  ], [matters, people, tree]);
  const values = React.useMemo(() => filterValuesFrom(filters), [filters]);

  const persist = (next: SavedView[]) => { setViews(next); try { storeViews(window.localStorage, VIEWS_KEY, next); } catch { /* ignore */ } };
  const onSaveView = (name: string) => persist(saveView(views, name, { values, query: q.trim() || undefined, extra: { sort, dir, viewMode } }).views);
  const onApplyView = (v: SavedView) => {
    setFilters({ ...filtersPatchFrom(v.values), q: v.query || undefined });
    setQ(v.query ?? "");
    const ex = v.extra ?? {};
    if (typeof ex.sort === "string") setSort(ex.sort as LibrarySort, ex.dir === "desc" ? "desc" : "asc");
    if (ex.viewMode === "grid" || ex.viewMode === "list") setViewMode(ex.viewMode);
  };

  const breadcrumb = (
    <nav className="flex min-w-0 items-center gap-0.5 text-[12.5px]" aria-label="Breadcrumb">
      <CrumbButton id={null} label="Library" active={!folderId && view === "folder"} onOpen={() => openFolder(null)} onDrop={dropOnCrumb} over={dragOverId === "__root__"} setOver={(v) => setDragOverId(v ? "__root__" : null)} />
      {viewTitle && (<><ChevronRight className="size-3.5 text-muted-foreground" /><span className="font-medium">{viewTitle}</span></>)}
      {crumbs.map((c, i) => (
        <React.Fragment key={c.id}>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <CrumbButton id={c.id} label={c.name} active={i === crumbs.length - 1} onOpen={() => openFolder(c.id)} onDrop={dropOnCrumb} over={dragOverId === c.id} setOver={(v) => setDragOverId(v ? c.id : null)} />
        </React.Fragment>
      ))}
      {isSearching && (<><ChevronRight className="size-3.5 text-muted-foreground" /><span className="truncate text-muted-foreground">Search</span></>)}
      <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" aria-hidden />
    </nav>
  );

  return (
    <Filterbar
      leading={breadcrumb}
      filters={filterDefs}
      values={values}
      onChange={(next) => setFilters(filtersPatchFrom(next))}
      query={q}
      onQueryChange={setQ}
      queryLoading={searchLoading}
      queryPlaceholder={folderId ? "Search this folder and below…" : "Search the library…"}
      inputRef={searchInputRef}
      savedViews={views}
      onSaveView={onSaveView}
      onApplyView={onApplyView}
      onDeleteView={(id) => persist(deleteView(views, id))}
      status={isSearching ? (
        <span className="flex items-center gap-1.5">
          {searchLoading && <Loader2 className="size-3 animate-spin" />}
          {search ? <>{search.hits.length} result{search.hits.length === 1 ? "" : "s"} for “{search.query}” · {search.mode === "hybrid" ? "semantic + keyword" : "keyword"} · {search.took} ms</> : "Searching…"}
        </span>
      ) : undefined}
    >
      <DropdownMenu>
        <Tip label={`Sort: ${SORT_LABEL[sort]} · ${dir === "asc" ? "ascending" : "descending"}`}>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground" aria-label="Sort">{dir === "asc" ? <ArrowDownAZ className="size-3.5" /> : <ArrowUpDown className="size-3.5" />}<span className="hidden lg:inline">{SORT_LABEL[sort]}</span><ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as LibrarySort)}>
            {(Object.keys(SORT_LABEL) as LibrarySort[]).map((k) => <DropdownMenuRadioItem key={k} value={k}>{SORT_LABEL[k]}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={dir} onValueChange={(v) => setSort(sort, v as "asc" | "desc")}>
            <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <SegmentedControl size="xs" ariaLabel="View" value={viewMode} onChange={(v) => setViewMode(v)} options={[{ value: "grid", label: <span className="sr-only">Grid</span>, icon: LayoutGrid, title: "Grid (1)" }, { value: "list", label: <span className="sr-only">List</span>, icon: List, title: "List (2)" }]} />
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void actions.upload(e.target.files); e.target.value = ""; }} />
      <Tip label="Upload files into this folder" shortcut="U"><Button variant="outline" size="xs" onClick={() => fileRef.current?.click()} aria-label="Upload"><Upload className="size-3.5" /> <span className="hidden xl:inline">Upload</span></Button></Tip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="xs" className="gap-1" aria-label="New item"><FilePlus2 className="size-3.5" /> <span className="hidden lg:inline">New</span> <ChevronDown className="size-3.5 opacity-70" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>In {list?.folder?.name ?? "Library"}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => openDialog({ kind: "folder", parentId: folderId })}><FolderPlus /> Folder <span className="ml-auto text-[10px] text-muted-foreground">F</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDialog({ kind: "note", parentId: folderId })}><StickyNote /> Note <span className="ml-auto text-[10px] text-muted-foreground">N</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDialog({ kind: "clause", parentId: folderId ?? LIBRARY_FOLDERS.clauses })}><TextQuote /> Clause</DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDialog({ kind: "link", parentId: folderId })}><Link2 /> Link</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Office</DropdownMenuLabel>
          <DropdownMenuItem asChild><Link href={newDocHref("word")}><FilePlus2 /> Document</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href={newDocHref("sheet")}><FileSpreadsheet /> Workbook</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href={newDocHref("slides")}><Presentation /> Deck</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href={newDocHref("pdf")}><FileType /> PDF</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Filterbar>
  );
}

function CrumbButton({ id, label, active, onOpen, onDrop, over, setOver }: { id: string | null; label: string; active: boolean; onOpen: () => void; onDrop: (e: React.DragEvent, id: string | null) => void; over: boolean; setOver: (v: boolean) => void }) {
  return (
    <button
      onClick={onOpen}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => onDrop(e, id)}
      className={cn("max-w-[220px] truncate rounded px-1.5 py-0.5 transition-colors cursor-pointer", active ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground", over && "ring-2 ring-primary/60 bg-primary/5")}
    >
      {label}
    </button>
  );
}
