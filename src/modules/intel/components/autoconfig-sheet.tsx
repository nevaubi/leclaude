"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Play, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AutoconfigRequest, AutoconfigState, MatterIntelPlan, SourceChange } from "../autoconfig-types";
import { changeIsEffective, changesForMatter, planItems } from "./coverage-models";
import { OriginChip } from "./coverage-parts";

type DryRun =
  | { kind: "loading" }
  | { kind: "ready"; plans: MatterIntelPlan[]; changes: SourceChange[] }
  | { kind: "unavailable" }
  | { kind: "denied" }
  | { kind: "error"; message: string };

interface ApplyResult { state: AutoconfigState; plans: MatterIntelPlan[]; changes: SourceChange[]; jobs: { id: string; sourceId: string }[] }

async function postAutoconfig(body: AutoconfigRequest): Promise<{ status: number; json: (ApplyResult & { error?: string }) | null }> {
  const res = await fetch("/api/intel/autoconfigure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (ApplyResult & { error?: string }) | null;
  return { status: res.status, json };
}

/**
 * "Set up from matters": a dry run shows, per matter, what each source would search and what changes, then
 * Apply & run writes the configuration and starts the runs. Sources that need a provider key say so and stay off.
 */
export function AutoconfigSheet({ open, onOpenChange, onApplied }: { open: boolean; onOpenChange: (v: boolean) => void; onApplied: (r: ApplyResult) => void }) {
  const [dry, setDry] = React.useState<DryRun>({ kind: "loading" });
  const [applying, setApplying] = React.useState(false);
  const [runNow, setRunNow] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDry({ kind: "loading" });
    postAutoconfig({ dryRun: true })
      .then(({ status, json }) => {
        if (cancelled) return;
        if (status === 404 || status === 405) setDry({ kind: "unavailable" });
        else if (status === 401 || status === 403) setDry({ kind: "denied" });
        else if (status >= 400 || !json) setDry({ kind: "error", message: json?.error ?? `${status}` });
        else setDry({ kind: "ready", plans: json.plans ?? json.state?.plans ?? [], changes: json.changes ?? json.state?.changes ?? [] });
      })
      .catch((e) => { if (!cancelled) setDry({ kind: "error", message: (e as Error).message }); });
    return () => { cancelled = true; };
  }, [open, attempt]);

  const apply = async () => {
    setApplying(true);
    try {
      const { status, json } = await postAutoconfig({ run: runNow });
      if (status === 403) throw new Error("You do not have permission to change intelligence sources");
      if (status >= 400 || !json) throw new Error(json?.error ?? `${status}`);
      const changed = (json.changes ?? []).filter(changeIsEffective).length;
      toast.success("Sources configured from matters", { description: `${changed} source${changed === 1 ? "" : "s"} changed${runNow ? ` · ${json.jobs?.length ?? 0} run${(json.jobs?.length ?? 0) === 1 ? "" : "s"} started` : ""}` });
      onApplied(json);
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not apply the plan", { description: (e as Error).message });
    } finally { setApplying(false); }
  };

  const effective = dry.kind === "ready" ? dry.changes.filter(changeIsEffective) : [];
  const skipped = dry.kind === "ready" ? dry.changes.filter((c) => c.skippedReason) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-2xl" aria-describedby="autoconfig-desc">
        <SheetHeader className="px-4 py-3">
          <SheetTitle className="text-[14px]">Set up sources from matters</SheetTitle>
          <SheetDescription id="autoconfig-desc" className="text-[12px]">Dry run: nothing changes until you apply. Dockets, judges and courts come from the matter record; search wording marked “suggested” was proposed and should be checked.</SheetDescription>
        </SheetHeader>
        <SheetBody className="px-4 py-3 text-[12.5px]">
          {dry.kind === "loading" && (
            <div className="space-y-3" role="status" aria-label="Building the plan">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading matters and building the plan…</div>
              {[0, 1, 2].map((i) => <div key={i} className="space-y-1.5"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" /></div>)}
            </div>
          )}
          {dry.kind === "unavailable" && <p className="text-muted-foreground">Setting up sources from matters is not available in this deployment yet. Sources can still be configured under <Link href="/settings#sources" className="text-primary hover:underline">Settings → Data &amp; automation</Link>.</p>}
          {dry.kind === "denied" && <p className="text-muted-foreground">You do not have permission to configure intelligence sources. Ask a partner or administrator.</p>}
          {dry.kind === "error" && (
            <div className="flex items-start gap-2 text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><div><p>The plan could not be built: {dry.message}</p><Button size="xs" variant="outline" className="mt-2" onClick={() => setAttempt((n) => n + 1)}><RotateCw className="size-3.5" />Try again</Button></div></div>
          )}
          {dry.kind === "ready" && dry.plans.length === 0 && <p className="text-muted-foreground">No active matters to plan for. Matters you can access appear here once they are open.</p>}
          {dry.kind === "ready" && dry.plans.length > 0 && (
            <div className="space-y-5">
              <p className="text-[12px] text-muted-foreground">
                <span className="tabular">{dry.plans.length}</span> matter{dry.plans.length === 1 ? "" : "s"} · <span className="tabular">{effective.length}</span> source{effective.length === 1 ? "" : "s"} would change
                {skipped.length > 0 && <> · <span className="text-warning-foreground dark:text-warning"><span className="tabular">{skipped.length}</span> stay off</span></>}
              </p>
              {dry.plans.map((plan) => <PlanBlock key={plan.matterId} plan={plan} changes={changesForMatter(dry.changes, plan.matterId)} />)}
              {skipped.length > 0 && (
                <div className="rounded-md border border-line-quiet p-2.5 text-[12px]">
                  <div className="mb-1 font-medium">Stays off</div>
                  <ul className="space-y-0.5">{skipped.map((c) => <li key={c.sourceId} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{c.name}</span><span className="text-warning-foreground dark:text-warning">{c.skippedReason}</span></li>)}</ul>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Provider keys go in the server environment; see <Link href="/settings#research" className="text-primary hover:underline">Research providers</Link>.</p>
                </div>
              )}
            </div>
          )}
        </SheetBody>
        <SheetFooter className="px-4 py-2.5">
          <label className="mr-auto flex items-center gap-2 text-[12px] text-muted-foreground">
            <Checkbox size="sm" checked={runNow} onCheckedChange={(v) => setRunNow(v === true)} disabled={dry.kind !== "ready"} />Start runs now
          </label>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void apply()} disabled={dry.kind !== "ready" || dry.plans.length === 0 || applying}>
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}{runNow ? "Apply & run" : "Apply"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PlanBlock({ plan, changes }: { plan: MatterIntelPlan; changes: SourceChange[] }) {
  const items = planItems(plan);
  return (
    <section className="min-w-0">
      <div className="flex items-baseline gap-2 border-b border-line-quiet pb-1">
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" title={plan.matterName}>{plan.matterName}</h3>
        <span className="shrink-0 text-[11px] text-muted-foreground">{plan.method === "model" ? "Record facts + suggested wording" : "Record facts only (no model key)"}</span>
      </div>
      {items.length === 0 ? <p className="py-1.5 text-[12px] text-muted-foreground">The matter record names no docket, judge, court or product; nothing to search yet.</p> : (
        <ul className="divide-hairline">
          {items.map((it, i) => (
            <li key={`${it.category}-${i}`} className="flex min-h-7 items-center gap-2 py-0.5">
              <span className="w-[72px] shrink-0 text-[11px] text-muted-foreground">{it.category}</span>
              <span className="min-w-0 flex-1 truncate" title={it.text}>{it.text}</span>
              <OriginChip origin={it.origin} />
            </li>
          ))}
        </ul>
      )}
      {changes.length > 0 && (
        <div className="mt-2">
          <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">Changes</div>
          <ul className="space-y-0.5 text-[12px]">
            {changes.map((c) => (
              <li key={c.sourceId} className="flex min-w-0 items-baseline gap-2">
                <span className="w-[200px] shrink-0 truncate" title={c.name}>{c.name}</span>
                <span className={cn("min-w-0 flex-1 truncate", c.skippedReason ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
                  {c.skippedReason ? `Stays off: ${c.skippedReason}` : [!c.enabledBefore && c.enabledAfter ? "turn on" : null, ...c.added].filter(Boolean).join(" · ") || "no change"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.notes?.length ? <p className="mt-1.5 text-[11px] text-muted-foreground">{plan.notes.join(" ")}</p> : null}
    </section>
  );
}
