"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, FolderOpen, History, Library, MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { PersonAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { OfficeDocument } from "@/lib/types/domain";
import { KIND_META, type OfficeDocSummary } from "./types";
import { KIND_BG, KIND_COLOR, KIND_ICON } from "./new-tiles";

export interface DocActions {
  rename: (doc: OfficeDocSummary, title: string) => Promise<void>;
  duplicate: (doc: OfficeDocSummary) => Promise<void>;
  remove: (doc: OfficeDocSummary) => Promise<void>;
}

export function docHref(doc: Pick<OfficeDocSummary, "kind" | "id">) { return `/office/${doc.kind}/${doc.id}`; }

/** Duplicate = GET the document (with content) then POST a copy with the same content. */
export async function duplicateOfficeDoc(doc: OfficeDocSummary): Promise<OfficeDocument> {
  const r = await fetch(`/api/office/docs/${doc.id}`);
  if (!r.ok) throw new Error("Could not read the document");
  const { doc: full } = (await r.json()) as { doc: OfficeDocument };
  const res = await fetch("/api/office/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: full.kind, title: `Copy of ${full.title}`, content: full.content, matterId: full.matterId, folderId: full.folderId, tags: full.tags, meta: full.meta }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
  return ((await res.json()) as { doc: OfficeDocument }).doc;
}

/** Download the native file for a document through its export route (.docx / .xlsx / .pptx / .pdf). */
/** Download the native file for a document through its export route (.docx / .xlsx / .pptx / .pdf). */
export async function downloadOfficeDoc(doc: OfficeDocSummary) {
  const routes: Record<OfficeDocSummary["kind"], { url: string; body: Record<string, unknown> }> = {
    word: { url: "/api/office/word/export", body: { docId: doc.id, format: "docx" } },
    sheet: { url: "/api/office/sheet/export", body: { docId: doc.id, format: "xlsx" } },
    slides: { url: "/api/office/slides/export", body: { docId: doc.id, format: "pptx" } },
    pdf: { url: "/api/office/pdf/export", body: { docId: doc.id, options: { flattenAnnotations: true, applyRedactions: true, bates: true, bookmarks: true } } },
  };
  const { url, body } = routes[doc.kind];
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? "Export failed");
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = href; a.download = `${doc.title.replace(/[\\/:*?"<>|]+/g, "-")}.${KIND_META[doc.kind].ext}`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

function useRename(doc: OfficeDocSummary, actions: DocActions) {
  const [renaming, setRenaming] = React.useState(false);
  const [title, setTitle] = React.useState(doc.title);
  React.useEffect(() => setTitle(doc.title), [doc.title]);
  const commit = async () => { setRenaming(false); if (title.trim() && title.trim() !== doc.title) await actions.rename(doc, title.trim()); else setTitle(doc.title); };
  const input = renaming ? (
    <input
      autoFocus
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") void commit(); if (e.key === "Escape") { setRenaming(false); setTitle(doc.title); } }}
      onClick={(e) => e.stopPropagation()}
      className="w-full rounded border border-ring bg-background px-1 py-0.5 text-sm font-medium outline-none ring-2 ring-ring/30"
      aria-label="Rename document"
    />
  ) : null;
  return { renaming, setRenaming, input };
}

function MenuItems({ doc, actions, onRename, Item, Sep }: { doc: OfficeDocSummary; actions: DocActions; onRename: () => void; Item: typeof DropdownMenuItem; Sep: typeof DropdownMenuSeparator }) {
  const router = useRouter();
  return (
    <>
      <Item onClick={() => router.push(docHref(doc))}><ExternalLink /> Open</Item>
      <Item onClick={() => window.open(docHref(doc), "_blank")}><ExternalLink /> Open in new tab</Item>
      <Sep />
      <Item onClick={onRename}><Pencil /> Rename</Item>
      <Item onClick={() => void actions.duplicate(doc)}><Copy /> Duplicate</Item>
      <Item onClick={() => downloadOfficeDoc(doc).catch((e: Error) => toast.error("Download failed", { description: e.message }))}><Download /> Download .{KIND_META[doc.kind].ext}</Item>
      {doc.libraryItemId && <Item onClick={() => router.push(`/library?item=${doc.libraryItemId}`)}><Library /> Show in Library</Item>}
      <Sep />
      <Item destructive onClick={() => void actions.remove(doc)}><Trash2 /> Delete</Item>
    </>
  );
}

export function DocCard({ doc, actions }: { doc: OfficeDocSummary; actions: DocActions }) {
  const router = useRouter();
  const Icon = KIND_ICON[doc.kind];
  const { renaming, setRenaming, input } = useRename(doc, actions);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="link"
          tabIndex={0}
          onClick={() => { if (!renaming) router.push(docHref(doc)); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !renaming) router.push(docHref(doc)); if (e.key === "F2") { e.preventDefault(); setRenaming(true); } }}
          className="group flex h-[168px] cursor-pointer flex-col rounded-xl border bg-card p-3.5 shadow-xs outline-none transition-all hover:border-foreground/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <div className="flex items-start gap-2.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", KIND_BG[doc.kind], KIND_COLOR[doc.kind])}><Icon className="size-4" /></span>
            <div className="min-w-0 flex-1">
              {input ?? <div className="line-clamp-2 text-sm font-medium leading-snug" title={doc.title}>{doc.title}</div>}
              <div className="mt-0.5 text-[11px] text-muted-foreground">{KIND_META[doc.kind].label}{doc.templateId ? " · from template" : ""}{doc.folderName ? ` · ${doc.folderName}` : ""}</div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" onClick={(e) => e.stopPropagation()} aria-label="Actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                <MenuItems doc={doc} actions={actions} onRename={() => setRenaming(true)} Item={DropdownMenuItem} Sep={DropdownMenuSeparator} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {doc.matterShortName && <Badge variant="outline" className="max-w-[160px] truncate px-1.5 py-0 text-[10px]">{doc.matterShortName}</Badge>}
            {(doc.tags ?? []).slice(0, 2).map((t) => <Badge key={t} variant="muted" className="px-1.5 py-0 text-[10px]">{t}</Badge>)}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 tabular" title={`Content version ${doc.contentVersion}`}><History className="size-3" /> v{doc.contentVersion} · {doc.versionCount} saved</span>
            {doc.commentCount > 0 && <span className="inline-flex items-center gap-1 tabular"><MessageSquare className="size-3" /> {doc.commentCount}</span>}
            <span className="flex-1" />
            {doc.ownerName && <PersonAvatar name={doc.ownerName} size="xs" />}
            <RelativeTime value={doc.updatedAt} />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <MenuItems doc={doc} actions={actions} onRename={() => setRenaming(true)} Item={ContextMenuItem as unknown as typeof DropdownMenuItem} Sep={ContextMenuSeparator as unknown as typeof DropdownMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function DocRow({ doc, actions }: { doc: OfficeDocSummary; actions: DocActions }) {
  const router = useRouter();
  const Icon = KIND_ICON[doc.kind];
  const { renaming, setRenaming, input } = useRename(doc, actions);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="link"
          tabIndex={0}
          onClick={() => { if (!renaming) router.push(docHref(doc)); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !renaming) router.push(docHref(doc)); if (e.key === "F2") { e.preventDefault(); setRenaming(true); } }}
          className="group flex h-11 cursor-pointer items-center gap-3 border-b px-3 text-sm outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
        >
          <Icon className={cn("size-4 shrink-0", KIND_COLOR[doc.kind])} />
          <div className="min-w-[240px] flex-1 truncate font-medium">{input ?? doc.title}</div>
          <div className="w-[100px] text-xs text-muted-foreground">{KIND_META[doc.kind].label}</div>
          <div className="w-[150px] truncate text-xs">{doc.matterShortName ?? <span className="text-muted-foreground">—</span>}</div>
          <div className="flex w-[150px] items-center gap-1.5 truncate text-xs">{doc.ownerName ? <><PersonAvatar name={doc.ownerName} size="xs" /><span className="truncate">{doc.ownerName}</span></> : "—"}</div>
          <div className="w-[110px] text-xs text-muted-foreground"><RelativeTime value={doc.updatedAt} /></div>
          <div className="w-[90px] text-xs tabular text-muted-foreground">v{doc.contentVersion} · {doc.versionCount}</div>
          <div className="w-[70px] text-right text-xs tabular text-muted-foreground">{doc.size ? formatBytes(doc.size) : "—"}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" onClick={(e) => e.stopPropagation()} aria-label="Actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
              <MenuItems doc={doc} actions={actions} onRename={() => setRenaming(true)} Item={DropdownMenuItem} Sep={DropdownMenuSeparator} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <MenuItems doc={doc} actions={actions} onRename={() => setRenaming(true)} Item={ContextMenuItem as unknown as typeof DropdownMenuItem} Sep={ContextMenuSeparator as unknown as typeof DropdownMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function OpenFolderLink({ doc }: { doc: OfficeDocSummary }) {
  if (!doc.libraryItemId) return null;
  return <Link href={`/library?item=${doc.libraryItemId}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><FolderOpen className="size-3" /> Library</Link>;
}
