"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, X, Maximize2, Minimize2, Paperclip, MessagesSquare, Copy, Files, ArrowUpLeft, PanelRightClose, PanelRightOpen, Search, ClipboardCopy, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreBar } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CodingDecision } from "@/lib/types/domain";
import type { DocRow, SimilarDoc } from "../types";
import { highlightRegex, parseBates, formatBates } from "../query";
import { useReviewStore, type ViewerTab } from "./store";
import { api, useDoc, useSimilar, type DocDetailResponse } from "./use-review-data";
import { useReview } from "./review-page";
import { ReviewListContext } from "./review-tab";
import { CodingPanel } from "./coding-panel";
import { AiTab } from "./ai-tab";
import { CodingBadges, IssueChip, ProvenanceBadge, TypeIcon, formatShortDate } from "./shared";

/** Viewer width at which the coding panel becomes a fixed right column instead of an overlay. */
export const CODING_COLUMN_MIN_WIDTH = 560;

/** Coding column width for a given viewer width: 240px in tight viewers, 272px when there is room. */
export function codingColumnWidth(viewerWidth: number): number {
  if (viewerWidth <= 0) return 272;
  return viewerWidth < 720 ? 240 : 272;
}

const TABS: { id: ViewerTab; label: string }[] = [
  { id: "text", label: "Text" }, { id: "metadata", label: "Metadata" }, { id: "family", label: "Family" }, { id: "similar", label: "Similar" }, { id: "ai", label: "AI" },
];

export function DocViewer({ docId, terms, onNavigate, onClose, index, count }: { docId: string; terms: string[]; onNavigate: (delta: number) => void; onClose: () => void; index: number; count: number }) {
  const { currentUserId } = useReview();
  const list = React.useContext(ReviewListContext);
  const detail = useDoc(docId);
  const tab = useReviewStore((s) => s.viewerTab);
  const setTab = useReviewStore((s) => s.setViewerTab);
  const fullscreen = useReviewStore((s) => s.fullscreen);
  const setFullscreen = useReviewStore((s) => s.setFullscreen);
  const codingOpen = useReviewStore((s) => s.codingPanelOpen);
  const setCodingOpen = useReviewStore((s) => s.setCodingPanelOpen);
  const autoAdvance = useReviewStore((s) => s.autoAdvance);
  const setOpenDocId = useReviewStore((s) => s.setOpenDocId);
  const [draft, setDraft] = React.useState<CodingDecision | null>(null);
  const [saving, setSaving] = React.useState(false);
  const doc = detail.data?.doc;
  const dirty = !!doc && !!draft && JSON.stringify(normalise(draft)) !== JSON.stringify(normalise(doc.coding));

  React.useEffect(() => { if (doc) setDraft({ ...doc.coding, issues: [...(doc.coding.issues ?? [])] }); }, [doc]);
  React.useEffect(() => { if (detail.error) toast.error("Could not load document", { description: detail.error.message }); }, [detail.error]);

  const save = React.useCallback(async (advance = true) => {
    if (!doc || !draft) return;
    setSaving(true);
    try {
      const res = await api<{ doc: { id: string; coding: CodingDecision } }>(`/api/ediscovery/docs/${encodeURIComponent(doc.id)}`, { method: "PATCH", json: { coding: draft, reviewerId: draft.reviewerId ?? currentUserId } });
      detail.mutate((cur) => (cur ? { ...cur, doc: { ...cur.doc, coding: res.doc.coding } } : cur));
      list.patchCoding([doc.id], res.doc.coding);
      // propagate to exact duplicates
      const dupIds = [...(detail.data?.family.duplicates ?? []).map((d) => d.id), ...(detail.data?.family.duplicateOf ? [detail.data.family.duplicateOf.id] : [])];
      if (dupIds.length) { await api("/api/ediscovery/docs/bulk", { method: "POST", json: { ids: dupIds, patch: res.doc.coding } }); list.patchCoding(dupIds, res.doc.coding); }
      toast.success(`Saved ${doc.bates}`, { description: dupIds.length ? `Coding propagated to ${dupIds.length} duplicate${dupIds.length === 1 ? "" : "s"}` : undefined, duration: 1800 });
      if (advance && autoAdvance && index < count - 1) onNavigate(1);
    } catch (e) { toast.error("Save failed", { description: (e as Error).message }); }
    finally { setSaving(false); }
  }, [doc, draft, currentUserId, detail, list, autoAdvance, index, count, onNavigate]);

  // Viewer shortcuts: ⌘S save; R/N/P/H quick coding; [ ] prev/next
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.getAttribute("role") === "combobox");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "r") setDraft((d) => (d ? { ...d, responsive: true } : d));
      else if (k === "n") setDraft((d) => (d ? { ...d, responsive: false } : d));
      else if (k === "p") setDraft((d) => (d ? { ...d, privileged: !d.privileged, privilegeBasis: d.privileged ? undefined : (d.privilegeBasis ?? "attorney-client") } : d));
      else if (k === "h") setDraft((d) => (d ? { ...d, hot: !d.hot } : d));
      else if (e.key === "[") onNavigate(-1);
      else if (e.key === "]") onNavigate(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, onNavigate]);

  const family = detail.data?.family;
  const thread = family?.thread ?? [];
  const threadIdx = thread.findIndex((t) => t.id === docId);

  // At 560px and wider the coding panel is a fixed right column (never an overlay), so the
  // primary decisions stay one glance away; narrower than that it opens as an overlay so the
  // document itself stays readable.
  const sectionRef = React.useRef<HTMLElement>(null);
  const [width, setWidth] = React.useState(0);
  const [overlayOpen, setOverlayOpen] = React.useState(false);
  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setWidth(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width > 0 && width < CODING_COLUMN_MIN_WIDTH;
  const codingWidth = codingColumnWidth(width);
  const codingVisible = narrow ? overlayOpen : codingOpen;
  const toggleCoding = () => (narrow ? setOverlayOpen((v) => !v) : setCodingOpen(!codingOpen));

  return (
    <section ref={sectionRef} className="flex h-full min-h-0 flex-col bg-background" data-doc-viewer aria-label="Document viewer">
      {/* header (wraps when the pane is narrow so the thread controls never overlap the Bates number) */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5">
        <div className="flex items-center gap-0.5">
          <Tip label="Previous document" shortcut="["><Button variant="ghost" size="icon-xs" onClick={() => onNavigate(-1)} disabled={index <= 0} aria-label="Previous"><ChevronLeft className="size-4" /></Button></Tip>
          <span className="tabular text-[11px] text-muted-foreground">{index >= 0 ? index + 1 : "–"} / {count}</span>
          <Tip label="Next document" shortcut="]"><Button variant="ghost" size="icon-xs" onClick={() => onNavigate(1)} disabled={index < 0 || index >= count - 1} aria-label="Next"><ChevronRight className="size-4" /></Button></Tip>
        </div>
        <div className="mx-1 h-4 w-px bg-border" />
        {doc ? (
          <div className="flex min-w-[160px] flex-1 items-center gap-2">
            <TypeIcon type={doc.type} />
            <span className="shrink-0 font-mono text-[12.5px] font-semibold tabular">{doc.bates}{doc.batesEnd && <span className="font-normal text-muted-foreground"> – {doc.batesEnd.slice(-4)}</span>}</span>
            <span className="min-w-0 truncate text-[13px] font-medium" title={doc.subject}>{doc.subject}</span>
            {dirty && <Badge variant="warning" className="shrink-0">Unsaved</Badge>}
          </div>
        ) : <Skeleton className="h-4 flex-1" />}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <FamilyNav family={family} threadIdx={threadIdx} onOpen={setOpenDocId} />
          <Tip label={codingVisible ? "Hide coding panel" : "Show coding panel"}><Button variant="ghost" size="icon-xs" onClick={toggleCoding} aria-label="Toggle coding panel" aria-pressed={codingVisible}>{codingVisible ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}</Button></Tip>
          <Tip label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F"><Button variant="ghost" size="icon-xs" onClick={() => setFullscreen(!fullscreen)} aria-label="Toggle full screen">{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button></Tip>
          <Tip label="Close" shortcut="Esc"><Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close viewer"><X className="size-4" /></Button></Tip>
        </div>
      </header>
      {/* tabs */}
      <div className="flex shrink-0 items-center border-b px-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("relative h-8 px-2.5 text-xs font-medium transition-colors cursor-pointer", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
            {t.id === "family" && family && <span className="ml-1 rounded bg-muted px-1 text-[10px] tabular">{(family.attachments.length + (family.parent ? 1 : 0) + Math.max(0, family.thread.length - 1) + family.duplicates.length + family.nearDuplicates.length + (family.duplicateOf ? 1 : 0))}</span>}
            {t.id === "ai" && doc?.aiScore != null && <span className="ml-1 rounded bg-muted px-1 text-[10px] tabular">{doc.aiScore}</span>}
            {t.id === "ai" && <ProvenanceBadge record={doc} className="ml-1 align-middle" />}
            {tab === t.id && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
        {doc && <div className="ml-auto flex items-center gap-2 pr-1"><CodingBadges coding={draft ?? doc.coding} compact /></div>}
      </div>
      {/* body */}
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden">
          {!detail.data ? (
            <div className="space-y-2 p-4">{Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className={cn("h-3.5", i % 4 === 3 ? "w-2/3" : "w-full")} />)}</div>
          ) : tab === "text" ? (
            <TextView detail={detail.data} terms={terms} />
          ) : tab === "metadata" ? (
            <MetadataView detail={detail.data} />
          ) : tab === "family" ? (
            <FamilyView detail={detail.data} onOpen={setOpenDocId} />
          ) : tab === "similar" ? (
            <SimilarView docId={docId} active={tab === "similar"} onOpen={setOpenDocId} />
          ) : (
            <AiTab detail={detail.data} analysis={detail.data.analysis} onAnalysis={(a) => detail.mutate((cur) => (cur ? { ...cur, analysis: a } : cur))} onApply={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} />
          )}
        </div>
        {codingVisible && draft && doc && (
          <CodingPanel draft={draft} onChange={setDraft} onSave={() => save()} saving={saving} dirty={dirty} reviewedBy={detail.data?.reviewerName} reviewedAt={doc.coding.reviewedAt} width={narrow ? 272 : codingWidth} className={narrow ? "absolute inset-y-0 right-0 z-20 bg-card shadow-xl" : undefined} />
        )}
        {narrow && !overlayOpen && draft && doc && (
          <Button variant="secondary" size="sm" className="absolute bottom-3 right-3 z-10 shadow-md" onClick={() => setOverlayOpen(true)}><PanelRightOpen className="size-4" /> Coding{dirty ? " · unsaved" : ""}</Button>
        )}
      </div>
    </section>
  );
}

function normalise(c: CodingDecision) {
  const { reviewedAt: _a, reviewerId: _b, ...rest } = c;
  void _a; void _b;
  return { ...rest, issues: [...(rest.issues ?? [])].sort(), notes: rest.notes ?? "" };
}

function FamilyNav({ family, threadIdx, onOpen }: { family: DocDetailResponse["family"] | undefined; threadIdx: number; onOpen: (id: string) => void }) {
  if (!family) return null;
  const thread = family.thread;
  return (
    <div className="flex items-center gap-0.5">
      {family.parent && <Tip label={`Parent: ${family.parent.bates}`}><Button variant="ghost" size="icon-xs" onClick={() => onOpen(family.parent!.id)} aria-label="Open parent"><ArrowUpLeft className="size-4" /></Button></Tip>}
      {family.attachments.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" className="gap-1 px-1.5" aria-label="Attachments"><Paperclip className="size-3.5" /><span className="tabular text-[11px]">{family.attachments.length}</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Attachments</DropdownMenuLabel>
            {family.attachments.map((a) => <DropdownMenuItem key={a.id} onClick={() => onOpen(a.id)}><span className="font-mono text-[11px]">{a.bates}</span><span className="ml-2 truncate">{a.subject}</span></DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {thread.length > 1 && (
        <span className="flex items-center rounded-md border">
          <Tip label="Previous in thread"><Button variant="ghost" size="icon-xs" className="size-6" disabled={threadIdx <= 0} onClick={() => onOpen(thread[threadIdx - 1].id)} aria-label="Previous in thread"><ChevronLeft className="size-3.5" /></Button></Tip>
          <span className="flex items-center gap-1 px-1 text-[11px] tabular text-muted-foreground"><MessagesSquare className="size-3" />{threadIdx + 1}/{thread.length}</span>
          <Tip label="Next in thread"><Button variant="ghost" size="icon-xs" className="size-6" disabled={threadIdx < 0 || threadIdx >= thread.length - 1} onClick={() => onOpen(thread[threadIdx + 1].id)} aria-label="Next in thread"><ChevronRight className="size-3.5" /></Button></Tip>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text view with search-hit highlighting, page markers and copy-with-cite
// ---------------------------------------------------------------------------

function TextView({ detail, terms }: { detail: DocDetailResponse; terms: string[] }) {
  const { doc } = detail;
  const [find, setFind] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const allTerms = React.useMemo(() => Array.from(new Set([...terms, ...(find.trim().length > 1 ? [find.trim().toLowerCase()] : [])])), [terms, find]);
  const regex = React.useMemo(() => highlightRegex(allTerms), [allTerms]);
  const pages = React.useMemo(() => splitPages(doc.text, doc.pages ?? 1), [doc.text, doc.pages]);
  const start = parseBates(doc.bates);
  const hitCount = React.useMemo(() => (regex ? (doc.text.match(regex) ?? []).length : 0), [regex, doc.text]);
  const [hitIdx, setHitIdx] = React.useState(0);
  // Start from the first hit again whenever the terms or the document change (the viewer is reused across j/k navigation).
  React.useEffect(() => setHitIdx(0), [regex, doc.id]);
  React.useEffect(() => {
    const marks = containerRef.current?.querySelectorAll("mark");
    if (!marks?.length) return;
    marks.forEach((m) => m.removeAttribute("data-current"));
    const m = marks[Math.min(hitIdx, marks.length - 1)];
    m?.setAttribute("data-current", "true");
    m?.scrollIntoView({ block: "center" });
  }, [hitIdx, regex, doc.id]);

  const copyWithCite = async () => {
    const sel = window.getSelection();
    let text = sel && sel.toString().trim() && containerRef.current?.contains(sel.anchorNode) ? sel.toString().trim() : doc.text;
    let cite = doc.bates;
    const pageEl = sel?.anchorNode ? (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)?.closest<HTMLElement>("[data-page-bates]") : null;
    if (pageEl?.dataset.pageBates && sel?.toString().trim()) cite = pageEl.dataset.pageBates;
    else if (doc.batesEnd) cite = `${doc.bates} at -${doc.batesEnd.slice(-3)}`;
    if (text.length > 4000 && text === doc.text) text = text.slice(0, 4000) + "…";
    try { await navigator.clipboard.writeText(`${text}\n\n(${cite}.)`); toast.success("Copied with Bates cite", { description: `(${cite}.)` }); } catch { toast.error("Clipboard unavailable"); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-1">
        <div className="relative w-56 max-w-full">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setHitIdx((i) => (hitCount ? (i + (e.shiftKey ? -1 : 1) + hitCount) % hitCount : 0)); }} placeholder="Find in document" className="h-7 w-full rounded border border-input bg-background pl-7 pr-2 text-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" aria-label="Find in document" />
        </div>
        {regex && <span className="tabular text-[11px] text-muted-foreground">{hitCount ? `${Math.min(hitIdx + 1, hitCount)} of ${hitCount} hits` : "no hits"}</span>}
        {hitCount > 0 && <span className="flex items-center"><Button variant="ghost" size="icon-xs" className="size-6" onClick={() => setHitIdx((i) => (i - 1 + hitCount) % hitCount)} aria-label="Previous hit"><ChevronLeft className="size-3.5" /></Button><Button variant="ghost" size="icon-xs" className="size-6" onClick={() => setHitIdx((i) => (i + 1) % hitCount)} aria-label="Next hit"><ChevronRight className="size-3.5" /></Button></span>}
        <div className="flex-1" />
        <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground sm:inline">{(doc.pages ?? 1)} page{(doc.pages ?? 1) === 1 ? "" : "s"} · {doc.text.length.toLocaleString()} chars</span>
        <Tip label="Copy selection (or whole document) with a Bates cite"><Button variant="ghost" size="xs" onClick={copyWithCite}><ClipboardCopy className="size-3.5" /> Copy w/ cite</Button></Tip>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin bg-muted/20 px-4 py-4 [&_mark]:rounded-sm [&_mark]:bg-warning/40 [&_mark]:px-px [&_mark]:text-foreground [&_mark[data-current=true]]:bg-chart-3 [&_mark[data-current=true]]:ring-2 [&_mark[data-current=true]]:ring-chart-3/50">
        {pages.map((page, i) => {
          const pageBates = start ? formatBates(start.prefix, start.number + i, start.width) : `${doc.bates} p.${i + 1}`;
          return (
            <article key={i} data-page-bates={pageBates} className="paper mx-auto mb-4 max-w-[760px] rounded-md border px-5 py-5 sm:px-8 sm:py-6">
              <div className="mb-3 flex items-center justify-between border-b pb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <span>Page {i + 1} of {pages.length}</span>
                <span>{pageBates}</span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-serif text-[13.5px] leading-[1.65] text-foreground/95">{highlight(page, regex)}</pre>
              <div className="mt-4 text-center font-mono text-[10px] text-muted-foreground">{pageBates} · {doc.coding.confidentiality ? doc.coding.confidentiality.toUpperCase() : "CONFIDENTIAL"} — SUBJECT TO PROTECTIVE ORDER</div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function splitPages(text: string, pages: number): string[] {
  if (text.includes("\f")) return text.split("\f").map((p) => p.replace(/^\n+/, ""));
  if (pages <= 1) return [text];
  const paras = text.split(/\n\n+/);
  const per = Math.ceil(paras.length / pages);
  const out: string[] = [];
  for (let i = 0; i < paras.length; i += per) out.push(paras.slice(i, i + per).join("\n\n"));
  return out.length ? out : [text];
}

function highlight(text: string, regex: RegExp | null): React.ReactNode {
  if (!regex) return text;
  const parts = text.split(regex);
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function MetadataView({ detail }: { detail: DocDetailResponse }) {
  const { doc } = detail;
  const { issueCodes } = useReview();
  const rows: [string, React.ReactNode][] = [
    ["Bates", <span key="b" className="font-mono">{doc.bates}{doc.batesEnd ? ` – ${doc.batesEnd}` : ""}</span>],
    ["Document id", <span key="i" className="font-mono text-xs">{doc.id}</span>],
    ["Date", formatShortDate(doc.date)],
    ["Type", <span key="t" className="flex items-center gap-1.5"><TypeIcon type={doc.type} />{doc.type}</span>],
    ["Custodian", doc.custodianName],
    ["From", doc.from ?? "—"],
    ["To", doc.to?.length ? doc.to.join("; ") : "—"],
    ["Cc", doc.cc?.length ? doc.cc.join("; ") : "—"],
    ["Pages", String(doc.pages ?? 1)],
    ["Source", doc.source ?? "—"],
    ["MD5 / hash", <span key="h" className="break-all font-mono text-xs">{doc.hash ?? "—"}</span>],
    ["Thread id", doc.family?.threadId ? <span key="th" className="font-mono text-xs">{doc.family.threadId}</span> : "—"],
    ["Parent", detail.family.parent ? <span key="p" className="font-mono text-xs">{detail.family.parent.bates}</span> : "—"],
    ["Duplicate of", detail.family.duplicateOf ? <span key="d" className="font-mono text-xs">{detail.family.duplicateOf.bates}</span> : "—"],
    ["Tags", doc.tags?.length ? <span key="tg" className="flex flex-wrap gap-1">{doc.tags.map((t) => <Badge key={t} variant="muted">{t}</Badge>)}</span> : "—"],
    ["AI score", doc.aiScore != null ? <ScoreBar key="s" value={doc.aiScore} /> : "—"],
    ["AI issues", doc.aiIssues?.length ? <span key="ai" className="flex flex-wrap gap-1">{doc.aiIssues.map((c) => <IssueChip key={c} code={c} codes={issueCodes} size="xs" />)}</span> : "—"],
    ["Reviewed by", detail.reviewerName ? `${detail.reviewerName}${doc.coding.reviewedAt ? ` · ${new Date(doc.coding.reviewedAt).toLocaleString()}` : ""}` : "—"],
  ];
  return (
    <div className="h-full overflow-auto scrollbar-thin p-4">
      <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground pt-0.5">{k}</dt><dd className="min-w-0 break-words">{v}</dd></React.Fragment>))}
      </dl>
      {doc.entities && (
        <div className="mt-5 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Entities</div>
          {(["people", "orgs", "places", "chemicals"] as const).map((k) => doc.entities?.[k]?.length ? <div key={k} className="flex flex-wrap items-baseline gap-1 text-sm"><span className="w-20 text-xs text-muted-foreground capitalize">{k}</span>{doc.entities[k]!.map((e) => <Badge key={e} variant="outline" className="font-normal">{e}</Badge>)}</div> : null)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

function FamilyView({ detail, onOpen }: { detail: DocDetailResponse; onOpen: (id: string) => void }) {
  const f = detail.family;
  const groups: { title: string; icon: React.ElementType; rows: DocRow[]; hint?: string }[] = [
    { title: "Parent", icon: ArrowUpLeft, rows: f.parent ? [f.parent] : [] },
    { title: "Attachments", icon: Paperclip, rows: f.attachments },
    { title: "Email thread", icon: MessagesSquare, rows: f.thread, hint: "chronological" },
    { title: "Exact duplicates", icon: Copy, rows: [...(f.duplicateOf ? [f.duplicateOf] : []), ...f.duplicates], hint: "same hash — coding propagates on save" },
    { title: "Near-duplicates", icon: Files, rows: f.nearDuplicates, hint: "drafts / versions" },
  ].filter((g) => g.rows.length);
  if (!groups.length) return <div className="p-6 text-sm text-muted-foreground">This document has no family, thread or duplicate relationships.</div>;
  return (
    <div className="h-full overflow-auto scrollbar-thin p-3">
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><g.icon className="size-3.5" />{g.title}<span className="font-normal normal-case tracking-normal">· {g.rows.length}{g.hint ? ` · ${g.hint}` : ""}</span></div>
          <ul className="divide-y rounded-md border">
            {g.rows.map((r) => <li key={r.id}><RowButton row={r} current={r.id === detail.doc.id} onClick={() => onOpen(r.id)} /></li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RowButton({ row, current, onClick, trailing }: { row: DocRow; current?: boolean; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={current} className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer disabled:cursor-default", current ? "bg-primary/10" : "hover:bg-accent/60")}>
      <TypeIcon type={row.type} />
      <span className="w-[104px] shrink-0 font-mono tabular">{row.bates}</span>
      <span className="w-[76px] shrink-0 tabular text-muted-foreground">{formatShortDate(row.date)}</span>
      <span className="min-w-0 flex-1 truncate">{row.subject}</span>
      <span className="hidden w-24 shrink-0 truncate text-muted-foreground md:inline">{row.custodianName}</span>
      <CodingBadges coding={row.coding} compact />
      {trailing}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Similar
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<SimilarDoc["reason"], string> = { semantic: "semantic", keyword: "keyword", duplicate: "duplicate", "near-duplicate": "near-dup", thread: "thread", family: "family" };

function SimilarView({ docId, active, onOpen }: { docId: string; active: boolean; onOpen: (id: string) => void }) {
  const { aiConfigured } = useReview();
  const sim = useSimilar(docId, active);
  if (sim.loading && !sim.data) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Finding similar documents…</div>;
  if (sim.error) return <div className="flex items-center gap-2 p-6 text-sm text-destructive"><AlertTriangle className="size-4" /> {sim.error.message}</div>;
  const rows = sim.data?.similar ?? [];
  return (
    <div className="h-full overflow-auto scrollbar-thin p-3">
      <p className="mb-2 px-1 text-[11px] text-muted-foreground">{aiConfigured ? "Hybrid ranking: embeddings fused with BM25 keyword scores." : "Keyword (BM25) similarity — add an OpenAI key for embedding-based ranking."} Family, thread and duplicate relations are listed first.</p>
      {!rows.length ? <div className="p-4 text-sm text-muted-foreground">No similar documents found.</div> : (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => onOpen(r.id)} className="flex w-full flex-col gap-1 px-2.5 py-2 text-left text-xs hover:bg-accent/60 cursor-pointer">
                <span className="flex items-center gap-2">
                  <TypeIcon type={r.type} />
                  <span className="font-mono tabular">{r.bates}</span>
                  <span className="tabular text-muted-foreground">{formatShortDate(r.date)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.subject}</span>
                  <Badge variant={r.reason === "semantic" ? "info" : r.reason === "keyword" ? "muted" : "secondary"} className="shrink-0">{REASON_LABEL[r.reason]}</Badge>
                  <ScoreBar value={Math.round(r.score * 100)} showValue={false} className="shrink-0" />
                </span>
                <span className="line-clamp-2 pl-5 text-[11px] text-muted-foreground">{r.passage}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
