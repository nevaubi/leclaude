"use client";
import * as React from "react";
import { AlertTriangle, ChevronRight, FolderInput, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PracticeArea } from "@/lib/types/domain";
import { CLAUSE_CATEGORIES, PRACTICE_AREAS, type ClauseCategory, type ClauseStance, type FolderNode } from "../types";
import { extractVariables } from "../clauses";
import { flattenTree } from "../tree";
import { LIBRARY_FOLDERS, isSystemFolder } from "../ids";
import { useLibrary } from "./library-provider";
import { TypeIcon } from "./icons";

export function LibraryDialogs() {
  const { dialog, closeDialog } = useLibrary();
  const open = Boolean(dialog);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
      {dialog?.kind === "folder" || dialog?.kind === "note" || dialog?.kind === "clause" || dialog?.kind === "link" ? <CreateDialog kind={dialog.kind} parentId={dialog.parentId} /> : null}
      {dialog?.kind === "move" && <MoveDialog ids={dialog.ids} />}
      {dialog?.kind === "delete" && <DeleteDialog ids={dialog.ids} />}
      {dialog?.kind === "shortcuts" && <ShortcutsDialog />}
    </Dialog>
  );
}

const KIND_TITLE = { folder: "New folder", note: "New note", clause: "New clause", link: "New link" } as const;

function CreateDialog({ kind, parentId }: { kind: "folder" | "note" | "clause" | "link"; parentId: string | null }) {
  const { actions, closeDialog, tree, openPreview, openFolder, matters } = useLibrary();
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState(kind === "clause" ? "" : "");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [practiceArea, setPracticeArea] = React.useState<string>("");
  const [matterId, setMatterId] = React.useState<string>("");
  const [category, setCategory] = React.useState<ClauseCategory>("confidentiality");
  const [stance, setStance] = React.useState<ClauseStance>("neutral");
  const [governingLaw, setGoverningLaw] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const parentName = parentId && tree ? findName(tree.roots, parentId) : null;
  const vars = kind === "clause" ? extractVariables(content) : [];
  const valid = name.trim().length > 0 && (kind !== "link" || /^(https?:\/\/|\/)/.test(url.trim()));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const item = await actions.create({
        type: kind,
        name: name.trim(),
        parentId,
        content: kind === "note" || kind === "clause" ? content : undefined,
        url: kind === "link" ? url.trim() : undefined,
        description: description.trim() || undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        practiceArea: (practiceArea || undefined) as PracticeArea | undefined,
        matterId: matterId || undefined,
        clause: kind === "clause" ? { category, stance, governingLaw: governingLaw || undefined, notes: notes || undefined } : undefined,
      });
      if (item) { closeDialog(); if (item.type === "folder") openFolder(item.id); else if (item.type !== "link") openPreview(item.id); }
    } finally { setBusy(false); }
  };

  return (
    <DialogContent size={kind === "folder" || kind === "link" ? "md" : "lg"}>
      <form onSubmit={submit} className="space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TypeIcon type={kind} /> {KIND_TITLE[kind]}</DialogTitle>
          <DialogDescription>In <span className="font-medium text-foreground">{parentName ?? "Library root"}</span>{kind === "clause" && parentId !== LIBRARY_FOLDERS.clauses ? " — clauses are normally kept in the Clause bank" : ""}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="lib-name">Name</Label>
          <Input id="lib-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "folder" ? "e.g. Hearing binders" : kind === "clause" ? "e.g. Non-solicitation (mutual, 12 months)" : kind === "link" ? "e.g. Judge Ellis standing orders" : "e.g. Rule 56.1 statement checklist"} />
        </div>
        {kind === "link" && (
          <div className="space-y-1.5"><Label htmlFor="lib-url">URL</Label><Input id="lib-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-invalid={url.length > 0 && !/^(https?:\/\/|\/)/.test(url.trim())} /></div>
        )}
        {(kind === "note" || kind === "clause") && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><Label htmlFor="lib-content">{kind === "clause" ? "Clause text (Markdown, use {{Variable}} for fill-ins)" : "Content (Markdown)"}</Label>{kind === "clause" && vars.length > 0 && <span className="text-[11px] text-muted-foreground">{vars.length} variable{vars.length === 1 ? "" : "s"}: {vars.slice(0, 5).join(", ")}{vars.length > 5 ? "…" : ""}</span>}</div>
            <Textarea id="lib-content" value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[200px] font-mono text-xs" placeholder={kind === "clause" ? "**{{Section Number}}. Non-Solicitation.** During the Term and for {{Restricted Period}} thereafter, {{Party A}} shall not…" : "# Title\n\nNotes…"} />
          </div>
        )}
        {kind === "clause" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label>Category</Label><Select value={category} onValueChange={(v) => setCategory(v as ClauseCategory)}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent>{CLAUSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Stance</Label><Select value={stance} onValueChange={(v) => setStance(v as ClauseStance)}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pro-client">Pro-client</SelectItem><SelectItem value="neutral">Neutral</SelectItem><SelectItem value="pro-counterparty">Pro-counterparty</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Governing law</Label><Input value={governingLaw} onChange={(e) => setGoverningLaw(e.target.value)} placeholder="Delaware" className="h-8 text-xs" /></div>
            <div className="space-y-1.5 sm:col-span-3"><Label>Drafting notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px] text-xs" placeholder="When to use it, typical pushback, fallback positions…" /></div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-3"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line shown on cards and in search" className="h-8 text-xs" /></div>
          <div className="space-y-1.5"><Label>Tags</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated" className="h-8 text-xs" /></div>
          <div className="space-y-1.5"><Label>Practice area</Label><Select value={practiceArea || "__none__"} onValueChange={(v) => setPracticeArea(v === "__none__" ? "" : v)}><SelectTrigger size="sm"><SelectValue placeholder="—" /></SelectTrigger><SelectContent><SelectItem value="__none__">—</SelectItem>{PRACTICE_AREAS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Matter</Label><Select value={matterId || "__none__"} onValueChange={(v) => setMatterId(v === "__none__" ? "" : v)}><SelectTrigger size="sm"><SelectValue placeholder="Inherit from folder" /></SelectTrigger><SelectContent><SelectItem value="__none__">Inherit from folder</SelectItem>{matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
          <Button type="submit" disabled={!valid || busy}>{busy && <Loader2 className="size-4 animate-spin" />} Create</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function MoveDialog({ ids }: { ids: string[] }) {
  const { tree, actions, closeDialog, itemById, folderId } = useLibrary();
  const [target, setTarget] = React.useState<string | null>(folderId);
  const [filter, setFilter] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const nodes = React.useMemo(() => (tree ? flattenTree(tree.roots) : []), [tree]);
  const moving = ids.map(itemById).filter(Boolean);
  const movingFolderIds = new Set(moving.filter((m) => m?.type === "folder").map((m) => m!.id));
  const disabled = (n: FolderNode) => movingFolderIds.has(n.id) || ancestorsOf(nodes, n.id).some((a) => movingFolderIds.has(a));
  const visible = nodes.filter((n) => !filter || n.name.toLowerCase().includes(filter.toLowerCase()));
  const submit = async () => { setBusy(true); try { const ok = await actions.move(ids, target); if (ok) closeDialog(); } finally { setBusy(false); } };
  return (
    <DialogContent size="md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><FolderInput className="size-4" /> Move {ids.length === 1 ? (moving[0]?.name ?? "item") : `${ids.length} items`}</DialogTitle>
        <DialogDescription>Choose a destination folder. Items keep their matter unless the destination belongs to another matter.</DialogDescription>
      </DialogHeader>
      <Input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter folders…" className="h-8 text-sm" />
      <div className="max-h-[360px] overflow-y-auto rounded-md border scrollbar-thin">
        <button onClick={() => setTarget(null)} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/50 cursor-pointer", target === null && "bg-accent font-medium")}><TypeIcon type="folder" /> Library root</button>
        {visible.map((n) => (
          <button key={n.id} disabled={disabled(n)} onClick={() => setTarget(n.id)} style={{ paddingLeft: 12 + n.depth * 16 }} className={cn("flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-accent/50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40", target === n.id && "bg-accent font-medium")}>
            <TypeIcon type="folder" className={cn(n.matterId && "text-chart-2")} /><span className="truncate">{n.name}</span>{n.system && <Badge variant="muted" className="ml-auto px-1 py-0 text-[9px]">system</Badge>}
          </button>
        ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Move here</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ancestorsOf(nodes: FolderNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let cur = byId.get(id);
  while (cur?.parentId) { out.push(cur.parentId); cur = byId.get(cur.parentId); }
  return out;
}

function DeleteDialog({ ids }: { ids: string[] }) {
  const { actions, closeDialog, itemById } = useLibrary();
  const [busy, setBusy] = React.useState(false);
  const items = ids.map(itemById).filter(Boolean);
  const folders = items.filter((i) => i?.type === "folder");
  const office = items.filter((i) => i?.officeDocId);
  const blocked = folders.filter((f) => isSystemFolder(f!.id));
  const submit = async () => { setBusy(true); try { await actions.remove(ids.filter((id) => !blocked.some((b) => b!.id === id))); closeDialog(); } finally { setBusy(false); } };
  return (
    <DialogContent size="sm">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-destructive" /> Delete {ids.length === 1 ? "this item" : `${ids.length} items`}?</DialogTitle>
        <DialogDescription>
          {folders.length > 0 && <>Folders are deleted with everything inside them. </>}
          {office.length > 0 && <>{office.length === 1 ? "The underlying Office document and its version history will be deleted too." : `${office.length} Office documents and their version history will be deleted too.`} </>}
          This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-sm scrollbar-thin">
        {items.slice(0, 8).map((i) => <li key={i!.id} className="flex items-center gap-2 truncate"><TypeIcon type={i!.type} /><span className="truncate">{i!.name}</span>{isSystemFolder(i!.id) && i!.type === "folder" && <Badge variant="muted" className="text-[10px]">system · skipped</Badge>}</li>)}
        {items.length > 8 && <li className="text-xs text-muted-foreground">…and {items.length - 8} more</li>}
      </ul>
      <DialogFooter>
        <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
        <Button variant="destructive" onClick={submit} disabled={busy || items.length === blocked.length}>{busy && <Loader2 className="size-4 animate-spin" />} Delete</Button>
      </DialogFooter>
    </DialogContent>
  );
}

const SHORTCUTS: [string, string][] = [
  ["/", "Focus search"], ["Enter", "Open selected"], ["Space", "Details of selected"], ["F2", "Rename"], ["⌫ / Delete", "Delete selected"], ["⌘A", "Select all"], ["Esc", "Clear selection / close"], ["S", "Star / unstar selected"], ["N", "New note"], ["F", "New folder"], ["U", "Upload"], ["A", "Toggle Ask the library"], ["1 / 2", "Grid / list view"], ["← ↑ → ↓", "Move between items"], ["?", "This help"],
];

function ShortcutsDialog() {
  return (
    <DialogContent size="sm">
      <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Shortcuts work when no text field is focused.</DialogDescription></DialogHeader>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        {SHORTCUTS.map(([k, v]) => <React.Fragment key={k}><dt><kbd>{k}</kbd></dt><dd className="text-muted-foreground">{v}</dd></React.Fragment>)}
      </dl>
    </DialogContent>
  );
}

function findName(nodes: FolderNode[], id: string): string | null {
  for (const n of nodes) { if (n.id === id) return n.name; const f = findName(n.children, id); if (f) return f; }
  return null;
}

export { ChevronRight };
