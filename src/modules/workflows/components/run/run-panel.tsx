"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRightLeft, ArrowUpRight, BellRing, Calendar, Check, ChevronRight, Coins, Download, ExternalLink, FileText, KeyRound, Library, ListChecks, ListTodo, Loader2, Paperclip, Play, RotateCcw, ShieldAlert, SkipForward, Square, Stamp, ThumbsDown, ThumbsUp, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import type { WorkflowRunStep } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ai/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/misc";
import { TrustBadge } from "@/components/ai/trust-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { executionPlan } from "../../graph";
import { nodeSpec } from "../../registry";
import { apiJson, ApiError, useRunStream } from "../../hooks";
import { FAILURE_KIND_LABEL, isTerminalStatus, SKIP_REASON_LABEL, STOP_REASON_LABEL, stopReasonOf, type RunArtifact, type RunOutput, type WorkflowRunRecord } from "../../types";
import { OUTPUT_FORMAT_LABEL, type OutputFormat } from "../../frontend";
import { formatDuration, formatTokens, formatUsd, InlineAlert, NodeTypeIcon, RunStatusBadge, SectionLabel, StepStatusIcon, stepDuration, useNow } from "../shared";
import { CopyButton, OutputViewer } from "./step-output";
import { artifactProvenance, outcomeSummary, outputWithoutProvenance, stepDotTone, stepFailureLine, stepProvenance, stepSummary } from "./timeline-helpers";
import { approvalVerbs, isTrustGate } from "./approval-helpers";

export interface RunPanelProps {
  runId: string;
  initialRun?: WorkflowRunRecord | null;
  onClose?: () => void;
  onRerun?: (newRunId: string) => void;
  onStepStatuses?: (statuses: Record<string, WorkflowRunStep["status"]>) => void;
  /** Show a link to the full run page. */
  detailLink?: boolean;
  className?: string;
  /** Larger layout for the run detail page. */
  wide?: boolean;
}

const ARTIFACT_ICON: Record<RunArtifact["kind"], React.ComponentType<{ className?: string }>> = { task: ListTodo, event: Calendar, document: FileText, library: Library, file: Paperclip, notification: BellRing, coding: Stamp };
const STEP_LABELS = { failure: FAILURE_KIND_LABEL as Record<string, string>, skip: SKIP_REASON_LABEL as Record<string, string> };

export function RunPanel({ runId, initialRun, onClose, onRerun, onStepStatuses, detailLink = true, className, wide }: RunPanelProps) {
  const { run, connected, error, noApiKey, progress, retrying, budgetWarnings, loading, resting, terminal, reconnect } = useRunStream(runId, initialRun);
  const now = useNow(Boolean(run && (run.status === "running" || run.status === "queued")));
  // Live durations depend on the clock, which differs between the server render and hydration; show them only after mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [usageOpen, setUsageOpen] = React.useState(false);
  const pendingApprovalRef = React.useRef<Pick<Approval, "kind" | "reasons"> | null>(null);

  React.useEffect(() => {
    if (!run || !onStepStatuses) return;
    onStepStatuses(Object.fromEntries(run.steps.map((s) => [s.nodeId, s.status])));
  }, [run, onStepStatuses]);

  const plan = React.useMemo(() => (run?.snapshot ? executionPlan(run.snapshot.nodes, run.snapshot.edges) : null), [run?.snapshot]);
  const nodeMap = React.useMemo(() => new Map((run?.snapshot?.nodes ?? []).map((n) => [n.id, n])), [run?.snapshot]);
  const stepMap = React.useMemo(() => new Map((run?.steps ?? []).map((s) => [s.nodeId, s])), [run?.steps]);

  const stop = async () => {
    setBusy("stop");
    try { await apiJson(`/api/workflows/runs/${runId}/cancel`, { method: "POST" }); toast.success("Stop requested — running steps are being cancelled"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  /** Retry: the engine resumes from the failed step when the graph allows, otherwise from the start (a new run either way). */
  const retry = async () => {
    setBusy("retry");
    try { const r = await apiJson<{ run: { id: string } }>(`/api/workflows/runs/${runId}/rerun`, { method: "POST" }); toast.success("Retry started"); onRerun?.(r.run.id); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not retry"); } finally { setBusy(null); }
  };
  /** Run again: a fresh run from the start with the same inputs. */
  const runAgain = async () => {
    if (!run) return;
    setBusy("again");
    try {
      const inputs = Object.fromEntries(Object.entries(run.inputs ?? {}).filter(([k]) => k !== "__event"));
      const r = await apiJson<{ run: { id: string } }>(`/api/workflows/${run.workflowId}/run`, { method: "POST", body: JSON.stringify({ inputs, matterId: run.matterId ?? null }) });
      toast.success("Run started"); onRerun?.(r.run.id);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not start the run"); } finally { setBusy(null); }
  };
  const decide = async (approved: boolean, comment: string) => {
    setBusy("approve");
    const verbs = approvalVerbs(pendingApprovalRef.current ?? {});
    try { await apiJson(`/api/workflows/runs/${runId}/approve`, { method: "POST", body: JSON.stringify({ approved, comment }) }); toast.success(approved ? verbs.approvedToast : verbs.rejectedToast); reconnect(); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not record the decision"); } finally { setBusy(null); }
  };

  if (loading || !run) {
    return (
      <div className={cn("space-y-3 p-3", className)}>
        <Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-64" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    );
  }

  const startedMs = new Date(run.startedAt).getTime();
  const durationMs = run.durationMs ?? (run.finishedAt ? new Date(run.finishedAt).getTime() - startedMs : mounted ? now - startedMs : null);
  const pendingApproval = run.status === "waiting_approval" ? (run.approvals ?? []).find((a) => a.decidedAt == null) : undefined;
  pendingApprovalRef.current = pendingApproval ?? null;
  const steps = plan ? orderedRows(plan, run) : run.steps.map((s) => ({ id: s.nodeId, depth: 0, loopId: null as string | null }));
  const stopReason = stopReasonOf(run);
  const stoppedAt = run.stoppedAtNodeId ? nodeMap.get(run.stoppedAtNodeId)?.label ?? run.stoppedAtNodeId : undefined;
  const retryable = terminal && run.status !== "succeeded";
  const stoppable = run.status === "running" || run.status === "queued" || run.status === "waiting_approval";
  const outcome = outcomeSummary(run.outcome);
  const usage = run.usage;
  const stepTelemetry = run.steps.filter((s) => s.telemetry && s.telemetry.total > 0);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          {connected && !resting && <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-info" /> live</span>}
          <span className="ml-auto flex items-center gap-1">
            {stoppable && <Button variant="outline" size="xs" onClick={stop} disabled={busy === "stop"} aria-label="Stop run">{busy === "stop" ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />} Stop</Button>}
            {retryable && <Button variant="outline" size="xs" onClick={retry} disabled={busy === "retry"} title="Re-run from the failed step when the graph allows, otherwise from the start">{busy === "retry" ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} Retry</Button>}
            {terminal && <Button variant="ghost" size="xs" onClick={runAgain} disabled={busy === "again"} title="Start a new run from the beginning with the same inputs">{busy === "again" ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Run again</Button>}
            {detailLink && <Button variant="ghost" size="icon-xs" asChild><Link href={`/workflows/runs/${run.id}`} aria-label="Open run page"><ArrowUpRight className="size-3.5" /></Link></Button>}
            {onClose && <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close run panel"><X className="size-3.5" /></Button>}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>Started <RelativeTime value={run.startedAt} /></span>
          <span className="tabular">{formatDuration(durationMs)}</span>
          <span className="capitalize">{run.triggeredBy}</span>
          {usage && (usage.total > 0 || usage.calls > 0) && (
            <button type="button" onClick={() => setUsageOpen((o) => !o)} className="inline-flex items-center gap-1 rounded px-0.5 tabular hover:text-foreground cursor-pointer" aria-expanded={usageOpen} aria-controls={`usage-${run.id}`}>
              <Coins className="size-3" />{formatTokens(usage.total)} tokens · {formatUsd(usage.costUsd)}
              <ChevronRight className={cn("size-3 transition-transform", usageOpen && "rotate-90")} />
            </button>
          )}
          {run.retryOf && <Link href={`/workflows/runs/${run.retryOf}`} className="hover:underline">retry of <span className="font-mono text-[10px]">{run.retryOf}</span></Link>}
          <span className="font-mono text-[10px]">{run.id}</span>
        </div>
        {usageOpen && usage && <UsageDetails id={`usage-${run.id}`} run={run} steps={stepTelemetry} nodeMap={nodeMap} warnings={budgetWarnings} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {noApiKey || run.errorCode === "no_api_key" ? (
          <div className="p-3 pb-0"><InlineAlert tone="warning" icon={KeyRound} title="Model provider not configured" action={<Button variant="outline" size="xs" asChild><Link href="/settings#ai">Settings</Link></Button>}>Add a model provider key (OPENAI_API_KEY, ANTHROPIC_API_KEY or Bedrock credentials) and restart to run AI steps. Data and action steps ran normally.</InlineAlert></div>
        ) : terminal && run.status !== "succeeded" && stopReason ? (
          <div className="p-3 pb-0">
            <InlineAlert tone={run.status === "cancelled" ? "info" : run.status === "partial" || run.status === "budget_exhausted" ? "warning" : "destructive"} title={<span>{STOP_REASON_LABEL[stopReason]}{stoppedAt && stopReason !== "completed_with_failures" ? <span className="font-normal text-muted-foreground"> · at {stoppedAt}</span> : null}</span>}>
              {run.error && run.error !== STOP_REASON_LABEL[stopReason] ? <div>{run.error}</div> : null}
              {outcome && <div className="mt-0.5 tabular">{outcome}</div>}
              {run.recovery && <div className="mt-0.5">{run.recovery.action === "resumed" ? "Resumed after a restart" : "Interrupted by a restart"}: {run.recovery.reason}</div>}
            </InlineAlert>
          </div>
        ) : run.recovery?.action === "resumed" && !terminal ? (
          <div className="p-3 pb-0"><InlineAlert tone="info" title="Resumed after a restart">{run.recovery.reason}</InlineAlert></div>
        ) : null}

        {pendingApproval && <ApprovalCard approval={pendingApproval} onDecide={decide} busy={busy === "approve"} nodeMap={nodeMap} />}

        <div className="p-3 space-y-2">
          <SectionLabel right={<span className="normal-case tracking-normal tabular">{stepSummary(run.steps)}</span>}>Steps</SectionLabel>
          <ol className="timeline-rail space-y-1.5 pl-0.5" aria-label="Run steps">
            {steps.map((row) => {
              const step = stepMap.get(row.id) ?? { nodeId: row.id, status: "pending" as const };
              const node = nodeMap.get(row.id);
              return <StepRow key={row.id} step={step} label={node?.label ?? row.id} type={node?.type ?? ""} depth={row.depth} progress={progress[row.id]} retrying={retrying[row.id]} now={now} iterations={node?.type === "logic.loop" ? run.loopIterations?.[row.id] : undefined} nodeMap={nodeMap} wide={wide} />;
            })}
          </ol>
        </div>

        {(run.deliverables?.length ?? 0) > 0 && <DeliverablesSection outputs={run.deliverables!} />}

        {(run.handoffs?.length ?? 0) > 0 && (
          <div className="border-t p-3 space-y-1.5">
            <SectionLabel right={<span className="normal-case tracking-normal tabular">{run.handoffs!.length}</span>}>Handoffs</SectionLabel>
            <ol className="divide-y divide-line-quiet rounded-md border" aria-label="Agent handoffs">
              {run.handoffs!.map((h, i) => (
                <li key={`${h.at}-${i}`} className="px-2 py-1.5 text-[11.5px]">
                  <div className="flex items-center gap-1.5">
                    <ArrowRightLeft className="size-3 shrink-0 text-muted-foreground" />
                    <span className="font-medium capitalize">{h.from}</span><span className="text-muted-foreground">→</span><span className="font-medium capitalize">{h.to}</span>
                    {h.nodeId && <span className="font-mono text-[10px] text-muted-foreground">{nodeMap.get(h.nodeId)?.label ?? h.nodeId}</span>}
                    <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground"><RelativeTime value={h.at} /></span>
                  </div>
                  <div className="mt-0.5 line-clamp-3 text-muted-foreground" title={h.brief}>{h.brief}</div>
                  {h.evidenceIds && h.evidenceIds.length > 0 && <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{h.evidenceIds.slice(0, 6).join(", ")}{h.evidenceIds.length > 6 ? ` +${h.evidenceIds.length - 6}` : ""}</div>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {(run.stewardship?.length ?? 0) > 0 && (
          <div className="border-t p-3 space-y-1.5">
            <SectionLabel right={<span className="normal-case tracking-normal tabular">{run.stewardship!.filter((s) => s.fixed).length} fixed · {run.stewardship!.filter((s) => s.escalated).length} escalated</span>}>Steward</SectionLabel>
            <ul className="divide-y divide-line-quiet rounded-md border">
              {run.stewardship!.map((s, i) => (
                <li key={`${s.nodeId}-${i}`} className="flex min-h-7 items-center gap-2 px-2 py-1 text-[11.5px]">
                  <ListChecks className={cn("size-3 shrink-0", s.fixed ? "text-success" : s.escalated ? "text-warning" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{nodeMap.get(s.nodeId)?.label ?? s.nodeId}</span>{s.code && <span className="text-muted-foreground"> · {s.code}</span>}{s.action && <span className="text-muted-foreground"> · {s.action}</span>}</span>
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">{s.note ?? (s.fixed ? "Fixed" : s.escalated ? "Escalated" : "")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {run.followUps && (run.followUps.taskIds.length > 0 || run.followUps.triggered.length > 0 || run.followUps.notified.length > 0) && (
          <div className="border-t p-3 space-y-1.5">
            <SectionLabel>After the run</SectionLabel>
            <ul className="space-y-0.5 text-[11.5px]">
              {run.followUps.taskIds.map((id) => <li key={id}><Link href={`/?task=${id}`} className="flex h-6 items-center gap-1.5 hover:underline"><ListTodo className="size-3 text-muted-foreground" /> Task created <span className="font-mono text-[10px] text-muted-foreground">{id}</span></Link></li>)}
              {run.followUps.triggered.map((t) => <li key={t.runId}><Link href={`/workflows/runs/${t.runId}`} className="flex h-6 items-center gap-1.5 hover:underline"><ArrowUpRight className="size-3 text-muted-foreground" /> Started {t.name ?? t.workflowId}</Link></li>)}
              {run.followUps.notified.length > 0 && <li className="flex h-6 items-center gap-1.5 text-muted-foreground"><BellRing className="size-3" /> Notified {run.followUps.notified.length} {run.followUps.notified.length === 1 ? "person" : "people"}</li>}
              {run.followUps.notes.map((n, i) => <li key={`n-${i}`} className="text-muted-foreground">{n}</li>)}
            </ul>
          </div>
        )}

        {(run.artifacts?.length ?? 0) > 0 && (
          <div className="border-t p-3 space-y-1.5">
            <SectionLabel>Created</SectionLabel>
            <ul className="space-y-1">
              {run.artifacts!.map((a, i) => {
                const Icon = ARTIFACT_ICON[a.kind] ?? Paperclip;
                const prov = artifactProvenance(a);
                const inner = (
                  <span className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs hover:bg-accent/60 transition-colors">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    {prov && <TrustBadge provenance={prov} compact />}
                    {a.meta?.dueAt ? <span className="text-[10.5px] text-muted-foreground">due {String(a.meta.dueAt)}</span> : null}
                    {a.href && <ExternalLink className="size-3 text-muted-foreground" />}
                  </span>
                );
                return <li key={`${a.kind}-${a.id}-${i}`}>{a.href ? <Link href={a.href} target={a.href.startsWith("/api/") ? "_blank" : undefined}>{inner}</Link> : inner}</li>;
              })}
            </ul>
          </div>
        )}

        {(run.status === "succeeded" || run.status === "partial") && run.outputs && Object.keys(run.outputs).length > 0 && (
          <div className="border-t p-3 space-y-1.5">
            <SectionLabel right={<CopyButton value={run.outputs} />}>Outputs</SectionLabel>
            <OutputViewer value={run.outputs} defaultDepth={0} />
          </div>
        )}

        {Object.keys(run.inputs ?? {}).filter((k) => k !== "__event").length > 0 && (
          <div className="border-t p-3 space-y-1.5">
            <SectionLabel>Inputs</SectionLabel>
            <OutputViewer value={Object.fromEntries(Object.entries(run.inputs).filter(([k]) => k !== "__event"))} defaultDepth={1} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cost telemetry (constitution §36, §42), one compact row per model-calling
 * step with the run's budget underneath. Collapsed behind the tokens · cost
 * summary in the header so the panel stays quiet.
 */
function UsageDetails({ id, run, steps, nodeMap, warnings }: { id: string; run: WorkflowRunRecord; steps: WorkflowRunStep[]; nodeMap: Map<string, { label: string }>; warnings: Record<string, { used: number; limit: number }> }) {
  const usage = run.usage!;
  const budget = run.budget;
  const active = usage.activeMs ?? run.durationMs;
  const pct = (used: number, limit?: number) => (limit ? Math.min(100, Math.round((used / limit) * 100)) : null);
  const line = (label: string, used: string, limit: string | null, p: number | null, key: string) => (
    <span className={cn("inline-flex items-center gap-1", warnings[key] && "text-warning-foreground dark:text-warning")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{used}{limit ? ` / ${limit}` : ""}</span>
      {p != null && <span className="tabular text-muted-foreground">({p}%)</span>}
    </span>
  );
  return (
    <div id={id} className="mt-2 space-y-1.5 rounded-md border bg-background/60 p-2 text-[11px]">
      {steps.length > 0 ? (
        <table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="pb-1 font-medium">Step</th><th className="pb-1 font-medium">Model</th><th className="pb-1 text-right font-medium">In</th><th className="pb-1 text-right font-medium">Out</th><th className="pb-1 text-right font-medium">Cache</th><th className="pb-1 text-right font-medium">Latency</th><th className="pb-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const t = s.telemetry!;
              return (
                <tr key={s.nodeId} className="border-t border-line-quiet">
                  <td className="max-w-[160px] truncate py-0.5 pr-2 font-medium" title={nodeMap.get(s.nodeId)?.label ?? s.nodeId}>{nodeMap.get(s.nodeId)?.label ?? s.nodeId}</td>
                  <td className="truncate py-0.5 pr-2 text-muted-foreground" title={[t.provider, t.model].filter(Boolean).join(" · ")}>{t.model ?? "—"}{t.provider ? <span className="text-[10px]"> · {t.provider}</span> : null}</td>
                  <td className="py-0.5 pr-2 text-right tabular">{formatTokens(t.input)}</td>
                  <td className="py-0.5 pr-2 text-right tabular">{formatTokens(t.output)}</td>
                  <td className="py-0.5 pr-2 text-right tabular text-muted-foreground">{t.cacheRead ? formatTokens(t.cacheRead) : "—"}</td>
                  <td className="py-0.5 pr-2 text-right tabular text-muted-foreground">{formatDuration(t.latencyMs)}</td>
                  <td className="py-0.5 text-right tabular">{formatUsd(t.costUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="text-muted-foreground">No model calls recorded yet.</div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line-quiet pt-1.5">
        {line("Tokens", formatTokens(usage.total), budget ? formatTokens(budget.maxTokens) : null, pct(usage.total, budget?.maxTokens), "tokens")}
        {line("Cost", formatUsd(usage.costUsd), budget ? formatUsd(budget.maxCostUsd) : null, pct(usage.costUsd, budget?.maxCostUsd), "cost")}
        {line("Active", formatDuration(active), budget ? formatDuration(budget.maxDurationMs) : null, active != null ? pct(active, budget?.maxDurationMs) : null, "time")}
        <span className="text-muted-foreground tabular">{usage.calls} call{usage.calls === 1 ? "" : "s"}{usage.cacheRead ? ` · ${formatTokens(usage.cacheRead)} cached` : ""}</span>
      </div>
    </div>
  );
}

/** Files and documents the run delivered: open in Office / the library, or download the bytes. */
function DeliverablesSection({ outputs }: { outputs: RunOutput[] }) {
  return (
    <div className="border-t p-3 space-y-1.5">
      <SectionLabel right={<span className="normal-case tracking-normal tabular">{outputs.length}</span>}>Outputs</SectionLabel>
      <ul className="divide-y divide-line-quiet rounded-md border" aria-label="Run outputs">
        {outputs.map((o) => {
          const prov = o.meta?.provenance as Parameters<typeof TrustBadge>[0]["provenance"] | undefined;
          const fmt = o.format ? (OUTPUT_FORMAT_LABEL[o.format as OutputFormat] ?? o.format.toUpperCase()) : o.kind;
          return (
            <li key={o.id} className="flex min-h-7 items-center gap-2 px-2 py-1 text-[12px]">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={o.title}>{o.title}</span>
                <span className="block truncate text-[10.5px] text-muted-foreground">{fmt}{o.size ? ` · ${(o.size / 1024).toFixed(o.size < 10_240 ? 1 : 0)} KB` : ""}{o.libraryItemId ? " · in library" : ""}{o.meta?.carriedFromRunId ? " · from the retried run" : ""}</span>
              </span>
              {prov && <TrustBadge provenance={prov} compact />}
              {o.href && <Button variant="ghost" size="xs" asChild><Link href={o.href}>{o.kind === "insight" ? "View" : o.libraryItemId && !o.docId ? "Library" : "Open"}</Link></Button>}
              {o.libraryItemId && o.docId && <Button variant="ghost" size="xs" asChild><Link href={`/library?item=${o.libraryItemId}`}><Library className="size-3" /></Link></Button>}
              {o.downloadHref && <Button variant="ghost" size="icon-xs" asChild><a href={o.downloadHref} download aria-label={`Download ${o.title}`}><Download className="size-3.5" /></a></Button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function orderedRows(plan: ReturnType<typeof executionPlan>, run: WorkflowRunRecord): { id: string; depth: number; loopId: string | null }[] {
  const rows: { id: string; depth: number; loopId: string | null }[] = [];
  const push = (ids: string[], depth: number, loopId: string | null) => {
    for (const id of ids) {
      rows.push({ id, depth, loopId });
      const loop = plan.loops[id];
      if (loop) push(loop.bodyOrder, depth + 1, id);
    }
  };
  push(plan.order, 0, null);
  // Anything not in the plan (unreachable nodes) goes last.
  for (const s of run.steps) if (!rows.some((r) => r.id === s.nodeId)) rows.push({ id: s.nodeId, depth: 0, loopId: null });
  return rows;
}

function StepRow({ step, label, type, depth, progress, retrying, now, iterations, nodeMap, wide }: { step: WorkflowRunStep; label: string; type: string; depth: number; progress?: string; retrying?: { attempt: number; nextAttempt: number; delayMs: number; message: string }; now: number; iterations?: NonNullable<WorkflowRunRecord["loopIterations"]>[string]; nodeMap: Map<string, { label: string; type: string }>; wide?: boolean }) {
  const [open, setOpen] = React.useState(step.status === "failed");
  React.useEffect(() => { if (step.status === "failed") setOpen(true); }, [step.status]);
  const dur = stepDuration(step, now);
  const spec = nodeSpec(type);
  const hasBody = step.output !== undefined || (step.logs?.length ?? 0) > 0 || step.error || (iterations?.length ?? 0) > 0;
  const dot = stepDotTone(step.status);
  // AI executors put provenance on the output (`_provenance`); verify steps under `provenance`; older records on the step itself.
  const stepProv = stepProvenance(step as { output?: unknown; meta?: Record<string, unknown>; provenance?: unknown });
  const shownOutput = outputWithoutProvenance(step.output);
  const failureLine = stepFailureLine(step, STEP_LABELS);
  const secondary = step.status === "running" && retrying ? `Attempt ${retrying.attempt} failed · retrying (attempt ${retrying.nextAttempt}) in ${Math.round(retrying.delayMs / 1000)}s` : step.status === "running" && progress ? progress : failureLine ?? spec?.short ?? type;
  const t = step.telemetry;
  return (
    <li className="relative pl-6" style={{ marginLeft: depth * 16 }}>
      <span className="absolute left-[3px] top-[13px] flex size-3.5 items-center justify-center rounded-full bg-card"><StatusDot tone={dot.tone} pulse={dot.pulse} label={dot.label} /></span>
      <div className={cn("rounded-md border bg-card transition-colors", step.status === "running" && "border-info/50", step.status === "failed" && "border-destructive/50", step.status === "waiting_approval" && "border-warning/60", step.status === "cancelled" && "border-dashed")}>
        <button type="button" onClick={() => hasBody && setOpen((o) => !o)} className={cn("flex w-full items-center gap-2 px-2 py-1.5 text-left", hasBody && "cursor-pointer hover:bg-accent/40")}>
          <NodeTypeIcon type={type} size="xs" />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-xs font-medium", (step.status === "skipped" || step.status === "cancelled") && "text-muted-foreground")}>{label}</span>
            <span className={cn("block truncate text-[10.5px] text-muted-foreground", step.status === "failed" && "text-destructive")}>{secondary}</span>
          </span>
          {stepProv && <TrustBadge provenance={stepProv} compact />}
          {step.attempt && step.attempt > 1 && step.status !== "running" ? <span className="tabular text-[10px] text-muted-foreground" title={`${step.attempt} attempts`}>×{step.attempt}</span> : null}
          {t && t.total > 0 ? <span className="tabular text-[10px] text-muted-foreground" title={`${formatTokens(t.input)} in · ${formatTokens(t.output)} out${t.cacheRead ? ` · ${formatTokens(t.cacheRead)} cached` : ""} · ${formatUsd(t.costUsd)}${t.model ? ` · ${t.model}` : ""}`}>{formatTokens(t.total)} tok</span> : step.tokens ? <span className="tabular text-[10px] text-muted-foreground">{formatTokens(step.tokens)} tok</span> : null}
          {dur != null && <span className="tabular text-[10.5px] text-muted-foreground">{formatDuration(dur)}</span>}
          {hasBody && <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />}
        </button>
        {open && hasBody && (
          <div className="space-y-2 border-t px-2 py-2">
            {step.error && <div className={cn("rounded-md border px-2 py-1.5 text-[11px]", step.status === "cancelled" ? "border-border bg-muted/40 text-muted-foreground" : "border-destructive/40 bg-destructive/8 text-destructive")}>{step.failureKind && step.status !== "cancelled" ? <span className="font-medium">{FAILURE_KIND_LABEL[step.failureKind]} · </span> : null}{step.error}</div>}
            {step.logs && step.logs.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Log</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[10.5px] leading-relaxed scrollbar-thin">{step.logs.join("\n")}</pre>
              </div>
            )}
            {iterations && iterations.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Iterations ({iterations.length})</div>
                <div className="space-y-1">
                  {iterations.map((it) => <IterationRow key={it.index} iteration={it} nodeMap={nodeMap} />)}
                </div>
              </div>
            )}
            {step.output !== undefined && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground"><span>Output</span><CopyButton value={step.output} /></div>
                <OutputViewer value={shownOutput} defaultDepth={wide ? 2 : 1} className={cn("max-h-[420px] overflow-auto scrollbar-thin")} />
                {stepProv && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <TrustBadge provenance={stepProv} />
                    <span className="tabular">{stepProv.sources.length} source{stepProv.sources.length === 1 ? "" : "s"}</span>
                    {stepProv.verification?.unresolvedCites?.length ? <span className="text-warning-foreground dark:text-warning">{stepProv.verification.unresolvedCites.length} cite{stepProv.verification.unresolvedCites.length === 1 ? "" : "s"} to verify</span> : null}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function IterationRow({ iteration, nodeMap }: { iteration: NonNullable<WorkflowRunRecord["loopIterations"]>[string][number]; nodeMap: Map<string, { label: string }> }) {
  const [open, setOpen] = React.useState(false);
  const stepsArr = Object.values(iteration.steps ?? {});
  const failed = stepsArr.some((s) => s.status === "failed" || s.status === "cancelled") || Boolean(iteration.error);
  const itemLabel = typeof iteration.item === "object" && iteration.item ? String((iteration.item as Record<string, unknown>).subject ?? (iteration.item as Record<string, unknown>).title ?? (iteration.item as Record<string, unknown>).case_name ?? (iteration.item as Record<string, unknown>).bates ?? (iteration.item as Record<string, unknown>).section ?? JSON.stringify(iteration.item).slice(0, 60)) : String(iteration.item ?? "");
  return (
    <div className="rounded border bg-background/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-accent/40 cursor-pointer">
        {failed ? <X className="size-3 text-destructive" /> : <Check className="size-3 text-success" />}
        <span className="w-5 tabular text-muted-foreground">#{iteration.index + 1}</span>
        <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
        <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="space-y-1.5 border-t p-2">
          {iteration.error && <div className="text-[11px] text-destructive">{iteration.error}</div>}
          {stepsArr.map((s) => {
            const prov = stepProvenance(s as { output?: unknown; meta?: Record<string, unknown>; provenance?: unknown });
            return (
              <div key={s.nodeId} className="text-[11px]">
                <div className="mb-0.5 flex items-center gap-1.5"><StepStatusIcon status={s.status} className="size-3" /><span className="font-medium">{nodeMap.get(s.nodeId)?.label ?? s.nodeId}</span>{prov && <TrustBadge provenance={prov} compact />}{s.error && <span className="text-destructive">— {s.error}</span>}</div>
                {s.output !== undefined && <OutputViewer value={outputWithoutProvenance(s.output)} defaultDepth={0} className="max-h-60 overflow-auto scrollbar-thin" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Approval = NonNullable<WorkflowRunRecord["approvals"]>[number];

/**
 * Approval card. A plain approval (logic.approval) asks a person to sign off on
 * the message. A trust gate is different and looks different: the run stopped
 * because an action would have used AI output that is unverified, below the
 * confidence gate or contradicted. Approve lifts the gate for those steps;
 * Reject skips the gated action and the run continues.
 */
function ApprovalCard({ approval, onDecide, busy, nodeMap }: { approval: Approval; onDecide: (approved: boolean, comment: string) => void; busy: boolean; nodeMap?: Map<string, { label: string; type: string }> }) {
  const [comment, setComment] = React.useState("");
  const gate = isTrustGate(approval);
  const reasons = approval.reasons ?? [];
  const stepIds = approval.stepIds ?? [];
  if (gate) {
    return (
      <div className="m-3 space-y-2 rounded-lg border border-warning/60 bg-warning/8 p-3" role="region" aria-label="Trust gate">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" />
          <div className="text-sm font-semibold">Trust gate: {approval.title}</div>
          <span className="ml-auto text-[10.5px] text-muted-foreground">held <RelativeTime value={approval.requestedAt} /></span>
        </div>
        <p className="text-xs text-muted-foreground">An action step would have relied on AI output that is not yet trusted. Lift the gate to let it proceed with this output, or skip the action and let the run continue without it. Either decision is audited.</p>
        {reasons.length > 0 && (
          <ul className="space-y-1 rounded-md border bg-background p-2.5 text-xs">
            {reasons.map((r, i) => <li key={i} className="flex items-start gap-2"><span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-warning" />{r}</li>)}
          </ul>
        )}
        {stepIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span>Gated:</span>
            {stepIds.map((id) => <span key={id} className="rounded border bg-card px-1.5 py-px font-mono text-[10.5px]">{nodeMap?.get(id)?.label ?? id}</span>)}
          </div>
        )}
        {approval.message && <div className="max-h-48 overflow-y-auto rounded-md border bg-background p-2.5 scrollbar-thin"><Markdown compact>{approval.message}</Markdown></div>}
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why (optional) — kept in the audit log" rows={2} className="min-h-0 bg-background text-xs" />
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onDecide(false, comment)} disabled={busy}><SkipForward className="size-3.5" /> Skip action</Button>
          <Button variant="success" size="sm" onClick={() => onDecide(true, comment)} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unlock className="size-3.5" />} Lift gate</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="m-3 rounded-lg border border-warning/60 bg-warning/8 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ThumbsUp className="size-4 text-warning" />
        <div className="text-sm font-semibold">{approval.title}</div>
        <span className="ml-auto text-[10.5px] text-muted-foreground">requested <RelativeTime value={approval.requestedAt} /></span>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border bg-background p-3 scrollbar-thin"><Markdown compact>{approval.message}</Markdown></div>
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (included in the follow-up task)" rows={2} className="min-h-0 bg-background text-xs" />
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onDecide(false, comment)} disabled={busy}><ThumbsDown className="size-3.5" /> Reject</Button>
        <Button variant="success" size="sm" onClick={() => onDecide(true, comment)} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <ThumbsUp className="size-3.5" />} Approve</Button>
      </div>
    </div>
  );
}

export { isTerminalStatus };
