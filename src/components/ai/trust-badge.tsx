"use client";
import * as React from "react";
import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldX, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { trustLabel } from "@/lib/integrity/provenance";
import type { Provenance } from "@/lib/integrity/types";
import { cn } from "@/lib/utils";

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
