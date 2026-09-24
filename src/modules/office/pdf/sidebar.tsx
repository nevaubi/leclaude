"use client";
/** Right sidebar: annotations, outline/bookmarks, search results, form fields and page comments. */
import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { Bookmark, Check, CheckCircle2, ChevronRight, Circle, CornerDownRight, Highlighter, Link2, List, ListTree, MessageSquare, PenLine, Pencil, RotateCcw, ScanSearch, Search, Send, Signature, Square, Stamp, StickyNote, Strikethrough, Trash2, Type, Underline, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OfficeComment } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconPanelTabs } from "@/modules/office/shared/office-chrome";
import { ANNOTATION_LABEL, activePages, boundsOf, sourceToDisplay, type AnnotationType, type PdfAnnotation, type PdfFormField, type PdfOutlineItem } from "./model";
import { usePdfStore, type SidebarTab } from "./store";

export const ANN_ICON: Record<AnnotationType, React.ComponentType<{ className?: string }>> = { highlight: Highlighter, underline: Underline, strikeout: Strikethrough, note: StickyNote, text: Type, rect: Square, ellipse: Circle, freehand: PenLine, stamp: Stamp, redaction: ScanSearch, link: Link2, signature: Signature };

const TABS: { id: SidebarTab; label: string; icon: LucideIcon }[] = [
  { id: "annotations", label: "Annotations", icon: Highlighter },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "search", label: "Search", icon: Search },
  { id: "forms", label: "Forms", icon: List },
  { id: "comments", label: "Comments", icon: MessageSquare },
];

export function commentPage(anchor: string): number | null { const m = anchor.match(/^page:(\d+)/); return m ? Number(m[1]) : null; }

export interface PdfSidebarProps {
  tab: SidebarTab;
  onTabChange: (t: SidebarTab | null) => void;
  comments: OfficeComment[];
  onAddComment: (page: number, body: string) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onResolveComment: (id: string, resolved: boolean) => Promise<void>;
  onDeleteComment: (id: string) => Promise<void>;
  onOpenAnnotation: (a: PdfAnnotation) => void;
  onRedactSearch: () => void;
  onHighlightSearch: () => void;
  counts: { annotations: number; comments: number; hits: number; fields: number };
}

export function PdfSidebar(props: PdfSidebarProps) {
  const { tab, onTabChange, counts } = props;
  return (
    <div className="flex h-full w-[288px] shrink-0 flex-col border-l bg-background" aria-label="PDF sidebar">
      <IconPanelTabs tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, count: t.id === "annotations" ? counts.annotations : t.id === "comments" ? counts.comments : t.id === "search" ? counts.hits : t.id === "forms" ? counts.fields : 0 }))} value={tab} onChange={(t) => onTabChange(t)} onClose={() => onTabChange(null)} />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {tab === "annotations" && <AnnotationsTab onOpen={props.onOpenAnnotation} />}
        {tab === "outline" && <OutlineTab />}
        {tab === "search" && <SearchTab onRedact={props.onRedactSearch} onHighlight={props.onHighlightSearch} />}
        {tab === "forms" && <FormsTab />}
        {tab === "comments" && <CommentsTab comments={props.comments} onAdd={props.onAddComment} onReply={props.onReply} onResolve={props.onResolveComment} onDelete={props.onDeleteComment} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AnnotationsTab({ onOpen }: { onOpen: (a: PdfAnnotation) => void }) {
  const model = usePdfStore((s) => s.model);
  const selectedId = usePdfStore((s) => s.selectedAnnotationId);
  const currentPage = usePdfStore((s) => s.currentPage);
  const store = usePdfStore;
  const [pageFilter, setPageFilter] = React.useState<"all" | "current">("all");
  const [type, setType] = React.useState<string>("all");
  const [author, setAuthor] = React.useState<string>("all");
  const [showResolved, setShowResolved] = React.useState(false);
  const authors = React.useMemo(() => Array.from(new Set(model.annotations.map((a) => a.author))).sort(), [model.annotations]);
  const list = React.useMemo(() => model.annotations
    .filter((a) => (pageFilter === "all" || sourceToDisplay(model, a.page) === currentPage) && (type === "all" || a.type === type) && (author === "all" || a.author === author) && (showResolved || !a.resolved))
    .map((a) => ({ a, display: sourceToDisplay(model, a.page) }))
    .sort((x, y) => (x.display ?? 9999) - (y.display ?? 9999) || (boundsOf(y.a.rects)?.y ?? 0) - (boundsOf(x.a.rects)?.y ?? 0)), [model, pageFilter, type, author, showResolved, currentPage]);
  const jump = (a: PdfAnnotation) => { const d = sourceToDisplay(model, a.page); if (!d) return; store.getState().scrollTo(d, boundsOf(a.rects) ?? undefined); store.getState().select(a.id); store.getState().flashAnnotation(a.id); };
  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-background p-2">
        <Select value={pageFilter} onValueChange={(v) => setPageFilter(v as "all" | "current")}><SelectTrigger className="h-7 w-[92px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All pages</SelectItem><SelectItem value="current">This page</SelectItem></SelectContent></Select>
        <Select value={type} onValueChange={setType}><SelectTrigger className="h-7 w-[104px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{(Object.keys(ANNOTATION_LABEL) as AnnotationType[]).map((t) => <SelectItem key={t} value={t}>{ANNOTATION_LABEL[t]}</SelectItem>)}</SelectContent></Select>
        <Select value={author} onValueChange={setAuthor}><SelectTrigger className="h-7 w-[84px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Anyone</SelectItem>{authors.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground"><Checkbox checked={showResolved} onCheckedChange={(v) => setShowResolved(Boolean(v))} /> Resolved</label>
      </div>
      {list.length === 0 ? <EmptyState icon={Highlighter} title="No annotations" description="Select text and pick a markup tool, or use the note, shape, stamp and redaction tools." className="m-3 p-6" /> : (
        <ul className="divide-y">
          {list.map(({ a, display }) => { const Icon = ANN_ICON[a.type]; return (
            <li key={a.id} className={cn("group cursor-pointer px-3 py-2 text-xs transition-colors hover:bg-accent/60", selectedId === a.id && "bg-accent", a.resolved && "opacity-60")} onClick={() => jump(a)}>
              <div className="flex items-center gap-1.5">
                <span className="flex size-4 items-center justify-center rounded-sm" style={{ background: a.type === "redaction" ? "#111" : a.color, opacity: a.type === "highlight" ? 0.75 : 1 }}><Icon className={cn("size-2.5", a.type === "redaction" || a.color === "#111111" ? "text-white" : "text-black/70")} /></span>
                <span className="font-medium">{ANNOTATION_LABEL[a.type]}</span>
                <span className="text-muted-foreground tabular">{display ? `p. ${display}` : "deleted page"}</span>
                {a.reason && <Badge variant="destructive" className="py-0 text-[9px]">{a.reason}</Badge>}
                {a.applied && <Badge variant="muted" className="py-0 text-[9px]">applied</Badge>}
                <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Tip label="Edit"><button className="rounded p-0.5 hover:bg-background cursor-pointer" onClick={(e) => { e.stopPropagation(); onOpen(a); }} aria-label="Edit annotation"><Pencil className="size-3" /></button></Tip>
                  <Tip label={a.resolved ? "Reopen" : "Resolve"}><button className="rounded p-0.5 hover:bg-background cursor-pointer" onClick={(e) => { e.stopPropagation(); store.getState().applyOp({ op: "resolve_annotations", ids: [a.id], resolved: !a.resolved }); }} aria-label="Resolve"><CheckCircle2 className={cn("size-3", a.resolved && "text-success")} /></button></Tip>
                  <Tip label="Delete"><button className="rounded p-0.5 text-destructive hover:bg-background cursor-pointer" onClick={(e) => { e.stopPropagation(); store.getState().removeAnnotations([a.id]); }} aria-label="Delete annotation"><Trash2 className="size-3" /></button></Tip>
                </div>
              </div>
              {(a.text || a.quote) && <div className="mt-1 line-clamp-3 text-[12px] leading-snug">{a.text ? a.text : <span className="text-muted-foreground">“{a.quote}”</span>}</div>}
              {a.text && a.quote && <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">“{a.quote}”</div>}
              <div className="mt-1 text-[10px] text-muted-foreground">{a.author} · {safeAgo(a.createdAt)}</div>
            </li>
          ); })}
        </ul>
      )}
    </div>
  );
}

function safeAgo(iso: string) { try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return ""; } }

// ---------------------------------------------------------------------------
function OutlineTab() {
  const model = usePdfStore((s) => s.model);
  const currentPage = usePdfStore((s) => s.currentPage);
  const store = usePdfStore;
  const [title, setTitle] = React.useState("");
  const outline = model.meta.outline ?? [];
  const bookmarks = model.bookmarks ?? [];
  const add = () => { const p = activePages(model)[currentPage - 1]; if (!p) return; const t = title.trim() || `Page ${currentPage}`; store.getState().applyOp({ op: "add_bookmark", bookmark: { id: `bm_${Math.random().toString(36).slice(2, 8)}`, page: p.index, title: t } }); setTitle(""); };
  const renderItems = (items: PdfOutlineItem[], depth = 0) => items.map((it, i) => (
    <li key={`${depth}-${i}`}>
      <button onClick={() => it.page && store.getState().scrollTo(sourceToDisplay(model, it.page) ?? it.page)} className={cn("flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-accent cursor-pointer", !it.page && "opacity-60")} style={{ paddingLeft: 8 + depth * 12 }}>
        {it.children?.length ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : <span className="w-3" />}
        <span className="flex-1 truncate">{it.title}</span>
        {it.page && <span className="text-[10px] tabular text-muted-foreground">{sourceToDisplay(model, it.page) ?? "—"}</span>}
      </button>
      {it.children?.length ? <ul>{renderItems(it.children, depth + 1)}</ul> : null}
    </li>
  ));
  return (
    <div className="p-2">
      <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Document outline</div>
      {outline.length ? <ul className="mb-3">{renderItems(outline)}</ul> : <div className="mb-3 px-2 py-2 text-xs text-muted-foreground">This PDF has no outline.</div>}
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"><span>Bookmarks</span><span className="tabular">{bookmarks.length}</span></div>
      <div className="mb-2 flex gap-1">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={`Bookmark page ${currentPage}…`} className="h-7 text-xs" />
        <Button size="sm" className="h-7" onClick={add}><Bookmark className="size-3.5" /> Add</Button>
      </div>
      {bookmarks.length === 0 ? <div className="px-2 py-1 text-xs text-muted-foreground">Bookmarks are written into the exported PDF&apos;s outline.</div> : (
        <ul className="space-y-0.5">
          {bookmarks.map((b) => (
            <li key={b.id} className="group flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent" style={{ paddingLeft: 8 + ((b.level ?? 1) - 1) * 12 }}>
              <button className="flex flex-1 items-center gap-1.5 truncate text-left cursor-pointer" onClick={() => store.getState().scrollTo(sourceToDisplay(model, b.page) ?? 1)}><Bookmark className="size-3 text-primary" /><span className="truncate">{b.title}</span><span className="ml-auto text-[10px] tabular text-muted-foreground">{sourceToDisplay(model, b.page) ?? "—"}</span></button>
              <button className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 cursor-pointer" onClick={() => store.getState().applyOp({ op: "remove_bookmark", id: b.id })} aria-label="Remove bookmark"><X className="size-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function SearchTab({ onRedact, onHighlight }: { onRedact: () => void; onHighlight: () => void }) {
  const search = usePdfStore((s) => s.search);
  const store = usePdfStore;
  const groups = React.useMemo(() => { const m = new Map<number, { i: number; snippet: string; text: string }[]>(); search.hits.forEach((h, i) => { const l = m.get(h.display) ?? []; l.push({ i, snippet: h.match.snippet, text: h.match.text }); m.set(h.display, l); }); return Array.from(m.entries()); }, [search.hits]);
  if (!search.query) return <EmptyState icon={Search} title="Search the document" description="Type in the search box (⌘F). Hits are highlighted on the pages; use Enter / Shift+Enter to step through them." className="m-3 p-6" />;
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background px-3 py-2 text-xs">
        <span className="font-medium tabular">{search.hits.length} hit{search.hits.length === 1 ? "" : "s"}</span><span className="truncate text-muted-foreground">for “{search.query}”</span>
        <div className="ml-auto flex gap-1">
          <Tip label="Highlight all hits"><Button size="sm" variant="outline" className="h-6 px-1.5" onClick={onHighlight} disabled={!search.hits.length}><Highlighter className="size-3" /></Button></Tip>
          <Tip label="Redact all hits"><Button size="sm" variant="outline" className="h-6 px-1.5" onClick={onRedact} disabled={!search.hits.length}><ScanSearch className="size-3" /></Button></Tip>
        </div>
      </div>
      {search.running && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
      {groups.map(([page, hits]) => (
        <div key={page}>
          <div className="sticky top-[37px] bg-muted/60 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">Page {page} · {hits.length}</div>
          <ul>
            {hits.map((h) => (
              <li key={h.i}><button onClick={() => { store.getState().setSearch({ index: h.i }); const hit = store.getState().search.hits[h.i]; store.getState().scrollTo(hit.display, boundsOf(hit.match.rects) ?? undefined); }} className={cn("w-full px-3 py-1.5 text-left text-[12px] leading-snug hover:bg-accent cursor-pointer", h.i === search.index && "bg-accent")}>{renderSnippet(h.snippet)}</button></li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function renderSnippet(s: string) {
  const m = s.match(/^(.*)«(.*)»(.*)$/s);
  if (!m) return s;
  return <>{m[1]}<mark className="rounded-sm bg-warning/60 px-0.5 text-foreground">{m[2]}</mark>{m[3]}</>;
}

// ---------------------------------------------------------------------------
function FormsTab() {
  const model = usePdfStore((s) => s.model);
  const store = usePdfStore;
  const fields = model.meta.fields ?? [];
  const values = model.formValues ?? {};
  if (!fields.length) return <EmptyState icon={List} title="No form fields" description="This PDF has no AcroForm fields. Use the text box tool to type on the page instead." className="m-3 p-6" />;
  const set = (name: string, value: string | boolean) => store.getState().applyOp({ op: "fill_form", values: { [name]: value } });
  const valueOf = (f: PdfFormField) => (values[f.name] !== undefined ? values[f.name] : f.value);
  const byPage = new Map<number | undefined, PdfFormField[]>();
  for (const f of fields) { const l = byPage.get(f.page) ?? []; l.push(f); byPage.set(f.page, l); }
  const changed = Object.keys(values).length;
  return (
    <div className="p-2">
      <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"><span>{fields.length} field{fields.length === 1 ? "" : "s"}{changed ? ` · ${changed} edited` : ""}</span>{changed > 0 && <button className="flex items-center gap-1 normal-case tracking-normal hover:text-foreground cursor-pointer" onClick={() => store.getState().setModel({ ...model, formValues: undefined })}><RotateCcw className="size-3" /> Reset</button>}</div>
      {Array.from(byPage.entries()).map(([page, list]) => (
        <div key={page ?? "x"} className="mb-3">
          <button className="mb-1 px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => page && store.getState().scrollTo(sourceToDisplay(model, page) ?? 1, list[0]?.rect)}>Page {page ? sourceToDisplay(model, page) ?? "?" : "?"}</button>
          <div className="space-y-2">
            {list.map((f) => (
              <div key={f.name} className="rounded-md border p-2">
                <div className="mb-1 flex items-center gap-1 text-[11px]"><span className="truncate font-medium" title={f.name}>{f.name}</span><Badge variant="muted" className="ml-auto py-0 text-[9px]">{f.type}</Badge>{values[f.name] !== undefined && <span className="size-1.5 rounded-full bg-warning" />}</div>
                {f.type === "checkbox" && <label className="flex items-center gap-2 text-xs"><Checkbox checked={Boolean(valueOf(f))} onCheckedChange={(v) => set(f.name, Boolean(v))} disabled={f.readOnly} /> {Boolean(valueOf(f)) ? "Checked" : "Unchecked"}</label>}
                {(f.type === "dropdown" || f.type === "radio" || f.type === "option") && <Select value={String(valueOf(f) ?? "")} onValueChange={(v) => set(f.name, v)} disabled={f.readOnly}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Choose…" /></SelectTrigger><SelectContent>{(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>}
                {f.type === "text" && <Input value={String(valueOf(f) ?? "")} onChange={(e) => set(f.name, e.target.value)} className="h-7 text-xs" disabled={f.readOnly} />}
                {(f.type === "button" || f.type === "signature") && <div className="text-[11px] text-muted-foreground">{f.type === "signature" ? "Signature field — use the signature tool to place an image." : "Button"}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="px-1 text-[11px] text-muted-foreground">Values are written into the fields on export; choose “Flatten forms” in the download menu to make them static.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CommentsTab({ comments, onAdd, onReply, onResolve, onDelete }: { comments: OfficeComment[]; onAdd: (page: number, body: string) => Promise<void>; onReply: (id: string, body: string) => Promise<void>; onResolve: (id: string, resolved: boolean) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const currentPage = usePdfStore((s) => s.currentPage);
  const store = usePdfStore;
  const [body, setBody] = React.useState("");
  const [showResolved, setShowResolved] = React.useState(false);
  const [replyFor, setReplyFor] = React.useState<string | null>(null);
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const list = comments.filter((c) => showResolved || !c.resolved).sort((a, b) => (commentPage(a.anchor) ?? 0) - (commentPage(b.anchor) ?? 0) || a.createdAt.localeCompare(b.createdAt));
  const submit = async () => { if (!body.trim()) return; setBusy(true); try { await onAdd(currentPage, body.trim()); setBody(""); } finally { setBusy(false); } };
  return (
    <div>
      <div className="border-b p-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Comment on page ${currentPage}…`} className="min-h-[60px] text-xs" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit(); }} />
        <div className="mt-1.5 flex items-center justify-between">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground"><Checkbox checked={showResolved} onCheckedChange={(v) => setShowResolved(Boolean(v))} /> Show resolved</label>
          <Button size="sm" className="h-7" onClick={() => void submit()} disabled={busy || !body.trim()}><Send className="size-3.5" /> Comment</Button>
        </div>
      </div>
      {list.length === 0 ? <EmptyState icon={MessageSquare} title="No comments" description="Comments are anchored to pages and shared with the team." className="m-3 p-6" /> : (
        <ul className="divide-y">
          {list.map((c) => { const page = commentPage(c.anchor); return (
            <li key={c.id} className={cn("px-3 py-2 text-xs", c.resolved && "opacity-60")}>
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{c.authorName}</span>
                {c.source === "agent" && <Badge variant="info" className="py-0 text-[9px]">assistant</Badge>}
                {page && <button className="text-[10px] tabular text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => store.getState().scrollTo(page)}>p. {page}</button>}
                <span className="ml-auto text-[10px] text-muted-foreground">{safeAgo(c.createdAt)}</span>
              </div>
              {c.quote && <div className="mt-1 border-l-2 border-warning/60 pl-2 text-[11px] italic text-muted-foreground line-clamp-2">“{c.quote}”</div>}
              <div className="mt-1 whitespace-pre-wrap text-[12px] leading-snug">{c.body}</div>
              {c.replies?.map((r) => <div key={r.id} className="mt-1.5 flex gap-1.5 pl-2 text-[11px]"><CornerDownRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" /><div><span className="font-medium">{r.authorName}</span> <span className="text-muted-foreground">· {safeAgo(r.createdAt)}</span><div className="whitespace-pre-wrap">{r.body}</div></div></div>)}
              {replyFor === c.id ? (
                <div className="mt-1.5 flex gap-1"><Input autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" className="h-7 text-xs" onKeyDown={async (e) => { if (e.key === "Enter" && reply.trim()) { await onReply(c.id, reply.trim()); setReply(""); setReplyFor(null); } if (e.key === "Escape") setReplyFor(null); }} /><Button size="sm" className="h-7" onClick={async () => { if (reply.trim()) { await onReply(c.id, reply.trim()); setReply(""); setReplyFor(null); } }}><Check className="size-3.5" /></Button></div>
              ) : (
                <div className="mt-1.5 flex gap-2 text-[11px] text-muted-foreground">
                  <button className="hover:text-foreground cursor-pointer" onClick={() => setReplyFor(c.id)}>Reply</button>
                  <button className="hover:text-foreground cursor-pointer" onClick={() => void onResolve(c.id, !c.resolved)}>{c.resolved ? "Reopen" : "Resolve"}</button>
                  <button className="hover:text-destructive cursor-pointer" onClick={() => void onDelete(c.id)}>Delete</button>
                </div>
              )}
            </li>
          ); })}
        </ul>
      )}
    </div>
  );
}
