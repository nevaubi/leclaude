"use client";
import * as React from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tip } from "@/components/ui/tooltip";
import { NONE_VALUE } from "@/components/ui/form-helpers";
import type { IntelEntityType, IntelWatch, IntelWatchKind } from "../types";
import { ENTITY_TYPE_LABEL, WATCH_KIND_FOR_ENTITY, fmtInt } from "../analysis/pure";
import type { EntityListResult } from "../analysis/types";
import { DateText, EntityLink, MethodNote, useJson } from "./shared";

export interface WatchRow extends IntelWatch { entity: { id: string; type: IntelEntityType; name: string; documents: number } | null; alerts: number }

const WATCH_KIND_LABEL: Record<IntelWatchKind, string> = { judge: "Judge", docket: "Docket", mdl: "MDL", product: "Product", regulation: "Regulation", attorney: "Attorney", firm: "Firm", query: "Query", court: "Court" };

export function WatchesView({ initial, userId, matters }: { initial: WatchRow[]; userId: string; matters: { id: string; shortName: string }[] }) {
  const [rows, setRows] = React.useState<WatchRow[]>(initial);
  const [q, setQ] = React.useState("");
  const [queryText, setQueryText] = React.useState("");
  const [matterId, setMatterId] = React.useState<string>(NONE_VALUE);
  const [busy, setBusy] = React.useState(false);
  const search = useJson<EntityListResult>(q.trim().length >= 2 ? `/api/intel/entities?q=${encodeURIComponent(q.trim())}&limit=8` : null, [q]);
  const matterName = (id?: string) => matters.find((m) => m.id === id)?.shortName;

  const create = async (input: { kind: IntelWatchKind; target: string; label?: string }) => {
    setBusy(true);
    try {
      const res = await fetch("/api/intel/watches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, userId, matterId: matterId === NONE_VALUE ? undefined : matterId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      const w = j.watch as IntelWatch;
      if (rows.some((r) => r.id === w.id)) { toast.message("Already watching"); return; }
      const hit = search.data?.items.find((e) => e.id === w.target);
      setRows((list) => [{ ...w, entity: hit ? { id: hit.id, type: hit.type, name: hit.name, documents: hit.documents } : null, alerts: 0 }, ...list]);
      toast.success(`Watching ${w.label}`);
      setQ(""); setQueryText("");
    } catch (e) { toast.error("Could not create the watch", { description: (e as Error).message }); } finally { setBusy(false); }
  };
  const remove = async (w: WatchRow) => {
    try {
      const res = await fetch(`/api/intel/watches/${encodeURIComponent(w.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      setRows((list) => list.filter((x) => x.id !== w.id));
      toast.success(`Stopped watching ${w.label}`);
    } catch (e) { toast.error("Could not remove the watch", { description: (e as Error).message }); }
  };

  const columns: DataTableColumn<WatchRow>[] = [
    { id: "label", header: "Watch", width: 300, minWidth: 180, locked: true, sortable: true, accessor: (w) => w.label.toLowerCase(), render: (w) => (w.entity ? <EntityLink id={w.entity.id} type={w.entity.type} name={w.label} className="font-medium" /> : <span className="truncate font-medium">{w.kind === "query" ? `“${w.target}”` : w.label}</span>) },
    { id: "kind", header: "Kind", width: 96, sortable: true, accessor: (w) => w.kind, render: (w) => <span className="text-muted-foreground">{WATCH_KIND_LABEL[w.kind]}</span> },
    { id: "matter", header: "Matter", width: 140, sortable: true, accessor: (w) => matterName(w.matterId) ?? "", render: (w) => <span className="truncate text-muted-foreground">{matterName(w.matterId) ?? "—"}</span> },
    { id: "records", header: "Records", width: 84, align: "right", sortable: true, accessor: (w) => w.entity?.documents ?? 0, render: (w) => <span className="tabular">{w.entity ? fmtInt(w.entity.documents) : "—"}</span> },
    { id: "alerts", header: "Alerts", width: 76, align: "right", sortable: true, accessor: (w) => w.alerts, render: (w) => <span className="tabular">{fmtInt(w.alerts)}</span> },
    { id: "channels", header: "Channels", width: 140, accessor: (w) => w.channels.join(","), render: (w) => <span className="text-muted-foreground">{w.channels.join(", ")}</span> },
    { id: "lastNotifiedAt", header: "Last alert", width: 110, sortable: true, accessor: (w) => w.lastNotifiedAt ?? "", render: (w) => <DateText value={w.lastNotifiedAt} /> },
    { id: "createdAt", header: "Since", width: 110, sortable: true, accessor: (w) => w.createdAt, render: (w) => <DateText value={w.createdAt} /> },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-3 py-2">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_200px]">
          <Field label="Watch an entity" help="Judges, dockets, MDLs, products, regulations, counsel, firms and courts.">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input size="xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search entities…" className="pl-7" aria-label="Search entities to watch" />
              {q.trim().length >= 2 && (
                <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-md border bg-popover p-1 text-[12px] shadow-md">
                  {(search.data?.items ?? []).map((e) => { const kind = WATCH_KIND_FOR_ENTITY[e.type]; return <button key={e.id} type="button" disabled={!kind || busy} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent disabled:opacity-50" onClick={() => kind && void create({ kind, target: e.id, label: e.name })}><span className="min-w-0 flex-1 truncate">{e.name}</span><span className="text-[11px] text-muted-foreground">{ENTITY_TYPE_LABEL[e.type]}{kind ? "" : " · not watchable"}</span><Plus className="size-3 text-muted-foreground" /></button>; })}
                  {search.data && !search.data.items.length && <div className="px-2 py-1 text-muted-foreground">No entities match.</div>}
                </div>
              )}
            </div>
          </Field>
          <Field label="Watch a query" help="Any phrase; new records matching it raise an alert.">
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (queryText.trim()) void create({ kind: "query", target: queryText.trim(), label: queryText.trim() }); }}>
              <Input size="xs" value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder='e.g. "medroxyprogesterone meningioma"' aria-label="Query to watch" />
              <Button size="xs" type="submit" variant="outline" disabled={!queryText.trim() || busy}><Plus className="size-3.5" /> Add</Button>
            </form>
          </Field>
          <Field label="Matter" help="Optional; scopes alerts to the matter.">
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger size="xs" aria-label="Matter"><SelectValue placeholder="No matter" /></SelectTrigger>
              <SelectContent><SelectItem value={NONE_VALUE}>No matter</SelectItem>{matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DataTable rows={rows} columns={columns} rowId={(w) => w.id} defaultSort={{ columnId: "createdAt", dir: "desc" }} selectionMode="single" noun="watch" ariaLabel="Watches" rowActions={(w) => <Tip label="Stop watching"><Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); void remove(w); }} aria-label={`Stop watching ${w.label}`}><Trash2 className="size-3.5" /></Button></Tip>} empty={<div className="p-6 text-center text-[12px] text-muted-foreground">No watches yet. Watch a judge, MDL, product or query above, or use the watch toggle in the explorer.<div className="mt-1"><MethodNote>Alerts for watched entities appear on Home under “For you” and in Insights; the analysis pass checks them on every run.</MethodNote></div></div>} />
      </div>
    </div>
  );
}
