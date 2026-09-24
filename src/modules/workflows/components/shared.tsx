"use client";
import * as React from "react";
import {
  AlertCircle, AlignLeft, BellRing, BookOpenCheck, CalendarClock, CalendarPlus, Check, CheckCircle2, CircleDashed, ClipboardCheck, Clock, CopyMinus, Download, FilePlus2, FileOutput, FileSearch, Gavel, GitBranch, GitMerge, Globe, Library, ListTodo, Loader2, Mail, MinusCircle, PauseCircle, PenLine, Play, Repeat, Scale, ScanSearch, ShieldAlert, ShieldCheck, Sparkles, Stamp, Tags, Timer, UserCheck, XCircle, type LucideIcon,
} from "lucide-react";
import type { WorkflowRun, WorkflowRunStep } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { categoryOf, nodeSpec, type NodeCategory } from "../registry";
import { RUN_STATUS_LABEL } from "../types";

export const ICONS: Record<string, LucideIcon> = {
  Play, CalendarClock, FilePlus2, Gavel, Mail, Sparkles, ScanSearch, Tags, AlignLeft, PenLine, ClipboardCheck, BookOpenCheck, Library, FileSearch, Scale, Globe, GitBranch, Repeat, GitMerge, UserCheck, Timer, ListTodo, CalendarPlus, FileOutput, BellRing, Download, Stamp,
  // Integrity nodes: verify against sources, deduplicate, trust review.
  ShieldCheck, CopyMinus, ShieldAlert,
};

export function iconFor(type: string): LucideIcon {
  return ICONS[nodeSpec(type)?.icon ?? ""] ?? Sparkles;
}

/** Tone classes per category, using design tokens only. */
export const CATEGORY_TONE: Record<NodeCategory, { bg: string; text: string; border: string; solid: string; ring: string }> = {
  trigger: { bg: "bg-success/12", text: "text-success", border: "border-success/40", solid: "bg-success text-success-foreground", ring: "ring-success/40" },
  ai: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/40", solid: "bg-primary text-primary-foreground", ring: "ring-primary/40" },
  data: { bg: "bg-info/12", text: "text-info", border: "border-info/40", solid: "bg-info text-primary-foreground", ring: "ring-info/40" },
  logic: { bg: "bg-warning/18", text: "text-warning-foreground dark:text-warning", border: "border-warning/50", solid: "bg-warning text-warning-foreground", ring: "ring-warning/40" },
  action: { bg: "bg-chart-5/12", text: "text-chart-5", border: "border-chart-5/40", solid: "bg-chart-5 text-primary-foreground", ring: "ring-chart-5/40" },
};

export function toneFor(type: string) {
  return CATEGORY_TONE[categoryOf(type)] ?? CATEGORY_TONE.action;
}

export function NodeTypeIcon({ type, className, size = "md" }: { type: string; className?: string; size?: "xs" | "sm" | "md" }) {
  const Icon = iconFor(type);
  const tone = toneFor(type);
  const sz = size === "xs" ? "size-5 [&>svg]:size-3" : size === "sm" ? "size-6 [&>svg]:size-3.5" : "size-7 [&>svg]:size-4";
  return <span className={cn("inline-flex shrink-0 items-center justify-center rounded-md", tone.bg, tone.text, sz, className)}><Icon /></span>;
}

/** Row of tiny node-type icons (used on template cards). */
export function NodeTypeStrip({ types, max = 8, className }: { types: string[]; max?: number; className?: string }) {
  const shown = types.slice(0, max);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {shown.map((t, i) => <NodeTypeIcon key={`${t}-${i}`} type={t} size="xs" />)}
      {types.length > max && <span className="text-[10px] text-muted-foreground">+{types.length - max}</span>}
    </div>
  );
}

export const CATEGORY_LABEL: Record<string, string> = { intake: "Intake", discovery: "Discovery", drafting: "Drafting", research: "Research", compliance: "Compliance", transactional: "Transactional", operations: "Operations" };

export function CategoryBadge({ category, className }: { category: string; className?: string }) {
  return <Badge variant="muted" className={cn("uppercase tracking-wider text-[10px]", className)}>{CATEGORY_LABEL[category] ?? category}</Badge>;
}

const RUN_VARIANT: Record<WorkflowRun["status"], "success" | "destructive" | "warning" | "info" | "muted" | "secondary"> = { succeeded: "success", failed: "destructive", cancelled: "muted", waiting_approval: "warning", running: "info", queued: "secondary" };

export function RunStatusBadge({ status, className }: { status: WorkflowRun["status"]; className?: string }) {
  return (
    <Badge variant={RUN_VARIANT[status]} className={cn("gap-1", className)}>
      {status === "running" && <Loader2 className="size-3 animate-spin" />}
      {status === "waiting_approval" && <PauseCircle className="size-3" />}
      {status === "succeeded" && <Check className="size-3" />}
      {status === "failed" && <XCircle className="size-3" />}
      {RUN_STATUS_LABEL[status]}
    </Badge>
  );
}

export function StepStatusIcon({ status, className }: { status: WorkflowRunStep["status"]; className?: string }) {
  const base = cn("size-4 shrink-0", className);
  switch (status) {
    case "running": return <Loader2 className={cn(base, "animate-spin text-info")} />;
    case "succeeded": return <CheckCircle2 className={cn(base, "text-success")} />;
    case "failed": return <XCircle className={cn(base, "text-destructive")} />;
    case "skipped": return <MinusCircle className={cn(base, "text-muted-foreground/60")} />;
    case "waiting_approval": return <PauseCircle className={cn(base, "text-warning")} />;
    default: return <CircleDashed className={cn(base, "text-muted-foreground/50")} />;
  }
}

export function WorkflowStatusBadge({ status }: { status: "draft" | "active" | "archived" }) {
  return <Badge variant={status === "active" ? "success" : status === "draft" ? "warning" : "muted"} className="capitalize">{status}</Badge>;
}

export function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatTokens(n?: number | null): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatUsd(n?: number | null): string {
  if (!n) return "$0.00";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function stepDuration(step: WorkflowRunStep, now = Date.now()): number | null {
  if (!step.startedAt) return null;
  const end = step.finishedAt ? new Date(step.finishedAt).getTime() : step.status === "running" ? now : null;
  return end == null ? null : end - new Date(step.startedAt).getTime();
}

/** Ticks once per second while `active` so live durations update. */
export function useNow(active: boolean, intervalMs = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return now;
}

export function InlineAlert({ tone = "warning", icon: Icon = AlertCircle, title, children, className, action }: { tone?: "warning" | "destructive" | "info" | "success"; icon?: LucideIcon; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const tones = { warning: "border-warning/50 bg-warning/10 text-warning-foreground dark:text-warning", destructive: "border-destructive/40 bg-destructive/8 text-destructive", info: "border-info/40 bg-info/8 text-info", success: "border-success/40 bg-success/8 text-success" };
  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs", tones[tone], className)}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 text-foreground">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "text-muted-foreground")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function SectionLabel({ children, className, right }: { children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground", className)}>
      <span>{children}</span>{right}
    </div>
  );
}

export { Clock };
