"use client";
import * as React from "react";
import { ArrowDownAZ, ArrowUpDown, ChevronDown, ChevronRight, FilePlus2, FileSpreadsheet, FileType, Filter, FolderPlus, LayoutGrid, Link2, List, Loader2, Presentation, Search, Sparkles, StickyNote, TextQuote, Upload, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { LibraryItemType } from "@/lib/types/domain";
import { PRACTICE_AREAS, TYPE_LABEL, type LibrarySort } from "../types";
import { activeFilterCount } from "../filters";
import { LIBRARY_FOLDERS } from "../ids";
import { useLibrary } from "./library-provider";
import { useLibraryUI } from "./store";
import { isFileDrag, readItemDrag } from "./use-uploads";

const ANY = "__any__";
const SORT_LABEL: Record<LibrarySort, string> = { name: "Name", updated: "Last updated", created: "Created", size: "Size", type: "Type" };
const TYPE_OPTIONS: (LibraryItemType | "office")[] = ["folder", "office", "docx", "xlsx", "pptx", "pdf", "template", "clause", "note", "link"];

export function Toolbar() {
  const lib = useLibrary();
  const { filters, setFilters, list, view, isSearching, search, searchLoading, openFolder, openDialog, actions, folderId, matters, people, tree, searchInputRef, setDragOverId, dragOverId, setDragging, currentMatterId } = lib;
  const viewMode = useLibraryUI((s) => s.viewMode);
  const setViewMode = useLibraryUI((s) => s.setViewMode);
  const sort = useLibraryUI((s) => s.sort);
  const dir = useLibraryUI((s) => s.dir);
  const setSort = useLibraryUI((s) => s.setSort);
  const [q, setQ] = React.useState(filters.q ?? "");
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setQ(filters.q ?? ""); }, [filters.q]);

  // Debounced URL sync for the search box.
  React.useEffect(() => {
    const t = setTimeout(() => { if ((filters.q ?? "") !== q.trim()) setFilters({ q: q.trim() || undefined }); }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const nFilters = activeFilterCount(filters);
  const crumbs = list?.breadcrumbs ?? [];
  const viewTitle = view === "starred" ? "Starred" : view === "recent" ? "Recent" : view === "shared" ? "Shared with me" : view === "all" ? "All items" : null;

  const dropOnCrumb = async (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault(); e.stopPropagation(); setDragOverId(null); setDragging(false);
    if (isFileDrag(e)) { if (e.dataTransfer.files.length) await actions.upload(e.dataTransfer.files, { folderId: targetId }); return; }
    const ids = readItemDrag(e); if (ids.length) await actions.move(ids, targetId);
  };

  const newDocHref = (kind: "word" | "sheet" | "slides" | "pdf") => `/office/${kind}/new${currentMatterId ? `?matter=${currentMatterId}` : ""}`;

  return (
    <div className="shrink-0 border-b bg-background">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        {/* Breadcrumbs */}
        <nav className="flex min-w-0 items-center gap-0.5 text-sm" aria-label="Breadcrumb">
          <CrumbButton id={null} label="Library" active={!folderId && view === "folder"} onOpen={() => openFolder(null)} onDrop={dropOnCrumb} over={dragOverId === "__root__"} setOver={(v) => setDragOverId(v ? "__root__" : null)} />
          {viewTitle && (<><ChevronRight className="size-3.5 text-muted-foreground" /><span className="font-medium">{viewTitle}</span></>)}
          {crumbs.map((c, i) => (
            <React.Fragment key={c.id}>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              <CrumbButton id={c.id} label={c.name} active={i === crumbs.length - 1} onOpen={() => openFolder(c.id)} onDrop={dropOnCrumb} over={dragOverId === c.id} setOver={(v) => setDragOverId(v ? c.id : null)} />
            </React.Fragment>
          ))}
          {isSearching && (<><ChevronRight className="size-3.5 text-muted-foreground" /><span className="truncate text-muted-foreground">Search</span></>)}
        </nav>
        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-full sm:w-72">
          {searchLoading ? <Loader2 className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
          <Input ref={searchInputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }} placeholder={folderId ? "Search this folder and below…" : "Search the library…"} className="h-8 pl-8 pr-14 text-sm" aria-label="Search library" />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {q ? <button onClick={() => setQ("")} className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Clear search"><X className="size-3.5" /></button> : <kbd className="hidden sm:inline">/</kbd>}
          </div>
        </div>

        {/* Filters + sort in one popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant={nFilters ? "secondary" : "outline"} size="sm" className="gap-1.5" aria-label="Filter and sort"><Filter className="size-3.5" /><span className="hidden md:inline">Filter</span>{nFilters > 0 && <Badge variant="default" className="ml-0.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]">{nFilters}</Badge>}</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px] space-y-3 p-3">
            <div className="flex items-center justify-between"><div className="text-[12px] font-semibold">Sort</div><span className="text-[11px] text-muted-foreground">{SORT_LABEL[sort]} · {dir === "asc" ? "ascending" : "descending"}</span></div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Sort by">
              {(Object.keys(SORT_LABEL) as LibrarySort[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => setSort(k, sort === k ? (dir === "asc" ? "desc" : "asc") : undefined)} className={cn("inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors cursor-pointer", sort === k ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                  {SORT_LABEL[k]}{sort === k && (dir === "asc" ? <ArrowDownAZ className="size-3" /> : <ArrowUpDown className="size-3" />)}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border-t pt-3"><div className="text-[12px] font-semibold">Filter</div>{nFilters > 0 && <Button variant="ghost" size="xs" onClick={() => setFilters({ type: undefined, matterId: undefined, practiceArea: undefined, tag: undefined, ownerId: undefined, from: undefined, to: undefined, status: undefined })}>Clear all</Button>}</div>
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect label="Type" value={filters.type ?? ANY} onChange={(v) => setFilters({ type: v === ANY ? undefined : (v as LibraryItemType | "office") })} options={[{ value: ANY, label: "Any type" }, ...TYPE_OPTIONS.map((t) => ({ value: t, label: t === "office" ? "Office documents" : TYPE_LABEL[t] }))]} />
              <FilterSelect label="Matter" value={filters.matterId ?? ANY} onChange={(v) => setFilters({ matterId: v === ANY ? undefined : v })} options={[{ value: ANY, label: "Any matter" }, ...matters.map((m) => ({ value: m.id, label: m.shortName }))]} />
              <FilterSelect label="Practice area" value={filters.practiceArea ?? ANY} onChange={(v) => setFilters({ practiceArea: v === ANY ? undefined : (v as (typeof PRACTICE_AREAS)[number]) })} options={[{ value: ANY, label: "Any area" }, ...PRACTICE_AREAS.map((p) => ({ value: p, label: p }))]} />
              <FilterSelect label="Owner" value={filters.ownerId ?? ANY} onChange={(v) => setFilters({ ownerId: v === ANY ? undefined : v })} options={[{ value: ANY, label: "Anyone" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
              <FilterSelect label="Tag" value={filters.tag ?? ANY} onChange={(v) => setFilters({ tag: v === ANY ? undefined : v })} options={[{ value: ANY, label: "Any tag" }, ...(tree?.tags ?? []).map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` }))]} />
              <FilterSelect label="Status" value={filters.status ?? ANY} onChange={(v) => setFilters({ status: v === ANY ? undefined : (v as "draft" | "approved" | "archived") })} options={[{ value: ANY, label: "Any status" }, { value: "approved", label: "Approved" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]} />
              <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Updated after</Label><Input type="date" value={filters.from ?? ""} onChange={(e) => setFilters({ from: e.target.value || undefined })} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Updated before</Label><Input type="date" value={filters.to ?? ""} onChange={(e) => setFilters({ to: e.target.value || undefined })} className="h-8 text-xs" /></div>
            </div>
            <p className="text-[11px] text-muted-foreground">Filters search the current folder and its subfolders.</p>
          </PopoverContent>
        </Popover>

        {/* View */}
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as "grid" | "list")} size="sm" variant="outline" className="rounded-md border p-0.5 [&>button]:border-0 [&>button]:shadow-none">
          <Tip label="Grid" shortcut="1"><ToggleGroupItem value="grid" aria-label="Grid view" size="xs"><LayoutGrid className="size-4" /></ToggleGroupItem></Tip>
          <Tip label="List" shortcut="2"><ToggleGroupItem value="list" aria-label="List view" size="xs"><List className="size-4" /></ToggleGroupItem></Tip>
        </ToggleGroup>

        {/* Upload + New */}
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void actions.upload(e.target.files); e.target.value = ""; }} />
        <Tip label="Upload files into this folder" shortcut="U"><Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} aria-label="Upload"><Upload className="size-3.5" /> <span className="hidden lg:inline">Upload</span></Button></Tip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" className="gap-1"><FilePlus2 className="size-3.5" /> New <ChevronDown className="size-3.5 opacity-70" /></Button></DropdownMenuTrigger>
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
      </div>

      {/* Active filter chips / search status */}
      {(nFilters > 0 || isSearching) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-xs">
          {isSearching && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {searchLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              {search ? <>{search.hits.length} result{search.hits.length === 1 ? "" : "s"} for “{search.query}” · {search.mode === "hybrid" ? "semantic + keyword" : "keyword"} · {search.took} ms</> : "Searching…"}
            </span>
          )}
          {filters.type && <Chip label={`Type: ${filters.type === "office" ? "Office documents" : TYPE_LABEL[filters.type]}`} onClear={() => setFilters({ type: undefined })} />}
          {filters.matterId && <Chip label={`Matter: ${matters.find((m) => m.id === filters.matterId)?.shortName ?? filters.matterId}`} onClear={() => setFilters({ matterId: undefined })} />}
          {filters.practiceArea && <Chip label={`Area: ${filters.practiceArea}`} onClear={() => setFilters({ practiceArea: undefined })} />}
          {filters.tag && <Chip label={`Tag: ${filters.tag}`} onClear={() => setFilters({ tag: undefined })} />}
          {filters.ownerId && <Chip label={`Owner: ${people.find((p) => p.id === filters.ownerId)?.name ?? filters.ownerId}`} onClear={() => setFilters({ ownerId: undefined })} />}
          {filters.status && <Chip label={`Status: ${filters.status}`} onClear={() => setFilters({ status: undefined })} />}
          {filters.from && <Chip label={`After ${filters.from}`} onClear={() => setFilters({ from: undefined })} />}
          {filters.to && <Chip label={`Before ${filters.to}`} onClear={() => setFilters({ to: undefined })} />}
        </div>
      )}
    </div>
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

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px]">
      {label}
      <button onClick={onClear} className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label={`Remove filter ${label}`}><X className="size-3" /></button>
    </span>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
