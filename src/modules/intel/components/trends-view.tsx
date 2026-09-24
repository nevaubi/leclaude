"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Filterbar, type FilterbarFilter } from "@/components/ui/filterbar";
import type { FilterValues } from "@/components/ui/filterbar-helpers";
import { SegmentedControl } from "@/components/ui/form";
import { Chip } from "@/components/ui/misc";
import type { IntelDocumentKind, IntelEntityType } from "../types";
import { DOC_KIND_LABEL, fmtInt, monthLabel } from "../analysis/pure";
import { TREND_GROUP_LABEL, type TrendGroupBy, type TrendQuery, type TrendResult } from "../analysis/types";
import { SeriesChart } from "./activity-chart";
import { MAX_SERIES, TREND_PERIODS, periodFrom, trendApiParams, trendDelta, trendQueryFromParams, trendQueryToParams, type TrendPeriod } from "./models";
import { EmptySources, MethodNote } from "./shared";

export interface TrendOptions { courts: { value: string; label: string }[]; jurisdictions: string[]; judges: { value: string; label: string }[]; kinds: IntelDocumentKind[]; matters: { value: string; label: string }[]; states: string[] }

const ENTITY_GROUPS: Partial<Record<TrendGroupBy, IntelEntityType>> = { judge: "judge", mdl: "mdl", attorney: "attorney", firm: "firm", product: "product" };

export function TrendsView({ initial, options, initialParams, now }: { initial: TrendResult; options: TrendOptions; initialParams: string; now: string }) {
  const router = useRouter();
  const nowDate = React.useMemo(() => new Date(now), [now]);
  const parsed = React.useMemo(() => trendQueryFromParams(new URLSearchParams(initialParams), nowDate), [initialParams, nowDate]);
  const [values, setValues] = React.useState<FilterValues>(() => ({ groupBy: parsed.groupBy, kinds: parsed.kinds?.length ? parsed.kinds : null, jurisdiction: parsed.jurisdiction ?? null, court: parsed.court ?? null, judge: parsed.judgeId ?? null, matter: parsed.matterId ?? null, period: parsed.period }));
  const [mode, setMode] = React.useState<"top" | "compare">(parsed.compareMode ? "compare" : "top");
  const [compare, setCompare] = React.useState<string[]>(parsed.compare ?? []);
  const [result, setResult] = React.useState<TrendResult>(initial);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const first = React.useRef(true);

  const query = React.useMemo<TrendQuery & { period: TrendPeriod; compareMode: boolean }>(() => {
    const str = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : undefined);
    const period = (str("period") ?? "3y") as TrendPeriod;
    const kindsRaw = values.kinds;
    return { groupBy: (str("groupBy") ?? "court") as TrendGroupBy, kinds: (Array.isArray(kindsRaw) ? kindsRaw : kindsRaw ? [kindsRaw] : []) as IntelDocumentKind[], jurisdiction: str("jurisdiction"), court: str("court"), judgeId: str("judge"), matterId: str("matter"), from: periodFrom(period, nowDate), period, compareMode: mode === "compare", compare: mode === "compare" && compare.length ? compare : undefined };
  }, [values, mode, compare, nowDate]);

  React.useEffect(() => {
    const sp = trendQueryToParams(query).toString();
    if (sp !== initialParams) router.replace(`/intel/trends?${sp}`, { scroll: false });
    if (first.current) { first.current = false; return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/intel/trends?${trendApiParams({ ...query, top: mode === "top" ? MAX_SERIES : undefined })}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j as TrendResult; })
      .then((j) => { setResult(j); setError(null); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setError((e as Error).message); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filters: FilterbarFilter[] = [
    { id: "groupBy", label: "Group by", options: (Object.keys(TREND_GROUP_LABEL) as TrendGroupBy[]).map((g) => ({ value: g, label: TREND_GROUP_LABEL[g] })) },
    { id: "period", label: "Period", options: TREND_PERIODS.map((p) => ({ value: p.value, label: p.label })) },
    { id: "kinds", label: "Kinds", multi: true, options: options.kinds.map((k) => ({ value: k, label: DOC_KIND_LABEL[k] })) },
    { id: "jurisdiction", label: "Jurisdiction", options: [...options.jurisdictions.map((j) => ({ value: j, label: j })), ...options.states.filter((s) => !options.jurisdictions.includes(s)).map((s) => ({ value: s, label: s }))], pinned: false },
    { id: "court", label: "Court", options: options.courts, pinned: false },
    { id: "judge", label: "Judge", options: options.judges, pinned: false },
    { id: "matter", label: "Matter", options: options.matters, pinned: false },
  ];
  const onChange = (next: FilterValues) => { if (!next.groupBy) next.groupBy = "court"; if (!next.period) next.period = "3y"; setValues(next); };
  const entityType = ENTITY_GROUPS[result.query.groupBy];
  const shown = result.series;
  const totalAll = result.totals.reduce((n, t) => n + t.count, 0);

  if (!initial.sample && !result.sample && !loading && !Object.values(values).some((v) => (Array.isArray(v) ? v.length : v && v !== "court" && v !== "3y"))) {
    return <div className="min-h-0 flex-1 overflow-auto scrollbar-thin"><div className="mx-auto max-w-3xl p-6"><EmptySources title="No dated records to trend yet" /></div></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Filterbar filters={filters} values={values} onChange={onChange} status={<span className="tabular">{loading ? "Loading…" : error ? `Error: ${error}` : `${fmtInt(result.sample)} records · ${result.totals.length} ${TREND_GROUP_LABEL[result.query.groupBy].toLowerCase()} values · ${result.anomalies.length} anomal${result.anomalies.length === 1 ? "y" : "ies"}`}</span>}>
        <SegmentedControl size="xs" ariaLabel="Series mode" value={mode} onChange={(m) => setMode(m)} options={[{ value: "top", label: `Top ${MAX_SERIES}` }, { value: "compare", label: "Compare" }]} />
      </Filterbar>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto max-w-[1400px] space-y-4 p-3 pb-8">
          {mode === "compare" && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] text-muted-foreground">Compare</span>
              {result.totals.slice(0, 40).map((t) => { const on = compare.some((c) => c.toLowerCase() === t.label.toLowerCase() || (t.id && c === t.id)); return <Chip key={t.label} active={on} onClick={() => setCompare((cur) => (on ? cur.filter((c) => c.toLowerCase() !== t.label.toLowerCase() && c !== t.id) : cur.length >= MAX_SERIES ? cur : [...cur, t.label]))} title={`${t.count} records`}>{t.label} <span className="tabular text-muted-foreground">{t.count}</span></Chip>; })}
              {compare.length >= MAX_SERIES && <span className="text-[11px] text-muted-foreground">up to {MAX_SERIES} series</span>}
              {!compare.length && <span className="text-[11px] text-muted-foreground">Pick up to {MAX_SERIES} values to align them on one month axis.</span>}
            </div>
          )}
          <div className="rounded-md border p-3">
            <SeriesChart months={result.months} series={shown} anomalies={result.anomalies} height={300} ariaLabel={`Records by ${TREND_GROUP_LABEL[result.query.groupBy]} per month`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="rounded-md border">
              <div role="table" aria-label="Series" className="text-[12px]">
                <div role="row" className="grid h-7 grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-2 border-b px-2 grid-head"><span>{TREND_GROUP_LABEL[result.query.groupBy]}</span><span className="text-right">Records</span><span className="text-right">Share</span><span className="text-right">Change</span></div>
                {result.totals.slice(0, 30).map((t) => (
                  <div key={t.label} role="row" className="grid min-h-7 grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-2 border-b border-line-quiet px-2 last:border-b-0">
                    <span className="truncate" title={t.label}>{entityType && t.id ? <Link href={`/intel/${entityType}/${encodeURIComponent(t.id)}`} className="hover:text-primary hover:underline">{t.label}</Link> : t.label}</span>
                    <span className="text-right tabular">{fmtInt(t.count)}</span>
                    <span className="text-right tabular text-muted-foreground">{totalAll ? `${Math.round((t.count / totalAll) * 100)}%` : "—"}</span>
                    <span className="text-right tabular text-muted-foreground">{trendDelta(result.trends[t.label])}</span>
                  </div>
                ))}
                {!result.totals.length && <div className="px-2 py-3 text-[11.5px] text-muted-foreground">No records match these filters.</div>}
              </div>
            </div>
            <div className="rounded-md border">
              <div role="table" aria-label="Anomalies" className="text-[12px]">
                <div role="row" className="grid h-7 grid-cols-[minmax(0,1fr)_84px_48px_56px_48px] items-center gap-2 border-b px-2 grid-head"><span>Anomaly</span><span>Month</span><span className="text-right">Value</span><span className="text-right">Mean</span><span className="text-right">z</span></div>
                {result.anomalies.map((a, i) => (
                  <div key={i} role="row" className="grid min-h-7 grid-cols-[minmax(0,1fr)_84px_48px_56px_48px] items-center gap-2 border-b border-line-quiet px-2 last:border-b-0">
                    <span className="truncate">{a.anomaly.direction === "up" ? "Spike" : "Drop"} · {a.series}</span><span className="tabular text-muted-foreground">{monthLabel(a.anomaly.t)}</span><span className="text-right tabular">{a.anomaly.v}</span><span className="text-right tabular text-muted-foreground">{a.anomaly.mean}</span><span className="text-right tabular">{a.anomaly.z}</span>
                  </div>
                ))}
                {!result.anomalies.length && <div className="px-2 py-3 text-[11.5px] text-muted-foreground">No month departs from its rolling six-month mean by two standard deviations.</div>}
              </div>
            </div>
          </div>
          <MethodNote>Counts are month buckets of dated records ({result.query.kinds?.map((k) => DOC_KIND_LABEL[k]).join(", ") ?? "all kinds"}); the change column compares the second half of the range with the first. Anomalies are rolling z-scores (window 6 months, threshold 2, standard-deviation floor 1). Nothing here is model-generated.</MethodNote>
        </div>
      </div>
    </div>
  );
}
