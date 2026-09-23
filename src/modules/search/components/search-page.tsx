"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookOpen, ChevronRight, History, Loader2, Scale, Search as SearchIcon, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tip } from "@/components/ui/tooltip";
import type { Matter } from "@/lib/types/domain";
import { jurisdictionByKey } from "../jurisdictions";
import { formatBluebook } from "../normalize";
import { extractTerms } from "../query-builder";
import type { SavedSearch, SearchHit, SearchRun, SearchSettings, SearchSource } from "../types";
import { useSearchStore } from "./store";
import { useSearch } from "./use-search";
import { QueryBar } from "./query-bar";
import { ResultsPane } from "./results-pane";
import { SynthesisPane } from "./synthesis-pane";
import { ReaderDrawer } from "./reader-drawer";
import { MemoTray } from "./memo-tray";
import { HistoryPanel } from "./history-panel";
import { CiteChecker } from "./citecheck";

export interface SearchPageProps {
  initialQuery?: string;
  initialTool?: string;
  saved: SavedSearch[];
  runs: SearchRun[];
  matters: Pick<Matter, "id" | "shortName" | "name" | "caption">[];
  aiConfigured: boolean;
  userName: string;
}

const EXAMPLES = [
  '"failure to warn" AND (PFAS OR PFOA) — 4th Cir.',
  "Is a consequential damages waiver enforceable against a claim for gross negligence under Illinois law?",
  "clear evidence standard for impossibility preemption after Albrecht",
  "PAGA manageability after Estrada v. Royalty Carpet Mills",
  "TSCA 8(e) substantial risk reporting deadline",
  "government contractor defense Boyle AFFF MilSpec",
];

export function SearchPage(props: SearchPageProps) {
  const router = useRouter();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const urlTool = params.get("tool") ?? props.initialTool ?? "";

  // ---- store (persisted settings, memo) ----
  const hydrated = useSearchStore((s) => s.hydrated);
  const settings = useSearchStore((s) => s.settings);
  const memo = useSearchStore((s) => s.memo);
  const memoOpen = useSearchStore((s) => s.memoOpen);
  const recentQueries = useSearchStore((s) => s.recentQueries);
  const { setSettings, replaceSettings, toggleSource, addToMemo, setMemoOpen, setMemoField, pushRecentQuery, setHydrated } = useSearchStore.getState();
  React.useEffect(() => { void useSearchStore.persist.rehydrate(); setHydrated(true); }, [setHydrated]);

  // ---- page state ----
  const [query, setQuery] = React.useState(props.initialQuery ?? urlQ);
  const [tool, setTool] = React.useState<"research" | "citecheck">(urlTool === "citecheck" ? "citecheck" : "research");
  const [saved, setSaved] = React.useState<SavedSearch[]>(props.saved);
  const [runs, setRuns] = React.useState<SearchRun[]>(props.runs);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeSource, setActiveSource] = React.useState<SearchSource | null>(null);
  const [visible, setVisible] = React.useState<SearchHit[]>([]);
  const [filter, setFilter] = React.useState("");
  const [readerHit, setReaderHit] = React.useState<SearchHit | null>(null);
  const [readerOpen, setReaderOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const refreshHistory = React.useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([fetch("/api/search/history?limit=40&full=1"), fetch("/api/search/saved")]);
      if (r1.ok) setRuns(((await r1.json()) as { runs: SearchRun[] }).runs);
      if (r2.ok) setSaved(((await r2.json()) as { saved: SavedSearch[] }).saved);
    } catch { /* offline */ }
  }, []);

  const search = useSearch({ onRunDone: () => void refreshHistory(), onError: (m) => { if (!/OPENAI_API_KEY/i.test(m)) toast.error("Synthesis failed", { description: m }); } });
  const { run, agent } = search;
  const terms = React.useMemo(() => extractTerms(run.query || query), [run.query, query]);
  const memoIds = React.useMemo(() => new Set(memo.map((m) => m.hit.id)), [memo]);
  const mode: "home" | "results" = run.runId ? "results" : "home";
  const currentMatter = React.useMemo(() => props.matters.find((m) => m.id === (run.settings?.matterId ?? settings.matterId)) ?? null, [props.matters, run.settings, settings.matterId]);
  const synthesisText = React.useMemo(() => agent.messages.find((m) => m.role === "assistant" && m.content)?.content ?? "", [agent.messages]);

  // ---- actions ----
  const submit = React.useCallback((q?: string, override?: SearchSettings, extra: { savedSearchId?: string } = {}) => {
    const text = (q ?? query).trim();
    if (!text) { inputRef.current?.focus(); return; }
    const s = override ?? useSearchStore.getState().settings;
    if (q !== undefined) setQuery(text);
    pushRecentQuery(text);
    setSelectedId(null);
    setFilter("");
    setActiveSource((cur) => (cur && s.sources.includes(cur) ? cur : s.sources[0] ?? null));
    const savedMatch = extra.savedSearchId ?? saved.find((x) => x.query.trim() === text)?.id;
    search.start(text, s, { savedSearchId: savedMatch });
    try { window.history.replaceState(null, "", `/search?q=${encodeURIComponent(text)}`); } catch { /* ignore */ }
  }, [query, saved, search, pushRecentQuery]);

  // auto-run from ?q= (command palette, deep links) once settings are hydrated
  const lastAutoRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!hydrated || !urlQ.trim() || tool === "citecheck") return;
    if (lastAutoRef.current === urlQ) return;
    lastAutoRef.current = urlQ;
    submit(urlQ);
  }, [hydrated, urlQ, tool, submit]);

  const copyCite = React.useCallback((hit: SearchHit) => {
    const cite = formatBluebook(hit);
    navigator.clipboard.writeText(cite).then(() => toast.success("Citation copied", { description: cite })).catch(() => toast.error("Clipboard unavailable"));
  }, []);

  const saveToLibrary = React.useCallback(async (hit: SearchHit) => {
    try {
      const res = await fetch("/api/search/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hit, matterId: useSearchStore.getState().settings.matterId }) });
      const j = (await res.json()) as { item?: { id: string; name: string }; error?: string };
      if (!res.ok || !j.item) throw new Error(j.error ?? res.statusText);
      toast.success("Saved to firm library", { description: "Library → Saved research", action: { label: "Open library", onClick: () => router.push(`/library?item=${j.item!.id}`) } });
    } catch (e) { toast.error("Could not save to library", { description: e instanceof Error ? e.message : String(e) }); }
  }, [router]);

  const memoAdd = React.useCallback((hit: SearchHit) => {
    const r = addToMemo(hit);
    if (r === "exists") { toast.info("Already in the memo"); return; }
    const n = useSearchStore.getState().memo.length;
    toast.success(`Added to memo (${n})`, { action: { label: "Open memo", onClick: () => setMemoOpen(true) } });
  }, [addToMemo, setMemoOpen]);

  const openHit = React.useCallback((hit: SearchHit) => { setReaderHit(hit); setReaderOpen(true); setSelectedId(hit.id); }, []);

  const runSaved = React.useCallback((s: SavedSearch) => { replaceSettings(s.settings); setHistoryOpen(false); setTool("research"); submit(s.query, s.settings, { savedSearchId: s.id }); }, [replaceSettings, submit]);
  const restoreRun = React.useCallback((r: SearchRun) => { replaceSettings(r.settings); setQuery(r.query); setHistoryOpen(false); setTool("research"); setSelectedId(null); setActiveSource(r.settings.sources[0] ?? null); search.restore(r); try { window.history.replaceState(null, "", `/search?q=${encodeURIComponent(r.query)}`); } catch { /* ignore */ } }, [replaceSettings, search]);
  const rerun = React.useCallback((r: SearchRun) => { replaceSettings(r.settings); setHistoryOpen(false); setTool("research"); submit(r.query, r.settings, { savedSearchId: r.savedSearchId }); }, [replaceSettings, submit]);

  const togglePin = async (s: SavedSearch) => { await fetch(`/api/search/saved/${s.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !s.pinned }) }); void refreshHistory(); };
  const deleteSaved = async (s: SavedSearch) => { await fetch(`/api/search/saved/${s.id}`, { method: "DELETE" }); toast.success("Saved search deleted"); void refreshHistory(); };
  const deleteRun = async (r: SearchRun) => { await fetch(`/api/search/history/${r.id}`, { method: "DELETE" }); void refreshHistory(); };

  const saveSearch = async () => {
    const q = (run.query || query).trim();
    if (!q) return;
    setSaving(true);
    try {
      const res = await fetch("/api/search/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: saveName.trim() || undefined, query: q, settings: run.settings ?? settings }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
      toast.success("Search saved");
      setSaveOpen(false); setSaveName("");
      void refreshHistory();
    } catch (e) { toast.error("Could not save search", { description: e instanceof Error ? e.message : String(e) }); } finally { setSaving(false); }
  };

  const switchTool = (t: "research" | "citecheck") => {
    setTool(t);
    try { window.history.replaceState(null, "", t === "citecheck" ? "/search?tool=citecheck" : run.query ? `/search?q=${encodeURIComponent(run.query)}` : "/search"); } catch { /* ignore */ }
  };

  // ---- keyboard: j/k move, Enter open, c cite, m memo, / focus ----
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" && !typing) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); return; }
      if (typing || readerOpen || mode !== "results" || tool !== "research") return;
      const idx = visible.findIndex((h) => h.id === selectedId);
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); const next = visible[Math.min(visible.length - 1, idx + 1)]; if (next) setSelectedId(next.id); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); const prev = visible[Math.max(0, idx <= 0 ? 0 : idx - 1)]; if (prev) setSelectedId(prev.id); }
      else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); openHit(visible[idx]); }
      else if (e.key === "c" && idx >= 0) { e.preventDefault(); copyCite(visible[idx]); }
      else if (e.key === "m" && idx >= 0) { e.preventDefault(); memoAdd(visible[idx]); }
      else if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, readerOpen, mode, tool, openHit, copyCite, memoAdd]);

  // When the active tab finishes empty (or errors) and another source has hits, jump to it — unless the user picked a tab this run.
  const userPickedTabRef = React.useRef(false);
  React.useEffect(() => { userPickedTabRef.current = false; }, [run.runId]);
  React.useEffect(() => {
    if (!run.settings || userPickedTabRef.current) return;
    const cur = activeSource ? run.sources[activeSource] : null;
    if (cur && (cur.status === "loading" || cur.hits.length > 0)) return;
    const next = run.settings.sources.find((s) => run.sources[s].hits.length > 0);
    if (next && next !== activeSource) setActiveSource(next);
  }, [run.sources, run.settings, activeSource]);

  const jurisdictionLabel = jurisdictionByKey(run.settings?.jurisdiction ?? settings.jurisdiction).label;
  const loadingCount = run.settings ? run.settings.sources.filter((s) => run.sources[s].status === "loading").length : 0;

  const topbar = (
    <TopbarSlot>
      <SearchIcon className="size-4 text-muted-foreground" />
      <button onClick={() => { search.clear(); setQuery(""); setTool("research"); try { window.history.replaceState(null, "", "/search"); } catch { /* ignore */ } }} className="text-sm font-semibold hover:text-primary cursor-pointer">Search</button>
      {tool === "citecheck" ? (
        <><ChevronRight className="size-3.5 text-muted-foreground" /><span className="text-sm text-muted-foreground">Citation checker</span></>
      ) : run.query ? (
        <><ChevronRight className="size-3.5 text-muted-foreground" /><span className="max-w-[28vw] truncate font-mono text-xs text-muted-foreground" title={run.query}>{run.query}</span>{search.isStreaming || loadingCount > 0 ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}</>
      ) : null}
      <div className="ml-2 hidden items-center rounded-md border p-0.5 md:flex">
        <button onClick={() => switchTool("research")} className={cn("flex h-6 items-center gap-1 rounded px-2 text-[11px] cursor-pointer", tool === "research" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground")}><Scale className="size-3" /> Research</button>
        <button onClick={() => switchTool("citecheck")} className={cn("flex h-6 items-center gap-1 rounded px-2 text-[11px] cursor-pointer", tool === "citecheck" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground")}><ShieldCheck className="size-3" /> Citation checker</button>
      </div>
      <div className="flex-1" />
      {currentMatter && <Badge variant="outline" className="hidden lg:inline-flex max-w-[220px] truncate">{currentMatter.shortName}{currentMatter.caption ? ` · ${currentMatter.caption}` : ""}</Badge>}
      {!props.aiConfigured && <Tip label="AI synthesis disabled until OPENAI_API_KEY is set"><Link href="/settings#ai"><Badge variant="warning" className="cursor-pointer">No OpenAI key</Badge></Link></Tip>}
      <Tip label="Saved searches & history"><Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}><History className="size-4" /> <span className="hidden sm:inline">History</span></Button></Tip>
      {mode === "results" && tool === "research" && (
        <Popover open={saveOpen} onOpenChange={setSaveOpen}>
          <PopoverTrigger asChild><Button variant="ghost" size="sm"><Bookmark className="size-4" /> <span className="hidden sm:inline">Save search</span></Button></PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-2 p-3">
            <div className="text-xs font-medium">Save this search</div>
            <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={run.query.slice(0, 60)} className="h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter") void saveSearch(); }} autoFocus />
            <div className="text-[11px] text-muted-foreground">Keeps the query, sources, jurisdiction, dates and matter context.</div>
            <Button size="sm" className="w-full" onClick={saveSearch} disabled={saving}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />} Save</Button>
          </PopoverContent>
        </Popover>
      )}
      <Tip label={memoOpen ? "Hide memo tray" : "Show memo tray"}><Button variant={memoOpen ? "secondary" : "ghost"} size="sm" onClick={() => setMemoOpen(!memoOpen)}><BookOpen className="size-4" /> <span className="hidden sm:inline">Memo</span>{memo.length > 0 && <Badge variant={memoOpen ? "default" : "muted"} className="ml-0.5 py-0 tabular">{memo.length}</Badge>}</Button></Tip>
    </TopbarSlot>
  );

  const queryBar = (compact: boolean) => (
    <QueryBar
      value={query}
      onChange={setQuery}
      onSubmit={(q) => submit(q)}
      settings={settings}
      setSettings={setSettings}
      toggleSource={toggleSource}
      matters={props.matters}
      streaming={search.isStreaming || loadingCount > 0}
      onStop={search.stop}
      compact={compact}
      autoFocus={!compact}
      aiConfigured={props.aiConfigured}
      inputRef={inputRef}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {topbar}

      {tool === "citecheck" ? (
        <CiteChecker matterId={settings.matterId} />
      ) : mode === "home" ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto w-full max-w-5xl px-6 pb-10 pt-8">
            <div className="mb-4">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><Sparkles className="size-3.5 text-primary" /> Legal research agent</div>
              <h1 className="text-2xl font-semibold tracking-tight">Search the law and the firm&apos;s knowledge</h1>
              <p className="mt-1 text-sm text-muted-foreground">Case law, statutes, regulations, the Federal Register, dockets, the web, the firm library and matter documents — retrieved in parallel and synthesized with an answer first, numbered citations, caveats and contrary authority.</p>
            </div>
            {queryBar(false)}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Try:</span>
              {(recentQueries.length ? recentQueries.slice(0, 3) : []).concat(EXAMPLES).slice(0, 7).map((ex) => (
                <button key={ex} onClick={() => { const q = ex.replace(/\s+—\s+4th Cir\.$/, ""); if (/4th Cir\.$/.test(ex)) setSettings({ jurisdiction: "4th-circuit" }); setQuery(q); submit(q); }} className="max-w-full truncate rounded-full border px-2.5 py-0.5 text-[11.5px] text-muted-foreground hover:border-foreground/25 hover:bg-accent hover:text-foreground cursor-pointer" title={ex}>{ex}</button>
              ))}
            </div>
            <div className="mt-8">
              <HistoryPanel saved={saved} runs={runs.slice(0, 12)} matters={props.matters} onRunSaved={runSaved} onTogglePin={togglePin} onDeleteSaved={deleteSaved} onRestore={restoreRun} onRerun={rerun} onDeleteRun={deleteRun} layout="columns" />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur">{queryBar(true)}</div>
          <div className="min-h-0 flex-1">
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel defaultSize="38" minSize="24">
                <SynthesisPane agent={agent} run={run} aiConfigured={props.aiConfigured} onFollowUp={search.followUp} onAddToMemo={(t) => { setMemoField("memoSynthesis", t); if (!useSearchStore.getState().memoQuestion) setMemoField("memoQuestion", run.query); setMemoOpen(true); toast.success("Synthesis added to the memo"); }} userName={props.userName} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={memoOpen ? "40" : "62"} minSize="28">
                <ResultsPane
                  run={run}
                  terms={terms}
                  order={settings.order}
                  onOrderChange={(o) => setSettings({ order: o })}
                  activeSource={activeSource}
                  onActiveSourceChange={(s) => { userPickedTabRef.current = true; setActiveSource(s); setSelectedId(null); }}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  memoIds={memoIds}
                  onOpen={openHit}
                  onCite={copyCite}
                  onSave={saveToLibrary}
                  onMemo={memoAdd}
                  onRetry={(s) => void search.retrySource(s)}
                  filter={filter}
                  onFilterChange={setFilter}
                  onVisibleChange={setVisible}
                />
              </ResizablePanel>
              {memoOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize="22" minSize="16">
                    <MemoTray jurisdictionLabel={jurisdictionLabel} matter={currentMatter ? { id: currentMatter.id, name: currentMatter.name, caption: currentMatter.caption } : null} currentQuery={run.query} currentSynthesis={synthesisText} onClose={() => setMemoOpen(false)} onOpenHit={openHit} userName={props.userName} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </>
      )}

      {/* Memo tray is also reachable from the home and cite-check views as a drawer */}
      {memoOpen && (mode === "home" || tool === "citecheck") && (
        <Sheet open onOpenChange={(o) => setMemoOpen(o)}>
          <SheetContent side="right" width="max-w-md" className="p-0">
            <MemoTray jurisdictionLabel={jurisdictionLabel} matter={currentMatter ? { id: currentMatter.id, name: currentMatter.name, caption: currentMatter.caption } : null} currentQuery={run.query || query} currentSynthesis={synthesisText} onClose={() => setMemoOpen(false)} onOpenHit={openHit} userName={props.userName} />
          </SheetContent>
        </Sheet>
      )}

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" width="max-w-lg" className="p-0">
          <SheetHeader><SheetTitle className="flex items-center gap-2"><History className="size-4" /> Saved searches & history</SheetTitle></SheetHeader>
          <SheetBody>
            <HistoryPanel saved={saved} runs={runs} matters={props.matters} onRunSaved={runSaved} onTogglePin={togglePin} onDeleteSaved={deleteSaved} onRestore={restoreRun} onRerun={rerun} onDeleteRun={deleteRun} layout="stack" />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ReaderDrawer hit={readerHit} open={readerOpen} onOpenChange={setReaderOpen} onCite={copyCite} onMemo={memoAdd} onSave={saveToLibrary} inMemo={readerHit ? memoIds.has(readerHit.id) : false} aiConfigured={props.aiConfigured} terms={terms} />
    </div>
  );
}
