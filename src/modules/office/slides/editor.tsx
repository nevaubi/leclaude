"use client";
import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Briefcase, ChevronDown, ChevronsDown, ChevronsUp, Download, FileImage, FileText, History, Keyboard, Loader2, MessageSquare, Minus, Play, Plus, Presentation, Printer, Save, Sparkles, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Matter, OfficeComment } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TopbarSlot } from "@/components/shell/app-shell";
import { OfficeAgentPanel, saveStateLabel, useOfficeDoc, type ApplyResult, type EditProposal, type OfficeScope } from "@/modules/office/shared";
import "./slides.css";
import { SlideCanvas } from "./canvas";
import { downloadOutline, downloadPptx, safeFilename, slideNodeToPng, downloadBlob } from "./client-utils";
import { CommentsPanel, commentSlideId } from "./comments-panel";
import { ChartSheet, ImageDialog, PromptDialog, ShortcutsDialog, TableSheet, type PromptRequest } from "./dialogs";
import { buildSlide } from "./layouts";
import { LAYOUT_LABEL, SLIDE_H, SLIDE_W, emptyDeck, estimateTextFit, normalizeDeck, slidePlainText, slideTitle, type DeckContent, type DeckElement } from "./model";
import { Presenter } from "./presenter";
import { SlideView } from "./slide-view";
import { buildSnapshot } from "./snapshot";
import { currentSlideOf, useSlidesStore } from "./store";
import type { TextEditorHandle } from "./text-editor";
import { ThumbnailRail } from "./thumbnail-rail";
import { SlidesToolbar } from "./toolbar";
import { VersionsDialog } from "./versions-dialog";

const SUGGESTIONS = {
  draft: ["Build a 10-slide case strategy deck for the AFFF bellwether", "Turn these notes into slides", "Tighten every slide to ≤5 bullets", "Add a timeline slide from the chronology", "Apply the Client Light theme and add speaker notes", "Add a key documents slide with Bates cites"],
  review: ["Check consistency, hierarchy and overflow", "Is the narrative arc clear? Flag gaps", "Check every cite and Bates number", "Is this deck ready for a client audience?"],
  ask: ["What's the narrative arc?", "Summarize the deck in three sentences", "Which slides mention the TSCA §8(e) timeline?"],
};

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];

function blankDeck(): DeckContent {
  const deck = emptyDeck();
  deck.slides = [buildSlide("title", { title: "Untitled deck", subtitle: "", date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) }, deck.theme)];
  return deck;
}

export interface SlidesEditorPageProps { id: string; templateId?: string | null; matterId?: string | null; matters: Matter[] }

export function SlidesEditorPage({ id, templateId, matterId, matters }: SlidesEditorPageProps) {
  const office = useOfficeDoc<DeckContent>({ id, kind: "slides", emptyContent: blankDeck, templateId: templateId ?? null, matterId: matterId ?? null, autosaveMs: 1500 });
  const { doc, loading, error } = office;
  const officeRef = React.useRef(office);
  officeRef.current = office;
  const store = useSlidesStore;
  const deck = useSlidesStore((s) => s.deck);
  const loaded = useSlidesStore((s) => s.loaded);
  const currentSlideId = useSlidesStore((s) => s.currentSlideId);
  const selectedIds = useSlidesStore((s) => s.selectedIds);
  const changeTick = useSlidesStore((s) => s.changeTick);
  const zoom = useSlidesStore((s) => s.zoom);
  const [ready, setReady] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [agentOpen, setAgentOpen] = React.useState(true);
  const [commentsOpen, setCommentsOpen] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(true);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [imageOpen, setImageOpen] = React.useState(false);
  const [dataEl, setDataEl] = React.useState<DeckElement | null>(null);
  const [presenting, setPresenting] = React.useState<number | null>(null);
  const [printing, setPrinting] = React.useState(false);
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [comments, setComments] = React.useState<OfficeComment[]>([]);
  const [prompt, setPrompt] = React.useState<PromptRequest | null>(null);
  const promptResolver = React.useRef<((v: string | null) => void) | null>(null);
  const textEditorRef = React.useRef<TextEditorHandle | null>(null);
  const slideNodeRef = React.useRef<HTMLDivElement | null>(null);
  const matter = React.useMemo(() => matters.find((m) => m.id === (doc?.matterId ?? matterId)) ?? null, [matters, doc?.matterId, matterId]);
  const slide = currentSlideOf({ deck, currentSlideId });
  const slideIndex = deck.slides.findIndex((s) => s.id === currentSlideId);

  const ask = React.useCallback((req: PromptRequest) => new Promise<string | null>((res) => { promptResolver.current = res; setPrompt(req); }), []);

  // ---- load ---------------------------------------------------------------------
  React.useEffect(() => {
    if (!doc || ready) return;
    store.getState().load(normalizeDeck(doc.content));
    setTitle(doc.title);
    setReady(true);
    if (doc.id !== "new") void office.comments.list().then(setComments).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ready]);
  React.useEffect(() => () => { useSlidesStore.setState({ loaded: false }); }, []);
  const docTitle = doc?.title;
  React.useEffect(() => { if (docTitle && document.activeElement?.getAttribute("data-title-input") !== "1") setTitle(docTitle); }, [docTitle]);

  // ---- autosave on every committed/transient change --------------------------------
  const lastTick = React.useRef(0);
  React.useEffect(() => {
    if (!ready || !loaded || changeTick === 0 || changeTick === lastTick.current) return;
    lastTick.current = changeTick;
    officeRef.current.markDirty(store.getState().deck);
  }, [changeTick, ready, loaded, store]);

  React.useEffect(() => { if (process.env.NODE_ENV !== "production") (window as unknown as { __leclaudeSlidesStore?: unknown }).__leclaudeSlidesStore = useSlidesStore; }, []);

  const saveNow = React.useCallback(async (version?: { summary?: string; label?: string; authorName?: string }) => {
    officeRef.current.contentRef.current = store.getState().deck;
    const r = await officeRef.current.save(version ? { version: { ...version, force: true } } : {});
    if (r && !version) toast.success("Saved", { duration: 1200 });
  }, [store]);
  const commitTitle = async () => { const t = title.trim() || "Untitled deck"; if (t !== doc?.title) await office.setTitle(t); };

  // ---- comments -------------------------------------------------------------------
  const refreshComments = React.useCallback(async () => { try { setComments(await officeRef.current.comments.list()); } catch { /* ignore */ } }, []);
  const commentCounts = React.useMemo(() => { const m: Record<string, number> = {}; for (const c of comments) { if (c.resolved) continue; const sid = commentSlideId(c.anchor); if (sid) m[sid] = (m[sid] ?? 0) + 1; } return m; }, [comments]);
  const addComment = React.useCallback(async (anchor: string, body: string) => { const c = await officeRef.current.comments.add({ anchor, body, source: "user" }); setComments((cs) => [...cs, c]); }, []);
  const quickComment = React.useCallback(async () => {
    const st = store.getState();
    if (!st.currentSlideId) return;
    const i = st.deck.slides.findIndex((s) => s.id === st.currentSlideId);
    const v = await ask({ title: `Comment on slide ${i + 1}`, placeholder: "Write a comment for the team…", multiline: true, confirm: "Comment" });
    if (!v) return;
    await addComment(`slide:${st.currentSlideId}`, v);
    setCommentsOpen(true);
  }, [ask, addComment, store]);

  // ---- exports --------------------------------------------------------------------
  const doExport = async (kind: "pptx" | "pdf" | "png" | "txt") => {
    if (!doc) return;
    const d = store.getState().deck;
    setExporting(kind);
    try {
      if (kind === "pptx") await downloadPptx({ docId: doc.id, content: d, title: doc.title });
      else if (kind === "txt") await downloadOutline({ docId: doc.id, content: d, title: doc.title });
      else if (kind === "png") { const node = slideNodeRef.current; if (!node) throw new Error("Slide not rendered"); const blob = await slideNodeToPng(node); downloadBlob(blob, `${safeFilename(doc.title)}-slide-${slideIndex + 1}.png`); }
      else { setPrinting(true); }
    } catch (e) { toast.error(`Export failed: ${(e as Error).message}`); } finally { if (kind !== "pdf") setExporting(null); }
  };
  React.useEffect(() => {
    if (!printing) return;
    const done = () => { setPrinting(false); setExporting(null); };
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => { window.print(); setTimeout(done, 1500); }, 400);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  // ---- agent ----------------------------------------------------------------------
  const scopes = React.useMemo<OfficeScope[]>(() => {
    const s: OfficeScope[] = [{ id: "document", label: "Whole deck", kind: "document" }];
    if (slide) s.push({ id: `slide:${slide.id}`, label: `Slide ${slideIndex + 1}`, kind: "slide", ref: slide.id, text: slidePlainText(slide).slice(0, 6000) });
    if (slide && selectedIds.length) { const text = slide.elements.filter((e) => selectedIds.includes(e.id) && e.type === "text").map((e) => e.text ?? "").join("\n"); if (text.trim()) s.push({ id: "selection", label: "Selection", kind: "selection", ref: selectedIds.join(","), text: text.slice(0, 6000) }); }
    return s;
  }, [slide, slideIndex, selectedIds]);
  const getSnapshot = React.useCallback(() => {
    const st = store.getState();
    return buildSnapshot(st.deck, { title: doc?.title ?? "Untitled deck", selection: { slideId: st.currentSlideId, elementIds: st.selectedIds }, comments: comments.filter((c) => !c.resolved).map((c) => ({ id: c.id, anchor: c.anchor, body: c.body, author: c.authorName, resolved: c.resolved })), matterId: doc?.matterId ?? null, templateId: doc?.templateId ?? null });
  }, [store, doc, comments]);
  const applyProposals = React.useCallback(async (proposals: EditProposal[]): Promise<ApplyResult> => store.getState().applyProposals(proposals), [store]);
  const onApplied = React.useCallback((summary: string) => { void saveNow({ summary, authorName: "Drafting assistant" }); }, [saveNow]);
  const onLocate = React.useCallback((target: string) => {
    const [slideId, elementId] = target.replace(/^slide:/, "").split("/");
    const st = store.getState();
    if (!st.deck.slides.some((s) => s.id === slideId)) { toast.error("That slide no longer exists"); return; }
    st.setCurrent(slideId);
    if (elementId) st.select([elementId]);
  }, [store]);

  // ---- element data editors -----------------------------------------------------------
  const onInsertImage = (src: string, alt: string, size: { w: number; h: number }) => {
    const maxW = 1136, maxH = 460;
    const r = Math.min(maxW / size.w, maxH / size.h, 1);
    const w = Math.round(size.w * r), h = Math.round(size.h * r);
    store.getState().addElement({ type: "image", src, alt, x: Math.round((SLIDE_W - w) / 2), y: Math.round(168 + (maxH - h) / 2), w, h, style: { fit: "contain", radius: 8 }, name: alt });
  };

  // ---- keyboard shortcuts ---------------------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "F5" || (mod && e.shiftKey && key === "p")) { e.preventDefault(); e.stopPropagation(); setPresenting(Math.max(0, store.getState().deck.slides.findIndex((s) => s.id === store.getState().currentSlideId))); return; }
      if (!mod) { if (e.key === "?" && !typing) { setShortcutsOpen(true); } return; }
      if (key === "s" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void saveNow(); return; }
      if (key === "/") { e.preventDefault(); e.stopPropagation(); setAgentOpen((v) => !v); return; }
      if (key === "p" && !e.shiftKey && !typing) { e.preventDefault(); e.stopPropagation(); void doExport("pdf"); return; }
      if (e.shiftKey && key === "n") { e.preventDefault(); e.stopPropagation(); store.getState().addSlide("bullets"); return; }
      if (e.shiftKey && key === "d" && !typing) { e.preventDefault(); e.stopPropagation(); const id = store.getState().currentSlideId; if (id) store.getState().duplicateSlide(id); return; }
      if (e.shiftKey && key === "h" && !typing) { e.preventDefault(); e.stopPropagation(); const id = store.getState().currentSlideId; if (id) store.getState().toggleHidden(id); return; }
      if (e.shiftKey && key === "c" && !typing) { e.preventDefault(); e.stopPropagation(); void quickComment(); return; }
      if (e.shiftKey && key === "m" && !typing) { e.preventDefault(); e.stopPropagation(); setCommentsOpen((v) => !v); return; }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveNow, quickComment]);

  const saveLabel = saveStateLabel(office.saveState, office.lastSavedAt);
  const overflowCount = slide ? slide.elements.filter((e) => e.type === "text" && e.text?.trim() && estimateTextFit(e, deck.theme).overflow).length : 0;
  const zoomPct = zoom === "fit" ? null : Math.round(zoom * 100);
  const setZoomStep = (dir: 1 | -1) => { const cur = zoom === "fit" ? 0.75 : zoom; const idx = ZOOMS.findIndex((z) => z >= cur - 0.001); const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (idx < 0 ? 3 : idx) + dir))]; store.getState().setZoom(next); };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <TopbarSlot><Link href="/library" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to Library</Link></TopbarSlot>
        <EmptyState icon={AlertTriangle} title={error} description="The deck may have been deleted, or the link is wrong." action={<Button asChild variant="outline"><Link href="/office?kind=slides">Open decks</Link></Button>} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopbarSlot>
        <Tip label="Back to Library" shortcut="G L"><Link href="/library" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Library</Link></Tip>
        <Badge variant="info" className="shrink-0 gap-1 font-mono"><Presentation className="size-3" /> PPTX</Badge>
        {matter ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="hidden max-w-[180px] shrink-0 items-center gap-1 truncate rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground lg:flex cursor-pointer"><Briefcase className="size-3" /><span className="truncate">{matter.shortName}</span><ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Matter</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={matter.id} onValueChange={(v) => void office.save({ matterId: v })}>{matters.map((mm) => <DropdownMenuRadioItem key={mm.id} value={mm.id}><span className="truncate">{mm.shortName} <span className="text-muted-foreground">· {mm.client}</span></span></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : ready ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="hidden shrink-0 items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground lg:flex cursor-pointer"><Briefcase className="size-3" /> Link matter</button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">{matters.map((mm) => <DropdownMenuItem key={mm.id} onClick={() => void office.save({ matterId: mm.id })}><span className="truncate">{mm.shortName} <span className="text-muted-foreground">· {mm.client}</span></span></DropdownMenuItem>)}</DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <input data-title-input="1" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void commitTitle()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} aria-label="Deck title" placeholder="Untitled deck" className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold outline-none transition-colors hover:border-border focus:border-ring focus:bg-background" />
        <span className={cn("hidden shrink-0 text-[11px] xl:inline", office.saveState === "error" ? "text-destructive" : office.saveState === "dirty" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>{saveLabel}</span>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="gap-1.5" disabled={!ready}>{exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download <ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => void doExport("pptx")}><Presentation /> PowerPoint (.pptx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport("pdf")}><Printer /> PDF (print, one slide per page) <span className="ml-auto text-[10px] text-muted-foreground">⌘P</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport("png")}><FileImage /> PNG of current slide</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void doExport("txt")}><FileText /> Outline with notes (.txt)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tip label="Save" shortcut="⌘S"><Button variant="ghost" size="sm" onClick={() => void saveNow()} disabled={office.saveState === "saving" || !ready}><Save className="size-4" /> Save</Button></Tip>
          <Tip label="Version history"><Button variant="ghost" size="sm" onClick={() => setVersionsOpen(true)} disabled={!ready}><History className="size-4" /> Versions</Button></Tip>
          <Tip label="Comments" shortcut="⌘⇧M"><Button variant={commentsOpen ? "secondary" : "ghost"} size="icon-sm" onClick={() => setCommentsOpen((v) => !v)} aria-pressed={commentsOpen} aria-label="Toggle comments" className="relative"><MessageSquare className="size-4" />{comments.filter((c) => !c.resolved).length > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] leading-3 text-primary-foreground tabular">{comments.filter((c) => !c.resolved).length}</span>}</Button></Tip>
          <Tip label="Present from current slide" shortcut="⌘⇧P"><Button variant="default" size="sm" onClick={() => setPresenting(Math.max(0, slideIndex))} disabled={!ready || deck.slides.length === 0}><Play className="size-4" /> Present</Button></Tip>
          <Tip label="Deck assistant" shortcut="⌘/"><Button variant={agentOpen ? "secondary" : "ghost"} size="icon-sm" onClick={() => setAgentOpen((v) => !v)} aria-pressed={agentOpen} aria-label="Toggle assistant"><Sparkles className={cn("size-4", agentOpen && "text-primary")} /></Button></Tip>
        </div>
      </TopbarSlot>

      {ready ? <SlidesToolbar textEditorRef={textEditorRef} onInsertImage={() => setImageOpen(true)} onEditData={(el) => setDataEl(el)} /> : <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">{[24, 24, 80, 90, 110, 24, 24, 24, 24].map((w, i) => <Skeleton key={i} className="h-6" style={{ width: w }} />)}</div>}

      <div className="flex min-h-0 flex-1">
        {ready ? <ThumbnailRail commentCounts={commentCounts} /> : (
          <div className="flex w-[232px] shrink-0 flex-col gap-2 border-r p-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex gap-2"><Skeleton className="h-4 w-5" /><Skeleton className="h-[95px] w-[168px]" /></div>)}</div>
        )}
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel minSize={480}>
            <div className="flex h-full min-h-0">
              <div className="flex min-w-0 flex-1 flex-col">
                {ready ? (
                  <SlideCanvas textEditorRef={textEditorRef} slideNodeRef={slideNodeRef} onOpenElementEditor={(el) => { if (el.type === "table" || el.type === "chart") setDataEl(el); else if (el.type === "image") setImageOpen(true); }} />
                ) : (
                  <div className="sl-viewport flex flex-1 items-center justify-center"><Skeleton className="aspect-video w-[70%] rounded" /></div>
                )}
                <div className={cn("sl-notes shrink-0 border-t bg-background transition-[height]", notesOpen ? "h-[132px]" : "h-8")}>
                  <button onClick={() => setNotesOpen((v) => !v)} className="flex h-8 w-full items-center gap-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer">
                    <StickyNote className="size-3.5" /> Speaker notes{slide?.notes.trim() ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] normal-case tracking-normal">{slide.notes.trim().split(/\s+/).length} words</span> : null}
                    <span className="ml-auto">{notesOpen ? <ChevronsDown className="size-3.5" /> : <ChevronsUp className="size-3.5" />}</span>
                  </button>
                  {notesOpen && slide && (
                    <textarea value={slide.notes} onFocus={() => store.getState().pushHistory()} onChange={(e) => store.getState().setNotes(slide.id, e.target.value)} placeholder="Notes for the presenter: what to emphasize, which cite to read aloud, the transition to the next slide…" className="h-[100px] w-full resize-none bg-transparent px-3 pb-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70 scrollbar-thin" spellCheck />
                  )}
                </div>
              </div>
              {commentsOpen && ready && (
                <CommentsPanel comments={comments} slides={deck.slides} currentSlideId={currentSlideId} onAdd={addComment} onReply={async (cid, body) => { await office.comments.update(cid, { reply: body }); await refreshComments(); }} onResolve={async (cid, resolved) => { await office.comments.update(cid, { resolved }); await refreshComments(); toast.success(resolved ? "Comment resolved" : "Comment reopened", { duration: 1200 }); }} onDelete={async (cid) => { await office.comments.remove(cid); await refreshComments(); }} onGoTo={(sid) => store.getState().setCurrent(sid)} onClose={() => setCommentsOpen(false)} />
              )}
            </div>
          </ResizablePanel>
          {agentOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={400} minSize={320} maxSize={640}>
                <OfficeAgentPanel endpoint="/api/office/slides/agent" docId={doc?.id} docTitle={doc?.title ?? "Untitled deck"} matterId={doc?.matterId ?? matterId ?? null} getSnapshot={getSnapshot} scopes={scopes} applyProposals={applyProposals} onUndo={() => store.getState().undo()} onLocate={onLocate} suggestions={SUGGESTIONS} onApplied={onApplied} title="Deck assistant" extraContext={() => ({ currentSlide: slideIndex + 1, slideCount: deck.slides.length, selectedElementIds: store.getState().selectedIds, zoom })} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-background px-3 text-[11px] text-muted-foreground">
        <span className="tabular">{slide ? `Slide ${slideIndex + 1} of ${deck.slides.length}` : "No slide"}</span>
        {slide && <span>{LAYOUT_LABEL[slide.layout]}{slide.hidden ? " · hidden" : ""} · {slide.elements.length} element{slide.elements.length === 1 ? "" : "s"}{selectedIds.length ? ` · ${selectedIds.length} selected` : ""}</span>}
        {overflowCount > 0 && <span className="flex items-center gap-1 text-warning-foreground dark:text-warning"><AlertTriangle className="size-3" /> {overflowCount} text box{overflowCount === 1 ? "" : "es"} overflow</span>}
        <span className="hidden md:inline">{deck.theme.name}</span>
        <div className="flex-1" />
        <span className="hidden lg:inline">{saveLabel}</span>
        <Tip label="Keyboard shortcuts" shortcut="?"><button onClick={() => setShortcutsOpen(true)} className="rounded p-0.5 hover:text-foreground cursor-pointer" aria-label="Keyboard shortcuts"><Keyboard className="size-3.5" /></button></Tip>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setZoomStep(-1)} className="rounded p-0.5 hover:text-foreground cursor-pointer" aria-label="Zoom out"><Minus className="size-3.5" /></button>
          <button onClick={() => store.getState().setZoom("fit")} className={cn("min-w-[44px] rounded px-1 text-center tabular hover:text-foreground cursor-pointer", zoom === "fit" && "text-foreground")}>{zoomPct ? `${zoomPct}%` : "Fit"}</button>
          <button onClick={() => setZoomStep(1)} className="rounded p-0.5 hover:text-foreground cursor-pointer" aria-label="Zoom in"><Plus className="size-3.5" /></button>
        </div>
      </div>

      <ImageDialog open={imageOpen} onOpenChange={setImageOpen} onInsert={onInsertImage} />
      <ChartSheet element={dataEl?.type === "chart" ? dataEl : null} open={dataEl?.type === "chart"} onOpenChange={(o) => { if (!o) setDataEl(null); }} onSave={(chart) => { if (dataEl) store.getState().updateElement(dataEl.id, { chart }); }} />
      <TableSheet element={dataEl?.type === "table" ? dataEl : null} open={dataEl?.type === "table"} onOpenChange={(o) => { if (!o) setDataEl(null); }} onSave={(table, style) => { if (dataEl) store.getState().updateElement(dataEl.id, { table, style }); }} />
      <VersionsDialog open={versionsOpen} onOpenChange={setVersionsOpen} list={office.versions.list} get={office.versions.get} checkpoint={async (label) => { await saveNow(); return office.versions.checkpoint(label); }} restore={async (vid) => { const d = await office.versions.restore(vid); if (d) store.getState().load(normalizeDeck(d.content)); return d; }} currentDeck={() => store.getState().deck} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <PromptDialog request={prompt} onSubmit={(v) => { setPrompt(null); promptResolver.current?.(v); promptResolver.current = null; }} onCancel={() => { setPrompt(null); promptResolver.current?.(null); promptResolver.current = null; }} />
      {presenting !== null && <Presenter deck={deck} startIndex={presenting} onExit={(last) => { setPresenting(null); const visible = deck.slides.filter((s) => !s.hidden); const id = visible[last]?.id; if (id) store.getState().setCurrent(id); }} />}
      {printing && createPortal(
        <div id="slides-print">
          {deck.slides.filter((s) => !s.hidden).map((s) => (
            <div key={s.id} className="sl-print-page"><div style={{ width: SLIDE_W, height: SLIDE_H }}><SlideView slide={s} theme={deck.theme} /></div></div>
          ))}
        </div>,
        document.body,
      )}
      {loading && !ready && <span className="sr-only">Loading deck…</span>}
      {slide && <span className="sr-only">{slideTitle(slide)}</span>}
    </div>
  );
}
