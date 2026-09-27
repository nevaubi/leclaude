"use client";
import * as React from "react";
import { Activity, ArrowLeft, Download, Link2, Loader2, Mail, Network, PanelRightClose, PanelRightOpen, Plus, ScrollText, Search, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Inspector } from "@/components/ui/inspector";
import { KeyValueList, SegmentedControl } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Relationship } from "@/lib/types/domain";
import type { AnalysisTabProps, GraphData, GraphEdge, GraphNode, GraphOrg, TimelineCategory } from "../types";
import { RELATIONSHIP_LABELS } from "../graph";
import { ALL_KINDS, KIND_GROUPS, edgesCsv, kindLabel, neighborhood, nodesCsv, timelineRows, type RelationshipKind } from "../graph-view";
import { FocusGraph } from "./force-graph";
import { GraphTimeline } from "./graph-timeline";
import { KnowledgeMatrix } from "./knowledge-matrix";
import { downloadPng, downloadSvg } from "./graph-export";
import { CategoryChip, CiteChip, ConflictStatusBadge, SeverityBadge, formatShortDate, typingTarget, useNarrowViewport } from "./shared";
import { api, downloadText, useGraph, useKnowledgeMaps, useOpenTestimony, useOverview, usePerson } from "./use-analysis-data";

type View = "graph" | "matrix";
interface ListRow { id: string; kind: "person" | "org"; label: string; role: string; organization?: string; docs: number; testimony: number; links: number }

const ROLE_LABEL: Record<string, string> = { custodian: "Custodian", attorney: "Attorney", opposing: "Opposing counsel", expert: "Expert", witness: "Witness", judge: "Judge", client: "Client", paralegal: "Paralegal", staff: "Staff", other: "Other" };

export function PeopleGraphTab({ matterId, onOpenDocument }: AnalysisTabProps) {
  const graphRes = useGraph(matterId);
  const overview = useOverview(matterId);
  const maps = useKnowledgeMaps(matterId);
  const [view, setView] = React.useState<View>("graph");
  const [q, setQ] = React.useState("");
  const [kinds, setKinds] = React.useState<Set<RelationshipKind>>(new Set(ALL_KINDS));
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [depth, setDepth] = React.useState<1 | 2>(1);
  const [centerId, setCenterId] = React.useState<string | null>(null);
  const [orgId, setOrgId] = React.useState<string | null>(null);
  const [edgeId, setEdgeId] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<string[]>([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const narrow = useNarrowViewport(1280);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const data = graphRes.data;
  const nodes = React.useMemo(() => data?.nodes ?? [], [data]);
  const orgs = React.useMemo(() => data?.orgs ?? [], [data]);
  const aiConfigured = !!overview.data?.aiConfigured;

  const filters = React.useMemo(() => ({ kinds, from: from || undefined, to: to || undefined }), [kinds, from, to]);
  const org = React.useMemo(() => (orgId ? orgs.find((o) => o.id === orgId) ?? null : null), [orgId, orgs]);
  const hood = React.useMemo(() => (data ? neighborhood(data, { centerId: org ? null : centerId, org, depth, filters }) : { nodes: [], edges: [], depth: new Map<string, number>(), truncated: false }), [data, centerId, org, depth, filters]);
  const rows = React.useMemo(() => timelineRows(hood.edges, nodes, org ? null : centerId), [hood.edges, nodes, org, centerId]);
  const undated = hood.edges.length - hood.edges.filter((e) => e.firstDate).length;
  const selectedEdge = React.useMemo(() => (edgeId ? data?.edges.find((e) => e.id === edgeId) ?? null : null), [edgeId, data]);
  const centerNode = React.useMemo(() => (centerId ? nodes.find((n) => n.id === centerId) ?? null : null), [centerId, nodes]);

  // Initial focus: ?person= when present, else the best-connected person.
  React.useEffect(() => {
    if (!nodes.length || centerId || orgId) return;
    const p = new URL(window.location.href).searchParams.get("person");
    const first = p && nodes.some((n) => n.id === p) ? p : [...nodes].sort((a, b) => b.degree + b.docCount - (a.degree + a.docCount))[0]?.id ?? null;
    setCenterId(first);
  }, [nodes, centerId, orgId]);
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (centerId && !orgId) url.searchParams.set("person", centerId); else url.searchParams.delete("person");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [centerId, orgId]);

  const focus = React.useCallback((id: string) => {
    if (id.startsWith("org:")) { setOrgId(id); setEdgeId(null); return; }
    setHistory((h) => (centerId && centerId !== id ? [...h.slice(-19), centerId] : h));
    setOrgId(null); setCenterId(id); setEdgeId(null);
  }, [centerId]);
  const back = () => { const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); setOrgId(null); setCenterId(prev); setEdgeId(null); };
  const toggleGroup = (g: RelationshipKind[]) => setKinds((s) => { const n = new Set(s); const on = g.every((k) => n.has(k)); for (const k of g) { if (on) n.delete(k); else n.add(k); } return n; });
  const hasFilters = kinds.size !== ALL_KINDS.length || !!from || !!to;

  // Keyboard: "[" toggles nothing here (the shell owns it); Backspace goes back to the previous person outside inputs.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.defaultPrevented || typingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return; if (e.key === "Backspace" && history.length) { e.preventDefault(); back(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const listRows = React.useMemo<ListRow[]>(() => {
    const t = q.trim().toLowerCase();
    const people: ListRow[] = nodes.map((n) => ({ id: n.id, kind: "person", label: n.label, role: ROLE_LABEL[n.role ?? ""] ?? n.role ?? "", organization: n.organization, docs: n.docCount, testimony: n.testimony ?? 0, links: n.degree }));
    const orgRows: ListRow[] = orgs.map((o) => ({ id: o.id, kind: "org", label: o.label, role: `${o.memberIds.length} people`, docs: o.docCount, testimony: o.testimony, links: o.memberIds.length }));
    const all = [...people, ...orgRows];
    return t ? all.filter((r) => `${r.label} ${r.organization ?? ""} ${r.role}`.toLowerCase().includes(t)) : all;
  }, [nodes, orgs, q]);

  const columns = React.useMemo<DataTableColumn<ListRow>[]>(() => [
    { id: "label", header: "Name", width: 150, minWidth: 110, sortable: true, locked: true, accessor: (r) => r.label, render: (r) => <span className={cn("truncate", r.kind === "org" && "font-medium")} title={r.organization ? `${r.label} · ${r.organization}` : r.label}>{r.label}</span> },
    { id: "role", header: "Role", width: 96, sortable: true, accessor: (r) => r.role, render: (r) => <span className="truncate text-muted-foreground">{r.role}</span> },
    { id: "docs", header: "Docs", width: 46, align: "right", sortable: true, accessor: (r) => r.docs, render: (r) => <span className="tabular">{r.docs}</span> },
    { id: "testimony", header: "Testimony", width: 68, align: "right", sortable: true, accessor: (r) => r.testimony, render: (r) => <span className="tabular">{r.testimony}</span>, title: "Q/A pairs given or naming this person" },
    { id: "links", header: "Links", width: 46, align: "right", sortable: true, accessor: (r) => r.links, render: (r) => <span className="tabular">{r.links}</span>, defaultHidden: true },
  ], []);

  const exportGraph = async (kind: "png" | "svg") => {
    const svg = svgRef.current;
    if (!svg) return;
    const name = `people-graph-${(centerNode?.label ?? org?.label ?? matterId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    try { if (kind === "svg") downloadSvg(svg, `${name}.svg`); else await downloadPng(svg, `${name}.png`); }
    catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
  };
  const removeRelationship = async (id: string) => {
    try { await api(`/api/ediscovery/analysis/relationships?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setEdgeId(null); graphRes.refresh(); toast.success("Relationship removed"); }
    catch (e) { toast.error("Could not remove", { description: (e as Error).message }); }
  };

  const inspectorVisible = !narrow || inspectorOpen;
  const caption = <><span className="tabular">{hood.nodes.length} people · {hood.edges.length} relationships{hood.truncated ? " · strongest shown" : ""}</span><span className="hidden lg:inline">arrows walk the neighbors · Enter focuses · E selects the edge · Backspace goes back</span></>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="toolbar flex-wrap gap-y-1 !h-auto !min-h-9 py-1">
        <SegmentedControl<View> size="xs" value={view} onChange={setView} options={[{ value: "graph", label: "Graph", icon: Network }, { value: "matrix", label: "Who knew what", icon: Users }]} ariaLabel="People view" />
        {view === "graph" && (
          <>
            <span className="mx-1 hidden h-4 w-px bg-border sm:inline" />
            <div className="flex items-center gap-1">{KIND_GROUPS.map((g) => { const on = g.kinds.every((k) => kinds.has(k)); return <button key={g.id} type="button" onClick={() => toggleGroup(g.kinds)} aria-pressed={on} className={cn("h-6 rounded border px-2 text-[11px] transition-colors cursor-pointer", on ? "border-foreground/25 bg-accent text-foreground" : "text-muted-foreground hover:bg-accent")}>{g.label}</button>; })}</div>
            <Input size="xs" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[126px]" aria-label="Active from" />
            <span className="text-[11px] text-muted-foreground">to</span>
            <Input size="xs" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[126px]" aria-label="Active to" />
            <SegmentedControl<"1" | "2"> size="xs" value={String(depth) as "1" | "2"} onChange={(v) => setDepth(Number(v) as 1 | 2)} options={[{ value: "1", label: "1 hop" }, { value: "2", label: "2 hops" }]} ariaLabel="Neighborhood depth" />
            {hasFilters && <Button size="xs" variant="ghost" onClick={() => { setKinds(new Set(ALL_KINDS)); setFrom(""); setTo(""); }}><X className="size-3.5" /> Clear</Button>}
            <span className="flex-1" />
            {history.length > 0 && <Tip label="Back to the previous person" shortcut="⌫"><Button size="xs" variant="ghost" onClick={back}><ArrowLeft className="size-3.5" /> Back</Button></Tip>}
            <Button size="xs" variant="outline" onClick={() => setAddOpen(true)}><Plus className="size-3.5" /> Add relationship</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="xs" variant="outline"><Download className="size-3.5" /> Export</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!hood.nodes.length} onClick={() => exportGraph("png")}>Graph as PNG</DropdownMenuItem>
                <DropdownMenuItem disabled={!hood.nodes.length} onClick={() => exportGraph("svg")}>Graph as SVG</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!hood.edges.length} onClick={() => downloadText("relationships-in-view.csv", edgesCsv(nodes, hood.edges), "text/csv;charset=utf-8")}>Relationships in view (CSV)</DropdownMenuItem>
                <DropdownMenuItem disabled={!data} onClick={() => data && downloadText("relationships.csv", edgesCsv(data.nodes, data.edges), "text/csv;charset=utf-8")}>All relationships (CSV)</DropdownMenuItem>
                <DropdownMenuItem disabled={!data} onClick={() => data && downloadText("people.csv", nodesCsv(data.nodes, data.orgs), "text/csv;charset=utf-8")}>People and organizations (CSV)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {narrow && <Tip label={inspectorOpen ? "Hide details" : "Show details"}><Button size="icon-xs" variant="ghost" onClick={() => setInspectorOpen((v) => !v)} aria-label="Toggle details" aria-pressed={inspectorOpen}>{inspectorOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}</Button></Tip>}
          </>
        )}
      </div>

      {view === "matrix" ? (
        <KnowledgeMatrix matterId={matterId} maps={maps.data?.maps ?? []} loading={maps.loading} aiConfigured={aiConfigured} topics={overview.data?.topics ?? []} onSelectPerson={(id) => { setView("graph"); focus(id); }} onOpenDocument={onOpenDocument} onChanged={maps.refresh} />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <aside className={cn("flex w-[300px] shrink-0 flex-col border-r bg-sidebar/40", narrow && "w-[240px]")} aria-label="People and organizations">
            <div className="border-b p-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input size="xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person or organization" className="pl-7 pr-6" aria-label="Search people" onKeyDown={(e) => { if (e.key === "Escape") setQ(""); if (e.key === "Enter" && listRows[0]) { e.preventDefault(); focus(listRows[0].id); } }} />
                {q && <button type="button" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent cursor-pointer" aria-label="Clear"><X className="size-3.5" /></button>}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <DataTable<ListRow> rows={listRows} columns={columns} rowId={(r) => r.id} selectionMode="single" activeId={orgId ?? centerId} onActiveChange={(id) => { if (id) focus(id); }} onRowActivate={(r) => focus(r.id)} defaultSort={{ columnId: "docs", dir: "desc" }} density="compact" columnChooser={false} summary={false} loading={graphRes.loading && !data} error={graphRes.error?.message ?? null} empty={<EmptyState icon={Users} title={q ? "No one matches" : "No people yet"} description={q ? "Try another name." : "People appear once documents, depositions or relationships exist for this matter."} compact />} ariaLabel="People" />
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {graphRes.loading && !data ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
                <FocusGraph nodes={hood.nodes} edges={hood.edges} depth={hood.depth} centerId={org ? null : centerId} selectedEdgeId={edgeId} onSelectNode={(id) => { if (id) { setEdgeId(null); if (org) focus(id); else if (id !== centerId) focus(id); if (narrow) setInspectorOpen(true); } }} onSelectEdge={(id) => { setEdgeId(id); if (id && narrow) setInspectorOpen(true); }} onCenter={focus} onEscape={() => { if (narrow) setInspectorOpen(false); }} svgRef={svgRef} caption={caption} />
              )}
            </div>
            <GraphTimeline rows={rows} selectedEdgeId={edgeId} onSelectEdge={setEdgeId} from={from || undefined} to={to || undefined} undated={undated} className="shrink-0" />
          </div>
          {inspectorVisible && (
            <div className={cn("shrink-0", narrow && "absolute inset-y-0 right-0 z-20 max-w-[85%] shadow-xl")}>
              {selectedEdge ? (
                <EdgeInspector edge={selectedEdge} nodes={nodes} onClose={() => (narrow ? setInspectorOpen(false) : setEdgeId(null))} onFocus={focus} onOpenDocument={onOpenDocument} onRemove={removeRelationship} />
              ) : org ? (
                <OrgInspector org={org} nodes={nodes} onClose={() => (narrow ? setInspectorOpen(false) : setOrgId(null))} onFocus={focus} />
              ) : centerNode ? (
                <PersonInspector key={centerNode.id} matterId={matterId} node={centerNode} data={data!} filters={filters} onClose={() => (narrow ? setInspectorOpen(false) : undefined)} onSelectEdge={setEdgeId} onFocus={focus} onOpenDocument={onOpenDocument} onAddRelationship={() => setAddOpen(true)} />
              ) : (
                <Inspector title="Details" width={340} onClose={narrow ? () => setInspectorOpen(false) : undefined}><div className="p-4"><EmptyState icon={Users} title="Nothing selected" description="Pick a person on the left, or click a node or an edge in the graph." compact /></div></Inspector>
              )}
            </div>
          )}
        </div>
      )}
      <AddRelationshipDialog open={addOpen} onOpenChange={setAddOpen} matterId={matterId} nodes={nodes} defaultFrom={org ? null : centerId} onCreated={() => graphRes.refresh()} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function PersonInspector({ matterId, node, data, filters, onClose, onSelectEdge, onFocus, onOpenDocument, onAddRelationship }: { matterId: string; node: GraphNode; data: GraphData; filters: { kinds: Set<RelationshipKind>; from?: string; to?: string }; onClose?: () => void; onSelectEdge: (id: string) => void; onFocus: (id: string) => void; onOpenDocument?: (id: string) => void; onAddRelationship: () => void }) {
  const detail = usePerson(matterId, node.id);
  const openTestimony = useOpenTestimony();
  const [tab, setTab] = React.useState("relationships");
  const [docTab, setDocTab] = React.useState<"authored" | "received">("authored");
  const name = React.useMemo(() => new Map(data.nodes.map((n) => [n.id, n.label])), [data.nodes]);
  const edges = React.useMemo(() => data.edges.filter((e) => (e.source === node.id || e.target === node.id) && filters.kinds.has(e.kind)).sort((a, b) => b.weight - a.weight), [data.edges, node.id, filters.kinds]);
  const d = detail.data;
  const items = [
    { label: "Role", value: ROLE_LABEL[node.role ?? ""] ?? node.role ?? "—" },
    { label: "Title", value: node.title ?? "—", muted: !node.title },
    { label: "Organization", value: node.organization ?? "—", muted: !node.organization },
    ...(d?.person.email ? [{ label: "Email", value: <span className="inline-flex items-center gap-1"><Mail className="size-3 text-muted-foreground" />{d.person.email}</span>, mono: true }] : []),
    { label: "Documents", value: `${node.authored} authored · ${node.received} received${d ? ` · ${d.counts.cc} copied · ${d.counts.mentioned} mentioned` : ""}` },
    { label: "Testimony", value: `${node.testimony ?? 0} Q/A${node.depositions ? ` · ${node.depositions} deposition${node.depositions === 1 ? "" : "s"}` : ""}` },
  ];
  return (
    <Inspector title={node.label} subtitle={[node.title, node.organization].filter(Boolean).join(" · ") || undefined} width={340} onClose={onClose} tabs={[{ id: "relationships", label: "Relationships", count: edges.length }, { id: "documents", label: "Documents", count: d ? d.authored.length + d.received.length : undefined }, { id: "testimony", label: "Testimony", count: d?.depositions.length }, { id: "timeline", label: "Timeline", count: d?.timeline.length }]} activeTab={tab} onTabChange={setTab} actions={<Tip label="Add a relationship from this person"><Button size="icon-xs" variant="ghost" onClick={onAddRelationship} aria-label="Add relationship"><Plus className="size-3.5" /></Button></Tip>}>
      <div className="border-b px-3 py-2"><KeyValueList dense labelWidth={92} items={items} /></div>
      {tab === "relationships" && (
        !edges.length ? <div className="p-4"><EmptyState icon={Link2} title="No relationships in view" description="Turn on more relationship kinds or clear the date range." compact /></div> : (
          <table className="w-full table-fixed text-[12px]">
            <thead className="grid-head sticky top-0 z-10 bg-background"><tr><th className="w-[92px] px-3 py-1 text-left">Kind</th><th className="px-2 py-1 text-left">With</th><th className="w-[36px] px-1 py-1 text-right">×</th><th className="w-[74px] px-2 py-1 text-right">Active</th></tr></thead>
            <tbody>
              {edges.map((e) => { const other = e.source === node.id ? e.target : e.source; const out = e.source === node.id; return (
                <tr key={e.id} className="row-default row-hover cursor-pointer border-t border-border/60" onClick={() => onSelectEdge(e.id)}>
                  <td className="truncate px-3 text-muted-foreground" title={out ? `${node.label} ${kindLabel(e.kind)} ${name.get(other)}` : `${name.get(other)} ${kindLabel(e.kind)} ${node.label}`}>{kindLabel(e.kind)}{out ? "" : " ←"}</td>
                  <td className="truncate px-2"><button type="button" onClick={(ev) => { ev.stopPropagation(); onFocus(other); }} className="font-medium hover:underline cursor-pointer">{name.get(other) ?? other}</button></td>
                  <td className="px-1 text-right tabular text-muted-foreground">{e.weight}</td>
                  <td className="px-2 text-right tabular text-[11px] text-muted-foreground">{e.firstDate ? (e.lastDate && e.lastDate.slice(0, 4) !== e.firstDate.slice(0, 4) ? `${e.firstDate.slice(0, 4)}–${e.lastDate.slice(2, 4)}` : e.firstDate.slice(0, 4)) : "—"}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        )
      )}
      {tab === "documents" && (
        !d ? <div className="p-3 text-[12px] text-muted-foreground">Loading…</div> : (
          <div>
            <div className="flex items-center gap-1 border-b px-3 py-1.5"><SegmentedControl<"authored" | "received"> size="xs" value={docTab} onChange={setDocTab} options={[{ value: "authored", label: `Authored ${d.counts.authored}` }, { value: "received", label: `Received ${d.counts.received}` }]} ariaLabel="Document direction" /></div>
            {(docTab === "authored" ? d.authored : d.received).length === 0 ? <div className="p-3 text-[12px] text-muted-foreground">None.</div> : (
              <table className="w-full table-fixed text-[12px]"><tbody>
                {(docTab === "authored" ? d.authored : d.received).map((x) => <tr key={x.id} className="row-default row-hover cursor-pointer border-t border-border/60" onClick={() => onOpenDocument?.(x.id)}><td className="w-[96px] truncate px-3 font-mono text-[11px] text-muted-foreground">{x.bates}</td><td className="w-[76px] tabular text-[11px] text-muted-foreground">{formatShortDate(x.date)}</td><td className="truncate px-2" title={x.subject}>{x.subject}</td></tr>)}
              </tbody></table>
            )}
          </div>
        )
      )}
      {tab === "testimony" && (
        !d ? <div className="p-3 text-[12px] text-muted-foreground">Loading…</div> : !d.depositions.length ? <div className="p-4"><EmptyState icon={ScrollText} title="No testimony" description="Not deposed and not named in a transcript." compact /></div> : (
          <table className="w-full table-fixed text-[12px]"><tbody>
            {d.depositions.map((x) => <tr key={x.id} className="row-default row-hover cursor-pointer border-t border-border/60" onClick={() => openTestimony(x.id)}><td className="truncate px-3">{x.witnessName === node.label ? "Own deposition" : `${x.witnessName} deposition`}</td><td className="w-[150px] pr-3 text-right tabular text-[11px] text-muted-foreground">{formatShortDate(x.date)} · {x.witnessName === node.label ? `${x.pages} pp` : `${x.mentions} mention${x.mentions === 1 ? "" : "s"}`}</td></tr>)}
          </tbody></table>
        )
      )}
      {tab === "timeline" && (
        !d ? <div className="p-3 text-[12px] text-muted-foreground">Loading…</div> : !d.timeline.length && !d.conflicts.length ? <div className="p-4"><EmptyState icon={Activity} title="No events" description="No chronology events or conflicts involve this person." compact /></div> : (
          <div>
            <table className="w-full table-fixed text-[12px]"><tbody>
              {d.timeline.map((e) => <tr key={e.id} className="row-default border-t border-border/60"><td className="w-[78px] px-3 tabular text-[11px] text-muted-foreground">{formatShortDate(e.date)}</td><td className="truncate px-1" title={e.title}>{e.title}</td><td className="w-[92px] pr-2 text-right"><CategoryChip category={e.category as TimelineCategory} /></td></tr>)}
            </tbody></table>
            {d.conflicts.length > 0 && <div className="border-t px-3 py-2"><div className="grid-head mb-1">Conflicts</div><ul className="space-y-1">{d.conflicts.map((c) => <li key={c.id} className="flex items-start gap-2 text-[12px]"><SeverityBadge severity={c.severity as "high"} /><span className="min-w-0 flex-1 leading-snug">{c.title}</span><ConflictStatusBadge status={c.status as "open"} /></li>)}</ul></div>}
          </div>
        )
      )}
    </Inspector>
  );
}

function OrgInspector({ org, nodes, onClose, onFocus }: { org: GraphOrg; nodes: GraphNode[]; onClose?: () => void; onFocus: (id: string) => void }) {
  const members = org.memberIds.map((id) => nodes.find((n) => n.id === id)).filter((n): n is GraphNode => !!n).sort((a, b) => b.docCount - a.docCount);
  return (
    <Inspector title={org.label} subtitle={`${members.length} people · ${org.docCount} documents · ${org.testimony} Q/A`} width={340} onClose={onClose}>
      <table className="w-full table-fixed text-[12px]">
        <thead className="grid-head sticky top-0 z-10 bg-background"><tr><th className="px-3 py-1 text-left">Person</th><th className="w-[110px] px-2 py-1 text-left">Role</th><th className="w-[44px] px-1 py-1 text-right">Docs</th></tr></thead>
        <tbody>{members.map((m) => <tr key={m.id} className="row-default row-hover cursor-pointer border-t border-border/60" onClick={() => onFocus(m.id)}><td className="truncate px-3 font-medium">{m.label}</td><td className="truncate px-2 text-muted-foreground">{m.title ?? ROLE_LABEL[m.role ?? ""] ?? m.role}</td><td className="px-1 text-right tabular">{m.docCount}</td></tr>)}</tbody>
      </table>
    </Inspector>
  );
}

function EdgeInspector({ edge, nodes, onClose, onFocus, onOpenDocument, onRemove }: { edge: GraphEdge; nodes: GraphNode[]; onClose?: () => void; onFocus: (id: string) => void; onOpenDocument?: (id: string) => void; onRemove: (id: string) => void }) {
  const openTestimony = useOpenTestimony();
  const name = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const evidence = [...edge.evidence].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return (
    <Inspector title={<span className="truncate"><button type="button" className="hover:underline cursor-pointer" onClick={() => onFocus(edge.source)}>{name(edge.source)}</button> <span className="font-normal text-muted-foreground">{kindLabel(edge.kind)}</span> <button type="button" className="hover:underline cursor-pointer" onClick={() => onFocus(edge.target)}>{name(edge.target)}</button></span>} subtitle={edge.label} width={340} onClose={onClose} actions={<Tip label="Remove this relationship"><Button size="icon-xs" variant="ghost" className="hover:text-destructive" onClick={() => onRemove(edge.id)} aria-label="Remove relationship"><Trash2 className="size-3.5" /></Button></Tip>}>
      <div className="border-b px-3 py-2"><KeyValueList dense labelWidth={92} items={[{ label: "Weight", value: <span className="tabular">{edge.weight}</span> }, { label: "Active", value: edge.firstDate ? <span className="tabular">{formatShortDate(edge.firstDate)}{edge.lastDate && edge.lastDate !== edge.firstDate ? ` – ${formatShortDate(edge.lastDate)}` : ""}</span> : "No dated evidence", muted: !edge.firstDate }, { label: "Evidence", value: <span className="tabular">{edge.evidence.length}</span> }]} /></div>
      {!evidence.length ? <div className="p-4"><EmptyState icon={Link2} title="No evidence recorded" description="Seeded org-chart links carry none; add a relationship with a Bates number or a page:line to document it." compact /></div> : (
        <table className="w-full table-fixed text-[12px]">
          <thead className="grid-head sticky top-0 z-10 bg-background"><tr><th className="w-[76px] px-3 py-1 text-left">Date</th><th className="w-[104px] px-1 py-1 text-left">Cite</th><th className="px-2 py-1 text-left">Excerpt</th></tr></thead>
          <tbody>
            {evidence.map((ev, i) => (
              <tr key={i} className="border-t border-border/60 align-top">
                <td className="px-3 py-1 tabular text-[11px] text-muted-foreground">{ev.date ? formatShortDate(ev.date) : "—"}</td>
                <td className="px-1 py-1">{ev.kind === "document" || ev.bates ? <CiteChip cite={ev.bates ?? "document"} kind="document" unresolved={!ev.docId} onClick={ev.docId ? () => onOpenDocument?.(ev.docId!) : undefined} /> : ev.kind === "deposition" ? <CiteChip cite={ev.cite ?? "testimony"} kind="deposition" onClick={ev.depositionId ? () => openTestimony(ev.depositionId!, ev.cite) : undefined} /> : <span className="text-[11px] text-muted-foreground">note</span>}</td>
                <td className="px-2 py-1 text-[11.5px] leading-snug text-muted-foreground">{ev.excerpt ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Inspector>
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
  const PersonPick = ({ value, onChange, placeholder, id }: { value: string; onChange: (v: string) => void; placeholder: string; id: string }) => (
    <Select value={value} onValueChange={onChange}><SelectTrigger id={id} size="sm"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{sorted.map((n) => <SelectItem key={n.id} value={n.id}><span className="flex items-center gap-2">{n.label}<span className="text-xs text-muted-foreground">{n.organization}</span></span></SelectItem>)}</SelectContent></Select>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Add relationship</DialogTitle><DialogDescription>Record an org-chart, engagement or communication link with the evidence that shows it.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="rel-from">From</Label><PersonPick id="rel-from" value={fromId} onChange={setFromId} placeholder="Person" /></div>
          <div className="grid gap-1.5"><Label htmlFor="rel-kind">Relationship</Label><Select value={kind} onValueChange={(v) => setKind(v as Relationship["kind"])}><SelectTrigger id="rel-kind" size="sm"><SelectValue /></SelectTrigger><SelectContent>{ALL_KINDS.map((k) => <SelectItem key={k} value={k}>{RELATIONSHIP_LABELS[k]}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="rel-to">To</Label><PersonPick id="rel-to" value={toId} onChange={setToId} placeholder="Person" /></div>
          <div className="grid gap-1.5"><Label htmlFor="rel-label">Label (optional)</Label><Input id="rel-label" size="sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Study director → sponsor toxicologist" /></div>
          <div className="grid grid-cols-[140px_1fr] gap-2"><div className="grid gap-1.5"><Label htmlFor="rel-bates">Evidence Bates</Label><Input id="rel-bates" size="sm" value={bates} onChange={(e) => setBates(e.target.value)} placeholder="Bates number" className="font-mono" /></div><div className="grid gap-1.5"><Label htmlFor="rel-excerpt">Excerpt or page:line</Label><Textarea id="rel-excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={1} placeholder="Witness 43:2 — quoted words" /></div></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !fromId || !toId || fromId === toId}>{saving && <Loader2 className="size-4 animate-spin" />} Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

