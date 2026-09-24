"use client";
import * as React from "react";
import { Sparkles, Loader2, Square, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readSSE } from "@/lib/ai/sse";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress, ScoreBar } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { PredictProgressEvent } from "../types";
import { useReview } from "./review-page";
import { useReviewStore } from "./store";
import { NoKeyCallout } from "./shared";

type Scope = "unscored" | "all_unreviewed" | "selected";

export function PredictDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { matterId, aiConfigured, refreshStats, refreshList } = useReview();
  const selected = useReviewStore((s) => s.selected);
  const [scope, setScope] = React.useState<Scope>("unscored");
  const [state, setState] = React.useState<{ status: "idle" | "running" | "done" | "error"; done: number; total: number; scored: number; feed: PredictProgressEvent[]; summary?: PredictProgressEvent["summary"]; error?: string; noKey?: boolean }>({ status: "idle", done: 0, total: 0, scored: 0, feed: [] });
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => { if (open) setState({ status: "idle", done: 0, total: 0, scored: 0, feed: [], noKey: !aiConfigured }); }, [open, aiConfigured]);
  React.useEffect(() => { if (selected.length && open) setScope("selected"); }, [selected.length, open]);

  const start = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState((s) => ({ ...s, status: "running", feed: [], done: 0, scored: 0, summary: undefined, error: undefined }));
    try {
      const res = await fetch("/api/ediscovery/batch/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matterId, ids: scope === "selected" ? selected : undefined, force: scope !== "unscored" }), signal: ctrl.signal });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string }; throw Object.assign(new Error(j.error ?? res.statusText), { code: j.code }); }
      await readSSE<PredictProgressEvent>(res, (ev) => {
        setState((s) => {
          if (ev.type === "start") return { ...s, total: ev.total ?? 0 };
          if (ev.type === "doc") return { ...s, done: ev.done ?? s.done, scored: ev.scored ?? s.scored, feed: [ev, ...s.feed].slice(0, 12) };
          if (ev.type === "progress") return { ...s, done: ev.done ?? s.done, scored: ev.scored ?? s.scored };
          if (ev.type === "done") return { ...s, status: "done", done: ev.done ?? s.done, scored: ev.scored ?? s.scored, summary: ev.summary };
          if (ev.type === "error") return { ...s, status: "error", error: ev.message, noKey: ev.code === "no_api_key" };
          return s;
        });
      }, ctrl.signal);
      setState((s) => (s.status === "running" ? { ...s, status: "done" } : s));
      refreshStats();
      refreshList();
    } catch (e) {
      if ((e as Error).name === "AbortError") { setState((s) => ({ ...s, status: "done" })); refreshStats(); refreshList(); return; }
      const err = e as Error & { code?: string };
      setState((s) => ({ ...s, status: "error", error: err.message, noKey: err.code === "no_api_key" }));
      if (err.code !== "no_api_key") toast.error("Prediction failed", { description: err.message });
    }
  };

  const stop = () => abortRef.current?.abort();
  const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && state.status === "running") stop(); onOpenChange(v); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-chart-3" /> Batch AI prediction</DialogTitle>
          <DialogDescription>Scores documents for responsiveness (0–100) against this matter&apos;s coding protocol and issue-code rubric, ten documents per call on the fast model. Scores feed the AI score column, the &ldquo;AI: likely responsive&rdquo; view and the score facets.</DialogDescription>
        </DialogHeader>
        {state.noKey && <NoKeyCallout feature="Batch prediction and document analysis" />}
        {state.status === "idle" && (
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="gap-2">
            {([
              ["unscored", "Unreviewed documents without a score", "Only documents with no responsiveness decision and no AI score."],
              ["all_unreviewed", "All unreviewed documents (re-score)", "Re-scores everything that still needs review."],
              ["selected", `Selected documents (${selected.length})`, "Scores the current selection, coded or not."],
            ] as [Scope, string, string][]).map(([v, label, hint]) => (
              <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent/50", scope === v && "border-primary/40 bg-primary/5", v === "selected" && !selected.length && "pointer-events-none opacity-50")}>
                <RadioGroupItem value={v} id={`scope-${v}`} className="mt-0.5" disabled={v === "selected" && !selected.length} />
                <span><Label htmlFor={`scope-${v}`} className="cursor-pointer text-sm">{label}</Label><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
          </RadioGroup>
        )}
        {state.status !== "idle" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Progress value={pct} className="h-2 flex-1" />
              <span className="tabular text-xs text-muted-foreground">{state.done} / {state.total}</span>
              {state.status === "running" ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : state.status === "done" ? <CheckCircle2 className="size-4 text-success" /> : null}
            </div>
            {state.summary && (
              <div className="grid grid-cols-4 gap-2 text-center">
                {([["Scored", state.summary.scored], ["Likely responsive", state.summary.likelyResponsive], ["Uncertain", state.summary.uncertain], ["Likely non-resp.", state.summary.likelyNonResponsive]] as [string, number][]).map(([k, v]) => (
                  <div key={k} className="rounded-md border bg-card p-2"><div className="tabular text-lg font-semibold">{v}</div><div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{k}</div></div>
                ))}
                <div className="col-span-4 text-right text-[11px] text-muted-foreground">{(state.summary.tookMs / 1000).toFixed(1)}s</div>
              </div>
            )}
            {state.feed.length > 0 && (
              <ul className="max-h-56 divide-y overflow-auto rounded-md border text-xs scrollbar-thin">
                {state.feed.map((f) => (
                  <li key={f.docId} className="flex items-center gap-2 px-2.5 py-1.5 animate-fade-in">
                    <span className="w-24 shrink-0 font-mono tabular">{f.bates}</span>
                    <ScoreBar value={f.aiScore ?? 0} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {state.status === "error" && !state.noKey && <p className="text-sm text-destructive">{state.error}</p>}
            {state.status === "done" && state.total === 0 && <p className="text-sm text-muted-foreground">Nothing to score in this scope.</p>}
          </div>
        )}
        <DialogFooter>
          {state.status === "running" ? (
            <Button variant="outline" onClick={stop}><Square className="size-3.5" /> Stop</Button>
          ) : state.status === "idle" ? (
            <><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={start} disabled={!aiConfigured && state.noKey}><Sparkles className="size-4" /> Start prediction</Button></>
          ) : (
            <><Button variant="ghost" onClick={() => setState({ status: "idle", done: 0, total: 0, scored: 0, feed: [], noKey: !aiConfigured })}>Run again</Button><Button onClick={() => onOpenChange(false)}>Close</Button></>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
