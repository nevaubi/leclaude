"use client";
import * as React from "react";
import { Eye, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import type { Provenance } from "@/lib/integrity/types";

/**
 * Client-safe trust indicator for research answers. Mirrors the shared
 * TrustBadge semantics; the shared component pulls `@/lib/integrity/provenance`
 * (node:crypto) into the client bundle, so the research page keeps a local
 * pure copy until that module is split (see sharedChangeRequests).
 */
const CONFIDENCE_GATE = 0.6;

export function trustLabelOf(p: Provenance | undefined): { label: string; tone: "success" | "warning" | "destructive" | "muted" } {
  if (!p) return { label: "Unverified", tone: "muted" };
  if (p.review?.status === "approved") return { label: "Reviewed", tone: "success" };
  if (p.review?.status === "rejected") return { label: "Rejected", tone: "destructive" };
  if (p.verification?.status === "contradicted") return { label: "Contradicted", tone: "destructive" };
  if (p.verification?.status === "verified") return { label: "Verified", tone: "success" };
  if (p.verification?.status === "partially-verified") return { label: "Partially verified", tone: "warning" };
  if (p.confidence != null && p.confidence < CONFIDENCE_GATE) return { label: "Needs review", tone: "warning" };
  return { label: p.sources.length ? "Source-backed" : "Not source-backed", tone: p.sources.length ? "success" : "warning" };
}

export function TrustChip({ provenance, className, compact }: { provenance?: Provenance; className?: string; compact?: boolean }) {
  const { label, tone } = trustLabelOf(provenance);
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
  ) : "This answer was not produced with recorded provenance.";
  return (
    <Tip label={tip}>
      <Badge variant={tone} className={cn("gap-1 cursor-help", compact && "px-1.5 py-0", className)}>
        <Icon className="size-3" />
        {!compact && label}
      </Badge>
    </Tip>
  );
}

/** Banner for answers that were not grounded in retrieved sources (same copy as the shared component). */
export function NotSourceBackedBanner({ detail, className }: { detail?: string; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 font-sans text-xs", className)} role="status">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <div><span className="font-semibold">Not source-backed.</span> {detail ?? "Research returned nothing usable, so this answer states general practice rather than the record in this matter. Confirm every case-specific fact before relying on it."}</div>
    </div>
  );
}
