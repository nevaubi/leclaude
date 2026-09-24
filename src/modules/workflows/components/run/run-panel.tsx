"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, BellRing, Calendar, Check, ChevronRight, Coins, ExternalLink, FileText, KeyRound, Library, ListTodo, Loader2, Paperclip, RotateCcw, ShieldAlert, SkipForward, Square, Stamp, ThumbsDown, ThumbsUp, Unlock, X } from "lucide-react";
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
import type { RunArtifact, WorkflowRunRecord } from "../../types";
import { formatDuration, formatTokens, formatUsd, InlineAlert, NodeTypeIcon, RunStatusBadge, SectionLabel, StepStatusIcon, stepDuration, useNow } from "../shared";
import { CopyButton, OutputViewer } from "./step-output";
import { artifactProvenance, outputWithoutProvenance, stepDotTone, stepProvenance, stepSummary } from "./timeline-helpers";
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

export function RunPanel({ runId, initialRun, onClose, onRerun, onStepStatuses, detailLink = true, className, wide }: RunPanelProps) {
  const { run, connected, error, noApiKey, progress, loading, resting, reconnect } = useRunStream(runId, initialRun);
  const now = useNow(Boolean(run && (run.status === "running" || run.status === "queued")));
  // Live durations depend on the clock, which differs between the server render and hydration; show them only after mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const [busy, setBusy] = React.useState<string | null>(null);
  const pendingApprovalRef = React.useRef<Pick<Approval, "kind" | "reasons"> | null>(null);

  React.useEffect(() => {
    if (!run || !onStepStatuses) return;
    onStepStatuses(Object.fromEntries(run.steps.map((s) => [s.nodeId, s.status])));
  }, [run, onStepStatuses]);

  const plan = React.useMemo(() => (run?.snapshot ? executionPlan(run.snapshot.nodes, run.snapshot.edges) : null), [run?.snapshot]);
  const nodeMap = React.useMemo(() => new Map((run?.snapshot?.nodes ?? []).map((n) => [n.id, n])), [run?.snapshot]);
  const stepMap = React.useMemo(() => new Map((run?.steps ?? []).map((s) => [s.nodeId, s])), [run?.steps]);

  const cancel = async () => {
    setBusy("cancel");
    try { await apiJson(`/api/workflows/runs/${runId}/cancel`, { method: "POST" }); toast.success("Run cancelled"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const rerun = async () => {
    setBusy("rerun");
    try { const r = await apiJson<{ run: { id: string } }>(`/api/workflows/runs/${runId}/rerun`, { method: "POST" }); toast.success("Re-run started"); onRerun?.(r.run.id); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not re-run"); } finally { setBusy(null); }
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

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          {connected && !resting && <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-info" /> live</span>}
          <span className="ml-auto flex items-center gap-1">
            {(run.status === "running" || run.status === "queued" || run.status === "waiting_approval") && <Button variant="outline" size="xs" onClick={cancel} disabled={busy === "cancel"}><Square className="size-3" /> Cancel</Button>}
            {resting && <Button variant="outline" size="xs" onClick={rerun} disabled={busy === "rerun"}>{busy === "rerun" ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} Re-run</Button>}
            {detailLink && <Button variant="ghost" size="icon-xs" asChild><Link href={`/workflows/runs/${run.id}`} aria-label="Open run page"><ArrowUpRight className="size-3.5" /></Link></Button>}
            {onClose && <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close run panel"><X className="size-3.5" /></Button>}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>Started <RelativeTime value={run.startedAt} /></span>
          <span className="tabular">{formatDuration(durationMs)}</span>
          <span className="capitalize">{run.triggeredBy}</span>
          {run.usage && run.usage.total > 0 && <span className="inline-flex items-center gap-1 tabular"><Coins className="size-3" />{formatTokens(run.usage.total)} tokens · {formatUsd(run.usage.costUsd)}</span>}
          <span className="font-mono text-[10px]">{run.id}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {noApiKey || run.errorCode === "no_api_key" ? (
          <div className="p-3 pb-0"><InlineAlert tone="warning" icon={KeyRound} title="OpenAI key required" action={<Button variant="outline" size="xs" asChild><Link href="/settings#ai">Settings</Link></Button>}>Add OPENAI_API_KEY to .env.local and restart to run AI steps. Data and action steps ran normally.</InlineAlert></div>
        ) : run.error && run.status !== "waiting_approval" ? (
          <div className="p-3 pb-0"><InlineAlert tone={run.status === "cancelled" ? "info" : "destructive"} title={run.status === "cancelled" ? "Run cancelled" : "Run failed"}>{run.error}</InlineAlert></div>
        ) : null}

        {pendingApproval && <ApprovalCard approval={pendingApproval} onDecide={decide} busy={busy === "approve"} nodeMap={nodeMap} />}

        <div className="p-3 space-y-2">
          <SectionLabel right={<span className="normal-case tracking-normal tabular">{stepSummary(run.steps)}</span>}>Steps</SectionLabel>
          <ol className="timeline-rail space-y-1.5 pl-0.5" aria-label="Run steps">
            {steps.map((row) => {
              const step = stepMap.get(row.id) ?? { nodeId: row.id, status: "pending" as const };
              const node = nodeMap.get(row.id);
              return <StepRow key={row.id} step={step} label={node?.label ?? row.id} type={node?.type ?? ""} depth={row.depth} progress={progress[row.id]} now={now} iterations={node?.type === "logic.loop" ? run.loopIterations?.[row.id] : undefined} nodeMap={nodeMap} wide={wide} />;
            })}
          </ol>
        </div>

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

        {run.status === "succeeded" && run.outputs && Object.keys(run.outputs).length > 0 && (
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

function StepRow({ step, label, type, depth, progress, now, iterations, nodeMap, wide }: { step: WorkflowRunStep; label: string; type: string; depth: number; progress?: string; now: number; iterations?: NonNullable<WorkflowRunRecord["loopIterations"]>[string]; nodeMap: Map<string, { label: string; type: string }>; wide?: boolean }) {
  const [open, setOpen] = React.useState(step.status === "failed");
  React.useEffect(() => { if (step.status === "failed") setOpen(true); }, [step.status]);
  const dur = stepDuration(step, now);
  const spec = nodeSpec(type);
  const hasBody = step.output !== undefined || (step.logs?.length ?? 0) > 0 || step.error || (iterations?.length ?? 0) > 0;
  const dot = stepDotTone(step.status);
  // AI executors put provenance on the output (`_provenance`); verify steps under `provenance`; older records on the step itself.
  const stepProv = stepProvenance(step as { output?: unknown; meta?: Record<string, unknown>; provenance?: unknown });
  const shownOutput = outputWithoutProvenance(step.output);
  return (
    <li className="relative pl-6" style={{ marginLeft: depth * 16 }}>
      <span className="absolute left-[3px] top-[13px] flex size-3.5 items-center justify-center rounded-full bg-card"><StatusDot tone={dot.tone} pulse={dot.pulse} label={dot.label} /></span>
      <div className={cn("rounded-md border bg-card transition-colors", step.status === "running" && "border-info/50", step.status === "failed" && "border-destructive/50", step.status === "waiting_approval" && "border-warning/60")}>
        <button type="button" onClick={() => hasBody && setOpen((o) => !o)} className={cn("flex w-full items-center gap-2 px-2 py-1.5 text-left", hasBody && "cursor-pointer hover:bg-accent/40")}>
          <NodeTypeIcon type={type} size="xs" />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-xs font-medium", step.status === "skipped" && "text-muted-foreground")}>{label}</span>
            <span className="block truncate text-[10.5px] text-muted-foreground">{step.status === "running" && progress ? progress : step.error ? step.error : spec?.short ?? type}</span>
          </span>
          {stepProv && <TrustBadge provenance={stepProv} compact />}
          {step.tokens ? <span className="tabular text-[10px] text-muted-foreground">{formatTokens(step.tokens)} tok</span> : null}
          {dur != null && <span className="tabular text-[10.5px] text-muted-foreground">{formatDuration(dur)}</span>}
          {hasBody && <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />}
        </button>
        {open && hasBody && (
          <div className="space-y-2 border-t px-2 py-2">
            {step.error && <div className="rounded-md border border-destructive/40 bg-destructive/8 px-2 py-1.5 text-[11px] text-destructive">{step.error}</div>}
            {step.logs && step.logs.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Log</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[10.5px] leading-relaxed scrollbar-thin">{step.logs.join("\n")}</pre>
              </div>
            )}
            {iterations && iterations.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Iterations ({iterations.length})</div>
                <div className="space-y-1">
                  {iterations.map((it) => <IterationRow key={it.index} iteration={it} nodeMap={nodeMap} />)}
                </div>
              </div>
            )}
            {step.output !== undefined && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground"><span>Output</span><CopyButton value={step.output} /></div>
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
  const failed = stepsArr.some((s) => s.status === "failed") || Boolean(iteration.error);
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
