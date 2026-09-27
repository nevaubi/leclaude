"use client";
import * as React from "react";
import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldX, Eye, BookOpen, FileSearch, Quote, Square, TimerOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { trustLabel } from "@/lib/integrity/provenance";
import type { Provenance } from "@/lib/integrity/types";
import { trustLabel as evidenceTrustLabel } from "@/lib/evidence/trust";
import type { TrustState } from "@/lib/evidence/types";
import { cn } from "@/lib/utils";

/**
 * Trust-state values the research and evidence surfaces show (constitution §23, §26, §34).
 * Artifact states come from the evidence contract; source states describe one source's
 * relationship to an answer; run states describe how a run ended. Each value maps to a
 * tone that never overstates certainty: only `verified` and `human_approved` are green.
 */
export type SourceStateValue = "found" | "snippet" | "read" | "source_backed" | "claim_checked" | "verified" | "contradicted";
export type RunStateValue = "partial" | "cancelled" | "coverage_incomplete" | "unresolved" | "stale";
export type TrustBadgeState = TrustState | SourceStateValue | RunStateValue;

type Tone = "success" | "warning" | "destructive" | "muted" | "info";

const STATE_META: Record<TrustBadgeState, { label: string; tone: Tone; icon: React.ComponentType<{ className?: string }>; hint: string }> = {
  generated: { label: "Generated", tone: "muted", icon: ShieldQuestion, hint: "Model output with no source linked to it yet." },
  source_linked: { label: "Source-linked", tone: "info", icon: BookOpen, hint: "Cites sources that were found or read; claims were not checked against them." },
  citation_checked: { label: "Citations checked", tone: "info", icon: ShieldQuestion, hint: "Citations were resolved against the sources read; propositions were not checked." },
  claim_checked: { label: "Claims checked", tone: "warning", icon: ShieldAlert, hint: "Claims were checked against the sources; not all are supported." },
  partially_supported: { label: "Partially supported", tone: "warning", icon: ShieldAlert, hint: "Some claims are supported by the sources read; others are not." },
  verified: { label: "Verified", tone: "success", icon: ShieldCheck, hint: "Every checked claim is supported by the text of a source read in this run." },
  human_approved: { label: "Reviewed", tone: "success", icon: ShieldCheck, hint: "A reviewer approved this exact version." },
  rejected: { label: "Rejected", tone: "destructive", icon: ShieldX, hint: "A reviewer rejected this version." },
  found: { label: "Found", tone: "muted", icon: FileSearch, hint: "Returned by a search; not opened and not cited." },
  snippet: { label: "Snippet", tone: "warning", icon: Quote, hint: "Only the search excerpt was seen; the full text was not read." },
  read: { label: "Read", tone: "info", icon: BookOpen, hint: "Full text was read in this run." },
  source_backed: { label: "Source-backed", tone: "info", icon: BookOpen, hint: "Read in full and cited; claims not individually checked against it." },
  contradicted: { label: "Contradicted", tone: "destructive", icon: ShieldX, hint: "The source's text contradicts a claim attributed to it." },
  partial: { label: "Partial", tone: "warning", icon: ShieldAlert, hint: "The run delivered part of what it set out to do." },
  cancelled: { label: "Stopped", tone: "muted", icon: Square, hint: "Stopped before the run finished." },
  coverage_incomplete: { label: "Coverage incomplete", tone: "warning", icon: ShieldAlert, hint: "Some claims still lack support when the run stopped." },
  unresolved: { label: "Unresolved", tone: "destructive", icon: ShieldX, hint: "No read source carries this citation." },
  stale: { label: "Stale", tone: "warning", icon: TimerOff, hint: "This verification is for an earlier version of the text." },
};

/** Badge for one explicit state value. Labels are fixed per state; `detail` adds context to the tooltip. */
export function TrustStateBadge({ state, detail, compact, className, size = "sm" }: { state: TrustBadgeState; detail?: React.ReactNode; compact?: boolean; className?: string; size?: "xs" | "sm" | "default" }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  const label = state in EVIDENCE_STATES ? evidenceTrustLabel(state as TrustState) : meta.label;
  return (
    <Tip label={<span className="block max-w-xs text-[11px]"><span className="font-medium">{label}.</span> {meta.hint}{detail ? <span className="block opacity-80">{detail}</span> : null}</span>}>
      <Badge variant={meta.tone} size={size} className={cn("gap-1 cursor-help", compact && "px-1", className)} data-trust-state={state}>
        <Icon className="size-3" />
        {!compact && label}
      </Badge>
    </Tip>
  );
}

const EVIDENCE_STATES: Record<TrustState, true> = { generated: true, source_linked: true, citation_checked: true, claim_checked: true, partially_supported: true, verified: true, human_approved: true, rejected: true };

export function trustStateTone(state: TrustBadgeState): Tone {
  return STATE_META[state].tone;
}

/**
 * Provenance/trust indicator for AI-generated records. Shows verification
 * state, confidence and the sources the output was grounded in. Render it
 * wherever a record carries `provenance` (timeline events, conflicts, digests,
 * knowledge maps, research answers, workflow outputs, coding suggestions).
 */
export function TrustBadge({ provenance, className, compact }: { provenance?: Provenance; className?: string; compact?: boolean }) {
  const { label, tone } = trustLabel(provenance);
  const Icon = tone === "success" ? ShieldCheck : tone === "warning" ? ShieldAlert : tone === "destructive" ? ShieldX : ShieldQuestion;
  const v = provenance?.verification;
  const tip = provenance ? (
    <div className="space-y-1 text-[11px]">
      <div className="font-medium">{label}{provenance.confidence != null && ` · confidence ${(provenance.confidence * 100).toFixed(0)}%`}</div>
      {v && <div>{v.supported} supported · {v.unsupported} unsupported · {v.contradicted} contradicted ({v.method})</div>}
      <div>{provenance.sources.length} source{provenance.sources.length === 1 ? "" : "s"} · {provenance.model} · {new Date(provenance.generatedAt).toLocaleString()}</div>
      {provenance.sources.slice(0, 4).map((s, i) => <div key={i} className="truncate opacity-80">· {s.cite ?? s.title ?? s.url ?? s.id}</div>)}
      {provenance.review?.status === "pending" && <div className="flex items-center gap-1"><Eye className="size-3" /> Awaiting human review</div>}
    </div>
  ) : "This item was not produced with recorded provenance.";
  return (
    <Tip label={tip}>
      <Badge variant={tone} size="sm" className={cn("gap-1 cursor-help", compact && "px-1", className)}>
        <Icon className="size-3" />
        {!compact && label}
      </Badge>
    </Tip>
  );
}

/** Banner for answers that were not grounded in retrieved sources (research, digests). */
export function NotSourceBackedBanner({ detail, className }: { detail?: string; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs", className)} role="status">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <div><span className="font-semibold">Not source-backed.</span> {detail ?? "Research returned nothing usable, so this answer states general practice rather than the record in this matter. Confirm every case-specific fact before relying on it."}</div>
    </div>
  );
}
