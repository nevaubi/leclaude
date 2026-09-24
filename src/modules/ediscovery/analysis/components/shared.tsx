"use client";
import * as React from "react";
import { AlertTriangle, CircleCheck, CircleDot, CircleX, FileText, Flag, Gavel, HelpCircle, KeyRound, Lock, Quote, ScrollText, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import type { Conflict } from "@/lib/types/domain";
import { NoKeyCallout, formatShortDate } from "../../components/shared";
import { type QAFlag, type TimelineCategory, TIMELINE_CATEGORIES, CONFLICT_KINDS } from "../types";

export { NoKeyCallout, formatShortDate };

export const FLAG_STYLES: Record<QAFlag, { icon: LucideIcon; cls: string; label: string }> = {
  admission: { icon: CircleCheck, cls: "bg-success/12 text-success border-success/30", label: "Admission" },
  contradiction: { icon: AlertTriangle, cls: "bg-destructive/12 text-destructive border-destructive/30", label: "Contradiction" },
  evasive: { icon: HelpCircle, cls: "bg-warning/18 text-warning-foreground dark:text-warning border-warning/40", label: "Evasive" },
  key: { icon: Flag, cls: "bg-primary/12 text-primary border-primary/30", label: "Key" },
  privilege: { icon: Lock, cls: "bg-info/12 text-info border-info/30", label: "Privilege" },
  objection: { icon: Gavel, cls: "bg-muted text-muted-foreground border-border", label: "Objection" },
};

export function FlagBadge({ flag, compact, className }: { flag: QAFlag; compact?: boolean; className?: string }) {
  const s = FLAG_STYLES[flag];
  const Icon = s.icon;
  return <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10.5px] font-medium leading-4 whitespace-nowrap", s.cls, className)}><Icon className="size-3" />{!compact && s.label}</span>;
}

export const OBJECTION_STYLES: Record<string, string> = {
  form: "bg-muted text-muted-foreground border-border",
  foundation: "bg-chart-2/12 text-chart-2 border-chart-2/30",
  speculation: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  privilege: "bg-info/12 text-info border-info/30",
  "asked-and-answered": "bg-chart-4/12 text-chart-4 border-chart-4/30",
  compound: "bg-chart-1/12 text-chart-1 border-chart-1/30",
  relevance: "bg-chart-5/12 text-chart-5 border-chart-5/30",
  argumentative: "bg-destructive/12 text-destructive border-destructive/30",
  mischaracterizes: "bg-warning/18 text-warning-foreground dark:text-warning border-warning/40",
  hearsay: "bg-primary/12 text-primary border-primary/30",
};

export function ObjectionBadge({ basis, by, className }: { basis: string; by?: string; className?: string }) {
  const b = basis.toLowerCase();
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10.5px] font-medium leading-4 whitespace-nowrap", OBJECTION_STYLES[b] ?? "bg-muted text-muted-foreground border-border", className)} title={by ? `Objection by ${by}` : undefined}>
      <Gavel className="size-3" />{b}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: Conflict["severity"]; className?: string }) {
  const v = severity === "high" ? "destructive" : severity === "medium" ? "warning" : "muted";
  return <Badge variant={v} className={cn("h-[18px] px-1.5 py-0 text-[10.5px] capitalize", className)}>{severity}</Badge>;
}

export function ConflictStatusBadge({ status, className }: { status: Conflict["status"]; className?: string }) {
  const map = { open: { v: "info" as const, icon: CircleDot }, resolved: { v: "success" as const, icon: CircleCheck }, dismissed: { v: "muted" as const, icon: CircleX } };
  const m = map[status];
  const Icon = m.icon;
  return <Badge variant={m.v} className={cn("h-[18px] gap-1 px-1.5 py-0 text-[10.5px] capitalize", className)}><Icon className="size-3" />{status}</Badge>;
}

export function kindLabel(kind: Conflict["kind"]) {
  return CONFLICT_KINDS.find((k) => k.id === kind)?.label ?? kind.replace(/_/g, " ");
}

export function categoryToken(cat: TimelineCategory) {
  return TIMELINE_CATEGORIES.find((c) => c.id === cat)?.color ?? "muted";
}

const DOT: Record<string, string> = { "chart-1": "bg-chart-1", "chart-2": "bg-chart-2", "chart-3": "bg-chart-3", "chart-4": "bg-chart-4", "chart-5": "bg-chart-5", primary: "bg-primary", info: "bg-info", muted: "bg-muted-foreground", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" };
const CHIP: Record<string, string> = { "chart-1": "bg-chart-1/12 text-chart-1 border-chart-1/30", "chart-2": "bg-chart-2/12 text-chart-2 border-chart-2/30", "chart-3": "bg-chart-3/15 text-chart-3 border-chart-3/30", "chart-4": "bg-chart-4/12 text-chart-4 border-chart-4/30", "chart-5": "bg-chart-5/12 text-chart-5 border-chart-5/30", primary: "bg-primary/12 text-primary border-primary/30", info: "bg-info/12 text-info border-info/30", muted: "bg-muted text-muted-foreground border-border", success: "bg-success/12 text-success border-success/30", warning: "bg-warning/18 text-warning-foreground dark:text-warning border-warning/40", destructive: "bg-destructive/12 text-destructive border-destructive/30" };

export function tokenDot(token: string) { return DOT[token] ?? DOT.muted; }
export function tokenChip(token: string) { return CHIP[token] ?? CHIP.muted; }

export function CategoryChip({ category, className }: { category: TimelineCategory; className?: string }) {
  const c = TIMELINE_CATEGORIES.find((x) => x.id === category);
  return <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10.5px] font-medium capitalize leading-4 whitespace-nowrap", tokenChip(c?.color ?? "muted"), className)}><span className={cn("size-1.5 rounded-full", tokenDot(c?.color ?? "muted"))} />{c?.label ?? category}</span>;
}

/** Citation chip: Bates → opens the document; page:line → jumps to the deposition. */
export function CiteChip({ cite, kind, onClick, className, title }: { cite: string; kind: "document" | "deposition" | "external"; onClick?: () => void; className?: string; title?: string }) {
  const Icon = kind === "document" ? FileText : kind === "deposition" ? ScrollText : Quote;
  const cls = cn("inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-px font-mono text-[10.5px] leading-4 whitespace-nowrap transition-colors", kind === "document" ? "bg-chart-1/8 text-chart-1 border-chart-1/25" : kind === "deposition" ? "bg-chart-2/10 text-chart-2 border-chart-2/25" : "bg-muted text-muted-foreground border-border", onClick && "cursor-pointer hover:bg-accent hover:text-accent-foreground", className);
  const inner = <><Icon className="size-3 shrink-0" /><span className="truncate">{cite}</span></>;
  if (onClick) return <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} className={cls} title={title ?? (kind === "document" ? "Open document" : "Open in transcript")}>{inner}</button>;
  return <span className={cls} title={title}>{inner}</span>;
}

export function AiButtonHint({ configured, children }: { configured: boolean; children: React.ReactElement }) {
  return configured ? children : <Tip label={<span className="flex items-center gap-1"><KeyRound className="size-3" /> OPENAI_API_KEY required</span>}>{children}</Tip>;
}

export function AiLabel({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary", className)}><Sparkles className="size-3" /> AI</span>;
}

export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div>
        </div>
      ))}
    </div>
  );
}

export function Pane({ title, count, actions, children, className, bodyClassName }: { title: React.ReactNode; count?: number; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("flex min-h-0 flex-col rounded-lg border bg-card", className)}>
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold"><span className="truncate">{title}</span>{count != null && <span className="rounded bg-muted px-1 py-px text-[10px] font-medium tabular text-muted-foreground">{count}</span>}</div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1 overflow-auto scrollbar-thin", bodyClassName)}>{children}</div>
    </section>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[92px_1fr] items-baseline gap-2 text-xs", className)}>
      <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function typingTarget(e: KeyboardEvent | React.KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.getAttribute("role") === "combobox");
}
