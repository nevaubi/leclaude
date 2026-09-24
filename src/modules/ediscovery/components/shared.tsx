"use client";
import * as React from "react";
import Link from "next/link";
import { Mail, FileText, FileBarChart2, Presentation, Table2, FileSignature, ScrollText, MessageSquare, StickyNote, Image as ImageIcon, FileAudio2, File, KeyRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { CodingDecision, DocType, IssueCode } from "@/lib/types/domain";
import { TrustBadge } from "@/components/ai/trust-badge";
import { provenanceOf } from "./provenance-of";
import { suggestionCall } from "./review-helpers";

export const TYPE_ICONS: Record<DocType, LucideIcon> = {
  Email: Mail, Memo: FileText, Report: FileBarChart2, Presentation: Presentation, Spreadsheet: Table2, Letter: FileSignature, Contract: ScrollText, Chat: MessageSquare, Note: StickyNote, Image: ImageIcon, Transcript: FileAudio2, Other: File,
};

export function TypeIcon({ type, className }: { type: DocType; className?: string }) {
  const Icon = TYPE_ICONS[type] ?? File;
  return <Icon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} aria-label={type} />;
}

/** Token-only colour classes for issue-code chips. */
export function issueColorClasses(color?: string): { dot: string; chip: string } {
  const map: Record<string, { dot: string; chip: string }> = {
    "chart-1": { dot: "bg-chart-1", chip: "bg-chart-1/12 text-chart-1 border-chart-1/30" },
    "chart-2": { dot: "bg-chart-2", chip: "bg-chart-2/12 text-chart-2 border-chart-2/30" },
    "chart-3": { dot: "bg-chart-3", chip: "bg-chart-3/15 text-chart-3 border-chart-3/30" },
    "chart-4": { dot: "bg-chart-4", chip: "bg-chart-4/12 text-chart-4 border-chart-4/30" },
    "chart-5": { dot: "bg-chart-5", chip: "bg-chart-5/12 text-chart-5 border-chart-5/30" },
    info: { dot: "bg-info", chip: "bg-info/12 text-info border-info/30" },
    warning: { dot: "bg-warning", chip: "bg-warning/18 text-warning-foreground dark:text-warning border-warning/40" },
    destructive: { dot: "bg-destructive", chip: "bg-destructive/12 text-destructive border-destructive/30" },
    success: { dot: "bg-success", chip: "bg-success/12 text-success border-success/30" },
    primary: { dot: "bg-primary", chip: "bg-primary/12 text-primary border-primary/30" },
  };
  return map[color ?? ""] ?? { dot: "bg-muted-foreground", chip: "bg-muted text-muted-foreground border-border" };
}

export function IssueChip({ code, codes, size = "sm", onRemove, className }: { code: string; codes?: IssueCode[]; size?: "xs" | "sm"; onRemove?: () => void; className?: string }) {
  const ic = codes?.find((c) => c.code === code);
  const cls = issueColorClasses(ic?.color);
  return (
    <span title={ic?.label ?? code} className={cn("inline-flex items-center gap-1 rounded border font-mono font-medium leading-none whitespace-nowrap", size === "xs" ? "px-1 py-[3px] text-[10px]" : "px-1.5 py-1 text-[11px]", cls.chip, className)}>
      <span className={cn("size-1.5 rounded-full", cls.dot)} />
      {code}
      {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="ml-0.5 rounded hover:bg-foreground/10 cursor-pointer" aria-label={`Remove ${code}`}>×</button>}
    </span>
  );
}

/** One-line decision summary ("Responsive · Privileged (WP) · Hot", or "Needs review"). */
export function decisionSummary(coding: CodingDecision): string {
  const parts: string[] = [];
  parts.push(coding.responsive === true ? "Responsive" : coding.responsive === false ? "Non-responsive" : "Needs review");
  if (coding.privileged === true) parts.push(`Privileged${coding.privilegeBasis ? ` (${{ "attorney-client": "AC", "work-product": "WP", "common-interest": "CI", "joint-defense": "JD" }[coding.privilegeBasis]})` : ""}`);
  if (coding.hot) parts.push("Hot");
  return parts.join(" · ");
}

const SLOT = "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] px-1 text-[10.5px] font-semibold leading-none tabular";

/**
 * Compact decision cell for grid rows: three fixed slots — R / NR / ? (responsiveness),
 * P (privileged), H (hot). Muted letters, tone only for the decision states so the
 * column reads at a glance without badge stacking. With `onChange` each slot is a
 * button: responsiveness cycles ? → R → NR → ?, privileged and hot toggle (inline coding).
 */
export function DecisionCell({ coding, className, onChange }: { coding: CodingDecision; className?: string; onChange?: (patch: Partial<CodingDecision>) => void }) {
  const resp = coding.responsive === true ? { t: "R", cls: "bg-success/12 text-success", label: "Responsive" } : coding.responsive === false ? { t: "NR", cls: "bg-muted text-muted-foreground", label: "Non-responsive" } : { t: "?", cls: "bg-warning/18 text-warning-foreground dark:text-warning", label: "Needs review" };
  const cycle = () => onChange?.({ responsive: coding.responsive == null ? true : coding.responsive ? false : null });
  const priv = () => onChange?.(coding.privileged ? { privileged: false, privilegeBasis: undefined } : { privileged: true, privilegeBasis: coding.privilegeBasis ?? "attorney-client" });
  const hot = () => onChange?.({ hot: !coding.hot });
  if (!onChange) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap", className)} title={decisionSummary(coding)} aria-label={decisionSummary(coding)}>
        <span className={cn(SLOT, resp.cls)}>{resp.t}</span>
        <span className={cn(SLOT, coding.privileged === true ? "bg-info/12 text-info" : "text-muted-foreground/35")}>P</span>
        <span className={cn(SLOT, coding.hot ? "bg-destructive/12 text-destructive" : "text-muted-foreground/35")}>H</span>
      </span>
    );
  }
  const btn = "cursor-pointer hover:ring-1 hover:ring-inset hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap", className)} role="group" aria-label={decisionSummary(coding)}>
      <Tip label={`${resp.label} · click to cycle (R / N keys)`}><button type="button" data-row-action onClick={(e) => { e.stopPropagation(); cycle(); }} className={cn(SLOT, btn, resp.cls)} aria-label={`Responsiveness: ${resp.label}`}>{resp.t}</button></Tip>
      <Tip label={coding.privileged ? "Privileged · click to clear (P)" : "Mark privileged (P)"}><button type="button" data-row-action onClick={(e) => { e.stopPropagation(); priv(); }} className={cn(SLOT, btn, coding.privileged === true ? "bg-info/12 text-info" : "text-muted-foreground/35")} aria-pressed={coding.privileged === true} aria-label="Privileged">P</button></Tip>
      <Tip label={coding.hot ? "Hot · click to clear (H)" : "Mark hot (H)"}><button type="button" data-row-action onClick={(e) => { e.stopPropagation(); hot(); }} className={cn(SLOT, btn, coding.hot ? "bg-destructive/12 text-destructive" : "text-muted-foreground/35")} aria-pressed={!!coding.hot} aria-label="Hot">H</button></Tip>
    </span>
  );
}

/** Coding badges: kept for existing call sites; renders the compact decision cell. */
export function CodingBadges({ coding, compact }: { coding: CodingDecision; compact?: boolean }) {
  if (compact) return <DecisionCell coding={coding} />;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px]"><DecisionCell coding={coding} /><span className="text-muted-foreground">{decisionSummary(coding)}</span></span>;
}

/**
 * "Suggested" cell: the call the AI score implies (R / NR / ?) with the score, quiet unless it
 * disagrees with the reviewer's call. Hover shows the rationale, confidence and trust state.
 */
export function SuggestedCell({ score, coding, rationale, confidence, record }: { score?: number | null; coding: CodingDecision; rationale?: string; confidence?: number; record?: unknown }) {
  const call = suggestionCall(score);
  if (!call || score == null) return <span className="text-[11px] text-muted-foreground/60">—</span>;
  const agrees = coding.responsive == null || call === "?" ? null : (call === "R") === coding.responsive;
  const provenance = provenanceOf(record);
  const tip = (
    <div className="max-w-[320px] space-y-1 text-[11px]">
      <div className="font-medium">Suggested {call === "R" ? "responsive" : call === "NR" ? "non-responsive" : "uncertain"} · score {score}{confidence != null && ` · confidence ${Math.round(confidence * 100)}%`}</div>
      {rationale ? <div className="leading-snug opacity-90">{rationale}</div> : <div className="opacity-70">No rationale recorded for this score.</div>}
      {agrees === false && <div className="opacity-90">Differs from the reviewer&apos;s call.</div>}
      {provenance?.review?.status === "pending" && <div className="opacity-90">Below the confidence gate — awaiting review.</div>}
      <div className="opacity-70">Suggestions never code a document; apply from the viewer.</div>
    </div>
  );
  return (
    <Tip label={tip}>
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap tabular text-[11.5px] cursor-help", agrees === false ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
        <span className="font-semibold">{call}</span>
        <span>{score}</span>
        {provenance && <TrustBadge provenance={provenance} compact className="h-4 px-0.5" />}
      </span>
    </Tip>
  );
}

export function NoKeyCallout({ feature = "AI features", compact }: { feature?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 text-sm", compact ? "p-2.5" : "p-3")}>
      <KeyRound className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">OpenAI key required</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{feature} run through the OpenAI Responses API. Add <code className="rounded bg-muted px-1 font-mono text-[11px]">OPENAI_API_KEY</code> to <code className="rounded bg-muted px-1 font-mono text-[11px]">.env.local</code> and restart.</div>
        <Button asChild variant="outline" size="xs" className="mt-2"><Link href="/settings#ai">Open settings</Link></Button>
      </div>
    </div>
  );
}

export function formatShortDate(iso: string) {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1 py-0.5 text-[10px]">{children}</kbd>;
}

export function SectionLabel({ children, className, action }: { children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between px-3 pt-3 pb-1", className)}>
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      {action}
    </div>
  );
}

/** Small status chip for batch / production / privilege-entry states (token tones only). */
export function StateChip({ tone = "muted", children, className }: { tone?: "muted" | "primary" | "success" | "warning" | "destructive" | "info"; children: React.ReactNode; className?: string }) {
  const tones = { muted: "border-border text-muted-foreground", primary: "border-primary/30 bg-primary/8 text-primary", success: "border-success/30 bg-success/10 text-success", warning: "border-warning/40 bg-warning/12 text-warning-foreground dark:text-warning", destructive: "border-destructive/30 bg-destructive/8 text-destructive", info: "border-info/30 bg-info/10 text-info" } as const;
  return <span className={cn("inline-flex h-[18px] items-center rounded-[var(--radius-chip)] border px-1.5 text-[10.5px] font-medium leading-none whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

/**
 * Defensive provenance badge: AI-produced records (timeline events, conflicts,
 * digests, fact-matrix rows, knowledge-map entries, suggested coding) render a
 * TrustBadge only when the record actually carries a `provenance` field. Records
 * from before the integrity layer, or hand-made ones, render nothing.
 */
export { provenanceOf };

export function ProvenanceBadge({ record, className, compact = true }: { record: unknown; className?: string; compact?: boolean }) {
  const p = provenanceOf(record);
  if (!p) return null;
  return <TrustBadge provenance={p} compact={compact} className={className} />;
}
