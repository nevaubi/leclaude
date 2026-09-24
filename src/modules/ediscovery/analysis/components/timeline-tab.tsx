"use client";
import * as React from "react";
import { Activity, Plus, Sparkles, Download, FileText, Search, X, Pencil, Trash2, MoreHorizontal, Loader2, CalendarRange, ListFilter, ShieldCheck, AlertOctagon, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSSE } from "@/lib/ai/sse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TimelineEvent } from "@/lib/types/domain";
import type { DocRow, SearchResponse } from "../../types";
import { TIMELINE_CATEGORIES, type AnalysisTabProps, type TimelineCategory, type TimelineFilters } from "../types";
import { filterEvents, formatEventDate, sortEvents, sourceLabel } from "../chronology";
import { TimelineSvg, CategoryLegend } from "./timeline-svg";
import { AiButtonHint, AiLabel, CategoryChip, CiteChip, NoKeyCallout, ProvenanceBadge, TabHeader, formatShortDate } from "./shared";
import { api, downloadFile, exportMarkdownToWord, useOpenTestimony, useOverview, useTimeline } from "./use-analysis-data";

type Src = TimelineEvent["sources"][number];

export function TimelineTab({ matterId, onOpenDocument }: AnalysisTabProps) {
  const tl = useTimeline(matterId);
  const overview = useOverview(matterId);
  const openTestimony = useOpenTestimony();
  const [filters, setFilters] = React.useState<TimelineFilters>({ categories: [] });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<TimelineEvent | "new" | null>(null);
  const [extractOpen, setExtractOpen] = React.useState(false);
  const [showChart, setShowChart] = React.useState(true);
  const rowRefs = React.useRef(new Map<string, HTMLTableRowElement>());
  const events = React.useMemo(() => sortEvents(filterEvents(tl.data?.events ?? [], filters)), [tl.data, filters]);
  const people = React.useMemo(() => new Map((tl.data?.people ?? []).map((p) => [p.id, p.name])), [tl.data]);
  const aiConfigured = !!overview.data?.aiConfigured;

  React.useEffect(() => { if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" }); }, [selectedId]);

  const patch = async (e: TimelineEvent, p: Partial<TimelineEvent>) => {
    tl.mutate((cur) => (cur ? { ...cur, events: cur.events.map((x) => (x.id === e.id ? { ...x, ...p } : x)) } : cur));
    try { await api(`/api/ediscovery/analysis/timeline`, { method: "PATCH", json: { id: e.id, patch: p } }); }
    catch (err) { toast.error("Could not update event", { description: (err as Error).message }); tl.refresh(); }
  };
  const remove = async (e: TimelineEvent) => {
    try { await api(`/api/ediscovery/analysis/timeline?id=${e.id}`, { method: "DELETE" }); tl.mutate((cur) => (cur ? { ...cur, events: cur.events.filter((x) => x.id !== e.id), total: cur.total - 1 } : cur)); toast.success("Event deleted"); }
    catch (err) { toast.error("Could not delete", { description: (err as Error).message }); }
  };
  const exportWord = async () => {
    try { const md = await api<{ title: string; markdown: string; count: number }>(`/api/ediscovery/analysis/timeline/export?matter=${encodeURIComponent(matterId)}&format=markdown`); await exportMarkdownToWord({ title: md.title, markdown: md.markdown, matterId, tags: ["chronology", "ediscovery"], meta: { events: md.count }, description: `${md.count} events · filed in the matter folder` }); }
    catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
  };
  const openSource = (s: Src) => {
    if (s.kind === "document" && s.id) onOpenDocument?.(s.id);
    else if (s.kind === "deposition" && s.id) openTestimony(s.id, s.cite); // page:line in the cite is resolved by the transcript viewer
  };
  const setCat = (c: TimelineCategory) => setFilters((f) => { const cur = new Set(f.categories ?? []); if (cur.has(c)) cur.delete(c); else cur.add(c); return { ...f, categories: Array.from(cur) }; });
  const hasFilters = !!(filters.categories?.length || filters.personId || filters.minSignificance || filters.from || filters.to || filters.sourceKind || filters.q || filters.disputedOnly || filters.unverifiedOnly);
  const counts = React.useMemo(() => { const all = tl.data?.events ?? []; return { verified: all.filter((e) => e.verified).length, disputed: all.filter((e) => e.disputed).length, ai: all.filter((e) => e.createdBy === "ai").length }; }, [tl.data]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabHeader
        icon={Activity}
        title="Chronology"
        summary={tl.data ? `${events.length} of ${tl.data.total} events · ${counts.verified} verified · ${counts.disputed} disputed${counts.ai ? ` · ${counts.ai} AI-extracted` : ""}` : undefined}
        actions={
          <>
            <Tip label="Toggle the visual timeline"><Button size="sm" variant="ghost" onClick={() => setShowChart((v) => !v)} className={cn(showChart && "bg-accent")} aria-pressed={showChart}><CalendarRange className="size-4" /> <span className="hidden md:inline">Timeline</span></Button></Tip>
            <AiButtonHint configured={aiConfigured}><Button size="sm" variant="outline" onClick={() => setExtractOpen(true)}><Sparkles className="size-4" /> <span className="hidden lg:inline">Extract from documents</span><span className="lg:hidden">Extract</span></Button></AiButtonHint>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Download className="size-4" /> <span className="hidden md:inline">Export</span> <ChevronDown className="size-3.5 opacity-60" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadFile(`/api/ediscovery/analysis/timeline/export?matter=${encodeURIComponent(matterId)}&format=csv`)}><Download className="size-4" /> CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWord}><FileText className="size-4" /> Word chronology</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> <span className="hidden md:inline">Add event</span><span className="md:hidden">Add</span></Button>
          </>
        }
      >
        <ListFilter className="size-3.5 text-muted-foreground" />
        <CategoryLegend active={new Set(filters.categories ?? [])} onToggle={setCat} />
        <span className="mx-1 h-4 w-px bg-border" />
        <Select value={filters.personId ?? "any"} onValueChange={(v) => setFilters((f) => ({ ...f, personId: v === "any" ? undefined : v }))}>
          <SelectTrigger size="sm" className="h-7 w-[170px] text-[11.5px]"><SelectValue placeholder="Person" /></SelectTrigger>
          <SelectContent><SelectItem value="any">Any person</SelectItem>{(tl.data?.people ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(filters.minSignificance ?? 0)} onValueChange={(v) => setFilters((f) => ({ ...f, minSignificance: Number(v) || undefined }))}>
          <SelectTrigger size="sm" className="h-7 w-[130px] text-[11.5px]"><SelectValue /></SelectTrigger>
          <SelectContent>{[0, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n ? `Significance ≥ ${n}` : "Any significance"}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.sourceKind ?? "any"} onValueChange={(v) => setFilters((f) => ({ ...f, sourceKind: v === "any" ? undefined : (v as TimelineFilters["sourceKind"]) }))}>
          <SelectTrigger size="sm" className="h-7 w-[130px] text-[11.5px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="any">Any source</SelectItem><SelectItem value="document">Documents</SelectItem><SelectItem value="deposition">Testimony</SelectItem><SelectItem value="external">External</SelectItem></SelectContent>
        </Select>
        <Input type="date" value={filters.from ?? ""} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))} className="h-7 w-[132px] text-[11.5px]" aria-label="From date" />
        <span className="text-[11px] text-muted-foreground">to</span>
        <Input type="date" value={filters.to ?? ""} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))} className="h-7 w-[132px] text-[11.5px]" aria-label="To date" />
        <label className="flex items-center gap-1.5 text-[11.5px]"><Switch size="sm" checked={!!filters.disputedOnly} onCheckedChange={(v) => setFilters((f) => ({ ...f, disputedOnly: v }))} /> Disputed</label>
        <label className="flex items-center gap-1.5 text-[11.5px]"><Switch size="sm" checked={!!filters.unverifiedOnly} onCheckedChange={(v) => setFilters((f) => ({ ...f, unverifiedOnly: v }))} /> Unverified</label>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={filters.q ?? ""} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))} placeholder="Search events, Bates…" className="h-7 w-[200px] pl-7 text-[11.5px]" aria-label="Search events" />
        </div>
        {hasFilters && <Button size="xs" variant="ghost" onClick={() => setFilters({ categories: [] })}><X className="size-3.5" /> Clear</Button>}
      </TabHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {showChart && (tl.loading && !tl.data ? <Skeleton className="h-[220px] shrink-0" /> : <TimelineSvg events={events} selectedId={selectedId} onSelect={setSelectedId} people={people} className="shrink-0" />)}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border scrollbar-thin">
          {tl.loading && !tl.data ? <div className="space-y-2 p-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div> : !events.length ? (
            <div className="flex h-full items-center justify-center p-8"><EmptyState icon={Activity} title={hasFilters ? "No events match the filters" : "No events yet"} description={hasFilters ? "Clear a filter or widen the date range." : "Add events by hand or extract them from documents."} action={hasFilters ? <Button size="sm" variant="outline" onClick={() => setFilters({ categories: [] })}>Clear filters</Button> : <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> Add event</Button>} /></div>
          ) : (
            <table className="w-full table-fixed border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-muted/80 text-[10.5px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                <tr>
                  <th className="w-[104px] border-b px-3 py-1.5 text-left font-semibold">Date</th>
                  <th className="border-b px-3 py-1.5 text-left font-semibold">Event</th>
                  <th className="w-[118px] border-b px-3 py-1.5 text-left font-semibold">Category</th>
                  <th className="w-[200px] border-b px-3 py-1.5 text-left font-semibold xl:w-[260px]">Sources</th>
                  <th className="w-[44px] border-b px-2 py-1.5 text-center font-semibold" title="Verified"><ShieldCheck className="mx-auto size-3.5" /></th>
                  <th className="w-[44px] border-b px-2 py-1.5 text-center font-semibold" title="Disputed"><AlertOctagon className="mx-auto size-3.5" /></th>
                  <th className="w-[36px] border-b" />
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} ref={(el) => { if (el) rowRefs.current.set(e.id, el); else rowRefs.current.delete(e.id); }} onClick={() => setSelectedId(e.id === selectedId ? null : e.id)} className={cn("group cursor-pointer border-b align-top transition-colors hover:bg-accent/40", selectedId === e.id && "bg-primary/8")}>
                    <td className="px-3 py-2 font-mono text-[11px] tabular text-muted-foreground">{formatEventDate(e)}</td>
                    <td className="min-w-0 px-3 py-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-1 inline-flex shrink-0 gap-px" title={`Significance ${e.significance}/5`}>{Array.from({ length: 5 }).map((_, i) => <span key={i} className={cn("h-2.5 w-1 rounded-sm", i < e.significance ? "bg-primary/70" : "bg-muted")} />)}</span>
                        <div className="min-w-0 break-words">
                          <div className="font-medium leading-snug">{e.title}{e.createdBy === "ai" && <AiLabel className="ml-1.5 align-middle" />}<ProvenanceBadge record={e} className="ml-1 align-middle" /></div>
                          {e.description && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">{e.description}</div>}
                          {e.personIds?.length ? <div className="mt-0.5 text-[10.5px] text-muted-foreground">{e.personIds.map((p) => people.get(p) ?? p).join(", ")}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2"><CategoryChip category={e.category} /></td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{e.sources.map((s, i) => <CiteChip key={i} cite={sourceLabel(s)} kind={s.kind} onClick={s.id ? () => openSource(s) : undefined} title={s.excerpt} />)}</div></td>
                    <td className="px-2 py-2 text-center" onClick={(ev) => ev.stopPropagation()}><Checkbox checked={!!e.verified} onCheckedChange={(v) => patch(e, { verified: v === true })} aria-label="Verified" /></td>
                    <td className="px-2 py-2 text-center" onClick={(ev) => ev.stopPropagation()}><button type="button" onClick={() => patch(e, { disputed: !e.disputed })} className={cn("inline-flex size-5 items-center justify-center rounded border transition-colors cursor-pointer", e.disputed ? "border-destructive/40 bg-destructive/12 text-destructive" : "text-muted-foreground/50 hover:text-muted-foreground")} aria-label="Toggle disputed" aria-pressed={!!e.disputed}><AlertOctagon className="size-3.5" /></button></td>
                    <td className="px-1 py-1.5 text-right" onClick={(ev) => ev.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Event actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(e)}><Pencil className="size-4" /> Edit</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onClick={() => remove(e)}><Trash2 className="size-4" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <EventDialog open={!!editing} event={editing === "new" ? null : editing} matterId={matterId} people={tl.data?.people ?? []} onOpenChange={(o) => { if (!o) setEditing(null); }} onSaved={(e, isNew) => { tl.mutate((cur) => (cur ? { ...cur, events: isNew ? [...cur.events, e] : cur.events.map((x) => (x.id === e.id ? e : x)), total: cur.total + (isNew ? 1 : 0) } : cur)); setEditing(null); setSelectedId(e.id); }} />
      <ExtractDialog open={extractOpen} onOpenChange={setExtractOpen} matterId={matterId} aiConfigured={aiConfigured} onDone={() => tl.refresh()} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function EventDialog({ open, event, matterId, people, onOpenChange, onSaved }: { open: boolean; event: TimelineEvent | null; matterId: string; people: { id: string; name: string }[]; onOpenChange: (o: boolean) => void; onSaved: (e: TimelineEvent, isNew: boolean) => void }) {
  const blank = React.useCallback((): Omit<TimelineEvent, "id" | "matterId" | "createdBy"> => ({ date: new Date().toISOString().slice(0, 10), title: "", description: "", category: "other", significance: 3, sources: [], personIds: [], verified: false, disputed: false, precision: "day" }), []);
  const [form, setForm] = React.useState(blank());
  const [saving, setSaving] = React.useState(false);
  const [personQ, setPersonQ] = React.useState("");
  React.useEffect(() => { if (open) setForm(event ? { date: event.date, dateEnd: event.dateEnd, precision: event.precision ?? "day", title: event.title, description: event.description ?? "", category: event.category, significance: event.significance, sources: event.sources.map((s) => ({ ...s })), personIds: [...(event.personIds ?? [])], verified: !!event.verified, disputed: !!event.disputed } : blank()); }, [open, event, blank]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setSource = (i: number, p: Partial<Src>) => set("sources", form.sources.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const save = async () => {
    if (!form.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { toast.error("A title and an ISO date are required"); return; }
    setSaving(true);
    try {
      const sources = form.sources.filter((s) => s.bates || s.cite || s.id).map((s) => ({ ...s, bates: s.bates?.trim() || undefined, cite: s.cite?.trim() || undefined, excerpt: s.excerpt?.trim() || undefined }));
      if (event) { const r = await api<{ event: TimelineEvent }>("/api/ediscovery/analysis/timeline", { method: "PATCH", json: { id: event.id, patch: { ...form, sources, dateEnd: form.dateEnd || undefined } } }); onSaved(r.event, false); toast.success("Event updated"); }
      else { const r = await api<{ event: TimelineEvent }>("/api/ediscovery/analysis/timeline", { method: "POST", json: { matterId, ...form, sources, dateEnd: form.dateEnd || undefined } }); onSaved(r.event, true); toast.success("Event added"); }
    } catch (e) { toast.error("Could not save event", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  const filteredPeople = people.filter((p) => !personQ || p.name.toLowerCase().includes(personQ.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{event ? "Edit event" : "Add event"}</DialogTitle><DialogDescription>Every event should cite a Bates number, a transcript page:line, or an external source.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Title</Label><Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Whitfield final report received: dose-related liver effects" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>End (optional)</Label><Input type="date" value={form.dateEnd ?? ""} onChange={(e) => set("dateEnd", e.target.value || undefined)} /></div>
            <div className="grid gap-1.5"><Label>Precision</Label><Select value={form.precision ?? "day"} onValueChange={(v) => set("precision", v as TimelineEvent["precision"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="day">Day</SelectItem><SelectItem value="month">Month</SelectItem><SelectItem value="year">Year</SelectItem></SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Significance</Label><Select value={String(form.significance)} onValueChange={(v) => set("significance", Number(v) as TimelineEvent["significance"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n} — {["background", "context", "relevant", "important", "case-critical"][n - 1]}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-1.5"><Label>Category</Label><div className="flex flex-wrap gap-1">{TIMELINE_CATEGORIES.map((c) => <button key={c.id} type="button" onClick={() => set("category", c.id)} className={cn("rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer", form.category === c.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>{c.label}</button>)}</div></div>
          <div className="grid gap-1.5"><Label>Description</Label><Textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={3} /></div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between"><Label>Sources</Label><Button size="xs" variant="outline" onClick={() => set("sources", [...form.sources, { kind: "document" }])}><Plus className="size-3" /> Add source</Button></div>
            {form.sources.length === 0 && <div className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">No sources yet.</div>}
            {form.sources.map((s, i) => (
              <div key={i} className="grid grid-cols-[110px_1fr_1fr_28px] items-center gap-1.5">
                <Select value={s.kind} onValueChange={(v) => setSource(i, { kind: v as Src["kind"] })}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="document">Document</SelectItem><SelectItem value="deposition">Testimony</SelectItem><SelectItem value="external">External</SelectItem></SelectContent></Select>
                {s.kind === "document" ? <Input value={s.bates ?? ""} onChange={(e) => setSource(i, { bates: e.target.value })} placeholder="Bates, e.g. MFC-0041877" className="h-8 font-mono text-xs" /> : <Input value={s.cite ?? ""} onChange={(e) => setSource(i, { cite: e.target.value })} placeholder={s.kind === "deposition" ? "Voss 24:05" : "Citation"} className="h-8 text-xs" />}
                <Input value={s.excerpt ?? ""} onChange={(e) => setSource(i, { excerpt: e.target.value })} placeholder="Supporting quotation" className="h-8 text-xs" />
                <Button size="icon-xs" variant="ghost" onClick={() => set("sources", form.sources.filter((_, j) => j !== i))} aria-label="Remove source"><X className="size-3.5" /></Button>
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label>People</Label>
            <Input value={personQ} onChange={(e) => setPersonQ(e.target.value)} placeholder="Filter people…" className="h-8 text-xs" />
            <div className="flex max-h-24 flex-wrap gap-1 overflow-auto scrollbar-thin">{filteredPeople.map((p) => { const on = form.personIds?.includes(p.id); return <button key={p.id} type="button" onClick={() => set("personIds", on ? (form.personIds ?? []).filter((x) => x !== p.id) : [...(form.personIds ?? []), p.id])} className={cn("rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer", on ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>{p.name}</button>; })}</div>
          </div>
          <div className="flex items-center gap-4 text-xs"><label className="flex items-center gap-1.5"><Checkbox checked={!!form.verified} onCheckedChange={(v) => set("verified", v === true)} /> Verified against the source</label><label className="flex items-center gap-1.5"><Checkbox checked={!!form.disputed} onCheckedChange={(v) => set("disputed", v === true)} /> Disputed</label></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} {event ? "Save changes" : "Add event"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function ExtractDialog({ open, onOpenChange, matterId, aiConfigured, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; matterId: string; aiConfigured: boolean; onDone: () => void }) {
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<DocRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<"ai" | "metadata">(aiConfigured ? "ai" : "metadata");
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = React.useState<{ added: TimelineEvent[]; merged: number; extracted: number; ai: boolean } | null>(null);
  const [noKey, setNoKey] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  React.useEffect(() => { setMode(aiConfigured ? "ai" : "metadata"); }, [aiConfigured]);
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api<SearchResponse>("/api/ediscovery/search", { method: "POST", json: { matterId, q, view: q ? undefined : "hot", limit: 60, sort: "date", dir: "asc" } })
        .then((r) => { if (alive) setRows(r.hits); }).catch(() => { if (alive) setRows([]); }).finally(() => { if (alive) setLoading(false); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, matterId]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = async () => {
    if (!selected.size) return;
    setRunning(true); setResult(null); setNoKey(false); setProgress({ done: 0, total: selected.size });
    try {
      const res = await fetch("/api/ediscovery/analysis/timeline/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matterId, docIds: Array.from(selected), mode }) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await readSSE<{ type: string; done?: number; total?: number; added?: TimelineEvent[]; merged?: number; extracted?: number; ai?: boolean; code?: string; message?: string }>(res, (ev) => {
        if (ev.type === "progress") setProgress({ done: ev.done ?? 0, total: ev.total ?? selected.size });
        else if (ev.type === "done") { setResult({ added: ev.added ?? [], merged: ev.merged ?? 0, extracted: ev.extracted ?? 0, ai: !!ev.ai }); onDone(); }
        else if (ev.type === "error") { if (ev.code === "no_api_key") setNoKey(true); else toast.error("Extraction failed", { description: ev.message }); }
      });
    } catch (e) { toast.error("Extraction failed", { description: (e as Error).message }); }
    finally { setRunning(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setResult(null); setSelected(new Set()); setProgress(null); } }}>
      <DialogContent size="lg" className="flex max-h-[92vh] flex-col">
        <DialogHeader><DialogTitle className="flex items-center gap-2">Extract events from documents <AiLabel /></DialogTitle><DialogDescription>Select documents; the model reads each one and proposes dated events with Bates cites. Events sharing a date and title are merged into existing entries rather than duplicated.</DialogDescription></DialogHeader>
        {(noKey || !aiConfigured) && <NoKeyCallout feature="AI event extraction" compact />}
        <div className="flex items-center gap-2">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents (defaults to hot documents)" className="h-8 pl-7 text-xs" /></div>
          <Select value={mode} onValueChange={(v) => setMode(v as "ai" | "metadata")}>
            <SelectTrigger size="sm" className="h-8 w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ai" disabled={!aiConfigured}>AI — read the text (generateJSON)</SelectItem><SelectItem value="metadata">Metadata — one event per document</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border scrollbar-thin">
          {loading && !rows.length ? <div className="space-y-1.5 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div> : !rows.length ? <div className="p-6 text-center text-xs text-muted-foreground">No documents match.</div> : (
            <ul className="divide-y">
              <li className="flex items-center gap-2 bg-muted/40 px-2 py-1 text-[10.5px] text-muted-foreground"><Checkbox checked={rows.length > 0 && rows.every((r) => selected.has(r.id)) ? true : selected.size ? "indeterminate" : false} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Select all" /><span>{rows.length} documents · {selected.size} selected</span></li>
              {rows.map((r) => (
                <li key={r.id}><label className={cn("flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/40", selected.has(r.id) && "bg-primary/6")}><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /><span className="w-[110px] shrink-0 font-mono text-[11px] text-muted-foreground">{r.bates}</span><span className="w-[84px] shrink-0 tabular text-[11px] text-muted-foreground">{formatShortDate(r.date)}</span><span className="min-w-0 flex-1 truncate">{r.subject}</span><span className="text-[10.5px] text-muted-foreground">{r.custodianName}</span></label></li>
              ))}
            </ul>
          )}
        </div>
        {progress && running && <div className="space-y-1"><Progress value={(progress.done / Math.max(1, progress.total)) * 100} /><div className="text-[11px] text-muted-foreground">{progress.done} of {progress.total} documents</div></div>}
        {result && <div className="rounded-md border bg-success/5 p-2.5 text-xs"><div className="font-medium">{result.added.length} new event{result.added.length === 1 ? "" : "s"} added · {result.merged} merged into existing entries · {result.extracted} extracted{result.ai ? " by the model" : " from metadata"}</div>{result.added.slice(0, 6).map((e) => <div key={e.id} className="mt-1 flex gap-2 text-muted-foreground"><span className="font-mono tabular">{e.date}</span><span className="truncate">{e.title}</span></div>)}{result.added.length > 6 && <div className="mt-1 text-muted-foreground">…and {result.added.length - 6} more</div>}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{result ? "Close" : "Cancel"}</Button>
          <Button onClick={run} disabled={running || !selected.size || (mode === "ai" && !aiConfigured)}>{running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {mode === "ai" ? "Extract with AI" : "Add as events"} ({selected.size})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
