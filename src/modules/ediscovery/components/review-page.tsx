"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, FileSearch, KeyRound, Keyboard, RefreshCw, Sparkles, Maximize2, Minimize2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { useShellStore } from "@/components/shell/shell-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REVIEW_TABS, type ReviewTab } from "../types";
import { DepositionsTab, CrossAnalysisTab, TimelineTab, PeopleGraphTab, ConflictsTab } from "../analysis";
import { useReviewStore } from "./store";
import { api, useIssueCodes, useStats } from "./use-review-data";
import { MatterHeader } from "./matter-header";
import { ReviewTab as ReviewTabView } from "./review-tab";
import { CodesTab } from "./codes-tab";
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
  refreshIssueCodes: () => void;
  refreshStats: () => void;
  openDocument: (id: string) => void;
  setTab: (tab: ReviewTab) => void;
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
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.getAttribute("role") === "combobox");
      if (e.key === "?" && !typing) { e.preventDefault(); setHelpOpen((o) => !o); }
      if (e.key === "/" && !typing) { e.preventDefault(); document.getElementById("ediscovery-search")?.focus(); }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[1-7]$/.test(e.key)) { const t2 = REVIEW_TABS[Number(e.key) - 1]; if (t2) setTabState(t2.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = React.useMemo<ReviewContextValue>(() => ({
    matterId, matter, aiConfigured: props.aiConfigured, reviewers: props.reviewers, currentUserId: props.currentUserId,
    issueCodes: codes.data?.codes ?? [], refreshIssueCodes: codes.refresh, refreshStats: stats.refresh, openDocument, setTab,
  }), [matterId, matter, props.aiConfigured, props.reviewers, props.currentUserId, codes.data, codes.refresh, stats.refresh, openDocument, setTab]);

  const fullscreen = store.fullscreen && tab === "review" && !!store.openDocId;

  return (
    <ReviewContext.Provider value={ctx}>
      <TopbarSlot>
        <FileSearch className="size-4 text-muted-foreground" />
        <span className="shrink-0 text-sm font-semibold">E-Discovery</span>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <Select value={matterId} onValueChange={changeMatter}>
          <SelectTrigger size="sm" className="h-7 w-auto max-w-[280px] gap-1.5 border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none hover:bg-accent" aria-label="Matter">
            <SelectValue />
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
        <Tip label="Score unreviewed documents for responsiveness (batch AI)"><Button variant="ghost" size="sm" onClick={() => setPredictOpen(true)}><Sparkles className="size-4" /> <span className="hidden lg:inline">AI predict</span></Button></Tip>
        <Tip label="Rebuild the search index for this matter"><Button variant="ghost" size="sm" onClick={rebuildIndex} disabled={indexing}>{indexing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} <span className="hidden lg:inline">Reindex</span></Button></Tip>
        {tab === "review" && store.openDocId && (
          <Tip label={store.fullscreen ? "Exit full-screen viewer" : "Full-screen viewer"} shortcut="F"><Button variant="ghost" size="icon-sm" onClick={() => store.setFullscreen(!store.fullscreen)} aria-label="Toggle full screen">{store.fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button></Tip>
        )}
        <Tip label="Keyboard shortcuts" shortcut="?"><Button variant="ghost" size="icon-sm" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts"><Keyboard className="size-4" /></Button></Tip>
      </TopbarSlot>

      <div className="flex h-full min-h-0 flex-col">
        {!fullscreen && (
          <>
            <MatterHeader matter={matter} stats={stats.data} loading={stats.loading} onOpenCodes={() => setTabState("codes")} />
            <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 no-scrollbar" aria-label="Workspace tabs">
              {REVIEW_TABS.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => setTabState(t.id)}
                  className={cn("relative flex h-9 shrink-0 items-center gap-1.5 px-3 text-[13px] font-medium transition-colors cursor-pointer", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                  aria-current={tab === t.id ? "page" : undefined}
                >
                  {t.label}
                  {t.id === "review" && stats.data && <span className="rounded bg-muted px-1 py-px text-[10px] tabular text-muted-foreground">{stats.data.total.toLocaleString()}</span>}
                  {t.id === "codes" && stats.data && stats.data.privileged > 0 && <span className="rounded bg-muted px-1 py-px text-[10px] tabular text-muted-foreground">{stats.data.privileged} priv</span>}
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
          {tab === "codes" && <CodesTab key={matterId} />}
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
