"use client";
/**
 * PDF editor page: viewer + thumbnail rail + sidebar + agent panel, with the
 * document lifecycle (import / template materialization / extraction),
 * autosave, search, exports, page operations and keyboard shortcuts.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Briefcase, ChevronDown, Download, FileText, FileType, Flame, History, Keyboard, Loader2, Merge, MessageSquare, PanelRight, PanelLeft, Save, Scissors, Sparkles, Stamp, Upload, Minimize2, FilePlus2, RotateCw, Type, Highlighter, ListTree, Search, List } from "lucide-react";
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
import "./pdf.css";
import { clearRunsCache, clearThumbCache, downloadBlob, downloadExport, fmtBytes, pageImageForAgent, postForm, postJson, rasterizeRedactedPages, safeFilename, searchDocument } from "./client-utils";
import { AnnotationDialog, ApplyDialog, BatesDialog, CustomStampDialog, DecorationsDialog, MergeDialog, ShortcutsDialog, SignatureDialog, SplitDialog, type ApplyOptions } from "./dialogs";
import { activePages, annotationStats, boundsOf, emptyModel, normalizeModel, sourceToDisplay, type PdfAnnotation, type PdfModel } from "./model";
import { openPdf, type PDFDocumentProxy } from "./pdfjs";
import { commentPage, PdfSidebar } from "./sidebar";
import { pageText } from "./snapshot";
import { usePdfStore, type SidebarTab, type Tool } from "./store";
import { ThumbnailRail } from "./thumbnail-rail";
import { PdfToolbar } from "./toolbar";
import { VersionsDialog } from "./versions-dialog";
import { PdfViewer } from "./viewer";

const SUGGESTIONS = {
  draft: ["Bates-stamp MFC-0060000 onward, bottom right", "Redact every SSN and account number", "Highlight every mention of MW-7 and add a note", "Stamp CONFIDENTIAL on every page", "Summarize this order and list deadlines", "Convert to Word"],
  review: ["Check for unredacted PII and privilege markers", "Is this ready to produce? Check Bates, legends and redactions", "Flag every deadline and who owns it"],
  ask: ["What does paragraph 12 require?", "Which pages mention the §8(e) notice?", "List the custodians and the relevant period for each"],
};

const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", "1": "highlight", "2": "underline", "3": "strikeout", n: "note", t: "text", r: "rect", e: "ellipse", p: "freehand", x: "redaction", l: "link" };

export interface PdfEditorPageProps { id: string; templateId?: string | null; blobId?: string | null; matterId?: string | null; matters: Matter[] }

export function PdfEditorPage(props: PdfEditorPageProps) {
  if (props.id === "new" && !props.templateId) return <NewPdfView blobId={props.blobId ?? null} matterId={props.matterId ?? null} />;
  return <PdfEditor {...props} />;
}

// ---------------------------------------------------------------------------
function NewPdfView({ blobId, matterId }: { blobId: string | null; matterId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(blobId ? "Opening PDF…" : null);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = React.useState<{ id: string; name: string; description: string }[]>([]);
  React.useEffect(() => { fetch("/api/office/templates?kind=pdf").then((r) => r.json()).then((j: { templates: { id: string; name: string; description: string }[] }) => setTemplates(j.templates)).catch(() => {}); }, []);
  React.useEffect(() => {
    if (!blobId) return;
    postJson<{ url: string }>("/api/office/pdf/from-blob", { blobId, matterId: matterId ?? undefined }).then((r) => router.replace(r.url)).catch((e) => { toast.error((e as Error).message); setBusy(null); });
  }, [blobId, matterId, router]);
  const upload = async (file: File) => {
    if (!/\.pdf$/i.test(file.name)) { toast.error("Only PDF files can be opened here"); return; }
    setBusy(`Importing ${file.name}…`);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "pdf");
      if (matterId) form.append("matterId", matterId);
      const r = await postForm<{ url: string }>("/api/office/import", form);
      router.replace(r.url);
    } catch (e) { toast.error(`Import failed: ${(e as Error).message}`); setBusy(null); }
  };
  return (
    <div className="pdf-dropzone flex h-full flex-col">
      <TopbarSlot><Link href="/office?kind=pdf" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> PDFs</Link><Badge variant="destructive" className="gap-1 font-mono"><FileType className="size-3" /> PDF</Badge><span className="text-sm font-semibold">New PDF</span></TopbarSlot>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }} onClick={() => !busy && inputRef.current?.click()} className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-background/80 p-12 text-center transition-colors hover:border-primary/60", drag && "border-primary bg-primary/5")}>
            {busy ? <><Loader2 className="size-8 animate-spin text-primary" /><div className="text-sm font-medium">{busy}</div><div className="text-xs text-muted-foreground">Extracting text, outline and form fields</div></> : <><div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Upload className="size-6" /></div><div className="text-base font-semibold">Drop a PDF to open it</div><div className="text-xs text-muted-foreground">Productions, orders, exhibits, scanned letters — up to 60 MB. The file is stored in the library and opened in the editor with text extraction.</div><Button size="sm" className="mt-2" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}><Upload className="size-3.5" /> Choose a file</Button></>}
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </div>
          {templates.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Or start from a template</div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {templates.map((t) => <Link key={t.id} href={`/office/pdf/new?template=${t.id}${matterId ? `&matter=${matterId}` : ""}`} className="rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"><div className="flex items-center gap-1.5 text-xs font-medium"><FileType className="size-3.5 text-destructive" /> {t.name}</div><div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{t.description}</div></Link>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PdfEditor({ id, templateId, matterId, matters }: PdfEditorPageProps) {
  const office = useOfficeDoc<PdfModel>({ id, kind: "pdf", emptyContent: emptyModel, templateId: templateId ?? null, matterId: matterId ?? null, autosaveMs: 1200 });
  const { doc, loading, error } = office;
  const officeRef = React.useRef(office);
  officeRef.current = office;
  const store = usePdfStore;
  const model = usePdfStore((s) => s.model);
  const loaded = usePdfStore((s) => s.loaded);
  const changeTick = usePdfStore((s) => s.changeTick);
  const currentPage = usePdfStore((s) => s.currentPage);
  const selectedAnnotationId = usePdfStore((s) => s.selectedAnnotationId);
  const sidebarTab = usePdfStore((s) => s.sidebarTab);
  const railOpen = usePdfStore((s) => s.railOpen);
  const effectiveScale = usePdfStore((s) => s.effectiveScale);
  const selection = usePdfStore((s) => s.selection);
  const search = usePdfStore((s) => s.search);
  const [ready, setReady] = React.useState(false);
  const [preparing, setPreparing] = React.useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = React.useState<PDFDocumentProxy | null>(null);
  const [title, setTitle] = React.useState("");
  const [agentOpen, setAgentOpen] = React.useState(true);
  const [comments, setComments] = React.useState<OfficeComment[]>([]);
  const [dialog, setDialog] = React.useState<null | "bates" | "decorations" | "merge" | "split" | "signature" | "stamp" | "apply" | "shortcuts" | "versions">(null);
  const [splitPages, setSplitPages] = React.useState<number[] | undefined>(undefined);
  const [editing, setEditing] = React.useState<PdfAnnotation | null>(null);
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [applyProgress, setApplyProgress] = React.useState<string | null>(null);
  const pageImageRef = React.useRef<{ page: number; dataUrl: string } | null>(null);
  const matter = React.useMemo(() => matters.find((m) => m.id === (doc?.matterId ?? matterId)) ?? null, [matters, doc?.matterId, matterId]);
  const pages = React.useMemo(() => activePages(model), [model]);
  const cacheKey = model.sourceBlobId || "none";

  // ---- load + materialize + extract ------------------------------------------------------
  React.useEffect(() => {
    if (!doc || ready) return;
    let cancelled = false;
    (async () => {
      let m = normalizeModel(doc.content);
      setTitle(doc.title);
      if (m.meta.pending || !m.textIndex?.length || !m.sourceBlobId) {
        setPreparing(m.meta.pending ? "Generating PDF…" : "Extracting text…");
        try {
          const r = await postJson<{ model: PdfModel; doc: { title: string } }>(`/api/office/pdf/${doc.id}/extract`, {});
          if (cancelled) return;
          m = normalizeModel(r.model);
          officeRef.current.contentRef.current = m;
        } catch (e) { toast.error(`Could not prepare the PDF: ${(e as Error).message}`); }
        finally { if (!cancelled) setPreparing(null); }
      }
      if (cancelled) return;
      store.getState().load(m, doc.id);
      setReady(true);
      void officeRef.current.comments.list().then(setComments).catch(() => {});
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ready]);
  React.useEffect(() => () => { usePdfStore.setState({ loaded: false }); }, []);
  const docTitle = doc?.title;
  React.useEffect(() => { if (docTitle && document.activeElement?.getAttribute("data-title-input") !== "1") setTitle(docTitle); }, [docTitle]);

  // open bytes with pdf.js whenever the source changes
  const sourceBlobId = model.sourceBlobId;
  React.useEffect(() => {
    if (!ready || !sourceBlobId) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    openPdf(`/api/blobs/${sourceBlobId}`).then((d) => { if (cancelled) { void d.loadingTask.destroy(); return; } opened = d; setPdfDoc(d); }).catch((e) => toast.error(`Could not render the PDF: ${(e as Error).message}`));
    return () => { cancelled = true; clearRunsCache(sourceBlobId); clearThumbCache(sourceBlobId); if (opened) void opened.loadingTask.destroy(); setPdfDoc(null); };
  }, [ready, sourceBlobId]);

  // ---- autosave --------------------------------------------------------------------------
  const lastTick = React.useRef(0);
  React.useEffect(() => {
    if (!ready || !loaded || changeTick === 0 || changeTick === lastTick.current) return;
    lastTick.current = changeTick;
    officeRef.current.markDirty(store.getState().model);
  }, [changeTick, ready, loaded, store]);
  const saveNow = React.useCallback(async (version?: { summary?: string; label?: string; authorName?: string }) => {
    officeRef.current.contentRef.current = store.getState().model;
    const r = await officeRef.current.save(version ? { version: { ...version, force: true } } : {});
    if (r && !version) toast.success("Saved", { duration: 1200 });
  }, [store]);
  const commitTitle = async () => { const t = title.trim() || "Untitled PDF"; if (t !== doc?.title) await office.setTitle(t); };
  React.useEffect(() => { if (process.env.NODE_ENV !== "production") (window as unknown as { __leclaudePdfStore?: unknown }).__leclaudePdfStore = usePdfStore; }, []);

  // page image for the agent (current page, debounced)
  React.useEffect(() => {
    if (!pdfDoc || !ready) return;
    const t = setTimeout(() => { void pageImageForAgent(pdfDoc, store.getState().model, currentPage).then((u) => { if (u) pageImageRef.current = { page: currentPage, dataUrl: u }; }); }, 900);
    return () => clearTimeout(t);
  }, [pdfDoc, ready, currentPage, store]);

  // ---- search ----------------------------------------------------------------------------
  const runSearch = React.useCallback(async (query: string, opts?: { regex?: boolean; caseSensitive?: boolean }) => {
    const st = store.getState();
    if (!query.trim()) { st.setSearch({ query: "", hits: [], index: -1, running: false }); return; }
    if (!pdfDoc) return;
    st.setSearch({ query, regex: opts?.regex ?? st.search.regex, caseSensitive: opts?.caseSensitive ?? st.search.caseSensitive, running: true });
    try {
      const hits = await searchDocument(pdfDoc, cacheKey, st.model, query, { regex: opts?.regex ?? st.search.regex, caseSensitive: opts?.caseSensitive ?? st.search.caseSensitive });
      if (store.getState().search.query !== query) return;
      const cur = store.getState().currentPage;
      const first = Math.max(0, hits.findIndex((h) => h.display >= cur));
      st.setSearch({ hits, index: hits.length ? first : -1, running: false });
      if (hits.length) st.scrollTo(hits[first].display, boundsOf(hits[first].match.rects) ?? undefined);
      else toast.message(`No matches for “${query}”`, { duration: 1500 });
      if (hits.length && !store.getState().sidebarTab) st.setSidebarTab("search");
    } catch (e) { st.setSearch({ running: false }); toast.error(`Search failed: ${(e as Error).message}`); }
  }, [pdfDoc, cacheKey, store]);
  const nextHit = React.useCallback((dir: 1 | -1) => { const st = store.getState(); const n = st.search.hits.length; if (!n) return; const i = (st.search.index + dir + n) % n; st.setSearch({ index: i }); const h = st.search.hits[i]; st.scrollTo(h.display, boundsOf(h.match.rects) ?? undefined); }, [store]);
  const markHits = React.useCallback((type: "highlight" | "redaction", reason?: string) => {
    const st = store.getState();
    const hits = st.search.hits;
    if (!hits.length) return;
    st.applyOp({ op: "add_annotations", annotations: hits.map((h) => ({ id: `an_${Math.random().toString(36).slice(2, 10)}`, page: h.source, type, rects: h.match.rects, color: type === "redaction" ? "#111111" : st.color, opacity: type === "highlight" ? 0.4 : 1, quote: h.match.text, reason: type === "redaction" ? reason ?? st.redactionReason : undefined, author: "Jordan Whitfield", createdAt: new Date().toISOString() })) });
    toast.success(`${type === "redaction" ? "Redacted" : "Highlighted"} ${hits.length} match${hits.length === 1 ? "" : "es"}`);
  }, [store]);
  const redactPattern = React.useCallback(async (query: string, regex: boolean, reason?: string) => {
    if (!pdfDoc) return;
    const st = store.getState();
    const hits = await searchDocument(pdfDoc, cacheKey, st.model, query, { regex });
    if (!hits.length) { toast.message("No matches to redact"); return; }
    st.applyOp({ op: "add_annotations", annotations: hits.map((h) => ({ id: `an_${Math.random().toString(36).slice(2, 10)}`, page: h.source, type: "redaction" as const, rects: h.match.rects, color: "#111111", opacity: 1, quote: h.match.text, reason: reason ?? st.redactionReason, author: "Jordan Whitfield", createdAt: new Date().toISOString() })) });
    toast.success(`Added ${hits.length} redaction${hits.length === 1 ? "" : "s"} — apply them via Pages → Apply to source`);
    st.setSidebarTab("annotations");
  }, [pdfDoc, cacheKey, store]);

  // ---- comments ---------------------------------------------------------------------------
  const refreshComments = React.useCallback(async () => { try { setComments(await officeRef.current.comments.list()); } catch { /* ignore */ } }, []);
  const commentCounts = React.useMemo(() => { const m: Record<number, number> = {}; for (const c of comments) { if (c.resolved) continue; const p = commentPage(c.anchor); if (p) m[p] = (m[p] ?? 0) + 1; } return m; }, [comments]);
  const addComment = React.useCallback(async (page: number, body: string) => { const sel = store.getState().selection; const c = await officeRef.current.comments.add({ anchor: `page:${page}`, body, source: "user", quote: sel && sel.display === page ? sel.text.slice(0, 200) : undefined }); setComments((cs) => [...cs, c]); }, [store]);

  // ---- exports / page operations ------------------------------------------------------------
  const exportEdited = async (opts: { native?: boolean; flattenForms?: boolean } = {}) => {
    if (!doc) return;
    setExporting("pdf");
    try {
      const m = store.getState().model;
      let rasterizedPages: Record<number, string> | undefined;
      if (pdfDoc && m.annotations.some((a) => a.type === "redaction" && !a.applied)) rasterizedPages = await rasterizeRedactedPages(pdfDoc, m);
      await downloadExport({ docId: doc.id, content: m, title: doc.title, options: { flattenAnnotations: !opts.native, applyRedactions: true, bates: Boolean(m.bates && !m.bates.applied), fillForms: true, flattenForms: opts.flattenForms ?? false, rasterizedPages } }, opts.native ? "-annotated" : "");
    } catch (e) { toast.error(`Export failed: ${(e as Error).message}`); } finally { setExporting(null); }
  };
  const exportText = async () => { if (!doc) return; setExporting("txt"); try { const r = await fetch(`/api/office/pdf/${doc.id}/text`); if (!r.ok) throw new Error(r.statusText); downloadBlob(await r.blob(), `${safeFilename(doc.title)}.txt`); } catch (e) { toast.error((e as Error).message); } finally { setExporting(null); } };
  const convertToWord = async () => { if (!doc) return; setExporting("word"); try { const r = await postJson<{ url: string; doc: { title: string } }>(`/api/office/pdf/${doc.id}/convert`, {}); toast.success(`Created “${r.doc.title}”`, { action: { label: "Open", onClick: () => window.open(r.url, "_blank") } }); } catch (e) { toast.error((e as Error).message); } finally { setExporting(null); } };
  const afterSourceChange = (m: PdfModel, message: string) => { store.getState().load(normalizeModel(m), doc?.id ?? null); lastTick.current = store.getState().changeTick; officeRef.current.contentRef.current = store.getState().model; toast.success(message); };
  const doMerge = async (files: File[]) => { if (!doc) return; await saveNow(); const form = new FormData(); for (const f of files) form.append("files", f); const r = await postForm<{ model: PdfModel; appended: number }>(`/api/office/pdf/${doc.id}/merge`, form); afterSourceChange(r.model, `Appended ${r.appended} file${r.appended === 1 ? "" : "s"}`); };
  const doSplit = async (pgs: number[], t: string) => { if (!doc) return; await saveNow(); const r = await postJson<{ url: string; doc: { title: string } }>(`/api/office/pdf/${doc.id}/split`, { pages: pgs, title: t || undefined }); toast.success(`Created “${r.doc.title}”`, { action: { label: "Open", onClick: () => window.open(r.url, "_blank") } }); };
  const doCompress = async () => { if (!doc) return; setExporting("compress"); try { await saveNow(); const r = await postJson<{ before: number; after: number; model: PdfModel }>(`/api/office/pdf/${doc.id}/compress`, {}); if (r.after < r.before) afterSourceChange(r.model, `Compressed ${fmtBytes(r.before)} → ${fmtBytes(r.after)}`); else toast.message("Already compact — no savings"); } catch (e) { toast.error((e as Error).message); } finally { setExporting(null); } };
  const doApply = async (o: ApplyOptions) => {
    if (!doc) return;
    const m = store.getState().model;
    let rasterizedPages: Record<number, string> | undefined;
    if (o.applyRedactions && o.rasterize && pdfDoc) { setApplyProgress("Rasterizing redacted pages…"); rasterizedPages = await rasterizeRedactedPages(pdfDoc, m, { onProgress: (d, t) => setApplyProgress(`Rasterizing redacted pages ${d}/${t}…`) }); }
    setApplyProgress("Writing the new source PDF…");
    try {
      const r = await postJson<{ model: PdfModel }>(`/api/office/pdf/${doc.id}/burn`, { content: m, applyRedactions: o.applyRedactions, flattenAnnotations: o.flattenAnnotations, flattenForms: o.flattenForms, bates: o.bates, rasterizedPages });
      afterSourceChange(r.model, "Edits applied to the source PDF");
    } catch (e) { toast.error(`Apply failed: ${(e as Error).message}`); throw e; } finally { setApplyProgress(null); }
  };
  const insertBlank = () => store.getState().applyOp({ op: "insert_blank_page", afterDisplay: currentPage });
  const rotateAll = () => store.getState().applyOp({ op: "rotate_pages", sourcePages: pages.map((p) => p.index), delta: 90 });

  // ---- agent ------------------------------------------------------------------------------
  const scopes = React.useMemo<OfficeScope[]>(() => {
    const s: OfficeScope[] = [{ id: "document", label: "Whole document", kind: "document" }];
    const p = pages[currentPage - 1];
    if (p) s.push({ id: `page:${currentPage}`, label: `Page ${currentPage}`, kind: "page", ref: String(p.index), text: pageText(model, p.index).slice(0, 8000) });
    if (selection?.text) s.push({ id: "selection", label: "Selection", kind: "selection", ref: `page:${selection.display}`, text: selection.text.slice(0, 6000) });
    return s;
  }, [pages, currentPage, model, selection]);
  const getSnapshot = React.useCallback(() => { const st = store.getState(); return { model: st.model, title: doc?.title ?? "Untitled PDF", docId: doc?.id, matterId: doc?.matterId ?? null, currentPage: st.currentPage, selection: st.selection ? { page: st.selection.display, text: st.selection.text } : null, comments: comments.filter((c) => !c.resolved).map((c) => ({ id: c.id, anchor: c.anchor, body: c.body, author: c.authorName, resolved: c.resolved })) }; }, [store, doc, comments]);
  const extraContext = React.useCallback(() => { const img = pageImageRef.current; return { currentPage: store.getState().currentPage, pageCount: activePages(store.getState().model).length, tool: store.getState().tool, pageImages: img ? { [img.page]: img.dataUrl } : {} }; }, [store]);
  const applyProposals = React.useCallback(async (proposals: EditProposal[]): Promise<ApplyResult> => store.getState().applyProposals(proposals), [store]);
  const onApplied = React.useCallback((summary: string) => { void saveNow({ summary, authorName: "Drafting assistant" }); }, [saveNow]);
  const onLocate = React.useCallback((target: string) => {
    const st = store.getState();
    const m = target.match(/^page:(\d+)/);
    if (m) { st.scrollTo(Number(m[1])); return; }
    const a = st.model.annotations.find((x) => x.id === target);
    if (a) { const d = sourceToDisplay(st.model, a.page); if (d) { st.scrollTo(d, boundsOf(a.rects) ?? undefined); st.select(a.id); st.flashAnnotation(a.id); } }
  }, [store]);

  // ---- keyboard shortcuts ------------------------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || target.closest("[role=dialog]")));
      const st = store.getState();
      if (mod) {
        if (key === "s" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void saveNow(); return; }
        if (key === "f") { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent("pdf:focus-search")); return; }
        if (key === "/") { e.preventDefault(); e.stopPropagation(); setAgentOpen((v) => !v); return; }
        if (key === "z" && !typing) { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) st.redo(); else st.undo(); return; }
        if (key === "b" && !typing) { e.preventDefault(); setDialog("bates"); return; }
        if (key === "i" && !typing) { e.preventDefault(); st.setDarkInvert(!st.darkInvert); return; }
        if (key === "r" && !typing) { e.preventDefault(); const p = activePages(st.model)[st.currentPage - 1]; if (p) st.applyOp({ op: "rotate_pages", sourcePages: [p.index], delta: 90 }); return; }
        if ((key === "=" || key === "+") && !typing) { e.preventDefault(); const z = st.effectiveScale / (96 / 72); st.setZoom(Math.min(4, Math.round((z + 0.25) * 4) / 4)); return; }
        if (key === "-" && !typing) { e.preventDefault(); const z = st.effectiveScale / (96 / 72); st.setZoom(Math.max(0.25, Math.round((z - 0.25) * 4) / 4)); return; }
        if (key === "0" && !typing) { e.preventDefault(); st.setZoom("fit-width"); return; }
        if (key === "9" && !typing) { e.preventDefault(); st.setZoom("fit-page"); return; }
        if (e.shiftKey && key === "m" && !typing) { e.preventDefault(); st.setSidebarTab(st.sidebarTab === "comments" ? null : "comments"); return; }
        return;
      }
      if (typing) return;
      if (e.key === "Escape") { st.setTool("select"); st.select(null); st.setSelection(null); window.getSelection()?.removeAllRanges(); return; }
      if (e.key === "?") { setDialog("shortcuts"); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && st.selectedAnnotationId) { e.preventDefault(); st.removeAnnotations([st.selectedAnnotationId]); return; }
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); st.scrollTo(Math.min(activePages(st.model).length, st.currentPage + 1)); return; }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); st.scrollTo(Math.max(1, st.currentPage - 1)); return; }
      if (e.key === "Home") { e.preventDefault(); st.scrollTo(1); return; }
      if (e.key === "End") { e.preventDefault(); st.scrollTo(activePages(st.model).length); return; }
      if (key === "s") { if (st.signatureDataUrl) st.setTool("signature"); else setDialog("signature"); return; }
      const t = TOOL_KEYS[key];
      if (t) { st.setTool(t); if ((t === "highlight" || t === "underline" || t === "strikeout") && st.selection) { st.addAnnotation({ page: st.selection.source, type: t, rects: st.selection.rects, quote: st.selection.text.slice(0, 300) }); st.setSelection(null); window.getSelection()?.removeAllRanges(); st.setTool("select"); } }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saveNow, store]);

  const saveLabel = saveStateLabel(office.saveState, office.lastSavedAt);
  const stats = annotationStats(model);
  const zoomPct = Math.round((effectiveScale / (96 / 72)) * 100);
  const sizeLabel = model.meta.sourceSize ? fmtBytes(Number(model.meta.sourceSize)) : null;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <TopbarSlot><Link href="/library" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to Library</Link></TopbarSlot>
        <EmptyState icon={AlertTriangle} title={error} description="The PDF may have been deleted, or the link is wrong." action={<Button asChild variant="outline"><Link href="/office?kind=pdf">Open PDFs</Link></Button>} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopbarSlot>
        <Tip label="Back to Library" shortcut="G L"><Link href="/library" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Library</Link></Tip>
        <Badge variant="destructive" className="shrink-0 gap-1 font-mono"><FileType className="size-3" /> PDF</Badge>
        {matter ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="hidden max-w-[180px] shrink-0 items-center gap-1 truncate rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground lg:flex cursor-pointer"><Briefcase className="size-3" /><span className="truncate">{matter.shortName}</span><ChevronDown className="size-3 opacity-60" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72"><DropdownMenuLabel>Matter</DropdownMenuLabel><DropdownMenuRadioGroup value={matter.id} onValueChange={(v) => void office.save({ matterId: v })}>{matters.map((mm) => <DropdownMenuRadioItem key={mm.id} value={mm.id}><span className="truncate">{mm.shortName} <span className="text-muted-foreground">· {mm.client}</span></span></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
          </DropdownMenu>
        ) : ready ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="hidden shrink-0 items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground lg:flex cursor-pointer"><Briefcase className="size-3" /> Link matter</button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">{matters.map((mm) => <DropdownMenuItem key={mm.id} onClick={() => void office.save({ matterId: mm.id })}><span className="truncate">{mm.shortName} <span className="text-muted-foreground">· {mm.client}</span></span></DropdownMenuItem>)}</DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <input data-title-input="1" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void commitTitle()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} aria-label="Document title" placeholder="Untitled PDF" className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold outline-none transition-colors hover:border-border focus:border-ring focus:bg-background" />
        <span className={cn("hidden shrink-0 text-[11px] xl:inline", office.saveState === "error" ? "text-destructive" : office.saveState === "dirty" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>{saveLabel}</span>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="gap-1.5" disabled={!ready}><Stamp className="size-4" /> Pages <ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => setDialog("bates")}><Stamp /> Bates stamping… <span className="ml-auto text-[10px] text-muted-foreground">⌘B</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog("decorations")}><Type /> Header, footer, page numbers, watermark…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={insertBlank}><FilePlus2 /> Insert blank page after p. {currentPage}</DropdownMenuItem>
              <DropdownMenuItem onClick={rotateAll}><RotateCw /> Rotate all pages</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog("merge")}><Merge /> Merge another PDF…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSplitPages(undefined); setDialog("split"); }}><Scissors /> Extract pages to a new PDF…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doCompress()}><Minimize2 /> Compress (re-save){sizeLabel ? <span className="ml-auto text-[10px] text-muted-foreground">{sizeLabel}</span> : null}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialog("apply")}><Flame /> Apply edits to source… <span className="ml-auto text-[10px] text-muted-foreground">redactions · Bates</span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="gap-1.5" disabled={!ready}>{exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download <ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => void exportEdited()}><FileType /> Edited PDF (flattened, redactions applied)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportEdited({ native: true })}><Highlighter /> Edited PDF with editable annotations</DropdownMenuItem>
              {model.meta.hasForm && <DropdownMenuItem onClick={() => void exportEdited({ flattenForms: true })}><List /> Edited PDF with flattened form</DropdownMenuItem>}
              <DropdownMenuItem asChild><a href={`/api/blobs/${model.sourceBlobId}`} download={`${safeFilename(doc?.title ?? "document")}-source.pdf`}><Download /> Current source PDF</a></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void exportText()}><FileText /> Extracted text (.txt)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void convertToWord()}><FileText /> Convert to Word document</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tip label="Save" shortcut="⌘S"><Button variant="ghost" size="sm" onClick={() => void saveNow()} disabled={office.saveState === "saving" || !ready}><Save className="size-4" /> Save</Button></Tip>
          <Tip label="Version history"><Button variant="ghost" size="sm" onClick={() => setDialog("versions")} disabled={!ready}><History className="size-4" /> Versions</Button></Tip>
          <Tip label="Comments" shortcut="⌘⇧M"><Button variant={sidebarTab === "comments" ? "secondary" : "ghost"} size="icon-sm" onClick={() => store.getState().setSidebarTab(sidebarTab === "comments" ? null : "comments")} aria-label="Toggle comments" className="relative"><MessageSquare className="size-4" />{comments.filter((c) => !c.resolved).length > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] leading-3 text-primary-foreground tabular">{comments.filter((c) => !c.resolved).length}</span>}</Button></Tip>
          <Tip label="PDF assistant" shortcut="⌘/"><Button variant={agentOpen ? "secondary" : "ghost"} size="icon-sm" onClick={() => setAgentOpen((v) => !v)} aria-pressed={agentOpen} aria-label="Toggle assistant"><Sparkles className={cn("size-4", agentOpen && "text-primary")} /></Button></Tip>
        </div>
      </TopbarSlot>

      {ready ? <PdfToolbar onSearch={(q, o) => void runSearch(q, o)} onNextHit={nextHit} onOpenSignature={() => setDialog("signature")} onRedactSearch={(q, regex, reason) => { if (q === store.getState().search.query && store.getState().search.hits.length) markHits("redaction", reason); else void redactPattern(q, regex, reason); }} onCustomStamp={() => setDialog("stamp")} /> : <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">{[24, 24, 24, 24, 24, 24, 80, 60, 24, 120, 90, 170].map((w, i) => <Skeleton key={i} className="h-6" style={{ width: w }} />)}</div>}

      <div className="flex min-h-0 flex-1">
        {ready && railOpen ? <ThumbnailRail pdfDoc={pdfDoc} cacheKey={cacheKey} commentCounts={commentCounts} onExtract={(pgs) => { setSplitPages(pgs); setDialog("split"); }} /> : !ready ? <div className="flex w-[168px] shrink-0 flex-col gap-2 border-r p-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex gap-2"><Skeleton className="h-4 w-4" /><Skeleton className="aspect-[8.5/11] flex-1" /></div>)}</div> : null}
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel minSize={420}>
            <div className="flex h-full min-h-0">
              <div className="relative flex min-w-0 flex-1 flex-col">
                {ready ? <PdfViewer pdfDoc={pdfDoc} onOpenAnnotation={(a) => setEditing(a)} /> : (
                  <div className="flex flex-1 flex-col items-center gap-4 overflow-hidden bg-muted/40 p-8">{preparing && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {preparing}</div>}<Skeleton className="aspect-[8.5/11] w-[60%] max-w-[560px]" /><Skeleton className="aspect-[8.5/11] w-[60%] max-w-[560px]" /></div>
                )}
                {ready && !railOpen && <button onClick={() => store.getState().setRailOpen(true)} className="absolute left-2 top-2 z-10 rounded-md border bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-foreground cursor-pointer" aria-label="Show pages"><PanelLeft className="size-4" /></button>}
              </div>
              {ready && sidebarTab && (
                <PdfSidebar tab={sidebarTab} onTabChange={(t) => store.getState().setSidebarTab(t)} comments={comments} onAddComment={addComment} onReply={async (cid, body) => { await office.comments.update(cid, { reply: body }); await refreshComments(); }} onResolveComment={async (cid, resolved) => { await office.comments.update(cid, { resolved }); await refreshComments(); }} onDeleteComment={async (cid) => { await office.comments.remove(cid); await refreshComments(); }} onOpenAnnotation={(a) => setEditing(a)} onRedactSearch={() => markHits("redaction")} onHighlightSearch={() => markHits("highlight")} counts={{ annotations: stats.unresolved, comments: comments.filter((c) => !c.resolved).length, hits: search.hits.length, fields: model.meta.fields?.length ?? 0 }} />
              )}
              {ready && !sidebarTab && (
                <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-l bg-background py-1">
                  {([["annotations", Highlighter, "Annotations"], ["outline", ListTree, "Outline & bookmarks"], ["search", Search, "Search results"], ["forms", List, "Form fields"], ["comments", MessageSquare, "Comments"]] as [SidebarTab, React.ComponentType<{ className?: string }>, string][]).map(([t, Icon, label]) => (
                    <Tip key={t} label={label} side="left"><button onClick={() => store.getState().setSidebarTab(t)} className="relative rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label={label}><Icon className="size-4" />{t === "annotations" && stats.unresolved > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[8px] leading-3 text-primary-foreground tabular">{stats.unresolved}</span>}</button></Tip>
                  ))}
                </div>
              )}
            </div>
          </ResizablePanel>
          {agentOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={400} minSize={320} maxSize={640}>
                <OfficeAgentPanel endpoint="/api/office/pdf/agent" docId={doc?.id} docTitle={doc?.title ?? "Untitled PDF"} matterId={doc?.matterId ?? matterId ?? null} getSnapshot={getSnapshot} scopes={scopes} applyProposals={applyProposals} onUndo={() => store.getState().undo()} onLocate={onLocate} suggestions={SUGGESTIONS} onApplied={onApplied} title="PDF assistant" extraContext={extraContext} trackedChanges={false} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-background px-3 text-[11px] text-muted-foreground">
        <button onClick={() => store.getState().setRailOpen(!railOpen)} className="flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Toggle page rail"><PanelLeft className="size-3.5" /></button>
        <span className="tabular">Page {currentPage} of {pages.length}</span>
        {model.pages.some((p) => p.deleted) && <span>{model.pages.filter((p) => p.deleted).length} deleted</span>}
        <span>{stats.total} annotation{stats.total === 1 ? "" : "s"}{stats.byType.redaction ? ` · ${stats.byType.redaction} redaction${stats.byType.redaction === 1 ? "" : "s"}${model.annotations.some((a) => a.type === "redaction" && !a.applied) ? " pending" : ""}` : ""}</span>
        {model.bates && <span className="font-mono">{model.bates.prefix}{String(model.bates.start).padStart(model.bates.digits, "0")}{model.bates.applied ? " ✓" : " (on export)"}</span>}
        {selectedAnnotationId && <span className="text-foreground">1 selected · Delete to remove · double-click to edit</span>}
        {selection && !selectedAnnotationId && <span>“{selection.text.slice(0, 40)}{selection.text.length > 40 ? "…" : ""}” selected · press 1/2/3 to mark</span>}
        <div className="flex-1" />
        {sizeLabel && <span className="hidden md:inline">{sizeLabel}</span>}
        <span className="hidden lg:inline">{saveLabel}</span>
        <span className="tabular">{zoomPct}%</span>
        <Tip label="Keyboard shortcuts" shortcut="?"><button onClick={() => setDialog("shortcuts")} className="rounded p-0.5 hover:text-foreground cursor-pointer" aria-label="Keyboard shortcuts"><Keyboard className="size-3.5" /></button></Tip>
        <button onClick={() => store.getState().setSidebarTab(sidebarTab ? null : "annotations")} className="rounded p-0.5 hover:text-foreground cursor-pointer" aria-label="Toggle sidebar"><PanelRight className="size-3.5" /></button>
      </div>

      <AnnotationDialog annotation={editing} onClose={() => setEditing(null)} />
      <BatesDialog open={dialog === "bates"} onOpenChange={(o) => setDialog(o ? "bates" : null)} />
      <DecorationsDialog open={dialog === "decorations"} onOpenChange={(o) => setDialog(o ? "decorations" : null)} />
      <MergeDialog open={dialog === "merge"} onOpenChange={(o) => setDialog(o ? "merge" : null)} onMerge={async (files) => { try { await doMerge(files); } catch (e) { toast.error(`Merge failed: ${(e as Error).message}`); throw e; } }} />
      <SplitDialog open={dialog === "split"} onOpenChange={(o) => setDialog(o ? "split" : null)} initialPages={splitPages} onSplit={async (p, t) => { try { await doSplit(p, t); } catch (e) { toast.error(`Extract failed: ${(e as Error).message}`); throw e; } }} />
      <SignatureDialog open={dialog === "signature"} onOpenChange={(o) => setDialog(o ? "signature" : null)} />
      <CustomStampDialog open={dialog === "stamp"} onOpenChange={(o) => setDialog(o ? "stamp" : null)} />
      <ApplyDialog open={dialog === "apply"} onOpenChange={(o) => setDialog(o ? "apply" : null)} onApply={doApply} progress={applyProgress} />
      <ShortcutsDialog open={dialog === "shortcuts"} onOpenChange={(o) => setDialog(o ? "shortcuts" : null)} />
      <VersionsDialog open={dialog === "versions"} onOpenChange={(o) => setDialog(o ? "versions" : null)} list={office.versions.list} get={office.versions.get} checkpoint={async (label) => { await saveNow(); return office.versions.checkpoint(label); }} restore={async (vid) => { const d = await office.versions.restore(vid); if (d) { const m = normalizeModel(d.content); if (m.meta.pending || !m.textIndex?.length) { try { const r = await postJson<{ model: PdfModel }>(`/api/office/pdf/${d.id}/extract`, {}); afterSourceChange(r.model, "Version restored"); return d; } catch { /* fall through */ } } afterSourceChange(m, "Version restored"); } return d; }} currentModel={() => store.getState().model} />
      {loading && !ready && <span className="sr-only">Loading PDF…</span>}
    </div>
  );
}
