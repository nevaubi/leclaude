"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play, RefreshCw, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { KeyValueList } from "@/components/ui/form";
import { Inspector } from "@/components/ui/inspector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { describeIntelSchedule } from "@/modules/intel/schedule";
import type { IntelConfigView, IntelHealth, IntelJob, IntelJobStatus, IntelSource, IntelSweepReport } from "@/modules/intel/types";
import type { AnalysisStatus } from "@/modules/intel/analysis/types";
import { fmtDate, fmtInt } from "@/modules/intel/analysis/pure";
import { JOB_STATUS_TONE, describeHealth, jobRepairText } from "@/modules/intel/components/models";
import { RunAnalysisButton, useJson } from "@/modules/intel/components/shared";
import type { ProvidersPayload } from "./providers";
import { SettingsBlock } from "./settings-section";

/**
 * Settings → Data & automation: the intelligence layer's sources (adapter,
 * schedule, enabled, run now, health, last run, counts, last error), the job
 * log with steward fixes and escalations (retry/cancel, log inspector), the
 * local folders read from the environment, provider status, a health summary
 * and storage statistics. Tables over cards; counts as text.
 */
type SourceRow = IntelSource & { documents: number; adapterName: string; lastJob?: { id: string; status: IntelJobStatus; finishedAt?: string; error?: { code: string; message: string } } };
type JobRow = IntelJob & { sourceName?: string };
interface SourcesPayload { sources: SourceRow[] }
interface JobsPayload { items: JobRow[]; total: number; counts: IntelHealth["jobs"] }
interface HealthPayload { health: IntelHealth; sweep: IntelSweepReport | null; loop: { mode: string; startedAt: string; lastTickAt?: string; ticks: number; lastError?: string; busy: boolean } | null; stats: { documents: number; chunks: number; entities: number; relations: number; insights: number; jobs: number; sources: number; watches: number; byKind: Record<string, number>; bySource: Record<string, number>; flagged: number; vectors: { docs: number; chunks: number; embedded: number } } }
type ConfigPayload = IntelConfigView & { httpCache: { rows: number; bytes?: number } };

const TONE_TEXT: Record<string, string> = { muted: "text-muted-foreground", success: "text-success", warning: "text-warning-foreground dark:text-warning", destructive: "text-destructive", primary: "text-primary" };
const TONE_DOT: Record<string, string> = { muted: "bg-muted-foreground/60", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive", primary: "bg-primary" };

export function DataAutomationSection({ background, dataDir, corpusFolders }: { background: "inline" | "cron" | "off"; dataDir: string; corpusFolders: number }) {
  return (
    <React.Suspense fallback={<div className="text-[11.5px] text-muted-foreground">Loading…</div>}>
      <DataAutomationPanel background={background} dataDir={dataDir} corpusFolders={corpusFolders} />
    </React.Suspense>
  );
}

function DataAutomationPanel({ background, dataDir, corpusFolders }: { background: "inline" | "cron" | "off"; dataDir: string; corpusFolders: number }) {
  const params = useSearchParams();
  const sources = useJson<SourcesPayload>("/api/intel/sources");
  const [jobStatus, setJobStatus] = React.useState<string>("all");
  const jobs = useJson<JobsPayload>(`/api/intel/jobs?limit=200${jobStatus === "escalated" ? "&escalated=1" : jobStatus !== "all" ? `&status=${jobStatus}` : ""}`, [jobStatus]);
  const health = useJson<HealthPayload>("/api/intel/health");
  const config = useJson<ConfigPayload>("/api/intel/config");
  const providers = useJson<ProvidersPayload>("/api/settings/providers");
  const analysis = useJson<AnalysisStatus>("/api/intel/analysis");
  const [rows, setRows] = React.useState<SourceRow[]>([]);
  const [openJob, setOpenJob] = React.useState<string | null>(params?.get("job") ?? null);
  const activeSource = params?.get("source") ?? null;
  React.useEffect(() => { if (sources.data) setRows(sources.data.sources); }, [sources.data]);
  const refreshAll = () => { sources.reload(); jobs.reload(); health.reload(); analysis.reload(); };

  const patchSource = async (s: SourceRow, patch: { enabled?: boolean }) => {
    try {
      const res = await fetch(`/api/intel/sources/${encodeURIComponent(s.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setRows((list) => list.map((x) => (x.id === s.id ? { ...x, ...(j.source as SourceRow) } : x)));
      toast.success(`${s.name}: ${patch.enabled ? "enabled" : "disabled"}`);
    } catch (e) { toast.error("Could not update the source", { description: (e as Error).message }); }
  };
  const runNow = async (s: SourceRow) => {
    try {
      const res = await fetch(`/api/intel/sources/${encodeURIComponent(s.id)}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wait: false }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      toast.success(`Queued: ${s.name}`, { description: background === "off" ? "Background jobs are off (LECLAUDE_BACKGROUND); the job waits for a tick." : "The runner picks it up on its next tick." });
      setTimeout(refreshAll, 1500);
    } catch (e) { toast.error("Could not queue the run", { description: (e as Error).message }); }
  };
  const jobAction = async (j: JobRow, action: "retry" | "cancel") => {
    try {
      const res = await fetch(`/api/intel/jobs/${encodeURIComponent(j.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? res.statusText);
      toast.success(action === "retry" ? "Re-queued" : "Cancelled");
      jobs.reload(); health.reload();
    } catch (e) { toast.error(`Could not ${action} the job`, { description: (e as Error).message }); }
  };

  const sourceColumns: DataTableColumn<SourceRow>[] = [
    { id: "name", header: "Source", width: 250, minWidth: 160, locked: true, sortable: true, accessor: (s) => s.name.toLowerCase(), render: (s) => <span className="min-w-0"><span className="block truncate font-medium" title={s.description}>{s.name}</span></span> },
    { id: "adapter", header: "Adapter", width: 150, sortable: true, accessor: (s) => s.adapterName, render: (s) => <span className="truncate text-muted-foreground" title={s.adapter}>{s.adapterName}</span> },
    { id: "schedule", header: "Schedule", width: 110, sortable: true, accessor: (s) => s.schedule.every, render: (s) => <span className="text-muted-foreground">{describeIntelSchedule(s.schedule)}</span> },
    { id: "enabled", header: "On", width: 56, align: "center", sortable: true, accessor: (s) => (s.enabled ? 1 : 0), render: (s) => <Switch size="sm" checked={s.enabled} onCheckedChange={(v) => void patchSource(s, { enabled: v })} onClick={(e) => e.stopPropagation()} aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`} /> },
    { id: "health", header: "Health", width: 120, sortable: true, accessor: (s) => describeHealth(s.health, s.enabled, s.status).label, render: (s) => { const h = describeHealth(s.health, s.enabled, s.status); return <span className={cn("inline-flex items-center gap-1.5", TONE_TEXT[h.tone])}><span className={cn("size-1.5 rounded-full", TONE_DOT[h.tone])} aria-hidden />{h.label}{s.health.consecutiveFailures > 0 && <span className="tabular text-muted-foreground">×{s.health.consecutiveFailures}</span>}</span>; } },
    { id: "lastRun", header: "Last run", width: 110, sortable: true, accessor: (s) => s.lastRunAt ?? "", render: (s) => <span className="tabular text-muted-foreground" title={s.lastRunAt}>{s.lastRunAt ? fmtDate(s.lastRunAt) : "never"}</span> },
    { id: "nextRun", header: "Next", width: 110, sortable: true, defaultHidden: true, accessor: (s) => s.nextRunAt ?? "", render: (s) => <span className="tabular text-muted-foreground">{s.nextRunAt ? fmtDate(s.nextRunAt) : "—"}</span> },
    { id: "documents", header: "Records", width: 80, align: "right", sortable: true, accessor: (s) => s.documents, render: (s) => <span className="tabular">{fmtInt(s.documents)}</span> },
    { id: "chunks", header: "Passages", width: 84, align: "right", sortable: true, defaultHidden: true, accessor: (s) => s.stats.chunks, render: (s) => <span className="tabular">{fmtInt(s.stats.chunks)}</span> },
    { id: "lastAdded", header: "Last added", width: 90, align: "right", sortable: true, accessor: (s) => s.stats.lastAdded, render: (s) => <span className="tabular text-muted-foreground">{fmtInt(s.stats.lastAdded)}</span> },
    { id: "error", header: "Last error", width: 320, accessor: (s) => s.health.lastError ?? "", render: (s) => <span className={cn("truncate", s.health.lastError ? "text-muted-foreground" : "text-muted-foreground/60")} title={s.health.lastError}>{s.health.lastError ?? "—"}</span> },
  ];
  const jobColumns: DataTableColumn<JobRow>[] = [
    { id: "status", header: "Status", width: 92, sortable: true, accessor: (j) => j.status, render: (j) => <span className={cn("inline-flex items-center gap-1.5", TONE_TEXT[JOB_STATUS_TONE[j.status] ?? "muted"])}><span className={cn("size-1.5 rounded-full", TONE_DOT[JOB_STATUS_TONE[j.status] ?? "muted"], j.status === "running" && "animate-pulse-soft")} aria-hidden />{j.status}</span> },
    { id: "kind", header: "Kind", width: 110, sortable: true, accessor: (j) => j.kind, render: (j) => <span className="font-mono text-[11px]">{j.kind}</span> },
    { id: "source", header: "Source", width: 220, sortable: true, accessor: (j) => j.sourceName ?? "", render: (j) => <span className="truncate text-muted-foreground">{j.sourceName ?? "—"}</span> },
    { id: "attempts", header: "Attempts", width: 74, align: "right", accessor: (j) => j.attempts, render: (j) => <span className="tabular">{j.attempts}/{j.maxAttempts}</span> },
    { id: "repairs", header: "Steward", width: 220, accessor: (j) => jobRepairText(j), render: (j) => <span className={cn("truncate", j.escalation ? "text-destructive" : "text-muted-foreground")} title={jobRepairText(j)}>{jobRepairText(j)}</span> },
    { id: "error", header: "Error", width: 260, accessor: (j) => j.error?.message ?? "", render: (j) => <span className="truncate text-muted-foreground" title={j.error ? `${j.error.code}: ${j.error.message}` : undefined}>{j.error ? `${j.error.code}: ${j.error.message}` : "—"}</span> },
    { id: "updated", header: "Updated", width: 120, sortable: true, accessor: (j) => j.updatedAt, render: (j) => <span className="tabular text-muted-foreground" title={j.updatedAt}>{new Date(j.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span> },
    { id: "duration", header: "Duration", width: 80, align: "right", defaultHidden: true, accessor: (j) => (j.startedAt && j.finishedAt ? new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime() : 0), render: (j) => <span className="tabular text-muted-foreground">{j.startedAt && j.finishedAt ? `${Math.round((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000)}s` : "—"}</span> },
  ];

  const h = health.data?.health;
  const stats = health.data?.stats;
  const openRow = jobs.data?.items.find((j) => j.id === openJob) ?? null;
  const localSource = rows.find((s) => s.adapter === "local-corpus");
  const matterMap = (localSource?.config.matterMap ?? {}) as Record<string, string>;
  const dirs = config.data?.corpusDirs ?? ((localSource?.config.dirs as string[] | undefined) ?? []);

  return (
    <div className="space-y-3">
      <SettingsBlock id="sources" title="Sources" description={`${rows.filter((s) => s.enabled).length} of ${rows.length} enabled · background: ${background === "off" ? "off" : background === "cron" ? "external cron" : "in-process loop"}`} actions={<Tip label="Refresh"><Button variant="ghost" size="icon-xs" onClick={refreshAll} aria-label="Refresh">{sources.loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</Button></Tip>}>
        <DataTable rows={rows} columns={sourceColumns} rowId={(s) => s.id} defaultSort={{ columnId: "name", dir: "asc" }} virtualize={false} fill={false} selectionMode="single" activeId={activeSource} noun="source" ariaLabel="Sources" loading={sources.loading && !rows.length} error={sources.error} empty={<div className="p-4 text-center text-[12px] text-muted-foreground">No sources.</div>}
          rowActions={(s) => <Tip label="Run now"><Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); void runNow(s); }} aria-label={`Run ${s.name} now`}><Play className="size-3.5" /></Button></Tip>} />
        <p className="mt-1.5 text-[11px] text-muted-foreground">Schedules and scope live in the database (PATCH /api/intel/sources/&lt;id&gt;); keys live in the environment. Sources without their provider key stay disabled until the key is present.</p>
      </SettingsBlock>

      <SettingsBlock id="jobs" title="Jobs" description={jobs.data ? `${fmtInt(jobs.data.counts.queued)} queued · ${fmtInt(jobs.data.counts.running)} running · ${fmtInt(jobs.data.counts.failed24h)} failed (24h) · ${fmtInt(jobs.data.counts.fixed24h)} fixed by the steward (24h) · ${fmtInt(jobs.data.counts.escalated)} escalated` : "Job log"} actions={
        <div className="flex items-center gap-1">
          <Select value={jobStatus} onValueChange={setJobStatus}>
            <SelectTrigger size="xs" className="w-[130px]" aria-label="Job status"><SelectValue /></SelectTrigger>
            <SelectContent>{["all", "queued", "running", "succeeded", "failed", "fixed", "escalated", "cancelled"].map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>)}</SelectContent>
          </Select>
          <Tip label="Refresh"><Button variant="ghost" size="icon-xs" onClick={() => jobs.reload()} aria-label="Refresh jobs">{jobs.loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</Button></Tip>
        </div>
      }>
        <div className="flex min-h-0">
          <div className="min-w-0 flex-1">
            <DataTable rows={jobs.data?.items ?? []} columns={jobColumns} rowId={(j) => j.id} defaultSort={{ columnId: "updated", dir: "desc" }} virtualize={false} fill={false} selectionMode="single" activeId={openJob} onActiveChange={setOpenJob} onRowClick={(j) => setOpenJob(j.id)} onRowActivate={(j) => setOpenJob(j.id)} noun="job" total={jobs.data?.total} ariaLabel="Jobs" loading={jobs.loading && !jobs.data} error={jobs.error} empty={<div className="p-4 text-center text-[12px] text-muted-foreground">No jobs {jobStatus === "all" ? "yet" : `with status ${jobStatus}`}.</div>}
              rowActions={(j) => (
                <span className="flex items-center gap-0.5">
                  {(j.status === "failed" || j.status === "escalated" || j.status === "cancelled") && <Tip label="Retry"><Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); void jobAction(j, "retry"); }} aria-label="Retry job"><RotateCcw className="size-3.5" /></Button></Tip>}
                  {(j.status === "queued" || j.status === "running") && <Tip label="Cancel"><Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); void jobAction(j, "cancel"); }} aria-label="Cancel job"><X className="size-3.5" /></Button></Tip>}
                </span>
              )} />
          </div>
          {openRow && (
            <Inspector title={`${openRow.kind} · ${openRow.status}`} subtitle={openRow.sourceName ?? openRow.id} onClose={() => setOpenJob(null)} closeShortcut="Esc" width={420} minWidth={320} maxWidth={720} resizable ariaLabel="Job details" className="max-h-[520px] border-l"
              footer={<div className="flex items-center gap-1 px-3 py-2">{(openRow.status === "failed" || openRow.status === "escalated" || openRow.status === "cancelled") && <Button size="xs" onClick={() => void jobAction(openRow, "retry")}><RotateCcw className="size-3.5" /> Retry</Button>}{(openRow.status === "queued" || openRow.status === "running") && <Button size="xs" variant="outline" onClick={() => void jobAction(openRow, "cancel")}><X className="size-3.5" /> Cancel</Button>}{openRow.escalation && <Button size="xs" variant="ghost" asChild><Link href="/settings#review">Open review queue</Link></Button>}</div>}>
              <div className="space-y-3 p-3 text-[12px]">
                <KeyValueList dense labelWidth={96} items={[
                  { label: "Job id", value: openRow.id, mono: true },
                  { label: "Attempts", value: `${openRow.attempts} of ${openRow.maxAttempts}` },
                  { label: "Priority", value: String(openRow.priority) },
                  { label: "Started", value: openRow.startedAt ? new Date(openRow.startedAt).toLocaleString() : "—", muted: !openRow.startedAt },
                  { label: "Finished", value: openRow.finishedAt ? new Date(openRow.finishedAt).toLocaleString() : "—", muted: !openRow.finishedAt },
                  { label: "Error", value: openRow.error ? `${openRow.error.code}: ${openRow.error.message}` : "—", muted: !openRow.error },
                ]} />
                {openRow.escalation && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11.5px]"><span className="font-medium">Escalated:</span> {openRow.escalation.reason} <span className="text-muted-foreground">({fmtDate(openRow.escalation.at)})</span></div>}
                {openRow.fixes.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Steward fixes</div>
                    <div className="divide-hairline">{openRow.fixes.map((f, i) => <div key={i} className="py-1"><span className="font-medium">{f.action}</span> <span className="text-muted-foreground">by {f.by} · {new Date(f.at).toLocaleString()}</span><div className="text-[11.5px] text-muted-foreground">{f.note}</div></div>)}</div>
                  </div>
                )}
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Log (last {openRow.log.length})</div>
                  <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed scrollbar-thin">{openRow.log.map((l) => `${l.at.slice(11, 19)} ${l.level.padEnd(5)} ${l.msg}${l.data ? ` ${JSON.stringify(l.data).slice(0, 200)}` : ""}`).join("\n")}</pre>
                </div>
                {openRow.result && <div><div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Result</div><pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed scrollbar-thin">{JSON.stringify(openRow.result, null, 1).slice(0, 4000)}</pre></div>}
              </div>
            </Inspector>
          )}
        </div>
      </SettingsBlock>

      <div className="grid gap-3 lg:grid-cols-2">
        <SettingsBlock title="Local folders" description="Read from LECLAUDE_CORPUS_DIRS; indexed incrementally by the local-corpus source.">
          {dirs.length ? (
            <ul className="divide-hairline text-[12px]">{dirs.map((d) => <li key={d} className="flex h-7 items-center gap-2"><span className="truncate font-mono text-[11px]" title={d}>{d}</span></li>)}</ul>
          ) : <p className="text-[12px] text-muted-foreground">No folders configured{corpusFolders ? ` (${corpusFolders} in the environment)` : ""}.</p>}
          <pre className="mt-2 rounded-md border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">{`# .env.local\nLECLAUDE_CORPUS_DIRS=/srv/matters/AFFF-PFAS,/srv/matters/Depo-Provera\n# restart, then enable "Local document folders" above`}</pre>
          {Object.keys(matterMap).length > 0 && <div className="mt-2 text-[11px] text-muted-foreground">Folder → matter mapping: {Object.entries(matterMap).map(([k, v]) => `${k} → ${v}`).join(" · ")}. Files under a mapped folder name are linked to that matter; PDF, DOCX, XLSX, text and Markdown are extracted; files over the size cap are skipped.</div>}
        </SettingsBlock>

        <SettingsBlock title="Provider status" description="Environment presence only; values are never shown.">
          {providers.data ? (
            <div className="divide-hairline text-[12px]">{providers.data.providers.map((p) => <div key={p.id} className="flex h-7 items-center gap-2"><span className={cn("size-1.5 shrink-0 rounded-full", p.state === "configured" ? "bg-success" : p.state === "public" ? "bg-muted-foreground/60" : "bg-warning")} aria-hidden /><span className="w-[150px] shrink-0 truncate font-medium">{p.name}</span><span className="min-w-0 flex-1 truncate text-muted-foreground" title={p.detail}>{p.detail}</span><span className="hidden shrink-0 font-mono text-[10.5px] text-muted-foreground xl:inline">{p.env.join(", ")}</span></div>)}</div>
          ) : <p className="text-[12px] text-muted-foreground">{providers.error ? `Could not load: ${providers.error}` : "Loading…"}</p>}
        </SettingsBlock>

        <SettingsBlock title="Health" description={h ? `${h.sources.enabled} sources enabled · ${h.jobs.escalated} escalated · last sweep ${h.lastSweepAt ? fmtDate(h.lastSweepAt) : "never"}` : "Runner, sweeps and analysis"} actions={<RunAnalysisButton variant="ghost" label={analysis.data?.pending ? `Run analysis (${fmtInt(analysis.data.pending)} pending)` : "Run analysis"} onDone={refreshAll} />}>
          {h ? (
            <KeyValueList dense columns={2} labelWidth={124} items={[
              { label: "Background", value: `${h.background}${health.data?.loop ? ` · ${health.data.loop.ticks} ticks${health.data.loop.busy ? " · busy" : ""}` : ""}`, mono: true },
              { label: "Sources", value: `${h.sources.enabled} enabled · ${h.sources.erroring} erroring · ${h.sources.running} running` },
              { label: "Jobs", value: `${h.jobs.queued} queued · ${h.jobs.running} running · ${h.jobs.failed24h} failed (24h)` },
              { label: "Steward", value: `${h.jobs.fixed24h} fixed (24h) · ${h.jobs.escalated} escalated` },
              { label: "Insights", value: `${h.insights.total} total · ${h.insights.flagged} flagged · ${h.insights.pendingVerification} awaiting verification` },
              { label: "Last sweep", value: health.data?.sweep ? `${fmtDate(health.data.sweep.at)} · ${health.data.sweep.staleFlagged} stale · ${health.data.sweep.contradictions} contradictions · ${health.data.sweep.brokenLinks} broken links` : "never", muted: !health.data?.sweep },
              { label: "Analysis", value: analysis.data?.lastRun ? `${fmtDate(analysis.data.lastRun.at)} · ${analysis.data.lastRun.insights.total} insights · ${fmtInt(analysis.data.pending)} records pending` : "not yet run", muted: !analysis.data?.lastRun },
              { label: "Loop error", value: health.data?.loop?.lastError ?? "none", muted: !health.data?.loop?.lastError },
            ]} />
          ) : <p className="text-[12px] text-muted-foreground">{health.error ? `Could not load: ${health.error}` : "Loading…"}</p>}
        </SettingsBlock>

        <SettingsBlock title="Storage" description={`SQLite in ${dataDir}`}>
          {stats ? (
            <>
              <KeyValueList dense columns={2} labelWidth={110} items={[
                { label: "Records", value: fmtInt(stats.documents) },
                { label: "Passages", value: fmtInt(stats.chunks) },
                { label: "Embedded", value: `${fmtInt(stats.vectors.embedded)} of ${fmtInt(stats.vectors.chunks)} vectors` },
                { label: "Entities", value: fmtInt(stats.entities) },
                { label: "Relations", value: fmtInt(stats.relations) },
                { label: "Insights", value: fmtInt(stats.insights) },
                { label: "Watches", value: fmtInt(stats.watches) },
                { label: "Jobs", value: fmtInt(stats.jobs) },
                { label: "Flagged records", value: fmtInt(stats.flagged) },
                { label: "HTTP cache", value: config.data ? `${fmtInt(config.data.httpCache.rows)} responses` : "—" },
              ]} />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">{Object.entries(stats.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k}>{k.replace(/_/g, " ")} <span className="tabular">{n}</span></span>)}</div>
            </>
          ) : <p className="text-[12px] text-muted-foreground">Loading…</p>}
        </SettingsBlock>
      </div>
    </div>
  );
}
