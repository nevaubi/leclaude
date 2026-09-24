"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Inspector } from "@/components/ui/inspector";
import { KeyValueList } from "@/components/ui/form";
import { Chip } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { IntelEntityType, IntelRelationType } from "../types";
import { ENTITY_TYPES, ENTITY_TYPE_LABEL, ENTITY_TYPE_PLURAL, RELATION_LABEL, RELATION_TYPES, entityHref, fmtInt } from "../analysis/pure";
import type { EntityListResult, GraphExport } from "../analysis/types";
import { IntelForceGraph } from "./intel-force-graph";
import { EmptySources, EntityLink, MethodNote, useJson } from "./shared";

export function GraphView({ initial }: { initial: GraphExport }) {
  const router = useRouter();
  const [center, setCenter] = React.useState<string | undefined>(initial.center);
  const [depth, setDepth] = React.useState(initial.depth);
  const [relTypes, setRelTypes] = React.useState<IntelRelationType[]>([]);
  const [entityTypes, setEntityTypes] = React.useState<IntelEntityType[]>([]);
  const [selected, setSelected] = React.useState<string | null>(initial.center ?? null);
  const [q, setQ] = React.useState("");
  const first = React.useRef(true);
  const url = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (center) sp.set("entityId", center);
    sp.set("depth", String(depth));
    if (relTypes.length) sp.set("types", relTypes.join(","));
    if (entityTypes.length) sp.set("entityTypes", entityTypes.join(","));
    sp.set("limit", "80");
    return sp.toString();
  }, [center, depth, relTypes, entityTypes]);
  const { data, loading, error } = useJson<GraphExport>(first.current ? null : `/api/intel/graph?${url}`, [url]);
  React.useEffect(() => { if (first.current) { first.current = false; return; } const sp = new URLSearchParams(); if (center) sp.set("entityId", center); if (depth !== 1) sp.set("depth", String(depth)); router.replace(sp.toString() ? `/intel/graph?${sp}` : "/intel/graph", { scroll: false }); }, [center, depth, router]);
  const graph = data ?? initial;
  const search = useJson<EntityListResult>(q.trim().length >= 2 ? `/api/intel/entities?q=${encodeURIComponent(q.trim())}&limit=8` : null, [q]);
  const node = graph.nodes.find((n) => n.id === selected) ?? null;
  const nodeLinks = node ? graph.links.filter((l) => l.source === node.id || l.target === node.id).sort((a, b) => b.weight - a.weight) : [];
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const typeOf = (id: string) => graph.nodes.find((n) => n.id === id)?.type;

  if (!initial.nodes.length && !data) {
    return <div className="min-h-0 flex-1 overflow-auto scrollbar-thin"><div className="mx-auto max-w-3xl p-6"><EmptySources title="No relations yet" description="Relations are derived from the records: judges presiding over MDLs, counsel appearing before judges, agencies regulating products, manufacturers recalling them. Enable and run sources, then run the analysis." /></div></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="toolbar flex-wrap gap-2 py-1 !h-auto !min-h-9">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input size="xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Center on an entity…" className="pl-7" aria-label="Center on an entity" />
          {q.trim().length >= 2 && (
            <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border bg-popover p-1 text-[12px] shadow-md">
              {(search.data?.items ?? []).map((e) => <button key={e.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent" onClick={() => { setCenter(e.id); setSelected(e.id); setQ(""); }}><span className="min-w-0 flex-1 truncate">{e.name}</span><span className="text-[11px] text-muted-foreground">{ENTITY_TYPE_LABEL[e.type]}</span></button>)}
              {search.data && !search.data.items.length && <div className="px-2 py-1 text-muted-foreground">No entities match.</div>}
            </div>
          )}
        </div>
        {center && <Chip active onClick={() => { setCenter(undefined); setSelected(null); }} icon={X} title="Show the most connected entities instead">{nameOf(center)}</Chip>}
        <Select value={String(depth)} onValueChange={(v) => setDepth(Number(v))}>
          <SelectTrigger size="xs" className="w-[92px]" aria-label="Depth"><SelectValue /></SelectTrigger>
          <SelectContent>{[1, 2, 3].map((d) => <SelectItem key={d} value={String(d)}>{d} hop{d === 1 ? "" : "s"}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-1">
          {ENTITY_TYPES.filter((t) => initial.nodes.some((n) => n.type === t) || entityTypes.includes(t)).map((t) => <Chip key={t} active={entityTypes.includes(t)} onClick={() => setEntityTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}>{ENTITY_TYPE_PLURAL[t]}</Chip>)}
        </div>
        <div className="flex-1" />
        <span className="text-[11px] tabular text-muted-foreground">{loading ? "Loading…" : error ? `Error: ${error}` : `${fmtInt(graph.nodes.length)} entities · ${fmtInt(graph.links.length)} relations`}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
        <span className="mr-1 text-[11px] text-muted-foreground">Relations</span>
        {RELATION_TYPES.filter((t) => initial.links.some((l) => l.type === t) || graph.links.some((l) => l.type === t) || relTypes.includes(t)).map((t) => <Chip key={t} active={relTypes.includes(t)} onClick={() => setRelTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}>{RELATION_LABEL[t]}</Chip>)}
        {relTypes.length > 0 && <Button variant="ghost" size="xs" className="h-6 px-1.5 text-[11px]" onClick={() => setRelTypes([])}>Clear</Button>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 p-2"><IntelForceGraph data={graph} selectedId={selected} onSelect={setSelected} /></div>
        {node && (
          <Inspector title={node.label} subtitle={ENTITY_TYPE_LABEL[node.type]} onClose={() => setSelected(null)} closeShortcut="Esc" width={340} minWidth={280} maxWidth={520} resizable ariaLabel="Entity relations"
            footer={<div className="flex items-center gap-2 px-3 py-2"><Button size="xs" asChild><Link href={entityHref(node)}>Open profile</Link></Button><Button size="xs" variant="ghost" onClick={() => { setCenter(node.id); }}>Center here</Button></div>}>
            <div className="space-y-3 p-3 text-[12px]">
              <KeyValueList dense labelWidth={96} items={[{ label: "Records", value: <span className="tabular">{fmtInt(node.documents)}</span> }, { label: "Degree", value: <span className="tabular">{fmtInt(node.degree)}</span> }, { label: "Mentions", value: <span className="tabular">{fmtInt(node.mentionCount)}</span> }]} />
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Relations ({nodeLinks.length})</div>
                <div className="divide-hairline">
                  {nodeLinks.map((l) => { const other = l.source === node.id ? l.target : l.source; const t = typeOf(other); return (
                    <div key={l.id} className="py-1">
                      <div className="flex items-center gap-2"><span className="w-[100px] shrink-0 truncate text-[11px] text-muted-foreground">{l.source === node.id ? RELATION_LABEL[l.type] : `← ${RELATION_LABEL[l.type]}`}</span>{t ? <EntityLink id={other} type={t} name={nameOf(other)} className="min-w-0 flex-1" /> : <span className="min-w-0 flex-1 truncate">{nameOf(other)}</span>}<span className="tabular text-[11px] text-muted-foreground">×{l.weight} · {Math.round(l.confidence * 100)}%</span></div>
                      {l.evidence[0] && <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={l.evidence[0].quote}><Link href={`/intel/documents/${encodeURIComponent(l.evidence[0].docId)}`} className="hover:text-primary hover:underline">{l.evidence[0].quote ?? l.evidence[0].docId}</Link></div>}
                    </div>
                  ); })}
                </div>
              </div>
              <MethodNote>Edges are computed from records that mention both entities; weight is the number of independent records and confidence follows the records&apos; own confidence.</MethodNote>
            </div>
          </Inspector>
        )}
      </div>
    </div>
  );
}
