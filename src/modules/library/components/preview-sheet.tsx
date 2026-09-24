"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ChevronRight, Copy, Download, ExternalLink, Eye, FolderInput, History, KeyRound, Loader2, Pencil, Save, Sparkles, Star, Tag, Trash2, X, Plus, LayoutTemplate, FolderOpen, MessageSquare, FileText } from "lucide-react";
import { toast } from "sonner";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RelativeTime } from "@/components/ui/relative-time";
import { PersonAvatar } from "@/components/ui/avatar";
import { Markdown } from "@/components/ai/markdown";
import { OFFICE_KIND_LABEL } from "@/modules/office/shared/types";
import type { LibraryItem, PracticeArea } from "@/lib/types/domain";
import { PRACTICE_AREAS, TYPE_LABEL, type LibraryItemDetail, type LibraryItemView } from "../types";
import { isSystemFolder } from "../ids";
import { api, isNoKeyError } from "./api";
import { useLibrary } from "./library-provider";
import { TypeGlyph, TypeIcon } from "./icons";
import { ClausePanel } from "./clause-panel";

const SHARE_LABEL: Record<string, string> = { firm: "Whole firm", "matter-team": "Matter team", private: "Only me" };

export function PreviewSheet() {
  const { previewId, openPreview } = useLibrary();
  return (
    <Sheet open={Boolean(previewId)} onOpenChange={(o) => { if (!o) openPreview(null); }}>
      <SheetContent width="max-w-3xl" className="w-full" aria-describedby={undefined}>
        {previewId && <PreviewBody id={previewId} key={previewId} />}
      </SheetContent>
    </Sheet>
  );
}

function PreviewBody({ id }: { id: string }) {
  const router = useRouter();
  const { actions, openPreview, openFolder, openItem, openDialog, aiConfigured, matters } = useLibrary();
  const [detail, setDetail] = React.useState<LibraryItemDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const [tab, setTab] = React.useState<"content" | "activity" | "versions">("content");

  const load = React.useCallback(async () => {
    try { const d = await api<LibraryItemDetail>(`/api/library/items/${id}`); setDetail(d); setDraft(d.item.content ?? ""); setNameDraft(d.item.name); }
    catch (e) { setError((e as Error).message); }
  }, [id]);
  React.useEffect(() => { void load(); }, [load]);

  const update = async (patch: Parameters<typeof actions.update>[1], silent = true) => {
    const item = await actions.update(id, patch, { silent });
    if (item) setDetail((d) => (d ? { ...d, item: { ...d.item, ...item } } : d));
    return item;
  };

  const saveContent = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const item = await actions.update(id, { content: draft }, { silent: true });
      if (item) { toast.success(`Saved v${item.version}`); setEditing(false); await load(); }
    } finally { setSaving(false); }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && editing) { e.preventDefault(); void saveContent(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft]);

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>;
  if (!detail) return <div className="space-y-3 p-5"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-40" /><Skeleton className="h-24" /></div>;
  const item = detail.item;
  const isText = item.type === "note" || item.type === "clause";
  const system = item.type === "folder" && isSystemFolder(item.id);
  const editorHref = item.officeDocId && item.officeKind ? `/office/${item.officeKind}/${item.officeDocId}` : null;

  return (
    <>
      <SheetHeader className="pr-10">
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <button onClick={() => { openPreview(null); openFolder(null); }} className="hover:text-foreground cursor-pointer">Library</button>
          {item.path.map((p) => (<React.Fragment key={p.id}><ChevronRight className="size-3" /><button onClick={() => { openPreview(null); openFolder(p.id); }} className="truncate hover:text-foreground cursor-pointer">{p.name}</button></React.Fragment>))}
        </div>
        <div className="flex items-start gap-3">
          <TypeGlyph type={item.type} />
          <div className="min-w-0 flex-1">
            {renaming ? (
              <form onSubmit={async (e) => { e.preventDefault(); setRenaming(false); if (nameDraft.trim() && nameDraft !== item.name) await update({ name: nameDraft.trim() }, false); }} className="flex items-center gap-1.5">
                <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }} className="h-8 text-sm" />
                <Button type="submit" size="sm">Save</Button>
              </form>
            ) : (
              <SheetTitle className="flex items-center gap-2 leading-snug">
                <span className="line-clamp-2">{item.name}</span>
                {!system && <Tip label="Rename"><Button variant="ghost" size="icon-xs" onClick={() => setRenaming(true)} aria-label="Rename"><Pencil className="size-3.5" /></Button></Tip>}
              </SheetTitle>
            )}
            <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span>{item.officeKind ? OFFICE_KIND_LABEL[item.officeKind] : TYPE_LABEL[item.type]}</span>
              {item.matterShortName && <><span>·</span><span>{item.matterShortName}</span></>}
              {item.ownerName && <><span>·</span><span className="inline-flex items-center gap-1"><PersonAvatar name={item.ownerName} size="xs" />{item.ownerName}</span></>}
              <span>·</span><span>updated <RelativeTime value={item.updatedAt} /></span>
              {item.version && <><span>·</span><span>v{item.contentVersion ?? item.version}</span></>}
            </SheetDescription>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {editorHref && <Button size="sm" asChild><Link href={editorHref}><ExternalLink className="size-3.5" /> Open in editor</Link></Button>}
          {item.type === "template" && item.url && <Button size="sm" asChild><Link href={item.url}><LayoutTemplate className="size-3.5" /> Use template</Link></Button>}
          {item.type === "link" && item.url && <Button size="sm" asChild><a href={item.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /> {item.url.startsWith("/api/blobs/") ? "Open file" : "Open link"}</a></Button>}
          {item.type === "folder" && <Button size="sm" onClick={() => { openPreview(null); openFolder(item.id); }}><FolderOpen className="size-3.5" /> Open folder</Button>}
          {isText && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit</Button>}
          <Tip label={item.starred ? "Unstar" : "Star"}><Button variant="outline" size="icon-sm" onClick={() => update({ starred: !item.starred })} aria-label="Star"><Star className={cn("size-4", item.starred && "fill-current text-warning")} /></Button></Tip>
          {!system && <Tip label="Move to…"><Button variant="outline" size="icon-sm" onClick={() => openDialog({ kind: "move", ids: [item.id] })} aria-label="Move"><FolderInput className="size-4" /></Button></Tip>}
          <Tip label="Duplicate"><Button variant="outline" size="icon-sm" onClick={() => actions.duplicate(item.id)} aria-label="Duplicate"><Copy className="size-4" /></Button></Tip>
          {item.type !== "folder" && <Tip label="Download"><Button variant="outline" size="icon-sm" onClick={() => actions.download(item)} aria-label="Download"><Download className="size-4" /></Button></Tip>}
          {!system && <Tip label="Delete"><Button variant="outline" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => openDialog({ kind: "delete", ids: [item.id] })} aria-label="Delete"><Trash2 className="size-4" /></Button></Tip>}
        </div>
      </SheetHeader>

      <SheetBody className="space-y-5">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b text-xs">
          {([["content", item.type === "folder" ? "Contents" : "Content", Eye], ["activity", "Activity", Activity], ["versions", "Versions", History]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 -mb-px transition-colors cursor-pointer", tab === k ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <Icon className="size-3.5" /> {label}{k === "versions" && detail.versions.length ? ` (${detail.versions.length})` : ""}{k === "activity" && detail.activity.length ? ` (${detail.activity.length})` : ""}
            </button>
          ))}
        </div>

        {tab === "content" && (
          <>
            {item.type === "clause" && !editing && <ClausePanel item={item} standard={detail.standard} />}
            {isText && (editing ? (
              <div className="space-y-2">
                <div className="grid gap-2 lg:grid-cols-2">
                  <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[360px] font-mono text-xs leading-relaxed" spellCheck={false} />
                  <div className="max-h-[360px] overflow-y-auto rounded-md border p-3 scrollbar-thin"><Markdown compact>{draft || "*Nothing to preview*"}</Markdown></div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={saveContent} disabled={saving || draft === (item.content ?? "")}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save as v{(item.version ?? 1) + 1}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(item.content ?? ""); }}>Cancel</Button>
                  <span className="ml-auto text-[11px] text-muted-foreground">Markdown · ⌘S to save</span>
                </div>
              </div>
            ) : item.type === "note" ? (
              <div className="rounded-md border bg-card px-5 py-4"><Markdown className="reading-serif text-[14px] leading-[1.65] [&_p]:my-2">{item.content || "*Empty note*"}</Markdown></div>
            ) : null)}

            {item.officeDocId && detail.office && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Words" value={detail.office.words.toLocaleString()} />
                  <Stat label="Version" value={`v${detail.office.contentVersion}`} hint={`${detail.office.versionCount} saved`} />
                  <Stat label="Open comments" value={String(detail.office.commentCount)} />
                  <Stat label="Updated" value={formatDateTime(detail.office.updatedAt)} />
                </div>
                <div className="rounded-md border">
                  <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium"><FileText className="size-3.5" /> Text preview</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 py-3 font-serif text-[14px] leading-[1.65] scrollbar-thin">{detail.office.text || "This document has no text yet."}</pre>
                </div>
              </div>
            )}

            {item.type === "link" && (
              <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
                <div className="break-all font-mono text-xs text-primary">{item.url}</div>
                {item.description && <p className="text-muted-foreground">{item.description}</p>}
              </div>
            )}

            {item.type === "template" && (
              <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
                <p>{item.description}</p>
                <p className="text-xs text-muted-foreground">Opens a new {item.tags?.[0] === "sheet" ? "workbook" : item.tags?.[0] === "slides" ? "deck" : item.tags?.[0] === "pdf" ? "PDF" : "document"} pre-filled with this template{item.templateId ? ` (${item.templateId})` : ""} for the selected matter.</p>
              </div>
            )}

            {item.type === "folder" && (
              <div className="rounded-md border">
                {item.description && <p className="border-b px-3 py-2 text-xs text-muted-foreground">{item.description}</p>}
                {detail.children?.length ? (
                  <ul className="divide-y">
                    {detail.children.map((c) => (
                      <li key={c.id}>
                        <button onClick={() => (c.type === "folder" ? (openPreview(null), openFolder(c.id)) : c.officeDocId || c.type === "link" || c.type === "template" ? openItem(c) : openPreview(c.id))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/50 cursor-pointer">
                          <TypeIcon type={c.type} /><span className="flex-1 truncate">{c.name}</span><RelativeTime value={c.updatedAt} className="text-[11px] text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-3 py-4 text-center text-xs text-muted-foreground">Empty folder</p>}
              </div>
            )}

            {!editing && item.type !== "folder" && <AiSummary id={item.id} aiConfigured={aiConfigured} />}

            {!editing && <Metadata item={item} matters={matters} onUpdate={update} />}
          </>
        )}

        {tab === "activity" && (
          detail.activity.length ? (
            <ul className="space-y-2">
              {detail.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-xs">
                  <PersonAvatar name={a.actorName} size="xs" className="mt-0.5" />
                  <div className="min-w-0 flex-1"><span className="font-medium">{a.actorName}</span> <span className="text-muted-foreground">{a.action}</span>{a.detail && <span className="text-muted-foreground"> · {a.detail}</span>}<div className="text-[10.5px] text-muted-foreground"><RelativeTime value={a.at} /></div></div>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
        )}

        {tab === "versions" && (
          detail.versions.length ? (
            <ul className="divide-y rounded-md border">
              {detail.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <Badge variant={v.version === item.version ? "default" : "muted"}>v{v.version}</Badge>
                  <div className="min-w-0 flex-1"><div className="truncate">{v.summary ?? "Saved"}</div><div className="text-[10.5px] text-muted-foreground">{v.authorName} · {formatDateTime(v.at)}</div></div>
                  {v.version !== item.version && <Button size="xs" variant="outline" onClick={async () => { const r = await update({ restoreVersion: v.version }, false); if (r) await load(); }}>Restore</Button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">{isText ? "No earlier versions." : item.officeDocId ? "Office document versions are managed in the editor (History)." : "This item type is not versioned."}</p>
        )}
      </SheetBody>
      {editorHref && <div className="border-t px-5 py-2 text-[11px] text-muted-foreground">Tip: the editor&apos;s Draft / Review / Ask agent can cite this document&apos;s matter context automatically. <button onClick={() => router.push(editorHref)} className="text-primary hover:underline cursor-pointer">Open now</button></div>}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-md border bg-card px-2.5 py-2"><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5 text-sm font-semibold tabular">{value}</div>{hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}</div>;
}

function AiSummary({ id, aiConfigured }: { id: string; aiConfigured: boolean }) {
  const [busy, setBusy] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [noKey, setNoKey] = React.useState(!aiConfigured);
  const run = async () => {
    setBusy(true);
    try { const r = await api<{ summary: string; cached: boolean }>("/api/library/ai", { method: "POST", json: { action: "summarize", id } }); setSummary(r.summary); setNoKey(false); if (r.cached) toast.info("Showing the cached summary"); }
    catch (e) { if (isNoKeyError(e)) setNoKey(true); else toast.error("Summary failed", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-lg border">
      <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Sparkles className="size-4 text-primary" /><div className="text-sm font-medium">AI summary</div>
        <div className="flex-1" />
        <Button size="xs" variant="secondary" onClick={run} disabled={busy}>{busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} {summary ? "Regenerate" : "Summarize this item"}</Button>
      </header>
      <div className="px-3 py-2 text-sm">
        {summary ? <Markdown compact>{summary}</Markdown> : noKey ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground"><KeyRound className="mt-0.5 size-3.5 shrink-0 text-warning" /><span>OpenAI key required. Add <code className="font-mono">OPENAI_API_KEY</code> in <Link href="/settings#ai" className="text-primary underline">Settings</Link> to summarize, auto-tag and ask the library.</span></div>
        ) : <p className="text-xs text-muted-foreground">Get a 5-bullet brief: what it is, key dates and authorities, when to use it, and what to watch out for.</p>}
      </div>
    </section>
  );
}

function Metadata({ item, matters, onUpdate }: { item: LibraryItemView; matters: { id: string; shortName: string }[]; onUpdate: (patch: Parameters<ReturnType<typeof useLibrary>["actions"]["update"]>[1], silent?: boolean) => Promise<unknown> }) {
  const [tagDraft, setTagDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState(item.description ?? "");
  React.useEffect(() => setDescDraft(item.description ?? ""), [item.description]);
  const tags = item.tags ?? [];
  const addTag = async () => { const t = tagDraft.trim(); if (!t) return; setTagDraft(""); await onUpdate({ tags: [...tags, t] }); };
  const share = (item.sharedWith?.[0] ?? "firm") as NonNullable<LibraryItem["sharedWith"]>[number];
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="text-sm font-medium">Details</div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Type</dt><dd>{item.officeKind ? OFFICE_KIND_LABEL[item.officeKind] : TYPE_LABEL[item.type]}</dd>
        <dt className="text-muted-foreground">Matter</dt>
        <dd>
          <Select value={item.matterId ?? "__none__"} onValueChange={(v) => onUpdate({ matterId: v === "__none__" ? null : v })}>
            <SelectTrigger size="sm" className="h-7 w-full max-w-[240px]"><SelectValue placeholder="No matter" /></SelectTrigger>
            <SelectContent><SelectItem value="__none__">No matter</SelectItem>{matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
          </Select>
        </dd>
        <dt className="text-muted-foreground">Practice area</dt>
        <dd>
          <Select value={item.practiceArea ?? "__none__"} onValueChange={(v) => onUpdate({ practiceArea: v === "__none__" ? null : (v as PracticeArea) })}>
            <SelectTrigger size="sm" className="h-7 w-full max-w-[240px]"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value="__none__">—</SelectItem>{PRACTICE_AREAS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </dd>
        <dt className="text-muted-foreground">Shared with</dt>
        <dd>
          <Select value={share} onValueChange={(v) => onUpdate({ sharedWith: [v as "firm" | "matter-team" | "private"] }, false)}>
            <SelectTrigger size="sm" className="h-7 w-full max-w-[240px]"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(SHARE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <Select value={item.status ?? "__none__"} onValueChange={(v) => onUpdate({ status: v === "__none__" ? undefined : (v as "draft" | "approved" | "archived") }, false)}>
            <SelectTrigger size="sm" className="h-7 w-full max-w-[240px]"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value="__none__">—</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent>
          </Select>
        </dd>
        <dt className="text-muted-foreground">Owner</dt><dd>{item.ownerName ?? "—"}</dd>
        <dt className="text-muted-foreground">Created</dt><dd>{formatDateTime(item.createdAt)}</dd>
        <dt className="text-muted-foreground">Updated</dt><dd>{formatDateTime(item.updatedAt)}</dd>
        <dt className="text-muted-foreground">Size</dt><dd>{item.size ? formatBytes(item.size) : "—"}</dd>
        <dt className="text-muted-foreground">Version</dt><dd>v{item.contentVersion ?? item.version ?? 1}</dd>
        <dt className="text-muted-foreground">Id</dt><dd className="font-mono text-[10.5px] text-muted-foreground">{item.id}</dd>
      </dl>
      <div>
        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Tag className="size-3" /> Tags</div>
        <div className="flex flex-wrap items-center gap-1">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">{t}<button onClick={() => onUpdate({ tags: tags.filter((x) => x !== t) })} className="rounded-full p-0.5 hover:bg-foreground/10 cursor-pointer" aria-label={`Remove tag ${t}`}><X className="size-3" /></button></Badge>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); void addTag(); }} className="flex items-center">
            <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add tag" className="h-6 w-24 rounded border bg-background px-1.5 text-[11px] outline-none focus:border-ring" />
            <button type="submit" className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Add tag"><Plus className="size-3.5" /></button>
          </form>
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><MessageSquare className="size-3" /> Description</div>
        <Textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} onBlur={() => { if (descDraft !== (item.description ?? "")) void onUpdate({ description: descDraft }); }} placeholder="Short description shown in cards and search" className="min-h-[56px] text-xs" />
      </div>
    </section>
  );
}
