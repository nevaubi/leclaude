"use client";
import * as React from "react";
import { ChevronRight, Clock, Database, Plus, RefreshCw, Star, Users, Sparkles, Library as LibraryIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { FolderNode, LibraryView } from "../types";
import { LIBRARY_FOLDERS } from "../ids";
import { useLibrary } from "./library-provider";
import { useLibraryUI } from "./store";
import { TypeIcon } from "./icons";
import { ITEM_DRAG_MIME, isFileDrag, readItemDrag } from "./use-uploads";

const VIEWS: { id: LibraryView; label: string; icon: React.ComponentType<{ className?: string }>; countKey: "starred" | "recent" | "shared" | "all" }[] = [
  { id: "starred", label: "Starred", icon: Star, countKey: "starred" },
  { id: "recent", label: "Recent", icon: Clock, countKey: "recent" },
  { id: "shared", label: "Shared with me", icon: Users, countKey: "shared" },
];

export function FolderTree({ className }: { className?: string }) {
  const lib = useLibrary();
  const { tree, folderId, view, openFolder, openView, openDialog, setDragOverId, dragOverId, actions, setDragging } = lib;
  const expanded = useLibraryUI((s) => s.expanded);
  const toggleExpanded = useLibraryUI((s) => s.toggleExpanded);
  const expandMany = useLibraryUI((s) => s.expandMany);
  const [treeFilter, setTreeFilter] = React.useState("");

  // Keep ancestors of the active folder expanded.
  React.useEffect(() => {
    if (!tree || !folderId) return;
    const path: string[] = [];
    const walk = (nodes: FolderNode[], trail: string[]): boolean => {
      for (const n of nodes) { if (n.id === folderId) { path.push(...trail); return true; } if (walk(n.children, [...trail, n.id])) return true; }
      return false;
    };
    walk(tree.roots, []);
    if (path.some((p) => !expanded.includes(p))) expandMany(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, tree]);

  const onDropTo = async (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    setDragging(false);
    if (isFileDrag(e)) { if (e.dataTransfer.files.length) await actions.upload(e.dataTransfer.files, { folderId: targetId }); return; }
    const ids = readItemDrag(e);
    if (ids.length) await actions.move(ids, targetId);
  };

  const filterLower = treeFilter.trim().toLowerCase();
  const matches = (n: FolderNode): boolean => !filterLower || n.name.toLowerCase().includes(filterLower) || n.children.some(matches);

  return (
    <aside className={cn("flex h-full min-h-0 flex-col border-r bg-sidebar/40", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <LibraryIcon className="size-4 text-muted-foreground" />
        <button onClick={() => openFolder(null)} className="text-sm font-semibold hover:text-primary cursor-pointer">Library</button>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="New"><Plus className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>New in {tree && folderId ? findNode(tree.roots, folderId)?.name ?? "this folder" : "Library"}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => openDialog({ kind: "folder", parentId: folderId })}>Folder</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog({ kind: "note", parentId: folderId })}>Note</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog({ kind: "clause", parentId: folderId ?? LIBRARY_FOLDERS.clauses })}>Clause</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog({ kind: "link", parentId: folderId })}>Link</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="px-2 pt-2">
        <input value={treeFilter} onChange={(e) => setTreeFilter(e.target.value)} placeholder="Filter folders…" className="h-7 w-full rounded-md border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30" />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 pt-1" aria-label="Library folders">
        <div className="mb-2 space-y-0.5">
          {VIEWS.map((v) => {
            const active = view === v.id;
            return (
              <button key={v.id} onClick={() => openView(v.id)} className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", active ? "bg-sidebar-primary/10 text-sidebar-primary font-medium" : "text-sidebar-foreground/85 hover:bg-sidebar-accent")}>
                <v.icon className={cn("size-4", active ? "text-sidebar-primary" : "text-muted-foreground")} />
                <span className="flex-1 truncate text-left">{v.label}</span>
                <span className="tabular text-[11px] text-muted-foreground">{tree?.views[v.countKey] ?? ""}</span>
              </button>
            );
          })}
        </div>
        <div className="mb-1 mt-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Folders</div>
        {!tree ? (
          <div className="space-y-1.5 px-1">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : (
          <ul className="space-y-0.5">
            {tree.roots.filter(matches).map((n) => (
              <TreeNode key={n.id} node={n} depth={0} expanded={expanded} toggle={toggleExpanded} activeId={view === "folder" ? folderId : null} onOpen={openFolder} onDrop={onDropTo} dragOverId={dragOverId} setDragOverId={setDragOverId} setDragging={setDragging} filter={filterLower} />
            ))}
          </ul>
        )}
      </nav>

      <IndexFooter />
    </aside>
  );
}

function findNode(nodes: FolderNode[], id: string): FolderNode | null {
  for (const n of nodes) { if (n.id === id) return n; const f = findNode(n.children, id); if (f) return f; }
  return null;
}

function TreeNode({ node, depth, expanded, toggle, activeId, onOpen, onDrop, dragOverId, setDragOverId, setDragging, filter }: { node: FolderNode; depth: number; expanded: string[]; toggle: (id: string) => void; activeId: string | null; onOpen: (id: string) => void; onDrop: (e: React.DragEvent, id: string) => void; dragOverId: string | null; setDragOverId: (id: string | null) => void; setDragging: (v: boolean) => void; filter: string }) {
  const isOpen = expanded.includes(node.id) || (filter.length > 0);
  const active = activeId === node.id;
  const over = dragOverId === node.id;
  const hasChildren = node.children.length > 0;
  const visibleChildren = filter ? node.children.filter((c) => c.name.toLowerCase().includes(filter) || hasMatch(c, filter)) : node.children;
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={active}
        draggable={!node.system}
        onDragStart={(e) => { e.dataTransfer.setData(ITEM_DRAG_MIME, JSON.stringify([node.id])); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
        onDragEnd={() => { setDragging(false); setDragOverId(null); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = isFileDrag(e) ? "copy" : "move"; if (dragOverId !== node.id) setDragOverId(node.id); if (hasChildren && !isOpen && !hoverTimer.current) hoverTimer.current = setTimeout(() => { toggle(node.id); hoverTimer.current = null; }, 700); }}
        onDragLeave={() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } if (dragOverId === node.id) setDragOverId(null); }}
        onDrop={(e) => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } onDrop(e, node.id); }}
        onClick={() => onOpen(node.id)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(node.id); if (e.key === "ArrowRight" && hasChildren && !isOpen) toggle(node.id); if (e.key === "ArrowLeft" && isOpen) toggle(node.id); }}
        tabIndex={0}
        className={cn("group flex h-8 cursor-pointer items-center gap-1 rounded-md pr-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50", active ? "bg-sidebar-primary/10 text-sidebar-primary font-medium" : "text-sidebar-foreground/85 hover:bg-sidebar-accent", over && "ring-2 ring-primary/60 bg-primary/5")}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          aria-label={isOpen ? "Collapse" : "Expand"}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggle(node.id); }}
          className={cn("flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground", !hasChildren && "invisible")}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
        </button>
        <TypeIcon type="folder" open={active || isOpen} className={cn("size-4", node.matterId && "text-chart-2")} />
        <span className="flex-1 truncate">{node.name}</span>
        <span className={cn("tabular text-[11px]", active ? "text-sidebar-primary/70" : "text-muted-foreground/80")}>{node.totalCount || ""}</span>
      </div>
      {hasChildren && isOpen && (
        <ul className="space-y-0.5">
          {visibleChildren.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} activeId={activeId} onOpen={onOpen} onDrop={onDrop} dragOverId={dragOverId} setDragOverId={setDragOverId} setDragging={setDragging} filter={filter} />
          ))}
        </ul>
      )}
    </li>
  );
}

function hasMatch(n: FolderNode, filter: string): boolean {
  return n.children.some((c) => c.name.toLowerCase().includes(filter) || hasMatch(c, filter));
}

function IndexFooter() {
  const { tree, actions, aiConfigured } = useLibrary();
  const [busy, setBusy] = React.useState(false);
  const idx = tree?.index;
  return (
    <div className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Database className="size-3.5" />
        <span className="flex-1 truncate">{idx ? `${idx.docs + idx.officeDocs} indexed · ${aiConfigured ? `${idx.embedded + idx.officeEmbedded} embedded` : "keyword only"}` : "Index"}</span>
        <Tip label={aiConfigured ? "Rebuild the search index with embeddings" : "Rebuild keyword index (add OPENAI_API_KEY for semantic search)"}>
          <Button variant="ghost" size="icon-xs" disabled={busy} onClick={async () => { setBusy(true); try { await actions.rebuildIndex(); } finally { setBusy(false); } }} aria-label="Rebuild index"><RefreshCw className={cn("size-3.5", busy && "animate-spin")} /></Button>
        </Tip>
      </div>
      {!aiConfigured && <div className="mt-1 flex items-center gap-1 text-warning-foreground/80 dark:text-warning"><Sparkles className="size-3" /> Semantic search and AI need an OpenAI key</div>}
    </div>
  );
}
