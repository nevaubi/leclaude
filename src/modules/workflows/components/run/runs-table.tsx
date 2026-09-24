"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RelativeTime } from "@/components/ui/relative-time";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useApi, useWorkflowMeta } from "../../hooks";
import type { RunSummary } from "../../service";
import { RUN_STATUS_LABEL } from "../../types";
import { formatDuration, formatTokens, formatUsd, RunStatusBadge } from "../shared";

const STATUSES = ["running", "waiting_approval", "succeeded", "failed", "cancelled", "queued"] as const;

function durationOf(r: RunSummary): number | null {
  return r.durationMs ?? (r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null);
}

/** Column definitions for the runs grid (exported so tests can assert ids and accessors). */
export function runColumns(opts: { workflowId?: string; compact?: boolean }): DataTableColumn<RunSummary>[] {
  const cols: DataTableColumn<RunSummary>[] = [
    { id: "status", header: "Status", width: 150, minWidth: 120, sortable: true, accessor: (r) => r.status, render: (r) => <RunStatusBadge status={r.status} /> },
  ];
  if (!opts.workflowId) cols.push({ id: "workflow", header: "Workflow", width: 260, minWidth: 160, sortable: true, accessor: (r) => r.workflowName ?? "", render: (r) => <span className="block min-w-0"><span className="block truncate font-medium">{r.workflowName}</span>{r.currentStep ? <span className="block truncate text-[10.5px] text-muted-foreground">at {r.currentStep}</span> : r.error ? <span className="block truncate text-[10.5px] text-destructive">{r.error}</span> : null}</span> });
  cols.push({ id: "progress", header: "Progress", width: 150, minWidth: 120, accessor: (r) => r.stepCounts.succeeded, render: (r) => {
    const done = r.stepCounts.succeeded + r.stepCounts.failed + r.stepCounts.skipped;
    const pct = r.stepTotal ? Math.round((done / r.stepTotal) * 100) : 0;
    return (
      <span className="flex items-center gap-2">
        <span className="h-1 w-16 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", r.status === "failed" ? "bg-destructive" : r.status === "succeeded" ? "bg-success" : r.status === "waiting_approval" ? "bg-warning" : "bg-info")} style={{ width: `${pct}%` }} /></span>
        <span className="tabular text-[11px] text-muted-foreground">{r.stepCounts.succeeded}/{r.stepTotal}{r.stepCounts.failed ? <span className="text-destructive"> · {r.stepCounts.failed} failed</span> : null}</span>
      </span>
    );
  } });
  if (!opts.compact) cols.push({ id: "matter", header: "Matter", width: 160, minWidth: 100, sortable: true, accessor: (r) => r.matterName ?? "", render: (r) => <span className="truncate text-muted-foreground">{r.matterName ?? "—"}</span> });
  cols.push({ id: "trigger", header: "Trigger", width: 130, minWidth: 90, sortable: true, accessor: (r) => r.triggeredBy, render: (r) => <span className="capitalize text-muted-foreground">{r.triggeredBy}{r.triggeredByName && !opts.compact ? <span className="ml-1 text-[11px]">· {r.triggeredByName}</span> : null}</span> });
  cols.push({ id: "started", header: "Started", width: 120, minWidth: 90, sortable: true, accessor: (r) => r.startedAt, render: (r) => <span className="whitespace-nowrap text-muted-foreground"><RelativeTime value={r.startedAt} /></span> });
  cols.push({ id: "duration", header: "Duration", width: 90, minWidth: 70, align: "right", sortable: true, accessor: (r) => durationOf(r) ?? -1, render: (r) => <span className="tabular text-muted-foreground">{formatDuration(durationOf(r))}</span> });
  if (!opts.compact) cols.push({ id: "usage", header: "Tokens · cost", width: 130, minWidth: 90, align: "right", sortable: true, accessor: (r) => r.usage?.total ?? 0, render: (r) => <span className="tabular whitespace-nowrap text-muted-foreground">{r.usage?.total ? `${formatTokens(r.usage.total)} · ${formatUsd(r.usage.costUsd)}` : "—"}</span> });
  if (!opts.compact) cols.push({ id: "outputs", header: "Outputs", width: 80, minWidth: 60, align: "right", defaultHidden: true, accessor: (r) => r.deliverables?.length ?? 0, render: (r) => <span className="tabular text-muted-foreground">{r.deliverables?.length ?? 0}</span> });
  return cols;
}

export function RunsTable({ workflowId, matterId, compact, className, limit = 50, refreshMs, workflows }: { workflowId?: string; matterId?: string; compact?: boolean; className?: string; limit?: number; refreshMs?: number; workflows?: { id: string; name: string }[] }) {
  const router = useRouter();
  const meta = useWorkflowMeta();
  const [status, setStatus] = React.useState<string>("");
  const [trigger, setTrigger] = React.useState<string>("");
  const [wf, setWf] = React.useState<string>(workflowId ?? "");
  const [matter, setMatter] = React.useState<string>(matterId ?? "");
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 250); return () => clearTimeout(t); }, [q]);
  const params = new URLSearchParams();
  if (wf) params.set("workflowId", wf);
  if (status) params.set("status", status);
  if (trigger) params.set("triggeredBy", trigger);
  if (matter) params.set("matterId", matter);
  if (debouncedQ) params.set("q", debouncedQ);
  params.set("limit", String(limit));
  const { data, loading, refresh, error } = useApi<{ runs: RunSummary[]; total: number }>(`/api/workflows/runs?${params}`, { refreshMs });
  const runs = React.useMemo(() => data?.runs ?? [], [data]);
  const hasFilters = Boolean(status || trigger || (wf && !workflowId) || (matter && !matterId) || q);
  const columns = React.useMemo(() => runColumns({ workflowId, compact }), [workflowId, compact]);
  const rowId = React.useCallback((r: RunSummary) => r.id, []);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {!compact && (
        <div className="toolbar mb-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs by workflow, id, error or input…" size="xs" className="pl-7" aria-label="Search runs" />
          </div>
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger size="xs" className="w-40" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{RUN_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
          {!workflowId && workflows && (
            <Select value={wf || "all"} onValueChange={(v) => setWf(v === "all" ? "" : v)}>
              <SelectTrigger size="xs" className="w-52" aria-label="Workflow"><SelectValue placeholder="Workflow" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All workflows</SelectItem>{workflows.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {!matterId && (
            <Select value={matter || "all"} onValueChange={(v) => setMatter(v === "all" ? "" : v)}>
              <SelectTrigger size="xs" className="w-44" aria-label="Matter"><SelectValue placeholder="Matter" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All matters</SelectItem>{(meta?.matters ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select value={trigger || "all"} onValueChange={(v) => setTrigger(v === "all" ? "" : v)}>
            <SelectTrigger size="xs" className="w-36" aria-label="Trigger"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Any trigger</SelectItem><SelectItem value="manual">Manual</SelectItem><SelectItem value="schedule">Schedule</SelectItem><SelectItem value="event">Event</SelectItem><SelectItem value="api">API</SelectItem></SelectContent>
          </Select>
          {hasFilters && <Button variant="ghost" size="xs" onClick={() => { setStatus(""); setTrigger(""); if (!workflowId) setWf(""); if (!matterId) setMatter(""); setQ(""); }}><X className="size-3" /> Clear</Button>}
          <Button variant="ghost" size="icon-xs" onClick={refresh} aria-label="Refresh"><RefreshCw className={cn("size-3.5", loading && "animate-spin")} /></Button>
          {data && <span className="tabular text-[11px] text-muted-foreground">{data.total} run{data.total === 1 ? "" : "s"}</span>}
        </div>
      )}
      <DataTable<RunSummary>
        rows={runs}
        columns={columns}
        rowId={rowId}
        defaultSort={{ columnId: "started", dir: "desc" }}
        selectionMode="single"
        onRowActivate={(r) => router.push(`/workflows/runs/${r.id}`)}
        onRowClick={(r) => router.push(`/workflows/runs/${r.id}`)}
        rowActions={(r) => <Link href={`/workflows/runs/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground" aria-label="Open run"><ArrowUpRight className="size-3.5" /></Link>}
        loading={loading && !data}
        error={error}
        total={data?.total}
        noun="run"
        columnChooser={!compact}
        summary={false}
        empty={<div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{hasFilters ? "No runs match. Try clearing the filters." : "Runs appear here as soon as a workflow starts."}</div>}
        className="min-h-0 flex-1 rounded-md border"
        ariaLabel="Workflow runs"
      />
    </div>
  );
}
