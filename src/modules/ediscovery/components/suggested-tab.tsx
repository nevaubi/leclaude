"use client";
import * as React from "react";
import { Loader2, RefreshCw, FileSignature, ClipboardCopy, AlertTriangle, ShieldAlert, ShieldCheck, Eye, ListChecks, Check, CircleSlash, Quote } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScoreBar } from "@/components/ui/progress";
import type { CodingDecision } from "@/lib/types/domain";
import type { Provenance } from "@/lib/integrity/types";
import { Tip } from "@/components/ui/tooltip";
import type { AIAnalysis } from "../types";
import { useReview } from "./review-page";
import { useReviewStore } from "./store";
import { ApiError, api, type DocDetailResponse } from "./use-review-data";
import { IssueChip, NoKeyCallout, ProvenanceBadge, StateChip } from "./shared";

/** POST /api/ediscovery/docs/[id]/apply-suggestion → the gate decides whether the suggestion becomes the coding. */
export interface ApplySuggestionResult { applied: boolean; needsReview: boolean; reason?: string; doc: { id: string; coding: CodingDecision; aiProvenance: Provenance | null } }

/**
 * "Suggested" tab: the model's coding suggestion with its rationale, verified
 * quotes (each checked against the text; click jumps to it) and trust state.
 * Nothing is coded here without a reviewer action: Apply goes through the
 * trust gate, Copy fills the coding panel for the reviewer to save.
 */
export function SuggestedTab({ detail, analysis, onAnalysis, onApply, onApplied }: { detail: DocDetailResponse; analysis: AIAnalysis | null; onAnalysis: (a: AIAnalysis) => void; onApply: (patch: Partial<CodingDecision>) => void; onApplied?: (coding: CodingDecision, aiProvenance?: Provenance | null) => void }) {
  const { aiConfigured, issueCodes, currentUserId } = useReview();
  const setJumpTo = useReviewStore((s) => s.setJumpTo);
  const { doc } = detail;
  const [running, setRunning] = React.useState(false);
  const [noKey, setNoKey] = React.useState(!aiConfigured);
  const [privDraft, setPrivDraft] = React.useState<{ description: string; ai: boolean } | null>(null);
  const [privRunning, setPrivRunning] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [gate, setGate] = React.useState<{ reason?: string } | null>(null);

  const run = async (force = false) => {
    setRunning(true);
    try {
      const r = await api<{ analysis: AIAnalysis }>(`/api/ediscovery/docs/${encodeURIComponent(doc.id)}/analyze`, { method: "POST", json: { force } });
      onAnalysis(r.analysis);
      setNoKey(false);
      toast.success("Suggestion ready", { description: `${doc.bates} · ${r.analysis.model}` });
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_api_key") setNoKey(true);
      else toast.error("Could not suggest coding", { description: (e as Error).message });
    } finally { setRunning(false); }
  };

  const draftPriv = async () => {
    setPrivRunning(true);
    try {
      const r = await api<{ description: string; ai: boolean }>(`/api/ediscovery/docs/${encodeURIComponent(doc.id)}/privilege-description`, { method: "POST", json: { save: false } });
      setPrivDraft(r);
    } catch (e) { toast.error("Could not draft description", { description: (e as Error).message }); }
    finally { setPrivRunning(false); }
  };

  /** Trusted suggestions become the coding and are audited; untrusted ones are held for review with a reason. `force` is the reviewer's override. */
  const applyGated = async (force = false) => {
    setApplying(true);
    try {
      const r = await api<ApplySuggestionResult>(`/api/ediscovery/docs/${encodeURIComponent(doc.id)}/apply-suggestion`, { method: "POST", json: { reviewerId: currentUserId, force } });
      if (r.applied) {
        setGate(null);
        onApplied?.(r.doc.coding, r.doc.aiProvenance);
        toast.success(force ? "Suggestion applied (reviewer override)" : "Suggestion applied", { description: `${doc.bates} coded from the suggestion${r.reason ? ` · ${r.reason}` : ""}.` });
      } else {
        setGate({ reason: r.reason });
        toast.warning("Held for review", { description: r.reason ?? "The suggestion did not pass the trust gate.", action: { label: "Apply anyway", onClick: () => void applyGated(true) } });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_api_key") setNoKey(true);
      else toast.error("Could not apply the suggestion", { description: (e as Error).message });
    } finally { setApplying(false); }
  };

  const copyToPanel = () => {
    if (!analysis) return;
    const s = analysis.suggestedCoding;
    onApply({ responsive: s.responsive, privileged: s.privileged, privilegeBasis: s.privileged ? (s.privilegeBasis ?? "attorney-client") : undefined, hot: s.hot, issues: Array.from(new Set([...(doc.coding.issues ?? []), ...s.issues])) });
    toast.success("Copied to the coding panel", { description: "Review and press ⌘S to save." });
  };

  const quotes = analysis?.quotes ?? [];
  const verifiedQuotes = quotes.filter((q) => q.verified).length;

  return (
    <div className="h-full space-y-4 overflow-auto scrollbar-thin p-4">
      {noKey && <NoKeyCallout feature="Suggested coding, document summaries and privilege-log drafting" />}

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><ListChecks className="size-3.5" /> Suggested coding</h3>
          <div className="flex items-center gap-1.5">
            {analysis && <ProvenanceBadge record={analysis} compact={false} />}
            {analysis && <span className="text-[10.5px] text-muted-foreground">{new Date(analysis.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {analysis.model}</span>}
            <Button size="xs" variant={analysis ? "ghost" : "default"} onClick={() => run(!!analysis)} disabled={running}>{running ? <Loader2 className="size-3.5 animate-spin" /> : analysis ? <RefreshCw className="size-3.5" /> : null} {analysis ? "Re-run" : "Suggest coding"}</Button>
          </div>
        </div>
        {!analysis ? (
          doc.aiSummary ? (
            <div className="mt-2 rounded-md border bg-muted/30 p-3 text-[12.5px]">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">Seeded summary <ProvenanceBadge record={doc} /></div>
              <p className="leading-relaxed">{doc.aiSummary}</p>
              {doc.aiScore != null && <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted-foreground">Predicted responsiveness <ScoreBar value={doc.aiScore} /></div>}
              {doc.aiIssues?.length ? <div className="mt-2 flex flex-wrap gap-1">{doc.aiIssues.map((c) => <IssueChip key={c} code={c} codes={issueCodes} size="xs" />)}</div> : null}
              <p className="mt-2 text-[11px] text-muted-foreground">A score is a suggestion; it never codes the document. Run “Suggest coding” for a rationale with verified quotes.</p>
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">Suggests responsiveness, privilege, hot and issue codes against the matter protocol, with a rationale and verbatim quotes that are checked against the text. Results are cached on the document; nothing is coded until a reviewer applies it.</p>
          )
        ) : (
          <div className="mt-2 space-y-3">
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">Suggestion <ProvenanceBadge record={analysis} /></div>
                <div className="flex items-center gap-1">
                  <Tip label="Copy the suggestion into the coding panel without saving"><Button size="xs" variant="ghost" onClick={copyToPanel}><ClipboardCopy className="size-3.5" /> Copy to panel</Button></Tip>
                  <Tip label="Apply through the trust gate: verified, source-backed suggestions are saved and audited; others are held for review"><Button size="xs" onClick={() => applyGated(false)} disabled={applying}>{applying ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Apply</Button></Tip>
                </div>
              </div>
              {gate && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11.5px]" role="status">
                  <Eye className="mt-0.5 size-3.5 shrink-0 text-warning-foreground dark:text-warning" />
                  <div className="min-w-0 flex-1"><span className="font-semibold">Held for review.</span> {gate.reason ?? "The suggestion did not pass the trust gate."} It was written into the notes with a NEEDS REVIEW marker; a reviewer can still apply it.</div>
                  <Button size="xs" variant="outline" onClick={() => applyGated(true)} disabled={applying}>Apply anyway</Button>
                </div>
              )}
              <div className="mt-2 grid grid-cols-[100px_1fr] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
                <span className="text-[11.5px] text-muted-foreground">Responsive</span><span className="flex items-center gap-2"><Badge variant={analysis.suggestedCoding.responsive ? "success" : "muted"} size="sm">{analysis.suggestedCoding.responsive ? "Yes" : "No"}</Badge><ScoreBar value={analysis.suggestedCoding.responsiveConfidence} /><span className="text-[11px] text-muted-foreground">confidence</span></span>
                <span className="text-[11.5px] text-muted-foreground">Privileged</span><span className="flex items-center gap-2"><Badge variant={analysis.suggestedCoding.privileged ? "info" : "muted"} size="sm">{analysis.suggestedCoding.privileged ? (analysis.suggestedCoding.privilegeBasis ?? "yes") : "No"}</Badge><ScoreBar value={analysis.suggestedCoding.privilegedConfidence} /><span className="text-[11px] text-muted-foreground">confidence</span></span>
                <span className="text-[11.5px] text-muted-foreground">Hot</span><span><Badge variant={analysis.suggestedCoding.hot ? "destructive" : "muted"} size="sm">{analysis.suggestedCoding.hot ? "Hot" : "Not hot"}</Badge></span>
                <span className="text-[11.5px] text-muted-foreground">Issues</span><span className="flex flex-wrap gap-1">{analysis.suggestedCoding.issues.length ? analysis.suggestedCoding.issues.map((c) => <IssueChip key={c} code={c} codes={issueCodes} size="xs" />) : <span className="text-[11.5px] text-muted-foreground">none</span>}</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Rationale.</span> {analysis.suggestedCoding.rationale}</p>
              {analysis.privilegeRisk && analysis.privilegeRisk !== "None identified" && <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-warning-foreground dark:text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{analysis.privilegeRisk}</p>}
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Quote className="size-3" /> Supporting quotes{quotes.length ? <span className="normal-case tracking-normal">· {verifiedQuotes} of {quotes.length} found in the text</span> : null}</div>
              {!quotes.length ? <p className="text-[11.5px] text-muted-foreground">No quotes were recorded for this suggestion{analysis.generatedAt ? " (re-run to collect verified excerpts)" : ""}.</p> : (
                <ul className="divide-y rounded-md border">
                  {quotes.map((q, i) => (
                    <li key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-[12px]">
                      {q.verified ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Found in the document" /> : <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="Not found in the document" />}
                      <span className={cn("min-w-0 flex-1 font-serif leading-snug", !q.verified && "text-muted-foreground line-through decoration-destructive/50")}>“{q.text}”</span>
                      {q.verified && q.start != null && q.end != null ? <Button size="xs" variant="ghost" className="h-6 shrink-0 px-1.5 text-[11px]" onClick={() => setJumpTo(q.start!, q.end!)}>Show in text</Button> : <StateChip tone="destructive">not in document</StateChip>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="mb-1 text-[12px] font-medium text-muted-foreground">Summary</div>
              <p className="text-[12.5px] leading-relaxed">{analysis.summary}</p>
            </div>
            {analysis.keyIssues.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-medium text-muted-foreground">Key issues</div>
                <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">{analysis.keyIssues.map((k, i) => <li key={i}>{k}</li>)}</ul>
              </div>
            )}
            <div>
              <div className="mb-1 text-[12px] font-medium text-muted-foreground">Entities</div>
              <div className="space-y-1">
                {(["people", "orgs", "places", "chemicals"] as const).map((k) => analysis.entities[k]?.length ? <div key={k} className="flex flex-wrap items-baseline gap-1 text-[12px]"><span className="w-16 capitalize text-[11px] text-muted-foreground">{k}</span>{analysis.entities[k]!.map((e) => <Badge key={e} variant="outline" size="sm" className="font-normal">{e}</Badge>)}</div> : null)}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={cn("rounded-md border p-3", doc.coding.privileged ? "border-info/40 bg-info/5" : "")}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><ShieldAlert className="size-3.5" /> Privilege log</h3>
          <Button size="xs" variant="outline" onClick={draftPriv} disabled={privRunning}>{privRunning ? <Loader2 className="size-3.5 animate-spin" /> : <FileSignature className="size-3.5" />} Draft description</Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{aiConfigured ? "Drafts a Rule 26(b)(5) description that identifies author, recipients and legal purpose without revealing the advice." : "Without an AI provider the description is built from a template using the coded basis, author and recipients."}</p>
        {privDraft && (
          <div className="mt-2 rounded-md border bg-background p-2.5 text-[12.5px]">
            <p className="leading-relaxed">{privDraft.description}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <StateChip tone="muted">{privDraft.ai ? "Drafted" : "Template"}</StateChip>
              <div className="flex-1" />
              <Button size="xs" variant="ghost" onClick={() => { navigator.clipboard.writeText(privDraft.description).then(() => toast.success("Copied")); }}><ClipboardCopy className="size-3.5" /> Copy</Button>
              <Button size="xs" variant="outline" onClick={() => { onApply({ notes: `${doc.coding.notes ? doc.coding.notes + "\n\n" : ""}Priv log: ${privDraft.description}` }); toast.success("Added to notes"); }}>Add to notes</Button>
              <Button size="xs" onClick={async () => { try { await api(`/api/ediscovery/docs/${encodeURIComponent(doc.id)}/privilege-description`, { method: "POST", json: { save: true } }); toast.success("Privilege log entry saved", { description: "See Codes & privilege → Privilege log." }); } catch (e) { toast.error("Could not save entry", { description: (e as Error).message }); } }} disabled={!doc.coding.privileged} title={doc.coding.privileged ? undefined : "Code the document privileged first"}>Save to log</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
