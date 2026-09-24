"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Filterbar, type FilterbarFilter } from "@/components/ui/filterbar";
import type { FilterValues } from "@/components/ui/filterbar-helpers";
import { Inspector } from "@/components/ui/inspector";
import { KeyValueList } from "@/components/ui/form";
import { Tip } from "@/components/ui/tooltip";
import { TrustBadge } from "@/components/ai/trust-badge";
import type { IntelInsight, IntelSeries, IntelTimelineEntry } from "../types";
import { INSIGHT_KIND_LABEL, INSIGHT_STATUS_LABEL, fmtDate, fmtInt } from "../analysis/pure";
import type { AnalysisStatus, DocLite } from "../analysis/types";
import { SeriesChart } from "./activity-chart";
import { applyInsightFilters, insightDataKind, insightFiltersFrom, scopeLabel } from "./models";
import { ConfidenceText, DateText, DocLink, EmptySources, FlagList, MethodNote, RunAnalysisButton, useJson } from "./shared";

interface InsightDetail { insight: IntelInsight; evidence: (IntelInsight["evidence"][number] & { doc: DocLite | null; chunkText?: string })[] }

const KINDS = Object.keys(INSIGHT_KIND_LABEL) as IntelInsight["kind"][];
const STATUSES = Object.keys(INSIGHT_STATUS_LABEL) as IntelInsight["status"][];

export function InsightsView({ initial, matters, userId, hasKey, status, openId }: { initial: IntelInsight[]; matters: { id: string; shortName: string }[]; userId: string; hasKey: boolean; status: AnalysisStatus; openId?: string }) {
  const router = useRouter();
  const [items, setItems] = React.useState<IntelInsight[]>(initial);
  const [values, setValues] = React.useState<FilterValues>({ status: openId ? null : ["published", "verified", "draft", "flagged"] });
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(openId ?? null);
  const matterName = React.useCallback((id: string) => matters.find((m) => m.id === id)?.shortName, [matters]);
  const filters = React.useMemo(() => insightFiltersFrom(values, query), [values, query]);
  const rows = React.useMemo(() => applyInsightFilters(items, filters), [items, filters]);
  React.useEffect(() => { if (openId && !items.some((i) => i.id === openId)) toast.message("Insight not found", { description: "It may have been dismissed or regenerated." }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterDefs: FilterbarFilter[] = [
    { id: "kind", label: "Kind", multi: true, options: KINDS.map((k) => ({ value: k, label: INSIGHT_KIND_LABEL[k], count: items.filter((i) => i.kind === k).length })) },
    { id: "status", label: "Status", multi: true, options: STATUSES.map((s) => ({ value: s, label: INSIGHT_STATUS_LABEL[s], count: items.filter((i) => i.status === s).length })) },
    { id: "matter", label: "Matter", options: matters.map((m) => ({ value: m.id, label: m.shortName, count: items.filter((i) => i.scope.matterId === m.id).length })), pinned: false },
  ];
  const update = (next: IntelInsight) => setItems((list) => list.map((i) => (i.id === next.id ? { ...i, ...next } : i)));
  const columns: DataTableColumn<IntelInsight>[] = [
    { id: "kind", header: "Kind", width: 92, sortable: true, accessor: (i) => i.kind, render: (i) => <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{INSIGHT_KIND_LABEL[i.kind]}</span> },
    { id: "title", header: "Insight", width: 420, minWidth: 220, locked: true, sortable: true, accessor: (i) => i.title.toLowerCase(), render: (i) => <span className="min-w-0"><span className="block truncate font-medium">{i.title}</span></span> },
    { id: "scope", header: "Scope", width: 120, sortable: true, accessor: (i) => scopeLabel(i, matterName), render: (i) => <span className="truncate text-muted-foreground">{scopeLabel(i, matterName)}</span> },
    { id: "confidence", header: "Conf.", width: 64, align: "right", sortable: true, accessor: (i) => i.confidence, render: (i) => <ConfidenceText value={i.confidence} /> },
    { id: "status", header: "Status", width: 92, sortable: true, accessor: (i) => i.status, render: (i) => <span className={i.status === "flagged" ? "text-warning-foreground dark:text-warning" : i.status === "dismissed" ? "text-muted-foreground" : ""}>{INSIGHT_STATUS_LABEL[i.status]}</span> },
    { id: "trust", header: "Trust", width: 120, accessor: (i) => i.provenance.verification?.status ?? "", render: (i) => <TrustBadge provenance={i.provenance} /> },
    { id: "flags", header: "Flags", width: 160, accessor: (i) => i.flags.length, render: (i) => (i.flags.length ? <FlagList flags={i.flags} /> : <span className="text-muted-foreground">—</span>) },
    { id: "evidence", header: "Evidence", width: 76, align: "right", sortable: true, accessor: (i) => i.evidence.length, render: (i) => <span className="tabular">{i.evidence.length}</span> },
    { id: "updated", header: "Updated", width: 104, sortable: true, accessor: (i) => i.updatedAt, render: (i) => <DateText value={i.updatedAt} /> },
    { id: "score", header: "Rank", width: 64, align: "right", sortable: true, defaultHidden: true, accessor: (i) => (i as IntelInsight & { score?: number }).score ?? 0, render: (i) => <span className="tabular text-muted-foreground">{(((i as IntelInsight & { score?: number }).score ?? 0) * 100).toFixed(0)}</span> },
  ];

  if (!items.length) {
    return <div className="min-h-0 flex-1 overflow-auto scrollbar-thin"><div className="mx-auto max-w-3xl p-6"><EmptySources title="No insights yet" description={<>Insights are composed by the analysis pass from the ingested records: activity trends, motion-outcome patterns, topic clusters, chronologies, judge profiles, anomalies, watch alerts and a weekly digest. {status.documents ? "Run the analysis to compose them from the records on file." : <>Enable and run sources under <Link href="/settings#sources" className="text-primary hover:underline">Settings → Data &amp; automation</Link> first.</>}</>} /></div></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Filterbar filters={filterDefs} values={values} onChange={setValues} query={query} onQueryChange={setQuery} queryPlaceholder="Search insights…" status={<span className="tabular">{rows.length === items.length ? `${fmtInt(items.length)} insights` : `${fmtInt(rows.length)} of ${fmtInt(items.length)} insights`} · ranked for you{status.pending > 0 ? ` · ${fmtInt(status.pending)} records await analysis` : ""}</span>}>
        <RunAnalysisButton variant="ghost" label={status.pending > 0 ? `Run analysis (${fmtInt(status.pending)} pending)` : "Run analysis"} />
      </Filterbar>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <DataTable rows={rows} columns={columns} rowId={(i) => i.id} selectionMode="single" activeId={open} onActiveChange={setOpen} onRowClick={(i) => { setOpen(i.id); router.replace(`/intel/insights?insight=${encodeURIComponent(i.id)}`, { scroll: false }); }} onRowActivate={(i) => setOpen(i.id)} noun="insight" total={items.length} ariaLabel="Insights" rowClassName={(i) => (i.status === "dismissed" ? "opacity-60" : undefined)} empty={<div className="p-6 text-center text-[12px] text-muted-foreground">No insights match these filters.</div>} />
        </div>
        {open && <InsightInspector id={open} hasKey={hasKey} userId={userId} matterName={matterName} onClose={() => { setOpen(null); router.replace("/intel/insights", { scroll: false }); }} onChange={update} />}
      </div>
    </div>
  );
}

function InsightInspector({ id, hasKey, matterName, onClose, onChange }: { id: string; hasKey: boolean; userId: string; matterName: (id: string) => string | undefined; onClose: () => void; onChange: (i: IntelInsight) => void }) {
  const { data, loading, error, reload } = useJson<InsightDetail>(`/api/intel/insights/${encodeURIComponent(id)}`);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [width, setWidth] = React.useState(440);
  const [tab, setTab] = React.useState<"summary" | "evidence">("summary");
  const i = data?.insight;
  const act = async (action: "publish" | "dismiss" | "verify") => {
    setBusy(action);
    try {
      const res = await fetch(`/api/intel/insights/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 503) { toast.error("Verification needs an OpenAI key", { description: "Add OPENAI_API_KEY to .env.local to verify insights against their evidence." }); return; }
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      const next = (j.insight ?? j) as IntelInsight | undefined;
      if (next && next.id) onChange(next);
      toast.success(action === "publish" ? "Published" : action === "dismiss" ? "Dismissed" : j.reason === "no_api_key" ? "Verification skipped (no key)" : `Verified: ${j.verified ?? 0} ok, ${j.flagged ?? 0} flagged, ${j.skipped ?? 0} skipped`);
      reload();
    } catch (e) { toast.error("Action failed", { description: (e as Error).message }); } finally { setBusy(null); }
  };
  const kind = i ? insightDataKind(i) : "none";
  return (
    <Inspector title={i?.title ?? "Insight"} subtitle={i ? `${INSIGHT_KIND_LABEL[i.kind]} · ${scopeLabel(i, matterName)}` : undefined} onClose={onClose} closeShortcut="Esc" width={width} minWidth={340} maxWidth={720} resizable onWidthChange={setWidth} ariaLabel="Insight details"
      tabs={[{ id: "summary", label: "Summary" }, { id: "evidence", label: "Evidence", count: i?.evidence.length }]} activeTab={tab} onTabChange={(t) => setTab(t as "summary" | "evidence")}
      actions={i && <TrustBadge provenance={i.provenance} />}
      footer={i && (
        <div className="flex flex-wrap items-center gap-1 px-3 py-2">
          {i.status !== "published" && i.status !== "dismissed" && <Tip label="Publish to Home and matter views"><Button size="xs" onClick={() => void act("publish")} disabled={busy != null}>{busy === "publish" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Publish</Button></Tip>}
          {i.status !== "dismissed" && <Button size="xs" variant="ghost" onClick={() => void act("dismiss")} disabled={busy != null}><X className="size-3.5" /> Dismiss</Button>}
          <Tip label={hasKey ? "Re-check every claim against the cited passages" : "Needs OPENAI_API_KEY"}><Button size="xs" variant="ghost" onClick={() => void act("verify")} disabled={busy != null}>{busy === "verify" ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Verify</Button></Tip>
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground">{INSIGHT_STATUS_LABEL[i.status]}</span>
        </div>
      )}>
      <div className="space-y-3 p-3 text-[12.5px]">
        {loading && !data && <div className="text-[11.5px] text-muted-foreground">Loading…</div>}
        {error && <div className="text-[11.5px] text-destructive">{error}</div>}
        {i && tab === "summary" && (
          <>
            <p className="font-serif text-[13.5px] leading-relaxed">{i.summary}</p>
            {i.flags.length > 0 && <FlagList flags={i.flags} max={5} />}
            <KeyValueList dense labelWidth={104} items={[
              { label: "Confidence", value: <ConfidenceText value={i.confidence} className="text-foreground" /> },
              { label: "Verification", value: i.provenance.verification ? `${i.provenance.verification.status} (${i.provenance.verification.method}) · ${fmtDate(i.provenance.verification.checkedAt)}` : "not yet", muted: !i.provenance.verification },
              { label: "Evidence", value: `${i.evidence.length} record${i.evidence.length === 1 ? "" : "s"}` },
              { label: "Period", value: i.scope.period ? `${fmtDate(i.scope.period.from)} – ${fmtDate(i.scope.period.to)}` : "—", muted: !i.scope.period },
              { label: "Updated", value: fmtDate(i.updatedAt) },
            ]} />
            {kind === "series" && <SeriesChart months={(i.data.months as string[] | undefined) ?? ((i.data.series as IntelSeries[])[0]?.points.map((p) => p.t) ?? [])} series={i.data.series as IntelSeries[]} anomalies={i.data.anomaly ? [{ series: (i.data.series as IntelSeries[])[0]?.label ?? "", anomaly: i.data.anomaly as { t: string; v: number; mean: number; sd: number; z: number; direction: "up" | "down" } }] : []} height={180} />}
            {kind === "timeline" && (
              <div className="divide-hairline rounded-md border">
                {(i.data.timeline as IntelTimelineEntry[]).slice(-12).reverse().map((e, n) => <div key={n} className="flex min-h-7 items-center gap-2 px-2 py-0.5 text-[12px]"><DateText value={e.at} className="w-[86px] shrink-0 text-[11px]" /><span className="min-w-0 flex-1 truncate" title={e.title}>{e.evidence[0] && !e.evidence[0].docId.startsWith("tl_") ? <Link href={e.evidence[0].href ?? "#"} className="hover:text-primary hover:underline">{e.title}</Link> : e.title}</span><ConfidenceText value={e.confidence} /></div>)}
              </div>
            )}
            {kind === "table" && (
              <div className="divide-hairline rounded-md border">
                {(i.data.table as Record<string, unknown>[]).slice(0, 12).map((row, n) => <div key={n} className="flex min-h-7 items-center gap-2 px-2 py-0.5 text-[12px]">{typeof row.date === "string" && <DateText value={row.date} className="w-[86px] shrink-0 text-[11px]" />}<span className="min-w-0 flex-1 truncate">{typeof row.href === "string" ? <Link href={row.href} className="hover:text-primary hover:underline">{String(row.title ?? row.name ?? row.shortName ?? "")}</Link> : String(row.title ?? row.name ?? row.shortName ?? "")}</span>{typeof row.total === "number" && <span className="tabular text-muted-foreground">{String(row.granted ?? 0)}/{row.total} granted</span>}{typeof row.records === "number" && <span className="tabular text-muted-foreground">{row.records} records</span>}</div>)}
              </div>
            )}
            {kind === "clusters" && (
              <div className="divide-hairline rounded-md border">
                {(i.data.clusters as { id: string; label: string; size: number; share: number }[]).slice(0, 8).map((c) => <div key={c.id} className="flex h-7 items-center gap-2 px-2 text-[12px]"><span className="min-w-0 flex-1 truncate">{c.label}</span><span className="tabular text-muted-foreground">{c.size} · {Math.round(c.share * 100)}%</span></div>)}
              </div>
            )}
            {kind === "profile" && (i.data.profile as { tendencies?: { label: string; total: number; granted: number; denied: number; partial: number }[] }).tendencies?.length ? (
              <div className="divide-hairline rounded-md border">
                {(i.data.profile as { tendencies: { label: string; total: number; granted: number; denied: number; partial: number }[] }).tendencies.slice(0, 8).map((t) => <div key={t.label} className="flex h-7 items-center gap-2 px-2 text-[12px]"><span className="min-w-0 flex-1 truncate">{t.label}</span><span className="tabular text-muted-foreground">{t.granted} granted · {t.denied} denied · {t.partial} in part</span></div>)}
                {typeof i.data.entityId === "string" && <div className="px-2 py-1 text-[11px]"><Link href={`/intel/judge/${encodeURIComponent(i.data.entityId)}`} className="text-primary hover:underline">Open profile</Link></div>}
              </div>
            ) : null}
            <MethodNote>Composed by the analysis pass from the cited records; the numbers are computed, not generated. Model verification re-checks the wording against the passages when a key exists.</MethodNote>
          </>
        )}
        {i && tab === "evidence" && data && (
          <div className="divide-hairline">
            {data.evidence.map((ev, n) => (
              <div key={`${ev.docId}-${n}`} className="py-1.5">
                <div className="flex items-center gap-2">{ev.doc ? <DocLink doc={ev.doc} className="min-w-0 flex-1 font-medium" showKind /> : <span className="min-w-0 flex-1 truncate text-muted-foreground">{ev.docId}</span>}{ev.doc && <DateText value={ev.doc.date} className="text-[11px]" />}</div>
                {ev.quote && <p className="mt-0.5 font-serif text-[12.5px] leading-snug text-muted-foreground">{ev.quote}</p>}
                {ev.doc?.flags.length ? <FlagList flags={ev.doc.flags} className="mt-0.5" /> : null}
              </div>
            ))}
            {!data.evidence.length && <MethodNote>No evidence attached.</MethodNote>}
          </div>
        )}
      </div>
    </Inspector>
  );
}
