"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Filterbar, type FilterbarFilter } from "@/components/ui/filterbar";
import type { FilterValues } from "@/components/ui/filterbar-helpers";
import { KeyValueList } from "@/components/ui/form";
import { Inspector } from "@/components/ui/inspector";
import { Tip } from "@/components/ui/tooltip";
import { useShortcutHelp, type ShortcutGroup } from "@/components/ui/shortcut-help";
import { isTypingTarget } from "@/components/ui/shortcut-help-helpers";
import { TrustBadge } from "@/components/ai/trust-badge";
import type { IntelEntity, IntelEntityType } from "../types";
import { ENTITY_TYPES, ENTITY_TYPE_LABEL, ENTITY_TYPE_PLURAL, WATCH_KIND_FOR_ENTITY, entityHref, fmtInt } from "../analysis/pure";
import type { AnalysisStatus, EntityListItem, EntityListResult, MotionTendency, RelatedEntity, DocLite } from "../analysis/types";
import { applyExplorerFilters, countByType, explorerFiltersFrom, explorerFiltersFromParams, explorerFiltersToParams } from "./models";
import { ConfidenceText, DateText, DocLink, EmptySources, EntityLink, FlagList, RunAnalysisButton, useJson } from "./shared";

export const EXPLORER_SHORTCUTS: ShortcutGroup[] = [
  { id: "intel-explorer", title: "Intelligence explorer", items: [
    { keys: ["/"], label: "Search entities" },
    { keys: ["j"], label: "Next row" }, { keys: ["k"], label: "Previous row" },
    { keys: ["enter"], label: "Open the profile" },
    { keys: ["w"], label: "Watch or unwatch the active row" },
    { keys: ["esc"], label: "Close the inspector" },
  ] },
];

interface CompactProfile { entity: IntelEntity; counts: { documents: number; matters: number; relations: number }; tendencies: MotionTendency[]; related: RelatedEntity[]; recent: DocLite[] }

export function EntityExplorer({ initial, userId, status, sources, initialParams }: { initial: EntityListResult; userId: string; status: AnalysisStatus; sources: { total: number; enabled: number }; initialParams: string }) {
  const router = useRouter();
  const parsed = React.useMemo(() => explorerFiltersFromParams(new URLSearchParams(initialParams)), [initialParams]);
  const [items, setItems] = React.useState<EntityListItem[]>(initial.items);
  const [values, setValues] = React.useState<FilterValues>(parsed.values);
  const [query, setQuery] = React.useState(parsed.query);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [inspecting, setInspecting] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  useShortcutHelp(EXPLORER_SHORTCUTS, "intel-explorer");

  const filters = React.useMemo(() => explorerFiltersFrom(values, query), [values, query]);
  const rows = React.useMemo(() => applyExplorerFilters(items, filters), [items, filters]);
  const counts = React.useMemo(() => countByType(items), [items]);

  // Keep the URL in sync so filters survive reloads and can be shared.
  React.useEffect(() => {
    const sp = explorerFiltersToParams(filters);
    const next = sp.toString();
    if (next !== initialParams) router.replace(next ? `/intel?${next}` : "/intel", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const toggleWatch = React.useCallback(async (item: EntityListItem) => {
    if (!WATCH_KIND_FOR_ENTITY[item.type]) { toast.message(`${ENTITY_TYPE_PLURAL[item.type]} cannot be watched`); return; }
    try {
      const res = await fetch(`/api/intel/entities/${encodeURIComponent(item.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "watch", userId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setItems((list) => list.map((x) => (x.id === item.id ? { ...x, watched: Boolean(j.watched) } : x)));
      toast.success(j.watched ? `Watching ${item.name}` : `Stopped watching ${item.name}`);
    } catch (e) { toast.error("Could not update the watch", { description: (e as Error).message }); }
  }, [userId]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target as HTMLElement | null) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "w" && activeId) { const item = items.find((x) => x.id === activeId); if (item) { e.preventDefault(); void toggleWatch(item); } }
      else if (e.key === "Escape" && inspecting && !document.querySelector('[role="dialog"]')) setInspecting(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, items, inspecting, toggleWatch]);

  const filterDefs: FilterbarFilter[] = [
    { id: "type", label: "Type", multi: true, options: ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_TYPE_PLURAL[t], count: counts[t] ?? 0 })) },
    { id: "watched", label: "Watched", options: [{ value: "1", label: "Watched by me", count: items.filter((x) => x.watched).length }] },
    { id: "flagged", label: "Flags", options: [{ value: "1", label: "Flagged", count: items.filter((x) => x.flags.length > 0).length }], pinned: false },
  ];

  const columns: DataTableColumn<EntityListItem>[] = [
    { id: "name", header: "Name", width: 260, minWidth: 160, sortable: true, locked: true, accessor: (r) => r.name.toLowerCase(), render: (r) => <span className="flex min-w-0 items-center gap-1.5"><EntityLink id={r.id} type={r.type} name={r.name} className="font-medium" />{r.watched && <Tip label="Watched"><Eye className="size-3 shrink-0 text-primary" aria-label="Watched" /></Tip>}</span> },
    { id: "type", header: "Type", width: 100, sortable: true, accessor: (r) => r.type, render: (r) => <span className="text-muted-foreground">{ENTITY_TYPE_LABEL[r.type]}</span> },
    { id: "detail", header: "Context", width: 300, minWidth: 140, accessor: (r) => r.detail ?? "", render: (r) => <span className="truncate text-muted-foreground" title={r.detail}>{r.detail ?? "—"}</span> },
    { id: "documents", header: "Records", width: 84, align: "right", sortable: true, accessor: (r) => r.documents, render: (r) => <span className="tabular">{fmtInt(r.documents)}</span> },
    { id: "relations", header: "Relations", width: 88, align: "right", sortable: true, accessor: (r) => r.relations, render: (r) => <span className="tabular">{fmtInt(r.relations)}</span> },
    { id: "mentions", header: "Mentions", width: 88, align: "right", sortable: true, defaultHidden: true, accessor: (r) => r.mentionCount, render: (r) => <span className="tabular">{fmtInt(r.mentionCount)}</span> },
    { id: "lastSeen", header: "Last seen", width: 110, sortable: true, accessor: (r) => r.lastSeen ?? "", render: (r) => <DateText value={r.lastSeen} /> },
    { id: "flags", header: "Flags", width: 150, accessor: (r) => r.flags.length, render: (r) => (r.flags.length ? <FlagList flags={r.flags} /> : <span className="text-muted-foreground">—</span>) },
    { id: "aliases", header: "Aliases", width: 240, defaultHidden: true, accessor: (r) => r.aliases.join(", "), render: (r) => <span className="truncate text-muted-foreground" title={r.aliases.join(", ")}>{r.aliases.join(", ") || "—"}</span> },
  ];

  if (!items.length) {
    return (
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl p-6">
          <EmptySources description={<>{sources.enabled} of {sources.total} sources are enabled and {fmtInt(status.documents)} records are stored. {status.documents > 0 ? "Run the analysis to resolve judges, counsel, parties, courts, MDLs, products, agencies and regulations from them." : <>Enable and run sources under <a href="/settings#sources" className="text-primary hover:underline">Settings → Data &amp; automation</a>, then run the analysis.</>}</>} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Filterbar
        filters={filterDefs}
        values={values}
        onChange={setValues}
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="Search entities…"
        inputRef={inputRef}
        status={<span className="tabular">{rows.length === items.length ? `${fmtInt(items.length)} entities` : `${fmtInt(rows.length)} of ${fmtInt(items.length)} entities`}{status.pending > 0 && ` · ${fmtInt(status.pending)} records await analysis`}</span>}
      >
        <RunAnalysisButton label={status.pending > 0 ? `Run analysis (${fmtInt(status.pending)} pending)` : "Run analysis"} variant="ghost" />
      </Filterbar>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(r) => r.id}
            defaultSort={{ columnId: "documents", dir: "desc" }}
            selectionMode="single"
            activeId={activeId}
            onActiveChange={setActiveId}
            onRowClick={(r) => { setActiveId(r.id); setInspecting(r.id); }}
            onRowActivate={(r) => router.push(entityHref(r))}
            rowActions={(r) => (
              <span className="flex items-center gap-0.5">
                <Tip label={r.watched ? "Unwatch" : WATCH_KIND_FOR_ENTITY[r.type] ? "Watch" : "Cannot be watched"} shortcut="W"><Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); void toggleWatch(r); }} aria-label={r.watched ? `Unwatch ${r.name}` : `Watch ${r.name}`} disabled={!WATCH_KIND_FOR_ENTITY[r.type]}>{r.watched ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</Button></Tip>
                <Tip label="Open profile" shortcut="Enter"><Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); router.push(entityHref(r)); }} aria-label={`Open ${r.name}`}><ArrowUpRight className="size-3.5" /></Button></Tip>
              </span>
            )}
            noun="entity"
            summary={false}
            total={items.length}
            ariaLabel="Entities"
            empty={<div className="p-6 text-center text-[12px] text-muted-foreground">No entities match these filters.</div>}
          />
        </div>
        {inspecting && <EntityInspector id={inspecting} onClose={() => setInspecting(null)} onWatch={(item) => void toggleWatch(item)} item={items.find((x) => x.id === inspecting)} />}
      </div>
    </div>
  );
}

function EntityInspector({ id, item, onClose, onWatch }: { id: string; item?: EntityListItem; onClose: () => void; onWatch: (item: EntityListItem) => void }) {
  const router = useRouter();
  const { data, loading, error } = useJson<CompactProfile>(`/api/intel/entities/${encodeURIComponent(id)}?compact=1`);
  const [width, setWidth] = React.useState(360);
  const e = data?.entity;
  const type = (item?.type ?? e?.type ?? "party") as IntelEntityType;
  return (
    <Inspector title={item?.name ?? e?.name ?? "Entity"} subtitle={ENTITY_TYPE_LABEL[type]} onClose={onClose} closeShortcut="Esc" width={width} minWidth={300} maxWidth={560} resizable onWidthChange={setWidth} ariaLabel="Entity details"
      actions={item && <Button variant="ghost" size="xs" onClick={() => onWatch(item)} disabled={!WATCH_KIND_FOR_ENTITY[item.type]}>{item.watched ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{item.watched ? "Unwatch" : "Watch"}</Button>}
      footer={<div className="flex items-center gap-2 px-3 py-2"><Button size="xs" onClick={() => router.push(entityHref({ id, type }))}>Open profile</Button><span className="text-[11px] text-muted-foreground">Enter opens the active row</span></div>}>
      <div className="space-y-4 p-3 text-[12.5px]">
        {loading && !data && <div className="text-[11.5px] text-muted-foreground">Loading…</div>}
        {error && <div className="text-[11.5px] text-destructive">{error}</div>}
        {data && e && (
          <>
            <KeyValueList dense labelWidth={110} items={[
              { label: "Context", value: item?.detail ?? "—", muted: !item?.detail },
              { label: "Records", value: <span className="tabular">{fmtInt(data.counts.documents)}</span> },
              { label: "Matters", value: <span className="tabular">{fmtInt(data.counts.matters)}</span> },
              { label: "Relations", value: <span className="tabular">{fmtInt(data.counts.relations)}</span> },
              { label: "Aliases", value: e.aliases.length ? e.aliases.join(", ") : "—", muted: !e.aliases.length, title: e.aliases.join(", ") },
            ]} />
            {(e.flags?.length ?? 0) > 0 && <FlagList flags={e.flags ?? []} max={5} />}
            {data.tendencies.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Motion outcomes</div>
                <div className="divide-hairline">
                  {data.tendencies.slice(0, 6).map((t) => (
                    <div key={t.motion} className="flex h-6 items-center gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate">{t.label}</span><span className="tabular text-muted-foreground">{t.granted}/{t.denied}/{t.partial}</span><span className="w-10 text-right tabular">{t.grantRate == null ? "—" : `${Math.round(t.grantRate * 100)}%`}</span></div>
                  ))}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground">granted / denied / in part · share granted</div>
              </div>
            )}
            {data.related.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Related</div>
                <div className="divide-hairline">
                  {data.related.slice(0, 8).map((r) => (
                    <div key={`${r.relation}-${r.entity.id}`} className="flex h-6 items-center gap-2 text-[12px]"><span className="w-[92px] shrink-0 truncate text-muted-foreground">{r.direction === "out" ? r.relation.replace(/_/g, " ") : `← ${r.relation.replace(/_/g, " ")}`}</span><EntityLink id={r.entity.id} type={r.entity.type} name={r.entity.name} className="min-w-0 flex-1" /><span className="tabular text-[11px] text-muted-foreground">×{r.weight}</span></div>
                  ))}
                </div>
              </div>
            )}
            {data.recent.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recent records</div>
                <div className="divide-hairline">
                  {data.recent.map((d) => (
                    <div key={d.id} className="flex min-h-7 items-center gap-2 py-0.5 text-[12px]"><DateText value={d.date} className="w-[86px] shrink-0 text-[11px]" /><DocLink doc={d} className="min-w-0 flex-1" /><ConfidenceText value={d.confidence} /></div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><TrustBadge provenance={undefined} compact /><span>Entity resolved deterministically from the records above; counts and relations are computed, not generated.</span></div>
          </>
        )}
      </div>
    </Inspector>
  );
}
