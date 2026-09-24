"use client";
import * as React from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Chip, EmptyState } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RelativeTime } from "@/components/ui/relative-time";
import { TrustBadge } from "@/components/ai/trust-badge";
import type { Provenance, ProvenanceReview, ProvenanceVerification } from "@/lib/integrity/types";

/** Row of GET /api/integrity/review (every field optional so older or partial responses still render). */
export interface ReviewQueueRow {
  kind: string;
  id: string;
  title?: string;
  href?: string;
  matterId?: string;
  surface?: string;
  confidence?: number;
  verification?: ProvenanceVerification;
  generatedAt?: string;
  model?: string;
  sources?: number;
  review?: ProvenanceReview;
  provenance?: Provenance;
}

export const KIND_LABEL: Record<string, string> = {
  "edoc.analysis": "Document analysis", "edoc.prediction": "Responsiveness prediction", "privilege.entry": "Privilege log entry",
  "timeline.event": "Timeline event", conflict: "Conflict", "fact-matrix": "Fact matrix", "knowledge-map": "Knowledge map",
  "deposition.digest": "Deposition digest", "deposition.outline": "Examination outline", "home.brief": "Daily brief",
  "workflow.step": "Workflow step", "office.proposal": "Drafting proposal", "library.summary": "Library summary", "library.autotag": "Auto-tags", "library.compare": "Clause comparison", research: "Research answer",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Provenance for the badge: the row's own record, else one synthesized from the summary fields. */
export function rowProvenance(r: ReviewQueueRow): Provenance | undefined {
  if (r.provenance && typeof r.provenance === "object" && Array.isArray(r.provenance.sources)) return r.provenance;
  if (r.model == null && r.generatedAt == null && r.confidence == null && !r.verification) return undefined;
  return {
    model: r.model ?? "unknown",
    generatedAt: r.generatedAt ?? new Date(0).toISOString(),
    sources: Array.from({ length: Math.max(0, r.sources ?? 0) }, () => ({ kind: "internal" as const })),
    confidence: r.confidence,
    verification: r.verification,
    review: r.review ?? { status: "pending" },
    surface: r.surface ?? r.kind,
  };
}

/** Group rows by kind, most rows first, stable inside a group. */
export function groupByKind(rows: ReviewQueueRow[]): { kind: string; label: string; rows: ReviewQueueRow[] }[] {
  const by = new Map<string, ReviewQueueRow[]>();
  for (const r of rows) by.set(r.kind, [...(by.get(r.kind) ?? []), r]);
  return Array.from(by.entries()).map(([kind, list]) => ({ kind, label: kindLabel(kind), rows: list })).sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
}

/** Why a row is in the queue, in one line. */
export function pendingReason(r: ReviewQueueRow): string {
  if (r.review?.note) return r.review.note;
  if (r.verification?.status === "contradicted") return `${r.verification.contradicted} claim(s) contradicted by the sources`;
  if (r.confidence != null && r.confidence < 0.6) return `Confidence ${(r.confidence * 100).toFixed(0)}% is below the gate`;
  if (r.verification?.status === "unverified" && !(r.sources ?? 0)) return "Not source-backed";
  return "Awaiting human review";
}

type Decision = "approved" | "rejected";

/**
 * Human review queue for AI-produced records. Reads GET /api/integrity/review
 * (optionally per matter) and posts Approve / Reject decisions with a note.
 * Renders an explicit empty state when the endpoint is missing.
 */
export function ReviewQueue({ matterId, className, compact, onCountChange }: { matterId?: string; className?: string; compact?: boolean; onCountChange?: (n: number) => void }) {
  const [rows, setRows] = React.useState<ReviewQueueRow[] | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Record<string, Decision>>({});

  const load = React.useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/integrity/review?status=pending&limit=200${matterId ? `&matter=${encodeURIComponent(matterId)}` : ""}`, { cache: "no-store" });
      if (res.status === 404) { setState("missing"); setRows([]); return; }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { items?: ReviewQueueRow[] };
      const items = Array.isArray(j.items) ? j.items.filter((r) => r && r.kind && r.id) : [];
      setRows(items);
      setDone({});
      setState("ready");
      onCountChange?.(items.length);
    } catch (e) { setError((e as Error).message); setState("error"); }
  }, [matterId, onCountChange]);
  React.useEffect(() => { void load(); }, [load]);

  const decide = async (r: ReviewQueueRow, decision: Decision, note?: string) => {
    const key = `${r.kind}:${r.id}`;
    setBusy(key);
    try {
      const res = await fetch("/api/integrity/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, kind: r.kind, decision, status: decision, note: note?.trim() || undefined }) });
      const j = (await res.json().catch(() => ({}))) as { results?: { ok: boolean; message?: string }[]; error?: string };
      const result = j.results?.[0];
      if (!res.ok && !result) throw new Error(j.error ?? `${res.status} ${res.statusText}`);
      if (result && !result.ok) throw new Error(result.message ?? "Decision was not recorded");
      setDone((d) => ({ ...d, [key]: decision }));
      setRows((list) => { const next = (list ?? []).filter((x) => `${x.kind}:${x.id}` !== key); onCountChange?.(next.length); return next; });
      toast.success(decision === "approved" ? "Approved" : "Rejected", { description: `${kindLabel(r.kind)} · ${r.title ?? r.id}` });
    } catch (e) { toast.error("Could not record the decision", { description: (e as Error).message }); }
    finally { setBusy(null); }
  };

  if (state === "loading" && !rows) return <div className={cn("space-y-2", className)}>{Array.from({ length: compact ? 3 : 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (state === "missing") return <EmptyState compact={compact} icon={ShieldCheck} title="Review queue not available" description="The integrity review endpoint is not enabled on this server, so there is nothing to approve here." className={className} />;
  if (state === "error") return <EmptyState compact={compact} icon={ShieldAlert} title="Could not load the review queue" description={error ?? undefined} action={<Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="size-3.5" /> Retry</Button>} className={className} />;
  const list = rows ?? [];
  if (!list.length) return <EmptyState compact={compact} icon={ShieldCheck} title="Nothing needs review" description={matterId ? "Every AI-produced record on this matter is verified, source-backed or already decided." : "Every AI-produced record is verified, source-backed or already decided."} action={<Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="size-3.5" /> Refresh</Button>} className={className} />;

  const groups = groupByKind(list);
  return (
    <div className={cn("space-y-4", className)}>
      {groups.map((g) => (
        <section key={g.kind}>
          <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><span>{g.label}</span><span className="section-count">{g.rows.length}</span></div>
          <ul className="divide-y rounded-md border bg-card">
            {g.rows.map((r) => {
              const key = `${r.kind}:${r.id}`;
              return (
                <li key={key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm", done[key] && "opacity-50")}>
                  <TrustBadge provenance={rowProvenance(r)} compact />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {r.href ? <Link href={r.href} className="truncate font-medium hover:underline underline-offset-2">{r.title ?? r.id}</Link> : <span className="truncate font-medium">{r.title ?? r.id}</span>}
                      {r.href && <ExternalLink className="size-3 shrink-0 text-muted-foreground" />}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{pendingReason(r)}</span>
                      {r.confidence != null && <Chip tone="quiet" className="tabular">{(r.confidence * 100).toFixed(0)}%</Chip>}
                      {r.verification && <span className="tabular">{r.verification.supported} supported · {r.verification.unsupported} unsupported</span>}
                      {r.sources != null && <span className="tabular">{r.sources} source{r.sources === 1 ? "" : "s"}</span>}
                      {r.model && <span>{r.model}</span>}
                      {r.generatedAt && <RelativeTime value={r.generatedAt} />}
                    </div>
                  </div>
                  <DecisionButtons busy={busy === key} onDecide={(d, note) => void decide(r, d, note)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DecisionButtons({ busy, onDecide }: { busy: boolean; onDecide: (d: Decision, note?: string) => void }) {
  const [note, setNote] = React.useState("");
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button size="xs" variant="success" onClick={() => onDecide("approved", note)} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve</Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button size="xs" variant="outline" disabled={busy}><X className="size-3.5" /> Reject</Button></PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-2 p-3">
          <div className="text-xs font-medium">Reject this record</div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional) — kept in the audit log" rows={2} className="min-h-0 text-xs" />
          <div className="flex justify-end gap-1.5"><Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button size="xs" variant="destructive" onClick={() => { setOpen(false); onDecide("rejected", note); }}>Reject</Button></div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Lightweight pending count for tab badges (null while loading or when the endpoint is missing). */
export function useReviewCount(matterId?: string) {
  const [count, setCount] = React.useState<number | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    fetch(`/api/integrity/review?status=pending&limit=1${matterId ? `&matter=${encodeURIComponent(matterId)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setCount(j?.counts?.pending != null ? Number(j.counts.pending) : Array.isArray(j?.items) ? j.items.length : null); })
      .catch(() => { if (alive) setCount(null); });
    return () => { alive = false; };
  }, [matterId, tick]);
  return { count, refresh: () => setTick((t) => t + 1) };
}
