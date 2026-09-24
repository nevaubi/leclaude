"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, FileSearch, KeyRound, Keyboard, RefreshCw, Sparkles, Maximize2, Minimize2, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { useShellStore } from "@/components/shell/shell-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CountChip } from "@/components/ui/misc";
import { REVIEW_TABS, type ReviewTab, type SavedViewCounts } from "../types";
import { DepositionsTab, CrossAnalysisTab, TimelineTab, PeopleGraphTab, ConflictsTab } from "../analysis";
import { useReviewStore } from "./store";
import { api, useIssueCodes, useReviewQueueCount, useStats } from "./use-review-data";
import { MatterHeader } from "./matter-header";
import { ReviewTab as ReviewTabView } from "./review-tab";
import { CodesTab, type CodesSection } from "./codes-tab";
import { PredictDialog } from "./predict-dialog";
import { Kbd } from "./shared";
import type { IssueCode } from "@/lib/types/domain";

export interface MatterOption { id: string; shortName: string; name: string; caption?: string; client: string; stage?: string; docCount: number }
export interface Reviewer { id: string; name: string; title?: string }

interface ReviewContextValue {
  matterId: string;
  matter: MatterOption | undefined;
  aiConfigured: boolean;
  reviewers: Reviewer[];
  currentUserId: string;
  issueCodes: IssueCode[];
  /** Saved-view counts from the shared stats fetch (null until loaded). Refreshed together with the header stats after coding. */
  viewCounts: SavedViewCounts[] | null;
  refreshIssueCodes: () => void;
  refreshStats: () => void;
  /** Ask the review list (and its facets) to refetch, e.g. after batch prediction changed AI scores. */
  refreshList: () => void;
  openDocument: (id: string) => void;
  setTab: (tab: ReviewTab) => void;
  /** Pending AI records awaiting a human decision in this matter (null when the integrity endpoint is unavailable). */
  reviewQueuePending: number | null;
  setReviewQueuePending: (n: number) => void;
  refreshReviewQueue: () => void;
}

const ReviewContext = React.createContext<ReviewContextValue | null>(null);
export function useReview() {
  const ctx = React.useContext(ReviewContext);
  if (!ctx) throw new Error("useReview outside ReviewPage");
  return ctx;
}

export interface ReviewPageProps {
  matters: MatterOption[];
  initialMatterId: string;
  initialTab: ReviewTab;
  /** Section of the Codes & privilege tab to open first (deep links such as `?view=privilege`). */
  initialCodesSection?: CodesSection;
  initialDocId?: string;
  initialQuery?: string;
  initialCustodian?: string;
  aiConfigured: boolean;
  reviewers: Reviewer[];
  currentUserId: string;
}

function writeUrl(params: Record<string, string | null | undefined>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); }
  window.history.replaceState(window.history.state, "", url.toString());
}

export function ReviewPage(props: ReviewPageProps) {
  const [matterId, setMatterId] = React.useState(props.initialMatterId);
  const [tab, setTabState] = React.useState<ReviewTab>(props.initialTab);
  const [predictOpen, setPredictOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [indexing, setIndexing] = React.useState(false);
  const store = useReviewStore();
  const setActiveMatterId = useShellStore((s) => s.setActiveMatterId);
  const stats = useStats(matterId);
  const codes = useIssueCodes(matterId);
  const queue = useReviewQueueCount(matterId);
  const matter = props.matters.find((m) => m.id === matterId);

  // Initial state from the URL (doc / query / custodian deep links from other modules).
  const initialised = React.useRef(false);
  React.useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const s = useReviewStore.getState();
    s.reset();
    if (props.initialQuery) s.setQ(props.initialQuery);
    if (props.initialCustodian) s.toggleFilter("custodians", props.initialCustodian);
    if (props.initialDocId) s.setOpenDocId(props.initialDocId);
    setActiveMatterId(props.initialMatterId);
  }, [props.initialDocId, props.initialQuery, props.initialCustodian, props.initialMatterId, setActiveMatterId]);

  React.useEffect(() => { writeUrl({ matter: matterId, tab: tab === "review" ? null : tab, doc: store.openDocId }); }, [matterId, tab, store.openDocId]);

  const setTab = React.useCallback((t: ReviewTab) => setTabState(t), []);
  const changeMatter = (id: string) => {
    if (id === matterId) return;
    store.reset();
    setMatterId(id);
    setActiveMatterId(id);
  };
  const openDocument = React.useCallback((id: string) => { setTabState("review"); useReviewStore.getState().setOpenDocId(id); }, []);

  const rebuildIndex = async () => {
    setIndexing(true);
    try {
      const r = await api<{ docs: number; chunks: number; embedded: number; embeddingsAvailable: boolean }>("/api/ediscovery/index", { method: "POST", json: { matterId } });
      toast.success(`Index rebuilt: ${r.docs} documents, ${r.chunks} chunks`, { description: r.embeddingsAvailable ? `${r.embedded} chunks embedded` : "Keyword-only (no OpenAI key); semantic search falls back to BM25." });
      stats.refresh();
    } catch (e) { toast.error("Index rebuild failed", { description: (e as Error).message }); }
    finally { setIndexing(false); }
  };

  // Global shortcuts for the page.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.getAttribute("role") === "combobox");
      if (e.key === "?" && !typing) { e.preventDefault(); setHelpOpen((o) => !o); }
      if (e.key === "/" && !typing) { e.preventDefault(); document.getElementById("ediscovery-search")?.focus(); }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[1-7]$/.test(e.key)) { const t2 = REVIEW_TABS[Number(e.key) - 1]; if (t2) setTabState(t2.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refreshList = React.useCallback(() => useReviewStore.getState().bumpList(), []);
  const ctx = React.useMemo<ReviewContextValue>(() => ({
    matterId, matter, aiConfigured: props.aiConfigured, reviewers: props.reviewers, currentUserId: props.currentUserId,
    issueCodes: codes.data?.codes ?? [], viewCounts: stats.data?.views ?? null, refreshIssueCodes: codes.refresh, refreshStats: stats.refresh, refreshList, openDocument, setTab,
    reviewQueuePending: queue.pending, setReviewQueuePending: queue.set, refreshReviewQueue: queue.refresh,
  }), [matterId, matter, props.aiConfigured, props.reviewers, props.currentUserId, codes.data, stats.data, codes.refresh, stats.refresh, refreshList, openDocument, setTab, queue.pending, queue.set, queue.refresh]);

  const fullscreen = store.fullscreen && tab === "review" && !!store.openDocId;

  return (
    <ReviewContext.Provider value={ctx}>
      <TopbarSlot>
        <FileSearch className="size-4 text-muted-foreground" />
        <span className="shrink-0 text-sm font-semibold">E-Discovery</span>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <Select value={matterId} onValueChange={changeMatter}>
          <SelectTrigger size="sm" className="h-7 w-auto max-w-[280px] gap-1.5 whitespace-nowrap border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none hover:bg-accent" aria-label="Matter">
            <SelectValue>{matter?.shortName ?? "Matter"}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start" className="min-w-[320px]">
            {props.matters.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-2"><span className="font-medium">{m.shortName}</span><span className="text-xs text-muted-foreground">{m.docCount.toLocaleString()} docs{m.caption ? ` · ${m.caption}` : ""}</span></span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ChevronRight className="hidden size-3.5 text-muted-foreground md:block" />
        <span className="hidden text-sm text-muted-foreground md:block">{REVIEW_TABS.find((t) => t.id === tab)?.label}</span>
        <div className="flex-1" />
        {!props.aiConfigured && (
          <Tip label="AI analysis, batch prediction and privilege-log drafting need OPENAI_API_KEY"><Link href="/settings#ai" className="shrink-0"><Badge variant="warning" className="cursor-pointer"><KeyRound className="size-3" /> No OpenAI key</Badge></Link></Tip>
        )}
        {tab === "review" && store.openDocId && (
          <Tip label={store.fullscreen ? "Exit full-screen viewer" : "Full-screen viewer"} shortcut="F"><Button variant="ghost" size="icon-sm" onClick={() => store.setFullscreen(!store.fullscreen)} aria-label="Toggle full screen">{store.fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button></Tip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => setPredictOpen(true)}><Sparkles /> AI predict responsiveness<span className="ml-auto text-[10px] text-muted-foreground">batch</span></DropdownMenuItem>
            <DropdownMenuItem onClick={rebuildIndex} disabled={indexing}>{indexing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Rebuild search index</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setHelpOpen(true)}><Keyboard /> Keyboard shortcuts<span className="ml-auto text-[10px] text-muted-foreground">?</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TopbarSlot>

      <div className="flex h-full min-h-0 flex-col">
        {!fullscreen && (
          <>
            <MatterHeader matter={matter} stats={stats.data} loading={stats.loading} onOpenCodes={() => setTabState("codes")} onOpenHot={() => { useReviewStore.getState().setView("hot"); setTabState("review"); }} onOpenPrivileged={() => { useReviewStore.getState().setView("privileged"); setTabState("review"); }} />
            <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 no-scrollbar" aria-label="Workspace tabs">
              {REVIEW_TABS.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => setTabState(t.id)}
                  className={cn("relative flex h-9 shrink-0 items-center gap-1.5 px-3 text-[13px] font-medium transition-colors cursor-pointer", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                  aria-current={tab === t.id ? "page" : undefined}
                >
                  {t.label}
                  {t.id === "review" && stats.data && <CountChip>{stats.data.total.toLocaleString()}</CountChip>}
                  {t.id === "codes" && !!queue.pending && <Tip label={`${queue.pending} AI record${queue.pending === 1 ? "" : "s"} need review`}><CountChip tone="warning">{queue.pending}</CountChip></Tip>}
                  <span className="sr-only">shortcut {i + 1}</span>
                  {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
                </button>
              ))}
            </nav>
          </>
        )}
        <div className="min-h-0 flex-1">
          {tab === "review" && <ReviewTabView key={matterId} />}
          {tab === "depositions" && <DepositionsTab matterId={matterId} onOpenDocument={openDocument} />}
          {tab === "cross" && <CrossAnalysisTab matterId={matterId} onOpenDocument={openDocument} />}
          {tab === "timeline" && <TimelineTab matterId={matterId} onOpenDocument={openDocument} />}
          {tab === "people" && <PeopleGraphTab matterId={matterId} onOpenDocument={openDocument} />}
          {tab === "conflicts" && <ConflictsTab matterId={matterId} onOpenDocument={openDocument} />}
          {tab === "codes" && <CodesTab key={matterId} initialSection={props.initialCodesSection} />}
        </div>
      </div>

      <PredictDialog open={predictOpen} onOpenChange={setPredictOpen} />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Review faster without leaving the keyboard.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {([
              ["j / k", "Next / previous document"], ["Enter", "Open selected document"], ["Space", "Toggle selection"], ["Shift + click", "Select a range"],
              ["Esc", "Close viewer / clear selection"], ["Ctrl/⌘ + S", "Save coding and advance"], ["Ctrl/⌘ + A", "Select all in view"], ["F", "Full-screen viewer"],
              ["/", "Focus search"], ["1 – 7", "Switch workspace tab"], ["R / N / P / H", "Responsive / Non-resp. / Privileged / Hot (viewer)"], ["?", "This help"],
            ] as [string, string][]).map(([k, v]) => (
              <React.Fragment key={k}><div className="flex items-center gap-1 text-xs">{k.split(" / ").map((x, i) => <React.Fragment key={x}>{i > 0 && <span className="text-muted-foreground">/</span>}<Kbd>{x}</Kbd></React.Fragment>)}</div><div className="text-muted-foreground">{v}</div></React.Fragment>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </ReviewContext.Provider>
  );
}
