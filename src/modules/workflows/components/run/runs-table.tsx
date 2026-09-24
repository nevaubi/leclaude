"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Filter, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useApi, useWorkflowMeta } from "../../hooks";
import type { RunSummary } from "../../service";
import { RUN_STATUS_LABEL } from "../../types";
import { formatDuration, formatTokens, formatUsd, RunStatusBadge } from "../shared";

const STATUSES = ["running", "waiting_approval", "succeeded", "failed", "cancelled", "queued"] as const;

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
  const runs = data?.runs ?? [];
  const hasFilters = Boolean(status || trigger || (wf && !workflowId) || (matter && !matterId) || q);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {!compact && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs by workflow, id, error or input…" className="h-8 pl-7 text-xs" />
          </div>
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger size="sm" className="w-40"><Filter className="size-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{RUN_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
          {!workflowId && workflows && (
            <Select value={wf || "all"} onValueChange={(v) => setWf(v === "all" ? "" : v)}>
              <SelectTrigger size="sm" className="w-52"><SelectValue placeholder="Workflow" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All workflows</SelectItem>{workflows.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {!matterId && (
            <Select value={matter || "all"} onValueChange={(v) => setMatter(v === "all" ? "" : v)}>
              <SelectTrigger size="sm" className="w-44"><SelectValue placeholder="Matter" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All matters</SelectItem>{(meta?.matters ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select value={trigger || "all"} onValueChange={(v) => setTrigger(v === "all" ? "" : v)}>
            <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Any trigger</SelectItem><SelectItem value="manual">Manual</SelectItem><SelectItem value="schedule">Schedule</SelectItem><SelectItem value="event">Event</SelectItem><SelectItem value="api">API</SelectItem></SelectContent>
          </Select>
          {hasFilters && <Button variant="ghost" size="xs" onClick={() => { setStatus(""); setTrigger(""); if (!workflowId) setWf(""); if (!matterId) setMatter(""); setQ(""); }}><X className="size-3" /> Clear</Button>}
          <Button variant="ghost" size="icon-xs" onClick={refresh} aria-label="Refresh"><RefreshCw className={cn("size-3.5", loading && "animate-spin")} /></Button>
          {data && <span className="text-[11px] text-muted-foreground">{data.total} run{data.total === 1 ? "" : "s"}</span>}
        </div>
      )}
      {error && <div className="mb-2 text-xs text-destructive">{error}</div>}
      <div className={cn("min-h-0 overflow-auto rounded-lg border", !compact && "flex-1")}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[150px]">Status</TableHead>
              {!workflowId && <TableHead>Workflow</TableHead>}
              <TableHead>Progress</TableHead>
              {!compact && <TableHead>Matter</TableHead>}
              <TableHead>Trigger</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              {!compact && <TableHead className="text-right">Tokens · cost</TableHead>}
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data && Array.from({ length: compact ? 4 : 8 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: compact ? 6 : 9 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
            ))}
            {data && runs.length === 0 && (
              <TableRow><TableCell colSpan={9}><EmptyState title="No runs match" description={hasFilters ? "Try clearing the filters." : "Runs appear here as soon as a workflow starts."} className="border-0" /></TableCell></TableRow>
            )}
            {runs.map((r) => {
              const done = r.stepCounts.succeeded + r.stepCounts.failed + r.stepCounts.skipped;
              const pct = r.stepTotal ? Math.round((done / r.stepTotal) * 100) : 0;
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/workflows/runs/${r.id}`)}>
                  <TableCell><RunStatusBadge status={r.status} /></TableCell>
                  {!workflowId && <TableCell className="max-w-[260px]"><div className="truncate text-xs font-medium">{r.workflowName}</div>{r.currentStep && <div className="truncate text-[10.5px] text-muted-foreground">at {r.currentStep}</div>}{r.error && !r.currentStep && <div className="truncate text-[10.5px] text-destructive">{r.error}</div>}</TableCell>}
                  <TableCell className="min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", r.status === "failed" ? "bg-destructive" : r.status === "succeeded" ? "bg-success" : r.status === "waiting_approval" ? "bg-warning" : "bg-info")} style={{ width: `${pct}%` }} /></div>
                      <span className="tabular text-[11px] text-muted-foreground">{r.stepCounts.succeeded}/{r.stepTotal}{r.stepCounts.failed ? <span className="text-destructive"> · {r.stepCounts.failed} failed</span> : null}</span>
                    </div>
                  </TableCell>
                  {!compact && <TableCell className="text-xs text-muted-foreground">{r.matterName ?? "—"}</TableCell>}
                  <TableCell><Badge variant="outline" className="capitalize">{r.triggeredBy}</Badge>{r.triggeredByName && !compact && <span className="ml-1.5 text-[11px] text-muted-foreground">{r.triggeredByName}</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap"><RelativeTime value={r.startedAt} /></TableCell>
                  <TableCell className="text-right tabular text-xs text-muted-foreground">{formatDuration(r.durationMs ?? (r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null))}</TableCell>
                  {!compact && <TableCell className="text-right tabular text-xs text-muted-foreground whitespace-nowrap">{r.usage?.total ? `${formatTokens(r.usage.total)} · ${formatUsd(r.usage.costUsd)}` : "—"}</TableCell>}
                  <TableCell><Link href={`/workflows/runs/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground" aria-label="Open run"><ArrowUpRight className="size-3.5" /></Link></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
