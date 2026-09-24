"use client";
import * as React from "react";
import Link from "next/link";
import { Mail, FileText, FileBarChart2, Presentation, Table2, FileSignature, ScrollText, MessageSquare, StickyNote, Image as ImageIcon, FileAudio2, File, Flame, ShieldAlert, CircleCheck, CircleDashed, CircleX, KeyRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CodingDecision, DocType, IssueCode } from "@/lib/types/domain";

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

/** Coding badges shown in the table: Responsive / Needs review / Privileged / Hot. */
export function CodingBadges({ coding, compact }: { coding: CodingDecision; compact?: boolean }) {
  const base = "gap-1 px-1.5 py-0 h-[18px] text-[10.5px] rounded";
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {coding.responsive === true ? (
        <Badge variant="success" className={base}><CircleCheck className="size-3" />{compact ? "R" : "Responsive"}</Badge>
      ) : coding.responsive === false ? (
        <Badge variant="muted" className={base}><CircleX className="size-3" />{compact ? "NR" : "Non-resp."}</Badge>
      ) : (
        <Badge variant="warning" className={base}><CircleDashed className="size-3" />{compact ? "?" : "Needs review"}</Badge>
      )}
      {coding.privileged === true && <Badge variant="info" className={base}><ShieldAlert className="size-3" />{compact ? "P" : "Privileged"}</Badge>}
      {coding.hot && <Badge variant="destructive" className={base}><Flame className="size-3" />{compact ? "H" : "Hot"}</Badge>}
    </span>
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
