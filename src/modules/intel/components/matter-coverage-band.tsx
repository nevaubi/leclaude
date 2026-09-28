"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, KeyRound, Loader2, Lock, RotateCw, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/ui/relative-time";
import type { MatterIntelPlan } from "../autoconfig-types";
import { fmtInt } from "../analysis/pure";
import { AutoconfigSheet } from "./autoconfig-sheet";
import { CoverageActivity, retrySource } from "./coverage-activity";
import { SEARCH_KIND_LABEL, planItems, type CoverageResponse, type CoverageSource, type MatterCoverage } from "./coverage-models";
import { OriginChip, SourceStateText } from "./coverage-parts";
import { useAutoconfigState, useCoverage } from "./use-coverage";

const COLLAPSE_KEY = "intel.coverage.collapsed";

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
}
function writeCollapsed(v: boolean) {
  try { window.localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch { /* storage unavailable */ }
}

/**
 * Per-matter view of the intelligence layer, above the explorer: what is searched for each matter (with its
 * origin), which sources serve it and in what state, what came back, and the live runs. Counts are computed
 * from the store; the band polls only while runs are queued or running.
 */
export function MatterCoverageBand({ className, variant = "band" }: { className?: string; variant?: "band" | "empty" }) {
  const router = useRouter();
  const coverage = useCoverage(() => router.refresh());
  const auto = useAutoconfigState();
  const [collapsed, setCollapsed] = React.useState(false);
  const [sheet, setSheet] = React.useState(false);
  const [openMatter, setOpenMatter] = React.useState<string | null>(null);
  React.useEffect(() => { if (variant === "band") setCollapsed(readCollapsed()); }, [variant]);
  const toggle = () => setCollapsed((v) => { writeCollapsed(!v); return !v; });

  const s = coverage.state;
  const data = s.kind === "ready" ? s.data : s.kind === "error" ? s.data : undefined;
  const plans = React.useMemo(() => new Map((auto.state.kind === "ready" ? auto.state.data.plans : []).map((p) => [p.matterId, p])), [auto.state]);
  const matterName = React.useCallback((id: string) => data?.matters.find((m) => m.matterId === id)?.shortName || data?.matters.find((m) => m.matterId === id)?.name, [data]);
  const autoAvailable = auto.state.kind !== "unavailable" && auto.state.kind !== "denied";

  if (s.kind === "unavailable") return null;
  if (s.kind === "denied") {
    return (
      <section aria-label="Matter coverage" className={cn("shrink-0 border-b", className)}>
        <div className="flex h-9 items-center gap-2 px-3 text-[12px] text-muted-foreground"><Lock className="size-3.5" />You do not have access to matter coverage.</div>
      </section>
    );
  }

  const t = data?.totals;
  const setupButton = (
    <Tip label={auto.state.kind === "unavailable" ? "Not available in this deployment yet" : auto.state.kind === "denied" ? "You do not have permission to configure sources" : "Plan the searches each source runs for your matters, then apply"}>
      <span>
        <Button size="xs" variant="outline" onClick={() => setSheet(true)} disabled={!autoAvailable}>
          <Wand2 className="size-3.5" />Set up from matters
        </Button>
      </span>
    </Tip>
  );

  return (
    <section aria-label="Matter coverage" className={cn("shrink-0 border-b bg-background", className)}>
      <div className="flex h-9 min-w-0 items-center gap-2 px-3">
        {variant === "band" ? (
          <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="intel-coverage-body" className="flex min-w-0 items-center gap-1 rounded text-[12.5px] font-semibold tracking-tight hover:text-primary">
            {collapsed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}Matter coverage
          </button>
        ) : <h2 className="text-[12.5px] font-semibold tracking-tight">Matter coverage</h2>}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
          {s.kind === "loading" ? "Loading…" : t ? <SummaryText totals={t} restricted={data?.restricted} /> : null}
        </span>
        {coverage.polling && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Updating" />}
        {s.kind === "error" && (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-destructive" role="alert"><AlertTriangle className="size-3.5" />{data ? "Update failed" : "Could not load coverage"}
            <Button size="xs" variant="ghost" onClick={coverage.reload}><RotateCw className="size-3.5" />Retry</Button>
          </span>
        )}
        {setupButton}
      </div>
      {data && data.jobs.length > 0 && <CoverageActivity jobs={data.jobs} onRetried={coverage.kick} matterName={matterName} />}
      {!collapsed && (
        <div id="intel-coverage-body" className={cn("border-t border-line-quiet", variant === "band" && "max-h-[38vh] overflow-auto scrollbar-thin")}>
          {s.kind === "loading" && <LoadingRows />}
          {s.kind === "error" && !data && <p className="px-3 py-3 text-[12px] text-muted-foreground">{s.message}</p>}
          {data && data.matters.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-muted-foreground">{data.restricted ? "No matters are shared with you, so there is no matter coverage to show." : "No matters yet. Coverage appears once a matter is opened."}</p>
          )}
          {data && data.matters.length > 0 && (
            <CoverageTable compact={variant === "empty"} data={data} plans={plans} planState={auto.state.kind} openMatter={openMatter} onToggle={(id) => setOpenMatter((cur) => (cur === id ? null : id))} onRetried={coverage.kick} onSetup={autoAvailable ? () => setSheet(true) : undefined} />
          )}
        </div>
      )}
      {sheet && (
        <AutoconfigSheet open={sheet} onOpenChange={setSheet} onApplied={(r) => { auto.set(r.state ?? { plans: r.plans, changes: r.changes, jobs: r.jobs }); coverage.kick(); }} />
      )}
    </section>
  );
}

function SummaryText({ totals: t, restricted }: { totals: CoverageResponse["totals"]; restricted?: boolean }) {
  const parts: React.ReactNode[] = [
    <span key="m"><span className="tabular">{fmtInt(t.matters)}</span> matter{t.matters === 1 ? "" : "s"}{restricted ? " shared with you" : ""}</span>,
    <span key="s"><span className="tabular">{fmtInt(t.enabledSources)}</span> of <span className="tabular">{fmtInt(t.sources)}</span> sources on</span>,
  ];
  if (t.running) parts.push(<span key="r" className="text-foreground"><span className="tabular">{t.running}</span> running</span>);
  if (t.queued) parts.push(<span key="q"><span className="tabular">{t.queued}</span> queued</span>);
  if (t.failed) parts.push(<span key="f" className="text-destructive"><span className="tabular">{t.failed}</span> failed</span>);
  if (t.needsKey) parts.push(<span key="k" className="text-warning-foreground dark:text-warning"><span className="tabular">{t.needsKey}</span> need{t.needsKey === 1 ? "s" : ""} an API key</span>);
  return <>{parts.map((p, i) => <React.Fragment key={i}>{i > 0 && " · "}{p}</React.Fragment>)}</>;
}

function LoadingRows() {
  return (
    <div className="space-y-2 px-3 py-2.5" role="status" aria-label="Loading matter coverage">
      {[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-3"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 flex-1" /><Skeleton className="h-3 w-16" /></div>)}
    </div>
  );
}

/** "3 from record · 4 suggested" from the applied plan, or the count of searches configured on the sources. */
function searchingSummary(m: MatterCoverage, plan: MatterIntelPlan | undefined): { text: string; empty: boolean } {
  if (plan) {
    const items = planItems(plan);
    const rec = items.filter((i) => i.origin === "record").length;
    const sug = items.filter((i) => i.origin === "suggested").length;
    if (!items.length) return { text: "Nothing to search", empty: true };
    const other = items.length - rec - sug;
    return { text: [rec ? `${rec} from record` : null, sug ? `${sug} suggested` : null, other ? `${other} other` : null].filter(Boolean).join(" · "), empty: false };
  }
  const n = new Set(m.sources.filter((x) => x.linked !== "records").flatMap((x) => x.searches.map((q) => `${q.kind}:${q.text}`))).size;
  return n ? { text: `${n} search${n === 1 ? "" : "es"} on sources`, empty: false } : { text: "No searches", empty: true };
}

function sourcesSummary(m: MatterCoverage): React.ReactNode {
  const serving = m.sources.filter((x) => x.linked !== "records");
  if (!serving.length) return <span className="text-muted-foreground">None</span>;
  const on = serving.filter((x) => x.enabled).length;
  const running = serving.filter((x) => x.state === "running").length;
  const queued = serving.filter((x) => x.state === "queued").length;
  const failed = serving.filter((x) => x.state === "failed").length;
  const key = serving.filter((x) => x.state === "needs_key").length;
  return (
    <span className="text-muted-foreground">
      <span className="tabular">{on}</span>/<span className="tabular">{serving.length}</span> on
      {running > 0 && <span className="text-foreground"> · {running} running</span>}
      {queued > 0 && <span> · {queued} queued</span>}
      {failed > 0 && <span className="text-destructive"> · {failed} failed</span>}
      {key > 0 && <span className="text-warning-foreground dark:text-warning"> · {key} need{key === 1 ? "s" : ""} key</span>}
    </span>
  );
}

function CoverageTable({ compact, data, plans, planState, openMatter, onToggle, onRetried, onSetup }: { compact?: boolean; data: CoverageResponse; plans: Map<string, MatterIntelPlan>; planState: string; openMatter: string | null; onToggle: (id: string) => void; onRetried: () => void; onSetup?: () => void }) {
  return (
    <table className="w-full table-fixed border-collapse text-[12px]">
      <caption className="sr-only">Intelligence coverage per matter</caption>
      <thead className="sticky top-0 z-[1] bg-background">
        <tr className="h-7 border-b border-line-quiet text-left text-[11px] font-medium text-muted-foreground">
          <th scope="col" className="pl-3 font-medium">Matter</th>
          {!compact && <th scope="col" className="w-[160px] font-medium">Searching</th>}
          <th scope="col" className={cn("font-medium", compact ? "w-[190px]" : "w-[250px]")}>Sources</th>
          {!compact && <>
            <th scope="col" className="w-[70px] pr-2 text-right font-medium">Records</th>
            <th scope="col" className="w-[70px] pr-2 text-right font-medium">Entities</th>
            <th scope="col" className="w-[70px] pr-2 text-right font-medium">Insights</th>
          </>}
          <th scope="col" className={cn("pr-3 font-medium", compact ? "w-[92px]" : "w-[104px]")}>Last run</th>
        </tr>
      </thead>
      <tbody>
        {data.matters.map((m) => {
          const open = openMatter === m.matterId;
          const plan = plans.get(m.matterId);
          const searching = searchingSummary(m, plan);
          return (
            <React.Fragment key={m.matterId}>
              <tr className={cn("h-8 cursor-pointer border-b border-line-quiet hover:bg-accent/50", open && "bg-accent/40")} onClick={() => onToggle(m.matterId)}>
                <td className="min-w-0 pl-1.5">
                  <button type="button" className="flex w-full min-w-0 items-center gap-1 text-left" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} coverage for ${m.name}`} onClick={(e) => { e.stopPropagation(); onToggle(m.matterId); }}>
                    {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 truncate font-medium" title={m.name}>{m.shortName || m.name}</span>
                    {m.status !== "active" && <span className="shrink-0 pr-2 text-[11px] text-muted-foreground">{m.status}</span>}
                  </button>
                </td>
                {!compact && <td className={cn("truncate", searching.empty && "text-muted-foreground")}>{searching.text}</td>}
                <td className="truncate">{sourcesSummary(m)}</td>
                {!compact && <>
                  <td className="pr-2 text-right tabular">{fmtInt(m.records)}{m.recentRecords > 0 && m.recentRecords < m.records && <span className="ml-1 text-[11px] text-muted-foreground" title="Fetched in the last 7 days">+{fmtInt(m.recentRecords)}</span>}</td>
                  <td className="pr-2 text-right tabular">{fmtInt(m.entities)}</td>
                  <td className="pr-2 text-right tabular" title={`${m.insights.published} published · ${m.insights.flagged} flagged`}>
                    <span className="inline-flex items-center justify-end gap-1">{m.insights.flagged > 0 && <AlertTriangle className="size-3 text-warning-foreground dark:text-warning" aria-label={`${m.insights.flagged} flagged`} />}{fmtInt(m.insights.total)}</span>
                  </td>
                </>}
                <td className="truncate pr-3 text-muted-foreground">{m.lastRunAt ? <RelativeTime value={m.lastRunAt} /> : "Never"}</td>
              </tr>
              {open && (
                <tr className="border-b border-line-quiet bg-muted/30">
                  <td colSpan={compact ? 3 : 7} className="px-3 py-2.5">
                    <MatterDetail compact={compact} m={m} plan={plan} planState={planState} onRetried={onRetried} onSetup={onSetup} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function MatterDetail({ compact, m, plan, planState, onRetried, onSetup }: { compact?: boolean; m: MatterCoverage; plan?: MatterIntelPlan; planState: string; onRetried: () => void; onSetup?: () => void }) {
  const [all, setAll] = React.useState(false);
  const serving = m.sources.filter((x) => x.linked !== "records");
  const fromRecords = m.sources.filter((x) => x.linked === "records");
  type Row = { key: string; category: string; text: string; origin: "record" | "suggested" | "configured" | "unspecified"; title?: string };
  const rows: Row[] = plan
    ? planItems(plan).map((it, i) => ({ key: `p${i}`, category: it.category, text: it.text, origin: it.origin }))
    : dedupeSearches(serving).map((x, i) => ({ key: `s${i}`, category: SEARCH_KIND_LABEL[x.kind], text: x.text, origin: "configured" as const, title: `Configured on ${x.sources.join(", ")}` }));
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <div className={cn("grid gap-4 text-[12px]", !compact && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
      <div className="min-w-0">
        <h4 className="text-[11.5px] font-medium text-muted-foreground">What is searched</h4>
        {m.court && <p className="mb-1 truncate text-[11px] text-muted-foreground" title={`${m.court}${m.judge ? ` · ${m.judge}` : ""}`}>{m.court}{m.judge ? ` · ${m.judge}` : ""}</p>}
        {rows.length === 0 ? (
          <p className="text-muted-foreground">No searches are configured for this matter yet.{onSetup && <> <button type="button" className="text-primary hover:underline" onClick={onSetup}>Set up from matters</button> to derive them from the matter record.</>}</p>
        ) : (
          <>
            <ul className="divide-hairline">
              {shown.map((r) => (
                <li key={r.key} className="flex min-h-7 items-center gap-2 py-0.5" title={r.title}>
                  <span className="w-[68px] shrink-0 text-[11px] text-muted-foreground">{r.category}</span>
                  <span className="min-w-0 flex-1 truncate" title={r.text}>{r.text}</span>
                  <OriginChip origin={r.origin} />
                </li>
              ))}
            </ul>
            {rows.length > 10 && <button type="button" className="mt-1 text-[11.5px] text-primary hover:underline" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
            {!plan && planState === "ready" && <p className="mt-1 text-[11px] text-muted-foreground">Not part of the last setup from matters; showing what the sources are configured with.</p>}
          </>
        )}
      </div>
      <div className="min-w-0">
        <h4 className="mb-1 text-[11.5px] font-medium text-muted-foreground">Sources for this matter</h4>
        {serving.length === 0 ? <p className="text-muted-foreground">No source serves this matter.</p> : (
          <ul className="divide-hairline">{serving.map((src) => <SourceRow key={src.id} src={src} onRetried={onRetried} />)}</ul>
        )}
        {fromRecords.length > 0 && <p className="mt-1.5 text-[11px] text-muted-foreground">Also linked from firm-wide sources: {fromRecords.map((x) => `${x.name} (${fmtInt(x.records)})`).join(", ")}.</p>}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          <span className="tabular">{fmtInt(m.records)}</span> records · <span className="tabular">{fmtInt(m.entities)}</span> entities · <span className="tabular">{fmtInt(m.relations)}</span> relations · <span className="tabular">{fmtInt(m.insights.total)}</span> insights ({m.insights.published} published{m.insights.flagged ? `, ${m.insights.flagged} flagged` : ""}). Counted from stored records.
          {m.records > 0 && <> <Link href={`/intel/trends?matterId=${encodeURIComponent(m.matterId)}`} className="text-primary hover:underline">Trends</Link></>}
        </p>
      </div>
    </div>
  );
}

function SourceRow({ src, onRetried }: { src: CoverageSource; onRetried: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const retry = async () => { setBusy(true); const ok = await retrySource(src.id, src.name); setBusy(false); if (ok) onRetried(); };
  return (
    <li className="py-1">
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <SourceStateText state={src.state} className="w-[104px]" />
        <span className="min-w-0 flex-1 truncate" title={src.name}>{src.name}</span>
        {src.linked === "all_active" && <span className="shrink-0 text-[11px] text-muted-foreground" title="Runs for every active matter">all matters</span>}
        <span className="w-[56px] shrink-0 text-right tabular text-muted-foreground" title="Records linked to this matter">{fmtInt(src.records)} rec.</span>
        <span className="hidden w-[86px] shrink-0 truncate text-right text-[11px] text-muted-foreground xl:inline-block">{src.lastRunAt ? <RelativeTime value={src.lastRunAt} /> : "never run"}</span>
        {src.state === "failed" && <Button size="xs" variant="ghost" className="h-6 shrink-0" onClick={() => void retry()} disabled={busy} aria-label={`Retry ${src.name}`}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}Retry</Button>}
      </div>
      {src.state === "needs_key" && src.needsKey && (
        <p className="ml-[112px] flex items-center gap-1 text-[11px] text-warning-foreground dark:text-warning"><KeyRound className="size-3" />Needs {src.needsKey}; nothing is fetched until it is set. <Link href="/settings#research" className="text-primary hover:underline">Providers</Link></p>
      )}
      {src.state === "failed" && src.lastError && <p className="ml-[112px] truncate text-[11px] text-destructive" title={src.lastError}>{src.lastError}</p>}
    </li>
  );
}

function dedupeSearches(sources: CoverageSource[]): { kind: CoverageSource["searches"][number]["kind"]; text: string; sources: string[] }[] {
  const map = new Map<string, { kind: CoverageSource["searches"][number]["kind"]; text: string; sources: string[] }>();
  for (const s of sources) for (const q of s.searches) {
    const k = `${q.kind}:${q.text}`;
    const cur = map.get(k);
    if (cur) cur.sources.push(s.name); else map.set(k, { kind: q.kind, text: q.text, sources: [s.name] });
  }
  const order: Record<string, number> = { docket: 0, mdl: 1, judge: 2, court: 3, query: 4, cfr: 5, product: 6, target: 7 };
  return Array.from(map.values()).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}
