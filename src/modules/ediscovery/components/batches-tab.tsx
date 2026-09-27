"use client";
import * as React from "react";
import { Layers, Loader2, Play, Plus, RefreshCw, ShieldCheck, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Inspector } from "@/components/ui/inspector";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { KeyValueList, SegmentedControl } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tip } from "@/components/ui/tooltip";
import type { ReviewBatch } from "@/lib/types/domain";
import type { ReviewBatchSummary, DisagreementReport } from "../types";
import { BATCH_PRIORITIES, BATCH_STATUSES } from "../batch-pure";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { api, useBatch, useBatches } from "./use-review-data";
import { BatchDialog } from "./batch-dialog";
import { StateChip, formatDateTime, formatShortDate } from "./shared";
import { PRIORITY_RANK, batchDueTone } from "./review-helpers";

const STATUS_TONE: Record<ReviewBatch["status"], "muted" | "primary" | "info" | "success"> = { open: "muted", in_progress: "primary", qc: "info", complete: "success" };
const statusLabel = (s: ReviewBatch["status"]) => BATCH_STATUSES.find((x) => x.id === s)?.label ?? s;

/**
 * Batches: every review assignment of the matter (or mine) as a grid with
 * progress and QC state; the inspector shows the disagreement report and the
 * batch actions (review next, QC sample, reassign, priority, due, complete, delete).
 */
export function BatchesTab({ initialBatchId }: { initialBatchId?: string }) {
  const { matterId, currentUserId, reviewers, setTab } = useReview();
  const batches = useBatches(matterId);
  const [scope, setScope] = React.useState<"mine" | "all">("all");
  const [status, setStatus] = React.useState<"open" | "all">("open");
  const [active, setActive] = React.useState<string | null>(initialBatchId ?? null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const rows = React.useMemo(() => (batches.data?.batches ?? []).filter((b) => (scope === "all" || b.assigneeId === currentUserId) && (status === "all" || b.status !== "complete")), [batches.data, scope, status, currentUserId]);
  const columns = React.useMemo<DataTableColumn<ReviewBatchSummary>[]>(() => [
    { id: "name", header: "Batch", width: 260, minWidth: 160, sortable: true, accessor: (b) => b.name, locked: true, render: (b) => <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium">{b.name}</span>{b.secondPass && <StateChip tone="muted">2nd pass</StateChip>}</span> },
    { id: "status", header: "Status", width: 100, sortable: true, accessor: (b) => b.status, render: (b) => <StateChip tone={STATUS_TONE[b.status]}>{statusLabel(b.status)}</StateChip> },
    { id: "progress", header: "Progress", width: 150, sortable: true, accessor: (b) => b.progress.pct, render: (b) => <span className="flex items-center gap-2"><span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted"><span className={cn("absolute inset-y-0 left-0 rounded-full", b.progress.pct >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${b.progress.pct}%` }} /></span><span className="tabular text-[11.5px]">{b.progress.coded}/{b.progress.total}</span></span> },
    { id: "assignee", header: "Assignee", width: 130, sortable: true, accessor: (b) => b.assigneeName ?? "", render: (b) => <span className="truncate">{b.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}</span> },
    { id: "priority", header: "Priority", width: 80, sortable: true, accessor: (b) => PRIORITY_RANK[b.priority], render: (b) => <span className={cn("capitalize", b.priority === "high" && "text-destructive")}>{b.priority}</span> },
    { id: "due", header: "Due", width: 100, sortable: true, accessor: (b) => b.dueAt ?? "", render: (b) => { const tone = batchDueTone(b.dueAt, b.status); return <span className={cn("tabular", tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>{b.dueAt ? formatShortDate(b.dueAt) : "—"}</span>; } },
    { id: "qc", header: "QC", width: 120, sortable: true, accessor: (b) => b.qcSamplePercent, render: (b) => b.qcSamplePercent ? <span className="tabular text-[11.5px]">{b.progress.qcDone}/{b.progress.qcSampled} · {b.qcSamplePercent}%{b.progress.disagreements ? <span className="text-warning-foreground dark:text-warning"> · {b.progress.disagreements} disagree</span> : null}</span> : <span className="text-muted-foreground">—</span> },
    { id: "hot", header: "Hot", width: 56, align: "right", accessor: (b) => b.progress.hot, defaultHidden: true },
    { id: "priv", header: "Priv", width: 56, align: "right", accessor: (b) => b.progress.privileged, defaultHidden: true },
    { id: "created", header: "Created", width: 130, sortable: true, accessor: (b) => b.createdAt, render: (b) => <span className="tabular text-muted-foreground">{formatDateTime(b.createdAt)}{b.createdByName ? ` · ${b.createdByName}` : ""}</span>, defaultHidden: true },
  ], []);
  const review = (b: ReviewBatchSummary, qc = false) => { useReviewStore.getState().setBatch(b.id, qc); setTab("review"); };
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
          <Layers className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-semibold">Batches</span>
          <span className="tabular text-[11.5px] text-muted-foreground">{rows.length}</span>
          <SegmentedControl size="xs" value={scope} onChange={setScope} ariaLabel="Scope" options={[{ value: "all", label: "All" }, { value: "mine", label: "Mine" }]} />
          <SegmentedControl size="xs" value={status} onChange={setStatus} ariaLabel="Status" options={[{ value: "open", label: "Open" }, { value: "all", label: "Incl. complete" }]} />
          <div className="flex-1" />
          <Button size="xs" variant="ghost" onClick={batches.refresh} aria-label="Refresh"><RefreshCw className="size-3.5" /></Button>
          <Button size="xs" onClick={() => setCreateOpen(true)}><Plus className="size-3.5" /> New batch</Button>
        </div>
        <DataTable<ReviewBatchSummary>
          rows={rows}
          columns={columns}
          rowId={(b) => b.id}
          selectionMode="single"
          activeId={active}
          onActiveChange={setActive}
          onRowActivate={(b) => review(b)}
          defaultSort={{ columnId: "priority", dir: "asc" }}
          noun="batch"
          loading={batches.loading && !batches.data}
          error={batches.error?.message ?? null}
          empty={<div className="p-8"><EmptyState icon={Layers} title="No batches" description="Create a batch from a search, a saved search, the current selection or every uncoded document." action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New batch</Button>} /></div>}
          rowActions={(b) => <Tip label="Review this batch"><Button size="xs" variant="ghost" className="h-6 px-1.5" onClick={() => review(b)} aria-label={`Review ${b.name}`}><Play className="size-3" /></Button></Tip>}
          ariaLabel="Review batches"
        />
      </div>
      {active && <BatchInspector id={active} reviewers={reviewers} onClose={() => setActive(null)} onChanged={batches.refresh} onReview={(qc) => { const b = rows.find((x) => x.id === active); if (b) review(b, qc); }} />}
      <BatchDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(created) => { batches.refresh(); setActive(created[0]?.id ?? null); }} defaultSource="search" />
    </div>
  );
}

function BatchInspector({ id, reviewers, onClose, onChanged, onReview }: { id: string; reviewers: { id: string; name: string }[]; onClose: () => void; onChanged: () => void; onReview: (qc: boolean) => void }) {
  const { openDocument } = useReview();
  const batch = useBatch(id);
  const [tab, setTabState] = React.useState<"overview" | "qc">("overview");
  const [busy, setBusy] = React.useState(false);
  const [qcPct, setQcPct] = React.useState<string | null>(null);
  const b = batch.data?.batch;
  const patch = async (p: Partial<Pick<ReviewBatch, "assigneeId" | "priority" | "dueAt" | "status" | "qcSamplePercent" | "name">>) => {
    setBusy(true);
    try { await api(`/api/ediscovery/batches/${encodeURIComponent(id)}`, { method: "PATCH", json: p }); batch.refresh(); onChanged(); }
    catch (e) { toast.error("Could not update the batch", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!b || !window.confirm(`Delete “${b.name}”? Coding already done stays on the documents.`)) return;
    try { await api(`/api/ediscovery/batches/${encodeURIComponent(id)}`, { method: "DELETE" }); toast.success("Batch deleted"); onChanged(); onClose(); }
    catch (e) { toast.error("Could not delete", { description: (e as Error).message }); }
  };
  const dis: DisagreementReport | undefined = b?.disagreements;
  return (
    <Inspector title={b?.name ?? "Batch"} subtitle={b ? `${b.progress.total} documents · ${statusLabel(b.status)}` : undefined} icon={Layers} onClose={onClose} width={360} tabs={[{ id: "overview", label: "Overview" }, { id: "qc", label: "QC", count: dis?.disagree }]} activeTab={tab} onTabChange={(t) => setTabState(t as "overview" | "qc")}
      footer={b ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <Button size="xs" onClick={() => onReview(false)} disabled={b.progress.remaining === 0 && !b.secondPass}><Play className="size-3" /> Review{b.progress.remaining ? ` (${b.progress.remaining} left)` : ""}</Button>
          {b.qcSamplePercent > 0 && <Button size="xs" variant="outline" onClick={() => onReview(true)}><ShieldCheck className="size-3" /> QC sample</Button>}
          {b.status !== "complete" ? <Button size="xs" variant="ghost" onClick={() => void patch({ status: "complete" })} disabled={busy}><Check className="size-3" /> Mark complete</Button> : <Button size="xs" variant="ghost" onClick={() => void patch({ status: "open" })} disabled={busy}>Reopen</Button>}
          <div className="flex-1" />
          <Button size="xs" variant="ghost" onClick={() => void remove()} aria-label="Delete batch"><Trash2 className="size-3" /></Button>
        </div>
      ) : undefined}>
      {!b ? <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</div> : tab === "overview" ? (
        <div className="space-y-4 p-3">
          {b.description && <p className="text-[12px] leading-relaxed">{b.description}</p>}
          <KeyValueList dense labelWidth={110} items={[
            { label: "Progress", value: <span className="tabular">{b.progress.coded} of {b.progress.total} coded · {b.progress.pct}%</span> },
            { label: "Calls", value: <span className="tabular">{b.progress.responsive} responsive · {b.progress.privileged} privileged · {b.progress.hot} hot</span> },
            { label: "Source", value: b.source.kind === "search" ? `search${b.source.q ? ` “${b.source.q}”` : ""}${b.source.view ? ` · view ${b.source.view}` : ""}` : b.source.kind === "selection" ? "selection" : "all documents" },
            { label: "Created", value: `${formatDateTime(b.createdAt)}${b.createdByName ? ` · ${b.createdByName}` : ""}` },
            ...(b.completedAt ? [{ label: "Completed", value: formatDateTime(b.completedAt) }] : []),
          ]} />
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-muted-foreground">Assignment</div>
            <div className="grid grid-cols-[90px_1fr] items-center gap-x-2 gap-y-1.5 text-[12px]">
              <span className="text-muted-foreground">Assignee</span>
              <Select value={b.assigneeId ?? "none"} onValueChange={(v) => void patch({ assigneeId: v === "none" ? undefined : v })}><SelectTrigger size="xs" aria-label="Assignee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{reviewers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
              <span className="text-muted-foreground">Priority</span>
              <Select value={b.priority} onValueChange={(v) => void patch({ priority: v as ReviewBatch["priority"] })}><SelectTrigger size="xs" aria-label="Priority"><SelectValue /></SelectTrigger><SelectContent>{BATCH_PRIORITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent></Select>
              <span className="text-muted-foreground">Due</span>
              <Input size="xs" type="date" value={b.dueAt ?? ""} onChange={(e) => void patch({ dueAt: e.target.value || undefined })} className="tabular" aria-label="Due date" />
              <span className="text-muted-foreground">QC sample</span>
              <span className="flex items-center gap-1"><Input size="xs" type="number" min={0} max={100} value={qcPct ?? String(b.qcSamplePercent)} onChange={(e) => setQcPct(e.target.value)} onBlur={() => { if (qcPct != null && Number(qcPct) !== b.qcSamplePercent) void patch({ qcSamplePercent: Math.max(0, Math.min(100, Number(qcPct) || 0)) }); setQcPct(null); }} className="w-16 tabular" aria-label="QC sample percent" /><span className="text-[11px] text-muted-foreground">% · {b.qcSampleIds.length} docs</span></span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-3">
          {!b.qcSamplePercent ? <EmptyState compact icon={ShieldCheck} title="No QC sample" description="Set a QC sample percentage in Overview; a second reviewer re-reads the sample and disagreements are reported here." /> : !dis ? null : (
            <>
              <KeyValueList dense labelWidth={120} items={[
                { label: "Sampled", value: <span className="tabular">{dis.sampled} document{dis.sampled === 1 ? "" : "s"} ({b.qcSamplePercent}%)</span> },
                { label: "Checked", value: <span className="tabular">{dis.reviewed} · {dis.agree} agree · {dis.disagree} disagree</span> },
                { label: "Agreement", value: <span className="tabular">{dis.rate == null ? "—" : `${Math.round(dis.rate * 100)}%`}</span> },
                { label: "By field", value: <span className="tabular">{dis.byField.responsive} responsive · {dis.byField.privileged} privileged · {dis.byField.hot} hot · {dis.byField.issues} issues</span> },
              ]} />
              {dis.byReviewer.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-medium text-muted-foreground">First-pass reviewers</div>
                  <ul className="divide-y rounded-md border text-[11.5px]">{dis.byReviewer.map((r) => <li key={r.reviewerId} className="flex h-7 items-center gap-2 px-2.5"><span className="min-w-0 flex-1 truncate">{reviewers.find((x) => x.id === r.reviewerId)?.name ?? r.reviewerId}</span><span className="tabular text-muted-foreground">{r.reviewed} checked · {r.disagree} disagree</span></li>)}</ul>
                </div>
              )}
              <div>
                <div className="mb-1 text-[12px] font-medium text-muted-foreground">Disagreements · {dis.rows.length}</div>
                {!dis.rows.length ? <div className="rounded-md border border-dashed p-3 text-center text-[11.5px] text-muted-foreground">No disagreements recorded yet.</div> : (
                  <ul className="divide-y rounded-md border text-[11.5px]">
                    {dis.rows.map((r) => (
                      <li key={r.docId} className="px-2.5 py-1.5">
                        <div className="flex items-center gap-2"><button type="button" onClick={() => openDocument(r.docId)} className="font-mono text-[11px] text-primary hover:underline cursor-pointer">{r.docId}</button><span className="text-muted-foreground">{r.fields.join(", ")}</span><span className="ml-auto tabular text-[10.5px] text-muted-foreground">{formatShortDate(r.at.slice(0, 10))}</span></div>
                        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">first: {callText(r.firstPass)} · qc: {callText(r.qc)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Inspector>
  );
}

function callText(c: { responsive?: boolean | null; privileged?: boolean | null; hot?: boolean; issues?: string[] }): string {
  return [c.responsive == null ? "?" : c.responsive ? "R" : "NR", c.privileged ? "P" : "", c.hot ? "H" : "", ...(c.issues ?? [])].filter(Boolean).join(" ");
}
