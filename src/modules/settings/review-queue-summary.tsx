"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Loader2, RefreshCw, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CountChip, EmptyState } from "@/components/ui/misc";
import type { ReviewQueueItem } from "@/lib/integrity/types";
import { isEndpointMissing, summarizeByMatter } from "@/modules/ediscovery/components/review-queue-helpers";

/**
 * Settings → Data & integrity → Review queue. Pending AI records grouped by
 * matter, each linking to that matter's "Needs review" section in E-Discovery.
 */
export function ReviewQueueSummary({ matters }: { matters: { id: string; shortName: string }[] }) {
  const [items, setItems] = React.useState<ReviewQueueItem[] | null>(null);
  const [state, setState] = React.useState<"loading" | "ok" | "missing" | "error">("loading");
  const load = React.useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/integrity/review?status=pending&limit=200", { cache: "no-store" });
      if (!res.ok) { setState(res.status === 404 || res.status === 405 ? "missing" : "error"); setItems([]); return; }
      const j = (await res.json()) as { items?: ReviewQueueItem[] };
      setItems(Array.isArray(j.items) ? j.items : []);
      setState("ok");
    } catch (e) { setState(isEndpointMissing(e) ? "missing" : "error"); setItems([]); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const nameOf = React.useCallback((id: string | undefined) => matters.find((m) => m.id === id)?.shortName, [matters]);
  const rows = React.useMemo(() => summarizeByMatter(items ?? [], nameOf), [items, nameOf]);
  const total = items?.length ?? 0;
  return (
    <Card id="review">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><ShieldQuestion className="size-4 text-primary" /> Review queue {total > 0 && <CountChip tone="warning">{total}</CountChip>}</CardTitle>
          <CardDescription>AI-produced records awaiting a human decision — below the confidence gate, contradicted by their sources, or not source-backed. Approve or reject them inside the matter.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={state === "loading"} aria-label="Refresh">{state === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</Button>
      </CardHeader>
      <CardContent>
        {state === "loading" && !items ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : state === "missing" ? (
          <EmptyState compact icon={ShieldCheck} title="Review endpoint not available" description="/api/integrity/review is not deployed in this environment." />
        ) : state === "error" ? (
          <EmptyState compact icon={ShieldQuestion} title="Could not load the review queue" action={<Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={ShieldCheck} title="Nothing waiting for review" description="Every AI record is verified or has a human decision." />
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.matterId ?? "firm"} className="flex items-center gap-3 px-3 py-2 text-sm">
                <CountChip tone="warning">{r.pending}</CountChip>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.matterName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{r.kinds.join(" · ")}</div>
                </div>
                {r.matterId ? (
                  <Button asChild size="xs" variant="outline"><Link href={`/ediscovery?matter=${encodeURIComponent(r.matterId)}&tab=codes&view=review`}>Open queue <ArrowRight className="size-3" /></Link></Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">firm-wide records</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
