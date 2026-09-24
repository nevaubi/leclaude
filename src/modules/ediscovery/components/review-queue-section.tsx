"use client";
import * as React from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Chip, CountChip } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/relative-time";
import { TrustBadge } from "@/components/ai/trust-badge";
import type { ReviewQueueItem } from "@/lib/integrity/types";
import { ApiError, api } from "./use-review-data";
import { decisionBody, groupQueueByKind, isEndpointMissing, queueReason } from "./review-queue-helpers";

interface QueueResponse { items: ReviewQueueItem[]; counts?: { pending: number; byKind: Record<string, number> } }

/**
 * "Needs review": every AI-produced record for this matter whose provenance is
 * pending a human decision. Approve makes the record trusted for downstream
 * automation; Reject keeps it out. Renders an empty state when the integrity
 * endpoint is missing so the tab never breaks.
 */
export function ReviewQueueSection({ matterId, onChanged }: { matterId: string; onChanged?: (pending: number) => void }) {
  const [items, setItems] = React.useState<ReviewQueueItem[] | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<"pending" | "all">("pending");

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api<QueueResponse>(`/api/integrity/review?matter=${encodeURIComponent(matterId)}&status=${status}&limit=200`);
      const rows = Array.isArray(r?.items) ? r.items : [];
      setItems(rows); setMissing(false);
      onChanged?.(status === "pending" ? rows.length : rows.filter((x) => x.review?.status === "pending").length);
    } catch (e) {
      if (isEndpointMissing(e)) { setMissing(true); setItems([]); }
      else setError(e instanceof ApiError ? e.message : String((e as Error)?.message ?? e));
    } finally { setLoading(false); }
  }, [matterId, status, onChanged]);
  React.useEffect(() => { void load(); }, [load]);

  const decide = async (item: ReviewQueueItem, decision: "approved" | "rejected", note?: string) => {
    const key = `${item.kind}:${item.id}`;
    setBusy(key);
    try {
      const r = await api<{ results?: { ok: boolean; message?: string }[]; counts?: { pending: number } }>("/api/integrity/review", { method: "POST", json: decisionBody(item, decision, note) });
      const res = r?.results?.[0];
      if (res && !res.ok) throw new Error(res.message ?? "Decision was not recorded");
      setItems((cur) => (cur ? cur.map((x) => (x.kind === item.kind && x.id === item.id ? { ...x, review: { ...x.review, status: decision, at: new Date().toISOString(), note } } : x)).filter((x) => status === "all" || x.review?.status === "pending") : cur));
      toast.success(decision === "approved" ? `Approved · ${item.title}` : `Rejected · ${item.title}`, { description: decision === "approved" ? "Now trusted for downstream automation and exports." : "Excluded from automation; the record stays for the audit trail." });
      // Re-read the queue so the tab count and any records the decision cascaded to (duplicates, native records) stay exact.
      void load();
    } catch (e) { toast.error("Could not record the decision", { description: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const pendingCount = items?.filter((x) => x.review?.status === "pending").length ?? 0;
  const groups = React.useMemo(() => groupQueueByKind(items ?? []), [items]);

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">Needs review {pendingCount > 0 && <CountChip tone="warning">{pendingCount}</CountChip>}</h2>
          <p className="text-xs text-muted-foreground">AI-produced records below the confidence gate, contradicted by their sources, or not source-backed. A human decision here is what lets them be relied on downstream.</p>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md border p-0.5 text-[11px]">
            <button type="button" onClick={() => setStatus("pending")} className={cn("h-6 rounded px-2 cursor-pointer", status === "pending" ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>Pending</button>
            <button type="button" onClick={() => setStatus("all")} className={cn("h-6 rounded px-2 cursor-pointer", status === "all" ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>All</button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Refresh queue">{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button>
        </div>
      </div>

      {loading && !items ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : missing ? (
        <EmptyState icon={ShieldCheck} title="Review queue is not available" description="The integrity review endpoint is not deployed in this environment. AI records still carry provenance; decisions can be recorded once /api/integrity/review is available." />
      ) : error ? (
        <EmptyState icon={ShieldAlert} title="Could not load the review queue" description={error} action={<Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>} />
      ) : !items?.length ? (
        <EmptyState icon={ShieldCheck} title={status === "pending" ? "Nothing waiting for review" : "No AI records recorded yet"} description={status === "pending" ? "Every AI-produced record in this matter is either verified against its sources or has a human decision." : "Records appear here as AI analyses, digests, timeline events and conflicts are generated."} />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.kind}>
              <div className="mb-1.5 flex items-center gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}<CountChip>{g.items.length}</CountChip></div>
              <ul className="divide-y rounded-md border bg-card">
                {g.items.map((it) => <QueueRow key={`${it.kind}:${it.id}`} item={it} busy={busy === `${it.kind}:${it.id}`} onDecide={decide} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function QueueRow({ item, busy, onDecide }: { item: ReviewQueueItem; busy: boolean; onDecide: (item: ReviewQueueItem, decision: "approved" | "rejected", note?: string) => void }) {
  const [note, setNote] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const decided = item.review?.status && item.review.status !== "pending";
  // TrustBadge reads the same shape the sidecar provides: compose a minimal Provenance for it.
  const provenance = { model: item.model, generatedAt: item.generatedAt, sources: Array.from({ length: item.sources }, () => ({ kind: "internal" as const })), confidence: item.confidence, verification: item.verification, review: item.review, surface: item.surface };
  return (
    <li className={cn("px-3 py-2.5", decided && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.href ? <Link href={item.href} className="truncate text-[13px] font-medium hover:underline underline-offset-2">{item.title}</Link> : <span className="truncate text-[13px] font-medium">{item.title}</span>}
            <TrustBadge provenance={provenance} compact />
            {item.href && <Link href={item.href} className="text-muted-foreground hover:text-foreground" aria-label="Open record"><ExternalLink className="size-3" /></Link>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{queueReason(item)}</span>
            <span aria-hidden>·</span>
            <span>{item.model}</span>
            <span aria-hidden>·</span>
            <RelativeTime value={item.generatedAt} />
            {item.confidence != null && <Chip tone="muted" className="h-4">{Math.round(item.confidence * 100)}%</Chip>}
            {item.verification && <span className="tabular">{item.verification.supported} supported · {item.verification.unsupported} unsupported · {item.verification.contradicted} contradicted</span>}
          </div>
          {decided && <div className="mt-1 text-[11px] text-muted-foreground">{item.review.status === "approved" ? "Approved" : "Rejected"}{item.review.by ? ` by ${item.review.by}` : ""}{item.review.note ? ` — ${item.review.note}` : ""}</div>}
          {open && !decided && <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the audit log (why approved or rejected)" rows={2} className="mt-2 min-h-0 text-xs" />}
        </div>
        {!decided && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="xs" variant="ghost" onClick={() => setOpen((v) => !v)} aria-pressed={open}>Note</Button>
            <Button size="xs" variant="outline" onClick={() => onDecide(item, "rejected", note)} disabled={busy}><X className="size-3.5" /> Reject</Button>
            <Button size="xs" variant="success" onClick={() => onDecide(item, "approved", note)} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve</Button>
          </div>
        )}
      </div>
    </li>
  );
}
