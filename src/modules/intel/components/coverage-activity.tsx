"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, KeyRound, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/relative-time";
import { fmtElapsed, headlineJob, type CoverageJob } from "./coverage-models";
import { useNow } from "./use-coverage";

const STATUS_LABEL: Partial<Record<CoverageJob["status"], string>> = { queued: "Queued", running: "Running", failed: "Failed", escalated: "Failed · escalated" };

/** Retry a failed source run through the existing run route. */
export async function retrySource(sourceId: string, name?: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/intel/sources/${encodeURIComponent(sourceId)}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 403) throw new Error("You do not have permission to run this source");
    if (!res.ok) throw new Error(j.error ?? `${res.status} ${res.statusText}`);
    toast.success(`${name ?? "Source"} queued`);
    return true;
  } catch (e) {
    toast.error("Could not start the run", { description: (e as Error).message });
    return false;
  }
}

/**
 * Live source runs in one compact line: the running job (or the newest failure) as the headline, the rest behind
 * a disclosure. Each row expands to its last log lines. Never a timeline.
 */
export function CoverageActivity({ jobs, onRetried, matterName }: { jobs: CoverageJob[]; onRetried: () => void; matterName: (id: string) => string | undefined }) {
  const [open, setOpen] = React.useState(false);
  const running = jobs.some((j) => j.status === "running");
  const now = useNow(running);
  const head = headlineJob(jobs);
  if (!head) return null;
  const rest = jobs.filter((j) => j.id !== head.id);
  return (
    <div className="border-t border-line-quiet" aria-live="polite">
      <JobRow job={head} now={now} onRetried={onRetried} matterName={matterName} trailing={rest.length > 0 && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="shrink-0 rounded px-1 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
          {open ? "Hide" : `+${rest.length} more`}
        </button>
      )} />
      {open && rest.map((j) => <JobRow key={j.id} job={j} now={now} onRetried={onRetried} matterName={matterName} />)}
    </div>
  );
}

function JobRow({ job, now, onRetried, trailing, matterName }: { job: CoverageJob; now: number; onRetried: () => void; trailing?: React.ReactNode; matterName: (id: string) => string | undefined }) {
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const failed = job.status === "failed" || job.status === "escalated";
  const start = job.startedAt ?? job.createdAt;
  const elapsed = job.status === "running" ? now - new Date(start).getTime() : job.finishedAt ? new Date(job.finishedAt).getTime() - new Date(start).getTime() : NaN;
  const tone = job.status === "running" ? "primary" : failed ? (job.needsKey ? "warning" : "destructive") : "muted";
  const matters = job.matterIds.map(matterName).filter(Boolean) as string[];
  const retry = async () => { if (!job.sourceId) return; setBusy(true); const ok = await retrySource(job.sourceId, job.sourceName); setBusy(false); if (ok) onRetried(); };
  return (
    <div className="px-3">
      <div className="flex h-8 min-w-0 items-center gap-2 text-[12px]">
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-label={expanded ? "Hide run details" : "Show run details"} className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <StatusDot tone={tone} pulse={job.status === "running"} label={STATUS_LABEL[job.status] ?? job.status} />
        <span className="shrink-0 font-medium">{job.sourceName ?? job.kind}</span>
        <span className={cn("shrink-0 text-muted-foreground", failed && !job.needsKey && "text-destructive", job.needsKey && "text-warning-foreground dark:text-warning")}>{job.needsKey ? "Needs API key" : STATUS_LABEL[job.status] ?? job.status}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={failed ? job.error : job.phase}>
          {failed ? (job.needsKey ? `Add ${job.needsKey}` : job.error ?? "Run failed") : job.status === "queued" ? "Waiting for a worker" : job.phase ?? "Starting"}
        </span>
        {job.status === "running" && <span className="hidden shrink-0 tabular text-muted-foreground sm:inline">{job.recordsSoFar.toLocaleString()} record{job.recordsSoFar === 1 ? "" : "s"} so far</span>}
        {Number.isFinite(elapsed) && <span className="w-[58px] shrink-0 text-right tabular text-muted-foreground" title={job.status === "running" ? "Elapsed" : "Duration"}>{fmtElapsed(elapsed)}</span>}
        {failed && job.needsKey && <Button asChild size="xs" variant="ghost" className="shrink-0"><Link href="/settings#research"><KeyRound className="size-3.5" />Add key</Link></Button>}
        {failed && !job.needsKey && job.sourceId && <Button size="xs" variant="outline" className="shrink-0" onClick={() => void retry()} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}Retry</Button>}
        {trailing}
      </div>
      {expanded && (
        <div className="mb-2 ml-7 space-y-1.5 border-l border-line-quiet pl-3 text-[11.5px]">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
            <span>Attempt <span className="tabular">{job.attempts}/{job.maxAttempts}</span></span>
            <span>Queued <RelativeTime value={job.createdAt} /></span>
            {job.finishedAt && <span>Finished <RelativeTime value={job.finishedAt} /></span>}
            {job.errorCode && <span>Code <span className="font-mono">{job.errorCode}</span></span>}
            <span>{matters.length ? `For ${matters.join(", ")}` : "Firm-wide source"}</span>
          </div>
          {failed && job.error && <p className="text-destructive">{job.error}</p>}
          {job.log.length > 0 ? (
            <ol className="space-y-0.5">
              {job.log.map((l, i) => (
                <li key={i} className="flex gap-2"><span className="w-[76px] shrink-0 whitespace-nowrap tabular text-muted-foreground">{new Date(l.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span><span className={cn("min-w-0 break-words", l.level === "error" && "text-destructive", l.level === "warn" && "text-warning-foreground dark:text-warning")}>{l.msg}</span></li>
              ))}
            </ol>
          ) : <p className="text-muted-foreground">No log lines yet.</p>}
        </div>
      )}
    </div>
  );
}
