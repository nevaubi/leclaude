"use client";
import * as React from "react";
import { BookOpen, Download, FileText, Globe, Loader2, MoreHorizontal, PenLine, Plus, ScrollText, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Inspector } from "@/components/ui/inspector";
import { Field, KeyValueList, SegmentedControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ai/markdown";
import { TrustBadge } from "@/components/ai/trust-badge";
import type { Provenance } from "@/lib/integrity/types";
import { formatCite, type AnalysisTabProps, type DepositionSummary, type Story, type StoryCiteReport, type StoryEvidence, type StoryFact, type StorySummary } from "../types";
import { formatEventDate } from "../chronology";
import { parseRange } from "../transcript";
import { CiteChip, ConfidenceText, KeyHint, NoKeyCallout, formatShortDate, useNarrowViewport } from "./shared";
import { api, downloadFile, exportMarkdownToWord, isNoKey, useDepositions, useOpenTestimony, useOptionalReview, useOverview, useStories, useStory } from "./use-analysis-data";

type View = "facts" | "narrative";
type BuildFrom = "timeline" | "testimony" | "intel";
const ORIGIN_LABEL: Record<string, string> = { timeline: "chronology", testimony: "testimony", intel: "intelligence", user: "typed", ai: "model" };

export function StoryTab({ matterId, onOpenDocument }: AnalysisTabProps) {
  const stories = useStories(matterId);
  const overview = useOverview(matterId);
  const deps = useDepositions(matterId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View>("facts");
  const [activeFactId, setActiveFactId] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<StoryCiteReport | null>(null);
  const [buildOpen, setBuildOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<"verify" | "draft" | null>(null);
  const [noKey, setNoKey] = React.useState(false);
  const [audience, setAudience] = React.useState<"memo" | "brief" | "opening">("memo");
  const narrow = useNarrowViewport(1280);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const list = React.useMemo(() => stories.data?.stories ?? [], [stories.data]);
  const aiConfigured = !!overview.data?.aiConfigured;

  React.useEffect(() => {
    if (selectedId || !list.length) return;
    const fromUrl = new URL(window.location.href).searchParams.get("story");
    setSelectedId(fromUrl && list.some((s) => s.id === fromUrl) ? fromUrl : list[0].id);
  }, [list, selectedId]);
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("story", selectedId); else url.searchParams.delete("story");
    window.history.replaceState(window.history.state, "", url.toString());
    return () => { const u = new URL(window.location.href); u.searchParams.delete("story"); window.history.replaceState(window.history.state, "", u.toString()); };
  }, [selectedId]);
  React.useEffect(() => { setReport(null); setActiveFactId(null); }, [selectedId]);

  const detail = useStory(selectedId);
  const story = detail.data?.story ?? null;
  const facts = React.useMemo(() => story?.facts ?? [], [story]);
  const activeFact = facts.find((f) => f.id === activeFactId) ?? null;

  const refreshAll = () => { stories.refresh(); detail.refresh(); };
  const patchStory = async (body: Record<string, unknown>) => {
    if (!story) return null;
    try { const r = await api<{ story: Story }>(`/api/ediscovery/analysis/stories/${story.id}`, { method: "PATCH", json: body }); detail.mutate((cur) => (cur ? { ...cur, story: r.story } : cur)); stories.refresh(); return r.story; }
    catch (e) { toast.error("Could not save", { description: (e as Error).message }); return null; }
  };
  const verify = async () => {
    if (!story) return;
    setBusy("verify");
    try {
      const r = await api<{ story: Story; report: StoryCiteReport }>(`/api/ediscovery/analysis/stories/${story.id}/verify`, { method: "POST" });
      detail.mutate((cur) => (cur ? { ...cur, story: r.story } : cur)); stories.refresh(); setReport(r.report);
      if (r.report.unresolved.length) toast.warning(`${r.report.unresolved.length} cite${r.report.unresolved.length === 1 ? "" : "s"} did not resolve`, { description: `${r.report.resolved} of ${r.report.checked} cites are in the record. Unresolved cites are marked in the fact table.` });
      else toast.success("Every cite resolves against the record", { description: `${r.report.checked} cites checked` });
    } catch (e) { toast.error("Verification failed", { description: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const draft = async () => {
    if (!story) return;
    setBusy("draft"); setNoKey(false);
    try {
      const r = await api<{ text: string; provenance: Provenance; unresolvedCites: string[] }>(`/api/ediscovery/analysis/stories/${story.id}/draft`, { method: "POST", json: { audience } });
      detail.refresh(); stories.refresh(); setView("narrative");
      toast.success("Narrative drafted", { description: r.unresolvedCites.length ? `${r.unresolvedCites.length} cite${r.unresolvedCites.length === 1 ? "" : "s"} marked [VERIFY]` : "Every cite in the draft resolves against the record" });
    } catch (e) { if (isNoKey(e)) setNoKey(true); else toast.error("Draft failed", { description: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const exportWord = async () => {
    if (!story) return;
    try { const md = await api<{ title: string; markdown: string }>(`/api/ediscovery/analysis/stories/${story.id}/export?format=markdown`); await exportMarkdownToWord({ title: md.title, markdown: md.markdown, matterId, tags: ["story", "chronology", "ediscovery"], meta: { storyId: story.id, facts: facts.length }, description: `${facts.length} facts with citations · filed in the matter folder` }); }
    catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
  };
  const removeStory = async () => {
    if (!story) return;
    try { await api(`/api/ediscovery/analysis/stories/${story.id}`, { method: "DELETE" }); toast.success("Story deleted"); setSelectedId(null); stories.refresh(); }
    catch (e) { toast.error("Could not delete", { description: (e as Error).message }); }
  };

  const unresolvedByFact = React.useMemo(() => { const m = new Map<string, string[]>(); for (const u of report?.unresolved ?? []) m.set(u.factId, [...(m.get(u.factId) ?? []), u.cite]); return m; }, [report]);
  const columns = React.useMemo<DataTableColumn<StoryFact>[]>(() => [
    { id: "order", header: "#", width: 36, align: "right", accessor: (f) => f.order, render: (f) => <span className="tabular text-muted-foreground">{f.order}</span>, locked: true },
    { id: "date", header: "Date", width: 104, sortable: true, accessor: (f) => f.date, render: (f) => <span className="tabular">{formatEventDate({ date: f.date, dateEnd: f.dateEnd, precision: f.precision })}</span>, locked: true },
    { id: "text", header: "Fact", width: 420, minWidth: 200, accessor: (f) => f.text, render: (f) => <span className="truncate" title={f.text}>{f.text}</span>, locked: true },
    { id: "evidence", header: "Evidence", width: 220, accessor: (f) => f.evidence.length, render: (f) => { const bad = unresolvedByFact.get(f.id) ?? []; return <span className="flex min-w-0 items-center gap-1 overflow-hidden"><span className="tabular text-muted-foreground">{f.evidence.length}</span>{f.evidence.slice(0, 3).map((e, i) => { const c = formatCite(e); return <CiteChip key={i} cite={c} kind={e.kind === "event" ? "external" : e.kind === "testimony" ? "deposition" : e.kind} unresolved={bad.includes(c)} />; })}{f.evidence.length > 3 && <span className="text-[10.5px] text-muted-foreground">+{f.evidence.length - 3}</span>}</span>; } },
    { id: "confidence", header: "Conf.", width: 56, align: "right", sortable: true, accessor: (f) => f.confidence, render: (f) => <ConfidenceText value={f.confidence} /> },
    { id: "disputed", header: "Disputed", width: 76, sortable: true, accessor: (f) => (f.disputed ? 1 : 0), render: (f) => (f.disputed ? <span className="rounded border border-warning/40 bg-warning/18 px-1.5 text-[10.5px] text-warning-foreground dark:text-warning">disputed</span> : <span className="text-muted-foreground/60">—</span>) },
    { id: "verified", header: "Cites", width: 64, sortable: true, accessor: (f) => (f.verified ? 1 : 0), render: (f) => (f.verified ? <span className="inline-flex items-center gap-1 text-[11px] text-success"><ShieldCheck className="size-3" /> resolve</span> : unresolvedByFact.get(f.id)?.length ? <span className="text-[11px] text-warning-foreground dark:text-warning">unresolved</span> : <span className="text-[11px] text-muted-foreground">unchecked</span>), title: "Whether every cite resolved against the record on the last check" },
    { id: "origin", header: "Origin", width: 84, sortable: true, accessor: (f) => f.origin ?? "user", render: (f) => <span className="text-muted-foreground">{ORIGIN_LABEL[f.origin ?? "user"] ?? f.origin}</span>, defaultHidden: true },
  ], [unresolvedByFact]);

  const storyColumns = React.useMemo<DataTableColumn<StorySummary>[]>(() => [
    { id: "title", header: "Story", width: 170, minWidth: 120, sortable: true, locked: true, accessor: (s) => s.title, render: (s) => <span className="truncate" title={s.title}>{s.title}</span> },
    { id: "factCount", header: "Facts", width: 48, align: "right", sortable: true, accessor: (s) => s.factCount, render: (s) => <span className="tabular">{s.factCount}</span> },
    { id: "updatedAt", header: "Updated", width: 76, sortable: true, accessor: (s) => s.updatedAt, render: (s) => <span className="tabular text-muted-foreground">{formatShortDate(s.updatedAt.slice(0, 10))}</span>, defaultHidden: true },
  ], []);

  const summary = story ? `${facts.length} fact${facts.length === 1 ? "" : "s"}${facts.length ? ` · ${facts[0].date.slice(0, 4)}–${facts[facts.length - 1].date.slice(0, 4)}` : ""} · ${facts.filter((f) => f.disputed).length} disputed · ${facts.filter((f) => f.verified).length} with resolved cites` : "";
  const inspectorVisible = !narrow || inspectorOpen;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[260px] shrink-0 flex-col border-r bg-sidebar/40" aria-label="Stories">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
          <span className="text-[12.5px] font-semibold">Stories</span>
          <span className="text-[11px] tabular text-muted-foreground">{list.length}</span>
          <span className="flex-1" />
          <Tip label="New empty story"><Button size="icon-xs" variant="ghost" onClick={() => setNewOpen(true)} aria-label="New story"><Plus className="size-4" /></Button></Tip>
        </div>
        <div className="min-h-0 flex-1">
          <DataTable<StorySummary> rows={list} columns={storyColumns} rowId={(s) => s.id} selectionMode="single" activeId={selectedId} onActiveChange={(id) => id && setSelectedId(id)} onRowActivate={(s) => setSelectedId(s.id)} density="compact" columnChooser={false} summary={false} loading={stories.loading && !stories.data} error={stories.error?.message ?? null} empty={<EmptyState icon={BookOpen} title="No stories yet" description="A story is an ordered set of dated facts, each tied to documents by Bates, testimony by page:line and intelligence by record." action={<Button size="xs" onClick={() => setBuildOpen(true)}>Build from the chronology</Button>} compact />} ariaLabel="Stories" />
        </div>
        <div className="border-t p-2"><Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setBuildOpen(true)}><Plus className="size-4" /> Build from…</Button></div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {!story ? (
          <div className="flex h-full items-center justify-center p-8">{detail.loading || (stories.loading && !stories.data) ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <EmptyState icon={BookOpen} title={list.length ? "Select a story" : "Start a story"} description={list.length ? "Choose a story on the left." : "Build the first story from the chronology, from flagged testimony or from the intelligence record, then draft it to Word."} action={<Button size="sm" onClick={() => setBuildOpen(true)}><Plus className="size-4" /> Build from…</Button>} />}</div>
        ) : (
          <>
            <div className="toolbar flex-wrap gap-y-1 !h-auto !min-h-9 py-1">
              <div className="min-w-0"><div className="truncate text-[13px] font-semibold leading-tight">{story.title}</div><div className="truncate text-[11px] tabular text-muted-foreground">{story.theme ? `${story.theme} · ` : ""}{summary}</div></div>
              <span className="flex-1" />
              <SegmentedControl<View> size="xs" value={view} onChange={setView} options={[{ value: "facts", label: "Facts" }, { value: "narrative", label: story.narrative ? "Narrative" : "Narrative (none)" }]} ariaLabel="Story view" />
              <Button size="xs" variant="outline" onClick={() => { setActiveFactId("__new"); if (narrow) setInspectorOpen(true); }}><Plus className="size-3.5" /> Add fact</Button>
              <Button size="xs" variant="outline" onClick={() => setBuildOpen(true)}>Build from…</Button>
              <Tip label="Check every Bates, page:line and record id against the matter record"><Button size="xs" variant="outline" onClick={verify} disabled={busy === "verify" || !facts.length}>{busy === "verify" ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Verify cites</Button></Tip>
              <div className="flex items-center">
                <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}><SelectTrigger size="xs" className="h-7 w-[112px] rounded-r-none border-r-0 text-[11.5px]" aria-label="Narrative form"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="memo">Fact memo</SelectItem><SelectItem value="brief">Statement of facts</SelectItem><SelectItem value="opening">Opening narrative</SelectItem></SelectContent></Select>
                <KeyHint configured={aiConfigured}><Button size="xs" className="rounded-l-none" onClick={draft} disabled={busy === "draft" || !facts.length}>{busy === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />} Draft</Button></KeyHint>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="xs" variant="outline"><Download className="size-3.5" /> Export</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportWord}><FileText className="size-4" /> Word (facts, citations{story.narrative ? ", narrative" : ""})</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadFile(`/api/ediscovery/analysis/stories/${story.id}/export?format=csv`)}><Download className="size-4" /> CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => { try { const md = await api<{ markdown: string; filename: string }>(`/api/ediscovery/analysis/stories/${story.id}/export?format=markdown`); const { downloadText } = await import("./use-analysis-data"); downloadText(md.filename, md.markdown, "text/markdown;charset=utf-8"); } catch (e) { toast.error("Export failed", { description: (e as Error).message }); } }}><Download className="size-4" /> Markdown</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="Story actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { const title = window.prompt("Story title", story.title); if (title?.trim()) void patchStory({ title: title.trim() }); }}>Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { const theme = window.prompt("Theme", story.theme ?? ""); if (theme != null) void patchStory({ theme }); }}>Set theme</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onClick={removeStory}><Trash2 className="size-4" /> Delete story</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {noKey && <div className="shrink-0 border-b px-3 py-2"><NoKeyCallout feature="Narrative drafts" compact /></div>}
            <div className="relative flex min-h-0 flex-1">
              <div className="min-h-0 min-w-0 flex-1">
                {view === "facts" ? (
                  <DataTable<StoryFact> rows={facts} columns={columns} rowId={(f) => f.id} selectionMode="single" activeId={activeFactId === "__new" ? null : activeFactId} onActiveChange={(id) => { setActiveFactId(id); if (id && narrow) setInspectorOpen(true); }} onRowActivate={(f) => { setActiveFactId(f.id); if (narrow) setInspectorOpen(true); }} density="compact" noun="fact" summary={false} empty={<EmptyState icon={BookOpen} title="No facts yet" description="Add a fact by hand, or build facts from the chronology, from flagged testimony or from the intelligence record." action={<Button size="xs" onClick={() => setBuildOpen(true)}>Build from…</Button>} compact />} ariaLabel="Facts" />
                ) : (
                  <NarrativeView story={story} onDraft={draft} drafting={busy === "draft"} aiConfigured={aiConfigured} onExport={exportWord} />
                )}
              </div>
              {inspectorVisible && (activeFact || activeFactId === "__new") && (
                <div className={cn("shrink-0", narrow && "absolute inset-y-0 right-0 z-20 max-w-[85%] shadow-xl")}>
                  <FactInspector key={activeFactId} story={story} fact={activeFact} depositions={deps.data?.depositions ?? []} unresolved={activeFact ? unresolvedByFact.get(activeFact.id) ?? [] : []} onClose={() => { setActiveFactId(null); setInspectorOpen(false); }} onOpenDocument={onOpenDocument} onSaved={(s) => { detail.mutate((cur) => (cur ? { ...cur, story: s } : cur)); stories.refresh(); }} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <BuildDialog open={buildOpen} onOpenChange={setBuildOpen} matterId={matterId} story={story} depositions={deps.data?.depositions ?? []} onDone={(id) => { refreshAll(); setSelectedId(id); }} />
      <NewStoryDialog open={newOpen} onOpenChange={setNewOpen} matterId={matterId} onCreated={(s) => { stories.refresh(); setSelectedId(s.id); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function NarrativeView({ story, onDraft, drafting, aiConfigured, onExport }: { story: Story; onDraft: () => void; drafting: boolean; aiConfigured: boolean; onExport: () => void }) {
  const n = story.narrative;
  if (!n?.text) return <div className="flex h-full items-center justify-center p-8"><EmptyState icon={PenLine} title="No narrative yet" description="Draft a fact memo, a statement of facts or an opening narrative from the facts. The draft uses only the facts and their excerpts; every cite is checked against the record and the result carries a trust badge." action={<KeyHint configured={aiConfigured}><Button size="sm" onClick={onDraft} disabled={drafting || !story.facts.length}>{drafting ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />} Draft narrative</Button></KeyHint>} /></div>;
  const prov = n.provenance as Provenance | undefined;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[11px] text-muted-foreground">
        <TrustBadge provenance={prov} />
        <span className="tabular">Drafted {formatShortDate(n.generatedAt.slice(0, 10))}</span>
        {prov?.verification?.unresolvedCites?.length ? <span className="text-warning-foreground dark:text-warning">{prov.verification.unresolvedCites.length} cite{prov.verification.unresolvedCites.length === 1 ? "" : "s"} marked [VERIFY]</span> : null}
        <span className="flex-1" />
        <Button size="xs" variant="outline" onClick={onExport}><FileText className="size-3.5" /> Export to Word</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin"><div className="mx-auto max-w-[72ch] px-6 py-5"><Markdown>{n.text}</Markdown></div></div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type EvidenceDraft = { kind: "document"; bates: string; excerpt: string } | { kind: "testimony"; depositionId: string; range: string; excerpt: string } | { kind: "intel"; docId: string; title: string } | { kind: "event"; eventId: string; title: string };

function toDraft(e: StoryEvidence): EvidenceDraft {
  if (e.kind === "document") return { kind: "document", bates: e.bates, excerpt: e.excerpt ?? "" };
  if (e.kind === "testimony") return { kind: "testimony", depositionId: e.depositionId, range: `${e.page}:${String(e.line).padStart(2, "0")}${e.endPage != null && e.endLine != null ? `-${e.endPage}:${String(e.endLine).padStart(2, "0")}` : ""}`, excerpt: e.excerpt ?? "" };
  if (e.kind === "intel") return { kind: "intel", docId: e.docId, title: e.title ?? "" };
  return { kind: "event", eventId: e.eventId, title: e.title ?? "" };
}
function fromDraft(d: EvidenceDraft): StoryEvidence | null {
  if (d.kind === "document") return d.bates.trim() ? { kind: "document", bates: d.bates.trim().toUpperCase(), excerpt: d.excerpt.trim() || undefined } : null;
  if (d.kind === "testimony") { const r = parseRange(d.range); if (!r || !d.depositionId) return null; return { kind: "testimony", depositionId: d.depositionId, page: r.startPage, line: r.startLine, endPage: r.endPage !== r.startPage || r.endLine !== r.startLine ? r.endPage : undefined, endLine: r.endPage !== r.startPage || r.endLine !== r.startLine ? r.endLine : undefined, excerpt: d.excerpt.trim() || undefined }; }
  if (d.kind === "intel") return d.docId.trim() ? { kind: "intel", docId: d.docId.trim(), title: d.title.trim() || undefined } : null;
  return d.eventId.trim() ? { kind: "event", eventId: d.eventId.trim(), title: d.title.trim() || undefined } : null;
}

function FactInspector({ story, fact, depositions, unresolved, onClose, onOpenDocument, onSaved }: { story: Story; fact: StoryFact | null; depositions: DepositionSummary[]; unresolved: string[]; onClose: () => void; onOpenDocument?: (id: string) => void; onSaved: (s: Story) => void }) {
  const openTestimony = useOpenTestimony();
  const review = useOptionalReview();
  const [tab, setTab] = React.useState(fact ? "evidence" : "edit");
  const [date, setDate] = React.useState(fact?.date ?? new Date().toISOString().slice(0, 10));
  const [dateEnd, setDateEnd] = React.useState(fact?.dateEnd ?? "");
  const [precision, setPrecision] = React.useState<"day" | "month" | "year">(fact?.precision ?? "day");
  const [text, setText] = React.useState(fact?.text ?? "");
  const [confidence, setConfidence] = React.useState(String(Math.round((fact?.confidence ?? 0.8) * 100)));
  const [disputed, setDisputed] = React.useState(!!fact?.disputed);
  const [evidence, setEvidence] = React.useState<EvidenceDraft[]>((fact?.evidence ?? []).map(toDraft));
  const [saving, setSaving] = React.useState(false);
  const transcribed = depositions.filter((d) => d.qaCount > 0);
  const save = async () => {
    if (!text.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error("A fact needs text and an ISO date"); return; }
    const ev = evidence.map(fromDraft);
    if (ev.some((e) => !e)) { toast.error("Every evidence row needs a Bates number or a deposition with a page:line"); return; }
    setSaving(true);
    try {
      const body = { fact: { ...(fact ? { id: fact.id } : {}), date, dateEnd: dateEnd || undefined, precision, text: text.trim(), confidence: Math.max(0, Math.min(1, Number(confidence) / 100 || 0.8)), disputed, evidence: ev as StoryEvidence[], origin: fact?.origin ?? "user" } };
      const r = await api<{ story: Story }>(`/api/ediscovery/analysis/stories/${story.id}`, { method: "PATCH", json: body });
      onSaved(r.story); toast.success(fact ? "Fact saved" : "Fact added"); if (!fact) onClose();
    } catch (e) { toast.error("Could not save the fact", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!fact) return;
    try { const r = await api<{ story: Story }>(`/api/ediscovery/analysis/stories/${story.id}`, { method: "PATCH", json: { removeFactId: fact.id } }); onSaved(r.story); onClose(); toast.success("Fact removed"); }
    catch (e) { toast.error("Could not remove", { description: (e as Error).message }); }
  };
  const open = (e: StoryEvidence) => {
    if (e.kind === "document" && e.docId) onOpenDocument?.(e.docId);
    else if (e.kind === "testimony") openTestimony(e.depositionId, `${e.page}:${e.line}`);
    else if (e.kind === "intel") window.open(`/intel/documents/${encodeURIComponent(e.docId)}`, "_blank", "noopener");
    else if (e.kind === "event") { const url = new URL(window.location.href); url.searchParams.set("event", e.eventId); window.history.replaceState(window.history.state, "", url.toString()); if (review) review.setTab("timeline"); else toast.info("Open the Timeline tab to see the event"); }
  };
  const canOpen = (e: StoryEvidence) => (e.kind === "document" ? !!e.docId : true);
  const KIND_LABEL: Record<StoryEvidence["kind"], string> = { document: "Document", testimony: "Testimony", intel: "Intelligence", event: "Event" };
  return (
    <Inspector title={fact ? `Fact ${fact.order}` : "New fact"} subtitle={fact ? formatEventDate({ date: fact.date, dateEnd: fact.dateEnd, precision: fact.precision }) : "Dated, sourced, one statement"} width={360} onClose={onClose} tabs={fact ? [{ id: "evidence", label: "Evidence", count: fact.evidence.length }, { id: "edit", label: "Edit" }] : undefined} activeTab={fact ? tab : "edit"} onTabChange={setTab} actions={fact ? <Tip label="Remove this fact"><Button size="icon-xs" variant="ghost" className="hover:text-destructive" onClick={remove} aria-label="Remove fact"><Trash2 className="size-3.5" /></Button></Tip> : undefined}>
      {fact && tab === "evidence" && (
        <div>
          <div className="border-b px-3 py-2 text-[12.5px] leading-relaxed">{fact.text}</div>
          <div className="border-b px-3 py-2"><KeyValueList dense labelWidth={84} items={[{ label: "Confidence", value: <ConfidenceText value={fact.confidence} /> }, { label: "Disputed", value: fact.disputed ? "yes" : "no", muted: !fact.disputed }, { label: "Cites", value: fact.verified ? "resolve against the record" : unresolved.length ? `${unresolved.length} unresolved` : "not checked yet", muted: !fact.verified }, { label: "Origin", value: ORIGIN_LABEL[fact.origin ?? "user"] ?? fact.origin }]} /></div>
          {!fact.evidence.length ? <div className="p-4"><EmptyState icon={ScrollText} title="No evidence" description="Add a Bates number or a page:line in the Edit tab." compact /></div> : (
            <table className="w-full table-fixed text-[12px]">
              <thead className="grid-head sticky top-0 z-10 bg-background"><tr><th className="w-[84px] px-3 py-1 text-left">Kind</th><th className="px-1 py-1 text-left">Cite</th></tr></thead>
              <tbody>
                {fact.evidence.map((e, i) => { const c = formatCite(e); const bad = unresolved.includes(c); return (
                  <tr key={i} className="border-t border-border/60 align-top">
                    <td className="px-3 py-1.5 text-muted-foreground">{e.kind === "intel" ? <span className="inline-flex items-center gap-1"><Globe className="size-3" />{KIND_LABEL[e.kind]}</span> : KIND_LABEL[e.kind]}</td>
                    <td className="px-1 py-1.5"><CiteChip cite={c} kind={e.kind === "event" ? "external" : e.kind === "testimony" ? "deposition" : e.kind} unresolved={bad} onClick={canOpen(e) ? () => open(e) : undefined} />{"excerpt" in e && e.excerpt && <div className="mt-1 text-[11.5px] leading-snug text-muted-foreground">“{e.excerpt}”</div>}{e.kind === "intel" && e.title && <div className="mt-1 text-[11.5px] text-muted-foreground">{e.title}</div>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {(tab === "edit" || !fact) && (
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-[1fr_1fr_88px] gap-2">
            <Field label="Date" required htmlFor="sf-date"><Input id="sf-date" size="xs" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="End" htmlFor="sf-end"><Input id="sf-end" size="xs" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} /></Field>
            <Field label="Precision" htmlFor="sf-prec"><Select value={precision} onValueChange={(v) => setPrecision(v as typeof precision)}><SelectTrigger id="sf-prec" size="xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="day">Day</SelectItem><SelectItem value="month">Month</SelectItem><SelectItem value="year">Year</SelectItem></SelectContent></Select></Field>
          </div>
          <Field label="Fact" required htmlFor="sf-text"><Textarea id="sf-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} className="text-[12.5px]" placeholder="One dated statement the record supports" /></Field>
          <div className="grid grid-cols-[100px_1fr] items-end gap-2">
            <Field label="Confidence %" htmlFor="sf-conf"><Input id="sf-conf" size="xs" type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(e.target.value)} /></Field>
            <label className="mb-1.5 flex items-center gap-1.5 text-[12px]"><Checkbox size="xs" checked={disputed} onCheckedChange={(v) => setDisputed(v === true)} /> Disputed by the other side</label>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><span className="form-label">Evidence</span><DropdownMenu><DropdownMenuTrigger asChild><Button size="xs" variant="outline"><Plus className="size-3" /> Add</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEvidence((l) => [...l, { kind: "document", bates: "", excerpt: "" }])}>Document by Bates</DropdownMenuItem><DropdownMenuItem onClick={() => setEvidence((l) => [...l, { kind: "testimony", depositionId: transcribed[0]?.id ?? "", range: "", excerpt: "" }])}>Testimony by page:line</DropdownMenuItem><DropdownMenuItem onClick={() => setEvidence((l) => [...l, { kind: "intel", docId: "", title: "" }])}>Intelligence record</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
            {!evidence.length && <div className="text-[11.5px] text-muted-foreground">A fact without evidence stays unverified.</div>}
            <div className="space-y-1.5">
              {evidence.map((d, i) => (
                <div key={i} className="grid grid-cols-[1fr_24px] items-start gap-1">
                  {d.kind === "document" && <div className="grid grid-cols-[120px_1fr] gap-1"><Input size="xs" value={d.bates} onChange={(e) => setEvidence((l) => l.map((x, j) => (j === i ? { ...d, bates: e.target.value } : x)))} placeholder="MFC-0041877" className="font-mono" aria-label="Bates" /><Input size="xs" value={d.excerpt} onChange={(e) => setEvidence((l) => l.map((x, j) => (j === i ? { ...d, excerpt: e.target.value } : x)))} placeholder="Excerpt (optional)" aria-label="Excerpt" /></div>}
                  {d.kind === "testimony" && <div className="grid grid-cols-[1fr_96px] gap-1"><Select value={d.depositionId} onValueChange={(v) => setEvidence((l) => l.map((x, j) => (j === i ? { ...d, depositionId: v } : x)))}><SelectTrigger size="xs" aria-label="Deposition"><SelectValue placeholder="Deposition" /></SelectTrigger><SelectContent>{transcribed.map((x) => <SelectItem key={x.id} value={x.id}>{x.witnessName}{x.volume && x.volume > 1 ? ` Vol. ${x.volume}` : ""}</SelectItem>)}</SelectContent></Select><Input size="xs" value={d.range} onChange={(e) => setEvidence((l) => l.map((x, j) => (j === i ? { ...d, range: e.target.value } : x)))} placeholder="24:05-24:20" className="font-mono" aria-label="Page:line" /></div>}
                  {d.kind === "intel" && <div className="grid grid-cols-[1fr_1fr] gap-1"><Input size="xs" value={d.docId} onChange={(e) => setEvidence((l) => l.map((x, j) => (j === i ? { ...d, docId: e.target.value } : x)))} placeholder="Record id (idoc_…)" className="font-mono" aria-label="Record id" /><Input size="xs" value={d.title} onChange={(e) => setEvidence((l) => l.map((x, j) => (j === i ? { ...d, title: e.target.value } : x)))} placeholder="Title" aria-label="Title" /></div>}
                  {d.kind === "event" && <div className="text-[11.5px] text-muted-foreground">Chronology event {d.eventId}{d.title ? ` — ${d.title}` : ""}</div>}
                  <Button size="icon-xs" variant="ghost" onClick={() => setEvidence((l) => l.filter((_, j) => j !== i))} aria-label="Remove evidence"><X className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-1.5"><Button size="xs" variant="ghost" onClick={onClose}>Cancel</Button><Button size="xs" onClick={save} disabled={saving}>{saving && <Loader2 className="size-3.5 animate-spin" />} {fact ? "Save fact" : "Add fact"}</Button></div>
        </div>
      )}
    </Inspector>
  );
}

// ---------------------------------------------------------------------------

function BuildDialog({ open, onOpenChange, matterId, story, depositions, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; matterId: string; story: Story | null; depositions: DepositionSummary[]; onDone: (storyId: string) => void }) {
  const [from, setFrom] = React.useState<BuildFrom>("timeline");
  const [target, setTarget] = React.useState<"current" | "new">(story ? "current" : "new");
  const [title, setTitle] = React.useState("");
  const [minSignificance, setMinSignificance] = React.useState("3");
  const [minConfidence, setMinConfidence] = React.useState("0.6");
  const [depIds, setDepIds] = React.useState<Set<string>>(new Set());
  const [flags, setFlags] = React.useState<Set<string>>(new Set(["admission", "key", "contradiction"]));
  const [running, setRunning] = React.useState(false);
  const transcribed = depositions.filter((d) => d.qaCount > 0);
  React.useEffect(() => { if (open) { setTarget(story ? "current" : "new"); setTitle(""); } }, [open, story]);
  const run = async () => {
    setRunning(true);
    try {
      const build: Record<string, unknown> = { from };
      if (from === "timeline") build.minSignificance = Number(minSignificance) || undefined;
      if (from === "testimony") { build.depositionIds = Array.from(depIds); build.flags = Array.from(flags); }
      if (from === "intel") build.minConfidence = Number(minConfidence);
      const r = await api<{ story: Story; built: number; added: number; merged: number }>("/api/ediscovery/analysis/stories", { method: "POST", json: { matterId, build, storyId: target === "current" && story ? story.id : undefined, title: target === "new" ? title.trim() || undefined : undefined } });
      toast.success(`${r.added} fact${r.added === 1 ? "" : "s"} added`, { description: `${r.built} built from ${from === "timeline" ? "the chronology" : from === "testimony" ? "testimony" : "the intelligence record"}${r.merged ? ` · ${r.merged} merged into existing facts` : ""}` });
      onDone(r.story.id); onOpenChange(false);
    } catch (e) { toast.error("Build failed", { description: (e as Error).message }); }
    finally { setRunning(false); }
  };
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) => set((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Build facts</DialogTitle><DialogDescription>Deterministic: one fact per chronology event, per flagged Q/A or per intelligence entry, each carrying its Bates, page:line or record id. Near-duplicates merge their evidence into the existing fact.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <SegmentedControl<BuildFrom> value={from} onChange={setFrom} options={[{ value: "timeline", label: "Chronology" }, { value: "testimony", label: "Testimony" }, { value: "intel", label: "Intelligence" }]} ariaLabel="Source" grow />
          {from === "timeline" && <Field label="Significance" help="Events at or above this significance become facts." htmlFor="b-sig"><Select value={minSignificance} onValueChange={setMinSignificance}><SelectTrigger id="b-sig" size="sm"><SelectValue /></SelectTrigger><SelectContent>{["1", "2", "3", "4", "5"].map((n) => <SelectItem key={n} value={n}>{n === "1" ? "Every event" : `≥ ${n}`}</SelectItem>)}</SelectContent></Select></Field>}
          {from === "testimony" && (
            <>
              <Field label="Depositions" help="All transcribed depositions when none is ticked."><div className="flex flex-wrap gap-1">{transcribed.map((d) => <label key={d.id} className={cn("flex h-6 cursor-pointer items-center gap-1.5 rounded border px-2 text-[11.5px]", depIds.has(d.id) ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")}><Checkbox size="xs" checked={depIds.has(d.id)} onCheckedChange={() => toggle(setDepIds, d.id)} />{d.witnessName}</label>)}</div></Field>
              <Field label="Flags"><div className="flex flex-wrap gap-1">{["admission", "key", "contradiction", "evasive", "privilege"].map((f) => <label key={f} className={cn("flex h-6 cursor-pointer items-center gap-1.5 rounded border px-2 text-[11.5px] capitalize", flags.has(f) ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")}><Checkbox size="xs" checked={flags.has(f)} onCheckedChange={() => toggle(setFlags, f)} />{f}</label>)}</div></Field>
            </>
          )}
          {from === "intel" && <Field label="Minimum confidence" help="Docket entries, rulings, regulatory events and recalls from the intelligence record for this matter." htmlFor="b-conf"><Select value={minConfidence} onValueChange={setMinConfidence}><SelectTrigger id="b-conf" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0.5">50%</SelectItem><SelectItem value="0.6">60% (gate)</SelectItem><SelectItem value="0.8">80%</SelectItem></SelectContent></Select></Field>}
          <Field label="Into"><SegmentedControl<"current" | "new"> value={target} onChange={setTarget} options={[{ value: "current", label: story ? `This story` : "This story", disabled: !story }, { value: "new", label: "A new story" }]} ariaLabel="Target" grow /></Field>
          {target === "new" && <Field label="Title" htmlFor="b-title"><Input id="b-title" size="sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What Meridian knew, and when" /></Field>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={run} disabled={running || (target === "current" && !story)}>{running && <Loader2 className="size-4 animate-spin" />} Build facts</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewStoryDialog({ open, onOpenChange, matterId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; matterId: string; onCreated: (s: Story) => void }) {
  const [title, setTitle] = React.useState("");
  const [theme, setTheme] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) { setTitle(""); setTheme(""); } }, [open]);
  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try { const r = await api<{ story: Story }>("/api/ediscovery/analysis/stories", { method: "POST", json: { matterId, title: title.trim(), theme: theme.trim() || undefined } }); onCreated(r.story); onOpenChange(false); }
    catch (e) { toast.error("Could not create the story", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>New story</DialogTitle><DialogDescription>An empty story to fill by hand or from the builders.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Field label="Title" required htmlFor="ns-title"><Input id="ns-title" size="sm" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") void save(); }} /></Field>
          <Field label="Theme" htmlFor="ns-theme"><Input id="ns-theme" size="sm" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Knowledge, reporting decisions and disclosure" /></Field>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !title.trim()}>{saving && <Loader2 className="size-4 animate-spin" />} Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
