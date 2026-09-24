"use client";
import * as React from "react";
import { AlertTriangle, Search, Plus, Download, FileText, Loader2, X, CircleCheck, CircleX, RotateCcw, Link2, MessageSquareText, ChevronDown, Trash2, ArrowRight, Filter } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { PersonAvatar } from "@/components/ui/avatar";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Conflict } from "@/lib/types/domain";
import { CONFLICT_KINDS, type AnalysisTabProps, type ConflictNote, type ConflictRow, type DepositionSummary } from "../types";
import { ModelLabel, CiteChip, ConflictStatusBadge, ListSkeleton, ProvenanceBadge, SeverityBadge, kindLabel, formatShortDate } from "./shared";
import { api, downloadFile, exportMarkdownToWord, useConflict, useConflicts, useDepositions, useOpenTestimony, type ConflictFilters } from "./use-analysis-data";

type Side = Conflict["sides"][number];

export function ConflictsTab({ matterId, onOpenDocument }: AnalysisTabProps) {
  const [filters, setFilters] = React.useState<ConflictFilters>({ status: "", kind: "", severity: "", witnessId: "", q: "" });
  const [debouncedQ, setDebouncedQ] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebouncedQ(filters.q ?? ""), 150); return () => clearTimeout(t); }, [filters.q]);
  const list = useConflicts(matterId, { ...filters, q: debouncedQ });
  const deps = useDepositions(matterId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const rows = React.useMemo(() => list.data?.conflicts ?? [], [list.data]);
  const witnesses = React.useMemo(() => { const m = new Map<string, string>(); for (const d of deps.data?.depositions ?? []) m.set(d.witnessId, d.witnessName); return Array.from(m.entries()); }, [deps.data]);
  React.useEffect(() => { if (!selectedId && rows.length) setSelectedId(rows[0].id); if (selectedId && rows.length && !rows.some((r) => r.id === selectedId)) setSelectedId(rows[0].id); }, [rows, selectedId]);
  const hasFilters = !!(filters.status || filters.kind || filters.severity || filters.witnessId || filters.q);
  const summary = React.useMemo(() => ({ open: rows.filter((r) => r.status === "open").length, high: rows.filter((r) => r.severity === "high" && r.status === "open").length }), [rows]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.getAttribute("role") === "combobox")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || !rows.length) return;
      const i = rows.findIndex((r) => r.id === selectedId);
      if (e.key === "j") { e.preventDefault(); setSelectedId(rows[Math.min(rows.length - 1, i + 1)].id); }
      if (e.key === "k") { e.preventDefault(); setSelectedId(rows[Math.max(0, i - 1)].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedId]);

  const exportWord = async () => {
    try { const md = await api<{ title: string; markdown: string; count: number }>(`/api/ediscovery/analysis/conflicts/export?matter=${encodeURIComponent(matterId)}&format=markdown`); await exportMarkdownToWord({ title: md.title, markdown: md.markdown, matterId, tags: ["conflicts", "ediscovery"], meta: { count: md.count } }); }
    catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[380px] shrink-0 flex-col border-r bg-sidebar/40">
        <div className="space-y-1.5 border-b p-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={filters.q ?? ""} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Search conflicts" className="h-8 pl-7 text-xs" aria-label="Search conflicts" /></div>
            <Tip label="New conflict"><Button size="icon-sm" variant="outline" onClick={() => setNewOpen(true)} aria-label="New conflict"><Plus className="size-4" /></Button></Tip>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Filter className="size-3 text-muted-foreground" />
            <Select value={filters.status || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? "" : (v as Conflict["status"]) }))}><SelectTrigger size="sm" className="h-6 w-auto gap-1 px-2 text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any status</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="dismissed">Dismissed</SelectItem></SelectContent></Select>
            <Select value={filters.severity || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, severity: v === "all" ? "" : (v as Conflict["severity"]) }))}><SelectTrigger size="sm" className="h-6 w-auto gap-1 px-2 text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any severity</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
            <Select value={filters.kind || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, kind: v === "all" ? "" : (v as Conflict["kind"]) }))}><SelectTrigger size="sm" className="h-6 w-auto gap-1 px-2 text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any kind</SelectItem>{CONFLICT_KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}</SelectContent></Select>
            <Select value={filters.witnessId || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, witnessId: v === "all" ? "" : v }))}><SelectTrigger size="sm" className="h-6 w-auto gap-1 px-2 text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any witness</SelectItem>{witnesses.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select>
            {hasFilters && <Button size="xs" variant="ghost" className="h-6" onClick={() => setFilters({ status: "", kind: "", severity: "", witnessId: "", q: "" })}><X className="size-3" /> Clear</Button>}
          </div>
        </div>
        <div className="flex items-center gap-2 border-b px-3 py-1 text-[10.5px] text-muted-foreground"><span className="tabular">{rows.length} conflict{rows.length === 1 ? "" : "s"}</span><span>·</span><span className="tabular">{summary.open} open</span>{summary.high > 0 && <><span>·</span><span className="tabular text-destructive">{summary.high} high</span></>}<span className="flex-1" /><kbd className="px-1 text-[9.5px]">j</kbd><kbd className="px-1 text-[9.5px]">k</kbd></div>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {list.loading && !list.data ? <ListSkeleton rows={6} /> : !rows.length ? <div className="p-4"><EmptyState icon={AlertTriangle} title={hasFilters ? "No conflicts match" : "No conflicts recorded"} description={hasFilters ? "Clear a filter." : "Use “Find contradictions” in Cross-analysis or add one by hand."} /></div> : (
            <ul className="p-1.5">{rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setSelectedId(c.id)} className={cn("w-full rounded-md px-2 py-2 text-left transition-colors cursor-pointer", selectedId === c.id ? "bg-accent text-accent-foreground" : "hover:bg-sidebar-accent")} aria-current={selectedId === c.id ? "true" : undefined}>
                  <div className="flex flex-wrap items-center gap-1"><SeverityBadge severity={c.severity} /><ConflictStatusBadge status={c.status} /><span className="text-[10.5px] text-muted-foreground">{kindLabel(c.kind)}</span>{c.createdBy === "ai" && <ModelLabel />}<ProvenanceBadge record={c} /></div>
                  <div className={cn("mt-1 line-clamp-2 text-[12.5px] leading-snug", c.status !== "open" && "text-muted-foreground")}>{c.title}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">{c.witnessNames.length > 0 && <span className="flex items-center gap-1">{c.witnessNames.map((w) => <PersonAvatar key={w} name={w} size="xs" />)}<span>{c.witnessNames.join(", ")}</span></span>}{c.noteCount > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquareText className="size-3" />{c.noteCount}</span>}</div>
                </button>
              </li>
            ))}</ul>
          )}
        </div>
        <div className="flex items-center gap-1.5 border-t p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="flex-1"><Download className="size-4" /> Export <ChevronDown className="size-3.5 opacity-60" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => downloadFile(`/api/ediscovery/analysis/conflicts/export?matter=${encodeURIComponent(matterId)}&format=csv`)}><Download className="size-4" /> CSV register</DropdownMenuItem>
              <DropdownMenuItem onClick={exportWord}><FileText className="size-4" /> Word register</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="flex-1" onClick={() => setNewOpen(true)}><Plus className="size-4" /> New conflict</Button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {selectedId ? <ConflictDetail key={selectedId} id={selectedId} depositions={deps.data?.depositions ?? []} onOpenDocument={onOpenDocument} onChanged={(deleted) => { list.refresh(); if (deleted) setSelectedId(null); }} /> : <div className="flex h-full items-center justify-center p-8">{list.loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <EmptyState icon={AlertTriangle} title="Select a conflict" description="Side-by-side excerpts, analysis, notes and actions appear here." />}</div>}
      </div>
      <NewConflictDialog open={newOpen} onOpenChange={setNewOpen} matterId={matterId} depositions={deps.data?.depositions ?? []} onCreated={(c) => { list.refresh(); setSelectedId(c.id); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConflictDetail({ id, depositions, onOpenDocument, onChanged }: { id: string; depositions: DepositionSummary[]; onOpenDocument?: (id: string) => void; onChanged: (deleted?: boolean) => void }) {
  const detail = useConflict(id);
  const openTestimony = useOpenTestimony();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [editingAnalysis, setEditingAnalysis] = React.useState(false);
  const [analysis, setAnalysis] = React.useState("");
  const c = detail.data?.conflict;
  const setStatus = async (status: Conflict["status"]) => {
    setBusy(true);
    try { const r = await api<{ conflict: ConflictRow; notes: ConflictNote[] }>(`/api/ediscovery/analysis/conflicts/${id}`, { method: "PATCH", json: { status } }); detail.mutate(() => r); onChanged(); toast.success(`Marked ${status}`); }
    catch (e) { toast.error("Could not update", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const setSeverity = async (severity: Conflict["severity"]) => {
    try { const r = await api<{ conflict: ConflictRow; notes: ConflictNote[] }>(`/api/ediscovery/analysis/conflicts/${id}`, { method: "PATCH", json: { severity } }); detail.mutate(() => r); onChanged(); }
    catch (e) { toast.error("Could not update", { description: (e as Error).message }); }
  };
  const saveAnalysis = async () => {
    try { const r = await api<{ conflict: ConflictRow; notes: ConflictNote[] }>(`/api/ediscovery/analysis/conflicts/${id}`, { method: "PATCH", json: { analysis } }); detail.mutate(() => r); setEditingAnalysis(false); toast.success("Analysis saved"); }
    catch (e) { toast.error("Could not save", { description: (e as Error).message }); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try { const r = await api<{ note: ConflictNote }>(`/api/ediscovery/analysis/conflicts/${id}/notes`, { method: "POST", json: { body: note } }); detail.mutate((cur) => (cur ? { ...cur, notes: [...cur.notes, r.note], conflict: { ...cur.conflict, noteCount: cur.conflict.noteCount + 1 } } : cur)); setNote(""); onChanged(); }
    catch (e) { toast.error("Could not add note", { description: (e as Error).message }); }
  };
  const removeSide = async (i: number) => {
    try { const r = await api<{ conflict: ConflictRow; notes: ConflictNote[] }>(`/api/ediscovery/analysis/conflicts/${id}`, { method: "PATCH", json: { removeSideIndex: i } }); detail.mutate(() => r); }
    catch (e) { toast.error("Could not remove", { description: (e as Error).message }); }
  };
  const remove = async () => {
    try { await api(`/api/ediscovery/analysis/conflicts/${id}`, { method: "DELETE" }); toast.success("Conflict deleted"); onChanged(true); }
    catch (e) { toast.error("Could not delete", { description: (e as Error).message }); }
  };
  const openSide = (s: Side) => {
    if (s.sourceKind === "document") onOpenDocument?.(s.sourceId);
    else openTestimony(s.sourceId, s.cite); // page:line in the cite is resolved by the transcript viewer
  };
  if (detail.loading && !detail.data) return <div className="space-y-3 p-5"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/3" /><div className="grid grid-cols-2 gap-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div><Skeleton className="h-24" /></div>;
  if (!c) return <div className="p-8"><EmptyState icon={AlertTriangle} title="Conflict not found" /></div>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-1.5"><SeverityBadge severity={c.severity} /><ConflictStatusBadge status={c.status} /><span className="text-[11px] text-muted-foreground">{kindLabel(c.kind)}</span>{c.createdBy === "ai" && <ModelLabel />}<ProvenanceBadge record={c} compact={false} /><span className="font-mono text-[10.5px] text-muted-foreground">{c.id}</span></div>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-snug">{c.title}</h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {c.status !== "resolved" && <Button size="sm" variant="success" onClick={() => setStatus("resolved")} disabled={busy}><CircleCheck className="size-4" /> Resolve</Button>}
          {c.status !== "dismissed" && <Button size="sm" variant="outline" onClick={() => setStatus("dismissed")} disabled={busy}><CircleX className="size-4" /> Dismiss</Button>}
          {c.status !== "open" && <Button size="sm" variant="outline" onClick={() => setStatus("open")} disabled={busy}><RotateCcw className="size-4" /> Reopen</Button>}
          <Select value={c.severity} onValueChange={(v) => setSeverity(v as Conflict["severity"])}><SelectTrigger size="sm" className="h-8 w-[120px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
          <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}><Link2 className="size-4" /> Link source</Button>
          <span className="flex-1" />
          <Tip label="Delete conflict"><Button size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={remove} aria-label="Delete"><Trash2 className="size-4" /></Button></Tip>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-5">
        <div className={cn("grid gap-3", c.sides.length >= 3 ? "grid-cols-1 xl:grid-cols-3" : "grid-cols-1 lg:grid-cols-2")}>
          {c.sides.map((s, i) => (
            <div key={i} className={cn("group relative rounded-lg border bg-card p-3", s.sourceKind === "deposition" ? "border-l-4 border-l-chart-2" : "border-l-4 border-l-chart-1")}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</span>
                <span className="flex-1" />
                <CiteChip cite={s.cite} kind={s.sourceKind} onClick={() => openSide(s)} />
                {c.sides.length > 2 && <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => removeSide(i)} aria-label="Remove side"><X className="size-3.5" /></Button>}
              </div>
              <blockquote className="mt-2 border-l-2 border-border pl-3 text-[13px] leading-relaxed">“{s.excerpt}”</blockquote>
              {i < c.sides.length - 1 && <ArrowRight className="absolute -right-4 top-1/2 hidden size-4 -translate-y-1/2 text-muted-foreground lg:block" />}
            </div>
          ))}
        </div>
        <section className="mt-5">
          <div className="mb-1 flex items-center gap-2"><h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Analysis</h3>{c.createdBy === "ai" && <ModelLabel />}<span className="flex-1" />{!editingAnalysis && <Button size="xs" variant="ghost" onClick={() => { setAnalysis(c.analysis); setEditingAnalysis(true); }}>Edit</Button>}</div>
          {editingAnalysis ? <div><Textarea value={analysis} onChange={(e) => setAnalysis(e.target.value)} rows={6} className="text-[13px]" autoFocus /><div className="mt-1.5 flex justify-end gap-1.5"><Button size="sm" variant="ghost" onClick={() => setEditingAnalysis(false)}>Cancel</Button><Button size="sm" onClick={saveAnalysis}>Save</Button></div></div> : <p className="whitespace-pre-line rounded-lg border bg-muted/30 p-3 text-[13px] leading-relaxed">{c.analysis || "No analysis yet."}</p>}
        </section>
        <section className="mt-5">
          <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Notes <span className="tabular">{detail.data?.notes.length ?? 0}</span></h3>
          <ul className="space-y-2">{(detail.data?.notes ?? []).map((n) => <li key={n.id} className="flex gap-2.5 rounded-md border px-3 py-2"><PersonAvatar name={n.authorName} size="sm" className="mt-0.5" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[11px]"><span className="font-medium">{n.authorName}</span><span className="text-muted-foreground">{formatShortDate(n.createdAt.slice(0, 10))}</span></div><div className="mt-0.5 whitespace-pre-line text-[12.5px] leading-relaxed">{n.body}</div></div></li>)}</ul>
          <div className="mt-2 flex gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note (⌘/Ctrl+Enter to save)" className="text-[12.5px]" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void addNote(); } }} />
            <Button size="sm" onClick={addNote} disabled={!note.trim()} className="self-end"><MessageSquareText className="size-4" /> Add note</Button>
          </div>
        </section>
      </div>
      <LinkSourceDialog open={linkOpen} onOpenChange={setLinkOpen} depositions={depositions} onAdd={async (side) => { try { const r = await api<{ conflict: ConflictRow; notes: ConflictNote[] }>(`/api/ediscovery/analysis/conflicts/${id}`, { method: "PATCH", json: { addSide: side } }); detail.mutate(() => r); setLinkOpen(false); toast.success("Source linked"); } catch (e) { toast.error("Could not link", { description: (e as Error).message }); } }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SideEditor({ side, onChange, depositions, compact }: { side: Side; onChange: (s: Side) => void; depositions: DepositionSummary[]; compact?: boolean }) {
  const [batesLookup, setBatesLookup] = React.useState<{ bates: string; found: boolean } | null>(null);
  const lookupBates = async (bates: string) => {
    if (!/^[A-Z]{2,5}-\d{5,}$/i.test(bates.trim())) return;
    try { const r = await api<{ doc: { id: string; subject: string; bates: string } }>(`/api/ediscovery/docs/${encodeURIComponent(bates.trim())}?view=0`); onChange({ ...side, sourceId: r.doc.id, cite: r.doc.bates, label: side.label || r.doc.subject }); setBatesLookup({ bates, found: true }); }
    catch { setBatesLookup({ bates, found: false }); }
  };
  return (
    <div className={cn("grid gap-2 rounded-md border p-2.5", compact && "p-2")}>
      <div className="grid grid-cols-[130px_1fr] gap-2">
        <Select value={side.sourceKind} onValueChange={(v) => onChange({ ...side, sourceKind: v as Side["sourceKind"], sourceId: "", cite: "" })}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deposition">Testimony</SelectItem><SelectItem value="document">Document</SelectItem></SelectContent></Select>
        <Input value={side.label} onChange={(e) => onChange({ ...side, label: e.target.value })} placeholder="Label, e.g. Hale testimony" className="h-8 text-xs" />
      </div>
      {side.sourceKind === "deposition" ? (
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <Select value={side.sourceId} onValueChange={(v) => { const d = depositions.find((x) => x.id === v); onChange({ ...side, sourceId: v, label: side.label || `${d?.witnessName ?? ""} testimony` }); }}><SelectTrigger size="sm"><SelectValue placeholder="Deposition" /></SelectTrigger><SelectContent>{depositions.filter((d) => d.qaCount > 0).map((d) => <SelectItem key={d.id} value={d.id}>{d.witnessName} · {formatShortDate(d.date)}{d.volume && d.volume > 1 ? ` · Vol. ${d.volume}` : ""}</SelectItem>)}</SelectContent></Select>
          <Input value={side.cite} onChange={(e) => onChange({ ...side, cite: e.target.value })} placeholder="Hale 46:07" className="h-8 font-mono text-xs" />
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <Input value={side.cite} onChange={(e) => onChange({ ...side, cite: e.target.value })} onBlur={(e) => lookupBates(e.target.value)} placeholder="Bates, e.g. MFC-0052210" className="h-8 font-mono text-xs" />
          <span className={cn("text-[10.5px]", batesLookup?.found ? "text-success" : batesLookup ? "text-destructive" : "text-muted-foreground")}>{batesLookup ? (batesLookup.found ? "found" : "not in workspace") : "looks up on blur"}</span>
        </div>
      )}
      <Textarea value={side.excerpt} onChange={(e) => onChange({ ...side, excerpt: e.target.value })} rows={2} placeholder="Verbatim excerpt" className="text-xs" />
    </div>
  );
}

function LinkSourceDialog({ open, onOpenChange, depositions, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; depositions: DepositionSummary[]; onAdd: (s: Side) => Promise<void> }) {
  const [side, setSide] = React.useState<Side>({ label: "", sourceKind: "deposition", sourceId: "", cite: "", excerpt: "" });
  React.useEffect(() => { if (open) setSide({ label: "", sourceKind: "deposition", sourceId: "", cite: "", excerpt: "" }); }, [open]);
  const valid = side.sourceId && side.cite.trim() && side.excerpt.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Link a source</DialogTitle><DialogDescription>Add a deposition page:line or a document Bates number as another side of this conflict.</DialogDescription></DialogHeader>
        <SideEditor side={side} onChange={setSide} depositions={depositions} />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => onAdd(side)} disabled={!valid}><Link2 className="size-4" /> Link</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewConflictDialog({ open, onOpenChange, matterId, depositions, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; matterId: string; depositions: DepositionSummary[]; onCreated: (c: Conflict) => void }) {
  const blank = (): Side => ({ label: "", sourceKind: "deposition", sourceId: "", cite: "", excerpt: "" });
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState<Conflict["kind"]>("testimony_vs_document");
  const [severity, setSeverity] = React.useState<Conflict["severity"]>("medium");
  const [analysis, setAnalysis] = React.useState("");
  const [sides, setSides] = React.useState<Side[]>([blank(), { ...blank(), sourceKind: "document" }]);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) { setTitle(""); setKind("testimony_vs_document"); setSeverity("medium"); setAnalysis(""); setSides([blank(), { ...blank(), sourceKind: "document" }]); } }, [open]);
  const valid = title.trim() && sides.every((s) => s.sourceId && s.cite.trim() && s.excerpt.trim());
  const save = async () => {
    setSaving(true);
    try { const r = await api<{ conflict: Conflict }>("/api/ediscovery/analysis/conflicts", { method: "POST", json: { matterId, title: title.trim(), kind, severity, analysis: analysis.trim(), sides: sides.map((s) => ({ ...s, label: s.label.trim() || (s.sourceKind === "document" ? "Document" : "Testimony") })) } }); toast.success("Conflict recorded"); onCreated(r.conflict); onOpenChange(false); }
    catch (e) { toast.error("Could not create conflict", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[92vh] flex-col">
        <DialogHeader><DialogTitle>New conflict</DialogTitle><DialogDescription>Record an inconsistency between testimony and documents (or between witnesses) with verbatim excerpts and cites.</DialogDescription></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto scrollbar-thin pr-1">
          <div className="grid gap-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hale: 'late August 2002' vs. transmittal email dated 8 Jul 2002" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Kind</Label><Select value={kind} onValueChange={(v) => setKind(v as Conflict["kind"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONFLICT_KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Severity</Label><Select value={severity} onValueChange={(v) => setSeverity(v as Conflict["severity"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></div>
          </div>
          <div className="grid gap-1.5"><div className="flex items-center justify-between"><Label>Sides</Label><Button size="xs" variant="outline" onClick={() => setSides((s) => [...s, blank()])} disabled={sides.length >= 4}><Plus className="size-3" /> Add side</Button></div>
            {sides.map((s, i) => <div key={i} className="relative"><SideEditor side={s} onChange={(v) => setSides((arr) => arr.map((x, j) => (j === i ? v : x)))} depositions={depositions} compact />{sides.length > 2 && <Button size="icon-xs" variant="ghost" className="absolute -right-1 -top-1" onClick={() => setSides((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove side"><X className="size-3.5" /></Button>}</div>)}
          </div>
          <div className="grid gap-1.5"><Label>Analysis</Label><Textarea value={analysis} onChange={(e) => setAnalysis(e.target.value)} rows={4} placeholder="Why the sources conflict, how serious it is, and how to handle it." /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !valid}>{saving && <Loader2 className="size-4 animate-spin" />} Record conflict</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
