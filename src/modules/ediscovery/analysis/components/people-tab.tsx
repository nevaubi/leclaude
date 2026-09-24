"use client";
import * as React from "react";
import { Network, Search, Plus, Sparkles, Loader2, X, FileText, ScrollText, Activity, AlertTriangle, Link2, Mail, Users, ChevronRight, BrainCircuit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { PersonAvatar } from "@/components/ui/avatar";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { Relationship } from "@/lib/types/domain";
import { type AnalysisTabProps, type GraphNode, type KnowledgeMap } from "../types";
import { RELATIONSHIP_LABELS } from "../graph";
import { ForceGraph } from "./force-graph";
import { AiButtonHint, AiLabel, CiteChip, ListSkeleton, NoKeyCallout, SeverityBadge, ConflictStatusBadge, CategoryChip, formatShortDate, tokenDot } from "./shared";
import { api, exportMarkdownToWord, isNoKey, useGraph, useKnowledgeMaps, useOpenTestimony, useOverview, usePerson } from "./use-analysis-data";
import type { TimelineCategory } from "../types";

const ALL_KINDS = Object.keys(RELATIONSHIP_LABELS) as Relationship["kind"][];
const KIND_GROUPS: { label: string; kinds: Relationship["kind"][] }[] = [
  { label: "Email", kinds: ["emailed", "cc"] },
  { label: "Org chart", kinds: ["reports_to", "supervises", "same_org"] },
  { label: "Engagements", kinds: ["retained", "represents"] },
  { label: "Testimony", kinds: ["testified_about", "meeting"] },
  { label: "Other", kinds: ["authored", "received", "other"] },
];

export function PeopleGraphTab({ matterId, onOpenDocument }: AnalysisTabProps) {
  const graph = useGraph(matterId);
  const overview = useOverview(matterId);
  const [q, setQ] = React.useState("");
  const [kinds, setKinds] = React.useState<Set<Relationship["kind"]>>(new Set(ALL_KINDS));
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [kmOpen, setKmOpen] = React.useState(false);
  const aiConfigured = !!overview.data?.aiConfigured;
  const nodes = React.useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const highlight = React.useMemo(() => { const t = q.trim().toLowerCase(); if (!t) return new Set<string>(); return new Set(nodes.filter((n) => `${n.label} ${n.organization ?? ""} ${n.title ?? ""}`.toLowerCase().includes(t)).map((n) => n.id)); }, [q, nodes]);
  const ranked = React.useMemo(() => [...nodes].sort((a, b) => b.docCount + b.degree - (a.docCount + a.degree)), [nodes]);
  const toggleGroup = (g: Relationship["kind"][]) => setKinds((s) => { const n = new Set(s); const on = g.every((k) => n.has(k)); for (const k of g) { if (on) n.delete(k); else n.add(k); } return n; });

  React.useEffect(() => {
    const url = new URL(window.location.href);
    const p = url.searchParams.get("person");
    if (p && nodes.some((n) => n.id === p)) setSelectedId(p);
  }, [nodes]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[280px] shrink-0 flex-col border-r bg-sidebar/40 lg:flex">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person or organisation" className="h-8 pl-7 pr-7 text-xs" aria-label="Search people" onKeyDown={(e) => { if (e.key === "Enter" && highlight.size) { e.preventDefault(); setSelectedId(Array.from(highlight)[0]); } if (e.key === "Escape") setQ(""); }} />
            {q && <button type="button" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent cursor-pointer" aria-label="Clear"><X className="size-3.5" /></button>}
          </div>
        </div>
        <div className="border-b px-3 py-2">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Relationships</div>
          <div className="flex flex-wrap gap-1">{KIND_GROUPS.map((g) => { const on = g.kinds.every((k) => kinds.has(k)); return <button key={g.label} type="button" onClick={() => toggleGroup(g.kinds)} className={cn("h-6 rounded-full border px-2 text-[11px] transition-colors cursor-pointer", on ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")}>{g.label}</button>; })}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {graph.loading && !graph.data ? <ListSkeleton rows={8} /> : (
            <ul className="p-1.5">
              {(q ? ranked.filter((n) => highlight.has(n.id)) : ranked).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => setSelectedId(n.id === selectedId ? null : n.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer", selectedId === n.id ? "bg-accent text-accent-foreground" : "hover:bg-sidebar-accent")}>
                    <span className={cn("size-2 shrink-0 rounded-full", tokenDot(n.color))} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">{n.label}</div>
                      <div className="truncate text-[10.5px] text-muted-foreground">{n.title ?? n.role}{n.organization ? ` · ${n.organization}` : ""}</div>
                    </div>
                    <span className="shrink-0 text-[10.5px] tabular text-muted-foreground" title="documents authored + received">{n.docCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1.5 border-t p-2">
          <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setAddOpen(true)}><Plus className="size-4" /> Add relationship</Button>
          <AiButtonHint configured={aiConfigured}><Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setKmOpen(true)}><BrainCircuit className="size-4" /> Who knew what, when <AiLabel className="ml-auto" /></Button></AiButtonHint>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1 p-3">
        {graph.loading && !graph.data ? <Skeleton className="h-full" /> : !nodes.length ? <div className="flex h-full items-center justify-center"><EmptyState icon={Network} title="No people yet" description="People appear once documents, depositions or relationships exist for this matter." /></div> : (
          <ForceGraph data={graph.data!} kinds={kinds} selectedId={selectedId} highlightIds={highlight} onSelect={setSelectedId} />
        )}
        <div className="absolute left-5 top-5 flex items-center gap-1.5 lg:hidden">
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="size-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setKmOpen(true)}><BrainCircuit className="size-4" /></Button>
        </div>
      </div>
      <PersonSheet matterId={matterId} personId={selectedId} onClose={() => setSelectedId(null)} onSelectPerson={setSelectedId} onOpenDocument={onOpenDocument} nodes={nodes} onChanged={graph.refresh} />
      <AddRelationshipDialog open={addOpen} onOpenChange={setAddOpen} matterId={matterId} nodes={nodes} defaultFrom={selectedId} onCreated={() => graph.refresh()} />
      <KnowledgeMapDialog open={kmOpen} onOpenChange={setKmOpen} matterId={matterId} aiConfigured={aiConfigured} topics={overview.data?.topics ?? []} onSelectPerson={(id) => { setKmOpen(false); setSelectedId(id); }} onOpenDocument={onOpenDocument} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function PersonSheet({ matterId, personId, onClose, onSelectPerson, onOpenDocument, nodes, onChanged }: { matterId: string; personId: string | null; onClose: () => void; onSelectPerson: (id: string) => void; onOpenDocument?: (id: string) => void; nodes: GraphNode[]; onChanged: () => void }) {
  const detail = usePerson(matterId, personId);
  const openTestimony = useOpenTestimony();
  const [docTab, setDocTab] = React.useState<"authored" | "received">("authored");
  const d = detail.data;
  const node = nodes.find((n) => n.id === personId);
  const removeRel = async (id: string) => { try { await api(`/api/ediscovery/analysis/relationships?id=${id}`, { method: "DELETE" }); detail.refresh(); onChanged(); toast.success("Relationship removed"); } catch (e) { toast.error("Could not remove", { description: (e as Error).message }); } };
  return (
    <Sheet open={!!personId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent width="max-w-lg" className="w-full">
        {!d ? (
          <><SheetHeader><SheetTitle>{node?.label ?? "Person"}</SheetTitle><SheetDescription>Loading…</SheetDescription></SheetHeader><SheetBody><ListSkeleton rows={6} className="p-0" /></SheetBody></>
        ) : (
          <>
            <SheetHeader className="pr-10">
              <div className="flex items-start gap-3">
                <PersonAvatar name={d.person.name} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="leading-tight">{d.person.name}</SheetTitle>
                  <SheetDescription className="mt-0.5">{d.person.title ?? d.person.role}{d.person.organization ? ` · ${d.person.organization}` : ""}</SheetDescription>
                  <div className="mt-1.5 flex flex-wrap gap-1"><Badge variant="secondary" className="capitalize">{d.person.role}</Badge>{d.person.email && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Mail className="size-3" />{d.person.email}</span>}</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[["Authored", d.counts.authored], ["Received", d.counts.received], ["Copied", d.counts.cc], ["Mentioned", d.counts.mentioned]].map(([k, v]) => <div key={String(k)} className="rounded-md border bg-card px-2 py-1"><div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{k}</div><div className="text-sm font-semibold tabular">{v}</div></div>)}
              </div>
            </SheetHeader>
            <SheetBody className="space-y-4 text-[12.5px]">
              <section>
                <div className="mb-1 flex items-center gap-2">
                  <h4 className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><FileText className="size-3" /> Documents</h4>
                  <div className="ml-auto flex gap-0.5">{(["authored", "received"] as const).map((t) => <button key={t} type="button" onClick={() => setDocTab(t)} className={cn("h-5 rounded px-1.5 text-[10.5px] capitalize transition-colors cursor-pointer", docTab === t ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent")}>{t} <span className="tabular">{t === "authored" ? d.counts.authored : d.counts.received}</span></button>)}</div>
                </div>
                {(docTab === "authored" ? d.authored : d.received).length === 0 ? <div className="text-[11.5px] text-muted-foreground">None.</div> : (
                  <ul className="max-h-56 space-y-0.5 overflow-auto scrollbar-thin">{(docTab === "authored" ? d.authored : d.received).map((x) => <li key={x.id}><button type="button" onClick={() => onOpenDocument?.(x.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent cursor-pointer"><span className="w-[92px] shrink-0 font-mono text-[10.5px] text-muted-foreground">{x.bates}</span><span className="w-[74px] shrink-0 tabular text-[10.5px] text-muted-foreground">{formatShortDate(x.date)}</span><span className="min-w-0 flex-1 truncate">{x.subject}</span></button></li>)}</ul>
                )}
              </section>
              {d.depositions.length > 0 && (
                <section>
                  <h4 className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><ScrollText className="size-3" /> Depositions</h4>
                  <ul className="space-y-0.5">{d.depositions.map((x) => <li key={x.id}><button type="button" onClick={() => openTestimony(x.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent cursor-pointer"><span className="min-w-0 flex-1 truncate">{x.witnessName === d.person.name ? "Own deposition" : `${x.witnessName} deposition`}</span><span className="tabular text-[10.5px] text-muted-foreground">{formatShortDate(x.date)} · {x.witnessName === d.person.name ? `${x.pages} pp` : `${x.mentions} mention${x.mentions === 1 ? "" : "s"}`}</span><ChevronRight className="size-3.5 text-muted-foreground" /></button></li>)}</ul>
                </section>
              )}
              <section>
                <h4 className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><Link2 className="size-3" /> Relationships <span className="tabular">{d.relationships.length}</span></h4>
                {d.relationships.length === 0 ? <div className="text-[11.5px] text-muted-foreground">None recorded.</div> : (
                  <ul className="space-y-0.5">{d.relationships.map((r) => (
                    <li key={r.id} className="group rounded px-1.5 py-1 hover:bg-accent/50">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{r.direction === "out" ? RELATIONSHIP_LABELS[r.kind as Relationship["kind"]] : `${RELATIONSHIP_LABELS[r.kind as Relationship["kind"]]} ←`}</span>
                        <button type="button" onClick={() => onSelectPerson(r.otherId)} className="font-medium hover:underline cursor-pointer">{r.otherName}</button>
                        <span className="rounded bg-muted px-1 text-[10px] tabular text-muted-foreground">×{r.weight}</span>
                        <span className="flex-1" />
                        {r.id.startsWith("rel_") && !r.id.startsWith("rel_afff_mail") && <Tip label="Remove relationship"><Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 hover:text-destructive" onClick={() => removeRel(r.id)} aria-label="Remove"><Trash2 className="size-3.5" /></Button></Tip>}
                      </div>
                      {(r.label || r.evidence.length > 0) && <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">{r.label && <span>{r.label}</span>}{r.evidence.filter((e) => e.bates).slice(0, 4).map((e, i) => <CiteChip key={i} cite={e.bates!} kind="document" onClick={e.docId ? () => onOpenDocument?.(e.docId!) : undefined} title={e.excerpt} />)}</div>}
                    </li>
                  ))}</ul>
                )}
              </section>
              {d.timeline.length > 0 && (
                <section>
                  <h4 className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><Activity className="size-3" /> Timeline <span className="tabular">{d.timeline.length}</span></h4>
                  <ul className="max-h-56 space-y-0.5 overflow-auto scrollbar-thin">{d.timeline.map((e) => <li key={e.id} className="flex items-start gap-2 px-1.5 py-0.5"><span className="w-[74px] shrink-0 font-mono text-[10.5px] tabular text-muted-foreground">{formatShortDate(e.date)}</span><span className="min-w-0 flex-1">{e.title}</span><CategoryChip category={e.category as TimelineCategory} /></li>)}</ul>
                </section>
              )}
              {d.conflicts.length > 0 && (
                <section>
                  <h4 className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><AlertTriangle className="size-3" /> Conflicts <span className="tabular">{d.conflicts.length}</span></h4>
                  <ul className="space-y-1">{d.conflicts.map((c) => <li key={c.id} className="flex items-start gap-2 rounded border px-2 py-1"><SeverityBadge severity={c.severity as "high"} /><span className="min-w-0 flex-1 leading-snug">{c.title}</span><ConflictStatusBadge status={c.status as "open"} /></li>)}</ul>
                </section>
              )}
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function AddRelationshipDialog({ open, onOpenChange, matterId, nodes, defaultFrom, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; matterId: string; nodes: GraphNode[]; defaultFrom: string | null; onCreated: () => void }) {
  const [fromId, setFromId] = React.useState("");
  const [toId, setToId] = React.useState("");
  const [kind, setKind] = React.useState<Relationship["kind"]>("reports_to");
  const [label, setLabel] = React.useState("");
  const [bates, setBates] = React.useState("");
  const [excerpt, setExcerpt] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) { setFromId(defaultFrom ?? ""); setToId(""); setLabel(""); setBates(""); setExcerpt(""); } }, [open, defaultFrom]);
  const sorted = [...nodes].sort((a, b) => a.label.localeCompare(b.label));
  const save = async () => {
    if (!fromId || !toId) return;
    setSaving(true);
    try {
      await api("/api/ediscovery/analysis/relationships", { method: "POST", json: { matterId, fromId, toId, kind, label: label.trim() || undefined, weight: 2, evidence: bates.trim() || excerpt.trim() ? [{ bates: bates.trim() || undefined, excerpt: excerpt.trim() || undefined }] : undefined } });
      toast.success("Relationship added"); onCreated(); onOpenChange(false);
    } catch (e) { toast.error("Could not add relationship", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  const PersonSelect = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{sorted.map((n) => <SelectItem key={n.id} value={n.id}><span className="flex items-center gap-2"><PersonAvatar name={n.label} size="xs" />{n.label}<span className="text-xs text-muted-foreground">{n.organization}</span></span></SelectItem>)}</SelectContent></Select>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Add relationship</DialogTitle><DialogDescription>Record an org-chart, engagement or communication link with its evidence.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>From</Label><PersonSelect value={fromId} onChange={setFromId} placeholder="Person" /></div>
          <div className="grid gap-1.5"><Label>Relationship</Label><Select value={kind} onValueChange={(v) => setKind(v as Relationship["kind"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ALL_KINDS.map((k) => <SelectItem key={k} value={k}>{RELATIONSHIP_LABELS[k]}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>To</Label><PersonSelect value={toId} onChange={setToId} placeholder="Person" /></div>
          <div className="grid gap-1.5"><Label>Label (optional)</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Study director → sponsor toxicologist" /></div>
          <div className="grid grid-cols-[140px_1fr] gap-2"><div className="grid gap-1.5"><Label>Evidence Bates</Label><Input value={bates} onChange={(e) => setBates(e.target.value)} placeholder="MFC-0041880" className="font-mono" /></div><div className="grid gap-1.5"><Label>Excerpt</Label><Textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={1} placeholder="Supporting quotation or cite" /></div></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !fromId || !toId || fromId === toId}>{saving && <Loader2 className="size-4 animate-spin" />} Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function KnowledgeMapDialog({ open, onOpenChange, matterId, aiConfigured, topics, onSelectPerson, onOpenDocument }: { open: boolean; onOpenChange: (o: boolean) => void; matterId: string; aiConfigured: boolean; topics: string[]; onSelectPerson: (id: string) => void; onOpenDocument?: (id: string) => void }) {
  const maps = useKnowledgeMaps(matterId);
  const openTestimony = useOpenTestimony();
  const [topic, setTopic] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [noKey, setNoKey] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const list = maps.data?.maps ?? [];
  const active = list.find((m) => m.id === activeId) ?? list[0];
  const run = async () => {
    if (!topic.trim()) return;
    setRunning(true); setNoKey(false);
    try { const r = await api<{ map: KnowledgeMap }>("/api/ediscovery/analysis/knowledge-map", { method: "POST", json: { matterId, topic: topic.trim() } }); maps.refresh(); setActiveId(r.map.id); toast.success("Knowledge map ready", { description: `${r.map.entries.length} people` }); }
    catch (e) { if (isNoKey(e)) setNoKey(true); else toast.error("Knowledge map failed", { description: (e as Error).message }); }
    finally { setRunning(false); }
  };
  const CONF: Record<string, "success" | "warning" | "muted"> = { high: "success", medium: "warning", low: "muted" };
  const toMarkdown = (m: KnowledgeMap) => `# Who knew what, when — ${m.topic}\n\n${m.narrative}\n\n| Person | Knew | First evidence | Confidence | Cites |\n|---|---|---|---|---|\n${m.entries.map((e) => `| ${e.personName} | ${e.knew.replace(/\|/g, "/")} | ${e.firstKnownDate} | ${e.confidence} | ${e.cites.map((c) => c.cite).join("; ")} |`).join("\n")}\n`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="flex max-h-[92vh] flex-col">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><BrainCircuit className="size-4" /> Who knew what, when <AiLabel /></DialogTitle><DialogDescription>For a topic, the model maps each person&apos;s knowledge to the earliest evidence in the record, with Bates and page:line cites. Saved with the matter.</DialogDescription></DialogHeader>
        {(noKey || !aiConfigured) && <NoKeyCallout feature="Knowledge maps" compact />}
        <div className="flex flex-wrap items-center gap-2">
          <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); void run(); }}><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic — e.g. PFOS persistence and half-life; MW-7 off-site migration" className="h-8 pl-7 text-xs" /></form>
          <AiButtonHint configured={aiConfigured}><Button size="sm" onClick={run} disabled={running || !topic.trim()}>{running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Map knowledge</Button></AiButtonHint>
        </div>
        <div className="flex flex-wrap gap-1">{topics.slice(0, 8).map((t) => <button key={t} type="button" onClick={() => setTopic(t)} className="h-6 rounded-full border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent cursor-pointer">{t}</button>)}</div>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {maps.loading && !maps.data ? <Skeleton className="h-40" /> : !active ? <EmptyState icon={Users} title="No knowledge map yet" description={aiConfigured ? "Enter a topic and run the map." : "Knowledge maps are generated with the OpenAI Responses API."} /> : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {list.length > 1 && <Select value={active.id} onValueChange={setActiveId}><SelectTrigger size="sm" className="h-7 w-[280px]"><SelectValue /></SelectTrigger><SelectContent>{list.map((m) => <SelectItem key={m.id} value={m.id}>{m.topic} · {formatShortDate(m.createdAt.slice(0, 10))}</SelectItem>)}</SelectContent></Select>}
                <div className="text-sm font-semibold">{active.topic}</div>
                <span className="flex-1" />
                <Button size="xs" variant="outline" onClick={() => exportMarkdownToWord({ title: `Who knew what, when — ${active.topic}`, markdown: toMarkdown(active), matterId, tags: ["knowledge-map", "ediscovery"] })}><FileText className="size-3.5" /> Word</Button>
              </div>
              <p className="rounded-md border bg-muted/30 p-3 text-[12.5px] leading-relaxed">{active.narrative}</p>
              <table className="w-full text-[12px]">
                <thead className="bg-muted/60 text-[10.5px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-2 py-1.5 text-left">Person</th><th className="px-2 py-1.5 text-left">Knew</th><th className="w-[100px] px-2 py-1.5 text-left">First evidence</th><th className="w-[80px] px-2 py-1.5 text-left">Confidence</th><th className="w-[220px] px-2 py-1.5 text-left">Cites</th></tr></thead>
                <tbody>{active.entries.map((e, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-2 py-1.5">{e.personId ? <button type="button" onClick={() => onSelectPerson(e.personId!)} className="flex items-center gap-1.5 font-medium hover:underline cursor-pointer"><PersonAvatar name={e.personName} size="xs" />{e.personName}</button> : <span className="flex items-center gap-1.5"><PersonAvatar name={e.personName} size="xs" />{e.personName}</span>}</td>
                    <td className="px-2 py-1.5 leading-relaxed">{e.knew}</td>
                    <td className="px-2 py-1.5 font-mono tabular text-muted-foreground">{e.firstKnownDate}</td>
                    <td className="px-2 py-1.5"><Badge variant={CONF[e.confidence] ?? "muted"} className="capitalize">{e.confidence}</Badge></td>
                    <td className="px-2 py-1.5"><div className="flex flex-wrap gap-1">{e.cites.map((c, j) => <CiteChip key={j} cite={c.cite} kind={c.sourceKind} onClick={c.sourceId ? () => (c.sourceKind === "document" ? onOpenDocument?.(c.sourceId!) : openTestimony(c.sourceId!)) : undefined} />)}</div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
