"use client";
import * as React from "react";
import { GitBranch, ListChecks, Loader2, Search, Table2, Download, FileText, Trash2, AlertTriangle, ScrollText, Files, ArrowRight, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/misc";
import { PersonAvatar } from "@/components/ui/avatar";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Conflict } from "@/lib/types/domain";
import { type AnalysisTabProps, type CrossExcerpt, type FactMatrix } from "../types";
import { highlightTerms } from "../transcript";
import { Inspector } from "@/components/ui/inspector";
import { KeyValueList } from "@/components/ui/form";
import { KeyHint, ModelLabel, CiteChip, FlagBadge, NoKeyCallout, Pane, ProvenanceBadge, SeverityBadge, ConflictStatusBadge, TabHeader, kindLabel, formatShortDate, useNarrowViewport } from "./shared";
import { api, downloadFile, exportMarkdownToWord, isNoKey, useCross, useDepositions, useFactMatrices, useOpenTestimony, useOverview } from "./use-analysis-data";

function Highlighted({ text, re }: { text: string; re: RegExp | null }) {
  if (!re) return <>{text}</>;
  return <>{text.split(re).map((p, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-warning/40 px-px text-foreground">{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}

export function CrossAnalysisTab({ matterId, onOpenDocument }: AnalysisTabProps) {
  const overview = useOverview(matterId);
  const deps = useDepositions(matterId);
  const witnesses = React.useMemo(() => { const m = new Map<string, { id: string; name: string; title?: string }>(); for (const d of deps.data?.depositions ?? []) if (d.qaCount > 0) m.set(d.witnessId, { id: d.witnessId, name: d.witnessName, title: d.witnessTitle }); return Array.from(m.values()); }, [deps.data]);
  const [witnessId, setWitnessId] = React.useState<string>("all");
  const [topicInput, setTopicInput] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [finding, setFinding] = React.useState(false);
  const [noKey, setNoKey] = React.useState(false);
  const [created, setCreated] = React.useState<Conflict[]>([]);
  const [matrixOpen, setMatrixOpen] = React.useState(false);
  const cross = useCross(matterId, topic, witnessId === "all" ? undefined : witnessId);
  const matrices = useFactMatrices(matterId);
  const openTestimony = useOpenTestimony();
  const aiConfigured = !!overview.data?.aiConfigured;
  const re = React.useMemo(() => (topic ? highlightTerms(topic) : null), [topic]);

  React.useEffect(() => { if (!topic && overview.data?.topics?.length) { setTopic(overview.data.topics[0]); setTopicInput(overview.data.topics[0]); } }, [overview.data, topic]);
  React.useEffect(() => { setSelected(new Set()); setCreated([]); }, [topic, witnessId]);

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const testimony = React.useMemo(() => cross.data?.testimony ?? [], [cross.data]);
  const byDeposition = React.useMemo(() => { const m = new Map<string, number[]>(); for (const t of testimony) if (selected.has(`${t.id}:${t.index}`)) m.set(t.id, [...(m.get(t.id) ?? []), t.index!]); return m; }, [testimony, selected]);

  const findContradictions = async () => {
    setFinding(true); setNoKey(false);
    try {
      const targets = byDeposition.size ? Array.from(byDeposition.entries()) : Array.from(new Set(testimony.map((t) => t.id))).map((id) => [id, [] as number[]] as [string, number[]]);
      if (!targets.length) { toast.info("No testimony to compare", { description: "Pick a witness or a topic with testimony hits first." }); return; }
      const all: Conflict[] = [];
      for (const [depositionId, indexes] of targets) {
        const r = await api<{ created: Conflict[]; considered: number }>("/api/ediscovery/analysis/contradictions", { method: "POST", json: { matterId, depositionId, topic: topic || "all topics", indexes: indexes.length ? indexes : undefined } });
        all.push(...r.created);
      }
      setCreated(all);
      cross.refresh();
      toast.success(all.length ? `${all.length} contradiction${all.length === 1 ? "" : "s"} recorded` : "No new contradictions found", { description: all.length ? "Saved to the Conflicts tab with cites and analysis." : "The model found nothing beyond the existing conflicts." });
    } catch (e) { if (isNoKey(e)) setNoKey(true); else toast.error("Contradiction search failed", { description: (e as Error).message }); }
    finally { setFinding(false); }
  };

  const applyTopic = (t: string) => { setTopic(t.trim()); setTopicInput(t.trim()); };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabHeader
        icon={GitBranch}
        title="Cross-analysis"
        summary={topic ? `“${topic}” · ${testimony.length} testimony excerpt${testimony.length === 1 ? "" : "s"} · ${cross.data?.documents.length ?? 0} document passage${(cross.data?.documents.length ?? 0) === 1 ? "" : "s"}` : "Pick a witness and a topic"}
        actions={
          <>
            <Tip label="Build a topics × sources matrix from the excerpts below"><Button size="sm" variant="outline" onClick={() => setMatrixOpen((v) => !v)} className={cn(matrixOpen && "bg-accent")} aria-pressed={matrixOpen}><Table2 className="size-4" /> <span className="hidden md:inline">Fact matrix</span> {matrices.data?.matrices.length ? <span className="rounded bg-muted px-1 text-[10px] tabular">{matrices.data.matrices.length}</span> : null}</Button></Tip>
            <KeyHint configured={aiConfigured}>
              <Button size="sm" onClick={findContradictions} disabled={finding || !testimony.length}>{finding ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />} <span className="hidden md:inline">Find contradictions</span><span className="md:hidden">Contradictions</span>{selected.size ? ` (${selected.size})` : ""}</Button>
            </KeyHint>
          </>
        }
      >
        <Select value={witnessId} onValueChange={setWitnessId}>
          <SelectTrigger size="sm" className="h-7 w-[200px]"><SelectValue placeholder="Witness" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><span className="flex items-center gap-2"><Users className="size-3.5 text-muted-foreground" /> All witnesses</span></SelectItem>
            {witnesses.map((w) => <SelectItem key={w.id} value={w.id}><span className="flex items-center gap-2"><PersonAvatar name={w.name} size="xs" />{w.name}</span></SelectItem>)}
          </SelectContent>
        </Select>
        <form className="relative" onSubmit={(e) => { e.preventDefault(); applyTopic(topicInput); }}>
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={topicInput} onChange={(e) => setTopicInput(e.target.value)} placeholder="Topic — e.g. MW-7 notification, 8(e) decision, MSDS language" className="h-7 w-[300px] max-w-[50vw] pl-7 text-xs" aria-label="Topic" />
        </form>
        <div className="hidden items-center gap-1 overflow-x-auto no-scrollbar lg:flex">
          {(overview.data?.topics ?? []).slice(0, 6).map((t) => <button key={t} type="button" onClick={() => applyTopic(t)} className={cn("h-6 shrink-0 rounded-md border px-2 text-[11px] transition-colors cursor-pointer", topic === t ? "border-foreground/25 bg-accent text-foreground" : "text-muted-foreground hover:bg-accent")}>{t}</button>)}
        </div>
      </TabHeader>

      {(noKey || (!aiConfigured && !overview.loading)) && <div className="shrink-0 px-4 pt-3"><NoKeyCallout feature="Contradiction finding and fact matrices" compact /></div>}

      {matrixOpen ? (
        <FactMatrixSection matterId={matterId} topic={topic} witnessId={witnessId === "all" ? undefined : witnessId} aiConfigured={aiConfigured} matrices={matrices.data?.matrices ?? []} loading={matrices.loading} onChanged={matrices.refresh} onOpenDocument={onOpenDocument} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2">
          <Pane title={<span className="flex items-center gap-1.5"><ScrollText className="size-3.5 text-chart-2" /> Testimony{witnessId !== "all" && witnesses.find((w) => w.id === witnessId) ? ` — ${witnesses.find((w) => w.id === witnessId)!.name}` : ""}</span>} count={testimony.length} actions={selected.size ? <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>Clear {selected.size}</Button> : <span className="text-[10.5px] text-muted-foreground">select to focus the AI</span>}>
            {cross.loading && !cross.data ? <ExcerptSkeleton /> : !testimony.length ? <div className="p-4"><EmptyState icon={ScrollText} title="No testimony on this topic" description="Try a broader topic or another witness." /></div> : (
              <ul className="divide-y">
                {testimony.map((t) => <TestimonyExcerpt key={`${t.id}:${t.index}`} t={t} re={re} checked={selected.has(`${t.id}:${t.index}`)} onToggle={() => toggle(`${t.id}:${t.index}`)} onOpen={() => openTestimony(t.id, t.index)} />)}
              </ul>
            )}
          </Pane>
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <Pane title={<span className="flex items-center gap-1.5"><Files className="size-3.5 text-chart-1" /> Documents on this topic</span>} count={cross.data?.documents.length} actions={<span className="text-[10.5px] text-muted-foreground">{aiConfigured ? "hybrid search" : "keyword (BM25)"}</span>}>
              {cross.loading && !cross.data ? <ExcerptSkeleton /> : !cross.data?.documents.length ? <div className="p-4"><EmptyState icon={Files} title={topic ? "No document passages" : "Enter a topic"} description={topic ? "No indexed passages match; rebuild the index from the top bar if documents were added." : "Document passages appear once a topic is set."} /></div> : (
                <ul className="divide-y">
                  {cross.data.documents.map((d) => (
                    <li key={d.id} className="group px-3 py-2 hover:bg-accent/30">
                      <div className="flex min-w-0 items-center gap-2">
                        <CiteChip cite={d.cite} kind="document" onClick={() => onOpenDocument?.(d.id)} />
                        <span className="tabular text-[10.5px] text-muted-foreground">{d.date ? formatShortDate(d.date) : ""}</span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{d.label}</span>
                        <span className="text-[10px] tabular text-muted-foreground">{Math.round(d.score * 100)}</span>
                      </div>
                      <p className="mt-1 break-words text-[12px] leading-relaxed text-foreground/85"><Highlighted text={d.text} re={re} /></p>
                    </li>
                  ))}
                </ul>
              )}
            </Pane>
            <Pane title={<span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-destructive" /> Other testimony & conflicts</span>} count={(cross.data?.otherTestimony.length ?? 0) + (cross.data?.conflicts.length ?? 0) + created.length}>
              {cross.loading && !cross.data ? <ExcerptSkeleton rows={2} /> : (
                <div className="divide-y">
                  {created.map((c) => <ConflictLine key={c.id} c={c} fresh />)}
                  {(cross.data?.conflicts ?? []).filter((c) => !created.some((x) => x.id === c.id)).map((c) => <ConflictLine key={c.id} c={c} />)}
                  {(cross.data?.otherTestimony ?? []).map((t) => (
                    <div key={`${t.id}:${t.index}`} className="px-3 py-2">
                      <div className="flex items-center gap-2"><CiteChip cite={t.cite} kind="deposition" onClick={() => openTestimony(t.id, t.index)} /><span className="text-[10.5px] text-muted-foreground">{t.label}</span>{t.flags?.map((f) => <FlagBadge key={f} flag={f} compact />)}</div>
                      <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-foreground/85"><Highlighted text={t.text} re={re} /></p>
                    </div>
                  ))}
                  {!created.length && !cross.data?.conflicts.length && !cross.data?.otherTestimony.length && <div className="p-4 text-center text-xs text-muted-foreground">No other witnesses or recorded conflicts on this topic.</div>}
                </div>
              )}
            </Pane>
          </div>
        </div>
      )}
    </div>
  );
}

function ExcerptSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3 p-3">{Array.from({ length: rows }).map((_, i) => <div key={i} className="space-y-1.5"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>)}</div>;
}

function TestimonyExcerpt({ t, re, checked, onToggle, onOpen }: { t: CrossExcerpt; re: RegExp | null; checked: boolean; onToggle: () => void; onOpen: () => void }) {
  const [q, a] = t.text.split("\nA. ");
  return (
    <li className={cn("group flex gap-2 px-3 py-2 transition-colors hover:bg-accent/30", checked && "bg-primary/6")}>
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-1" aria-label="Select excerpt" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <CiteChip cite={t.cite} kind="deposition" onClick={onOpen} title="Open in the Depositions tab" />
          <span className="tabular text-[10.5px] text-muted-foreground">{t.date ? formatShortDate(t.date) : ""}</span>
          {t.flags?.map((f) => <FlagBadge key={f} flag={f} />)}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground"><Highlighted text={q.replace(/^Q\. /, "")} re={re} /></p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed"><span className="font-semibold text-muted-foreground">A.</span> <Highlighted text={a ?? ""} re={re} /></p>
      </div>
    </li>
  );
}

function ConflictLine({ c, fresh }: { c: Conflict; fresh?: boolean }) {
  return (
    <div className={cn("px-3 py-2", fresh && "bg-success/5")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={c.severity} /><ConflictStatusBadge status={c.status} />
        <span className="text-[10.5px] text-muted-foreground">{kindLabel(c.kind)}</span>
        {fresh && <Badge variant="success" className="h-[16px] px-1 py-0 text-[10px]">new</Badge>}
        {c.createdBy === "ai" && <ModelLabel />}
        <ProvenanceBadge record={c} />
      </div>
      <div className="mt-1 text-[12px] font-medium leading-snug">{c.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1">{c.sides.map((s, i) => <React.Fragment key={i}>{i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}<CiteChip cite={s.cite} kind={s.sourceKind} /></React.Fragment>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FactMatrixSection({ matterId, topic, witnessId, aiConfigured, matrices, loading, onChanged, onOpenDocument }: { matterId: string; topic: string; witnessId?: string; aiConfigured: boolean; matrices: FactMatrix[]; loading: boolean; onChanged: () => void; onOpenDocument?: (id: string) => void }) {
  const openTestimony = useOpenTestimony();
  const narrow = useNarrowViewport(1280);
  const [building, setBuilding] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [cell, setCell] = React.useState<{ topic: string; sourceId: string } | null>(null);
  const active = matrices.find((m) => m.id === activeId) ?? matrices[0];
  React.useEffect(() => { setCell(null); }, [active?.id]);
  const unresolved = React.useMemo(() => new Set((active?.provenance?.verification?.unresolvedCites ?? []).map((u) => u.toUpperCase())), [active]);
  const build = async () => {
    if (!topic) { toast.info("Enter a topic first"); return; }
    setBuilding(true);
    try {
      const r = await api<{ matrix: FactMatrix }>("/api/ediscovery/analysis/fact-matrix", { method: "POST", json: { matterId, topic, witnessId } });
      onChanged(); setActiveId(r.matrix.id);
      toast.success("Fact matrix built", { description: `${r.matrix.topics.length} topics × ${r.matrix.sources.length} sources · cells verified against their sources` });
    } catch (e) { if (isNoKey(e)) toast.error("AI provider not configured", { description: "Fact matrices are built by the model and verified against the record." }); else toast.error("Matrix failed", { description: (e as Error).message }); }
    finally { setBuilding(false); }
  };
  const remove = async (m: FactMatrix) => {
    try { await api(`/api/ediscovery/analysis/fact-matrix?id=${m.id}`, { method: "DELETE" }); onChanged(); if (activeId === m.id) setActiveId(null); } catch (e) { toast.error("Delete failed", { description: (e as Error).message }); }
  };
  const toMarkdown = (m: FactMatrix) => {
    const head = `| Topic | ${m.sources.map((s) => `${s.label} (${s.cite})`).join(" | ")} |`;
    const sep = `|---|${m.sources.map(() => "---").join("|")}|`;
    const rows = m.topics.map((t) => `| ${t} | ${m.sources.map((s) => { const c = m.cells.find((x) => x.topic === t && x.sourceId === s.id); return c ? `${c.position} (${c.cite}) [${c.stance}]` : "—"; }).join(" | ")} |`);
    return `# Fact matrix — ${m.topic}\n\nBuilt ${formatShortDate(m.createdAt.slice(0, 10))} · ${m.topics.length} topics × ${m.sources.length} sources\n\n${[head, sep, ...rows].join("\n")}\n`;
  };
  const exportCsv = (m: FactMatrix) => {
    const cellText = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [["Topic", ...m.sources.map((s) => `${s.label} (${s.cite})`)].map(cellText).join(",")];
    for (const t of m.topics) lines.push([t, ...m.sources.map((s) => { const c = m.cells.find((x) => x.topic === t && x.sourceId === s.id); return c ? `${c.position} (${c.cite}) [${c.stance}]` : ""; })].map(cellText).join(","));
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    downloadFile(url);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const openSource = (s: FactMatrix["sources"][number], cite?: string) => (s.kind === "document" ? onOpenDocument?.(s.id) : openTestimony(s.id, cite ?? s.cite));
  const STANCE: Record<string, string> = { supports: "text-success", contradicts: "text-destructive", neutral: "text-muted-foreground", silent: "text-muted-foreground" };
  const selectedCell = active && cell ? active.cells.find((x) => x.topic === cell.topic && x.sourceId === cell.sourceId) ?? null : null;
  const selectedSource = active && cell ? active.sources.find((s) => s.id === cell.sourceId) ?? null : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">Fact matrix {active && <ProvenanceBadge record={active} compact={false} />}</div>
        <span className="hidden text-[11.5px] text-muted-foreground xl:inline">Topics × sources for “{topic || "…"}”; each cell is what the source says, its cite and its stance for the client.</span>
        <div className="flex-1" />
        {matrices.length > 1 && <Select value={active?.id ?? ""} onValueChange={setActiveId}><SelectTrigger size="xs" className="h-7 w-[240px]"><SelectValue placeholder="Saved matrices" /></SelectTrigger><SelectContent>{matrices.map((m) => <SelectItem key={m.id} value={m.id}>{m.topic} · {formatShortDate(m.createdAt.slice(0, 10))}</SelectItem>)}</SelectContent></Select>}
        {active && <><Button size="xs" variant="outline" onClick={() => exportCsv(active)}><Download className="size-3.5" /> CSV</Button><Button size="xs" variant="outline" onClick={() => exportMarkdownToWord({ title: `Fact matrix — ${active.topic}`, markdown: toMarkdown(active), matterId, tags: ["fact-matrix", "ediscovery"] })}><FileText className="size-3.5" /> Word</Button><Tip label="Delete this matrix"><Button size="icon-xs" variant="ghost" onClick={() => remove(active)} aria-label="Delete matrix"><Trash2 className="size-3.5" /></Button></Tip></>}
        <KeyHint configured={aiConfigured}><Button size="xs" onClick={build} disabled={building || !topic}>{building ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} Build for “{topic.slice(0, 24)}{topic.length > 24 ? "…" : ""}”</Button></KeyHint>
      </div>
      {loading && !matrices.length ? <Skeleton className="m-3 h-40" /> : !active ? (
        <div className="flex flex-1 items-center justify-center"><EmptyState icon={Table2} title="No fact matrix yet" description={aiConfigured ? "Build one for the current topic; every cell is verified against its source, saved with the matter and exportable to CSV or Word." : "Fact matrices are built by the model. Configure an AI provider in Settings to enable."} /></div>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto scrollbar-thin">
            <table className="w-max min-w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="grid-head">
                  <th className="sticky left-0 z-20 w-[200px] min-w-[200px] border-b border-r bg-background px-3 py-1.5 text-left">Topic</th>
                  {active.sources.map((s) => <th key={s.id} className="min-w-[220px] max-w-[300px] border-b border-r px-3 py-1.5 text-left align-top font-medium text-foreground"><CiteChip cite={s.cite} kind={s.kind} onClick={() => openSource(s)} /><div className="mt-0.5 line-clamp-2 text-[11px] font-normal text-muted-foreground">{s.label}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {active.topics.map((t) => (
                  <tr key={t} className="align-top">
                    <th className="sticky left-0 z-10 border-b border-r bg-background px-3 py-1.5 text-left font-medium">{t}</th>
                    {active.sources.map((s) => {
                      const c = active.cells.find((x) => x.topic === t && x.sourceId === s.id);
                      const sel = cell?.topic === t && cell?.sourceId === s.id;
                      return (
                        <td key={s.id} className={cn("border-b border-r px-3 py-1.5 leading-snug", c && "cursor-pointer hover:bg-accent/50", sel && "bg-primary/8")} onClick={() => c && setCell({ topic: t, sourceId: s.id })}>
                          {c ? <><div className="line-clamp-3">{c.position}</div><div className="mt-1 flex items-center gap-1.5"><CiteChip cite={c.cite} kind={s.kind} unresolved={unresolved.has(c.cite.toUpperCase())} onClick={() => openSource(s, c.cite)} /><span className={cn("text-[10.5px]", STANCE[c.stance])}>{c.stance}</span></div></> : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedCell && selectedSource && (
            <div className={cn("shrink-0", narrow && "absolute inset-y-0 right-0 z-20 max-w-[85%] shadow-xl")}>
              <Inspector title={selectedCell.topic} subtitle={selectedSource.label} width={340} onClose={() => setCell(null)}>
                <div className="border-b px-3 py-2"><KeyValueList dense labelWidth={76} items={[{ label: "Source", value: <CiteChip cite={selectedSource.cite} kind={selectedSource.kind} onClick={() => openSource(selectedSource, selectedCell.cite)} /> }, { label: "Cite", value: <CiteChip cite={selectedCell.cite} kind={selectedSource.kind} unresolved={unresolved.has(selectedCell.cite.toUpperCase())} onClick={() => openSource(selectedSource, selectedCell.cite)} /> }, { label: "Stance", value: <span className={STANCE[selectedCell.stance]}>{selectedCell.stance} — relative to the client&apos;s position</span> }, { label: "Cite check", value: unresolved.has(selectedCell.cite.toUpperCase()) ? "did not resolve against the record" : "resolves against the record", muted: false }]} /></div>
                <div className="px-3 py-2 text-[12.5px] leading-relaxed">{selectedCell.position}</div>
                <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">Built {formatShortDate(active.createdAt.slice(0, 10))} <ProvenanceBadge record={active} compact={false} className="ml-1 align-middle" /></div>
              </Inspector>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
