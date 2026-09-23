"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Bot, Flag, Gavel, Maximize2, Minimize2, Scale, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/ui/avatar";
import { Tip } from "@/components/ui/tooltip";
import type { CalendarEvent, Task } from "@/lib/types/domain";
import { countdown, type Urgency } from "../time";
import { EVENT_KIND_LABEL } from "../types";
import { useHome } from "./home-provider";

/** Event kind → token classes (dot, chip background/text, calendar bar). */
export const KIND_STYLE: Record<CalendarEvent["kind"], { dot: string; chip: string; bar: string; label: string }> = {
  deadline: { dot: "bg-destructive", chip: "bg-destructive/10 text-destructive border-destructive/20", bar: "border-l-destructive", label: EVENT_KIND_LABEL.deadline },
  filing: { dot: "bg-chart-5", chip: "bg-chart-5/10 text-chart-5 border-chart-5/20", bar: "border-l-chart-5", label: EVENT_KIND_LABEL.filing },
  hearing: { dot: "bg-primary", chip: "bg-primary/10 text-primary border-primary/20", bar: "border-l-primary", label: EVENT_KIND_LABEL.hearing },
  deposition: { dot: "bg-chart-2", chip: "bg-chart-2/12 text-chart-2 border-chart-2/25", bar: "border-l-chart-2", label: EVENT_KIND_LABEL.deposition },
  meeting: { dot: "bg-chart-4", chip: "bg-chart-4/12 text-chart-4 border-chart-4/25", bar: "border-l-chart-4", label: EVENT_KIND_LABEL.meeting },
  internal: { dot: "bg-muted-foreground", chip: "bg-muted text-muted-foreground border-border", bar: "border-l-muted-foreground", label: EVENT_KIND_LABEL.internal },
  cle: { dot: "bg-chart-3", chip: "bg-chart-3/15 text-warning-foreground dark:text-chart-3 border-chart-3/30", bar: "border-l-chart-3", label: EVENT_KIND_LABEL.cle },
  other: { dot: "bg-foreground/50", chip: "bg-accent text-accent-foreground border-transparent", bar: "border-l-foreground/40", label: EVENT_KIND_LABEL.other },
};

export const PRIORITY_STYLE: Record<Task["priority"], { label: string; className: string; dot: string }> = {
  urgent: { label: "Urgent", className: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
  high: { label: "High", className: "bg-chart-3/15 text-warning-foreground dark:text-chart-3 border-chart-3/30", dot: "bg-chart-3" },
  medium: { label: "Medium", className: "bg-primary/8 text-primary border-primary/15", dot: "bg-primary/70" },
  low: { label: "Low", className: "bg-muted text-muted-foreground border-transparent", dot: "bg-muted-foreground/60" },
};

export const URGENCY_STYLE: Record<Urgency, string> = {
  overdue: "bg-destructive/10 text-destructive border-destructive/25",
  today: "bg-chart-3/15 text-warning-foreground dark:text-chart-3 border-chart-3/30",
  soon: "bg-primary/10 text-primary border-primary/20",
  upcoming: "bg-accent text-accent-foreground border-transparent",
  later: "bg-muted text-muted-foreground border-transparent",
  past: "bg-muted text-muted-foreground border-transparent",
};

export function KindDot({ kind, className }: { kind: CalendarEvent["kind"]; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", KIND_STYLE[kind].dot, className)} aria-hidden />;
}

export function KindBadge({ kind, className }: { kind: CalendarEvent["kind"]; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium leading-4", KIND_STYLE[kind].chip, className)}><KindDot kind={kind} className="size-1.5" />{KIND_STYLE[kind].label}</span>;
}

export function PriorityBadge({ priority, className, compact }: { priority: Task["priority"]; className?: string; compact?: boolean }) {
  const s = PRIORITY_STYLE[priority];
  if (compact) return <Tip label={`${s.label} priority`}><span className={cn("inline-block size-2 rounded-full", s.dot, className)} /></Tip>;
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium leading-4", s.className, className)}><Flag className="size-2.5" />{s.label}</span>;
}

/** Countdown chip, e.g. "in 3 wk", "overdue 2d", "today". */
export function CountdownChip({ date, deadline, className, prefix }: { date?: string | null; deadline?: boolean; className?: string; prefix?: string }) {
  const { now } = useHome();
  if (!date) return null;
  const c = countdown(date, now, { deadline });
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium leading-4 tabular", URGENCY_STYLE[c.urgency], className)} title={new Date(date).toLocaleString()}>
      {c.urgency === "overdue" && <AlertTriangle className="size-2.5" />}
      {prefix}{c.label}
    </span>
  );
}

export function MatterBadge({ matterId, className, link }: { matterId?: string | null; className?: string; link?: boolean }) {
  const { matterById } = useHome();
  const m = matterById(matterId);
  if (!m) return null;
  const inner = <Badge variant="outline" className={cn("max-w-[160px] gap-1 truncate font-medium text-[10.5px] text-foreground/80 hover:bg-accent", className)} title={m.name}><Scale className="size-2.5 shrink-0 text-muted-foreground" /><span className="truncate">{m.shortName}</span></Badge>;
  return link ? <Link href={`/ediscovery?matter=${m.id}`} onClick={(e) => e.stopPropagation()}>{inner}</Link> : inner;
}

export function SourceIcon({ source, className }: { source?: Task["source"]; className?: string }) {
  if (!source || source === "manual") return null;
  const map: Record<Exclude<Task["source"], "manual" | undefined>, { icon: LucideIcon; label: string }> = { workflow: { icon: Workflow, label: "Created by a workflow" }, agent: { icon: Bot, label: "Created by an agent" }, docket: { icon: Gavel, label: "From the docket monitor" } };
  const it = map[source];
  const Icon = it.icon;
  return <Tip label={it.label}><span className={cn("inline-flex items-center text-muted-foreground", className)}><Icon className="size-3" /></span></Tip>;
}

export function PeopleStack({ ids, max = 4, size = "xs", className }: { ids: string[]; max?: number; size?: "xs" | "sm"; className?: string }) {
  const { personById } = useHome();
  const people = ids.map((id) => personById(id)).filter(Boolean);
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <PersonAvatar key={p!.id} name={p!.name} size={size} className={cn("ring-2 ring-card", i > 0 && "-ml-1.5")} />
      ))}
      {extra > 0 && <span className={cn("-ml-1.5 inline-flex items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-card", size === "xs" ? "size-5" : "size-6")}>+{extra}</span>}
    </span>
  );
}

export function PersonChip({ id, className, size = "xs" }: { id?: string | null; className?: string; size?: "xs" | "sm" }) {
  const { personById } = useHome();
  const p = personById(id);
  if (!p) return null;
  return <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}><PersonAvatar name={p.name} size={size} /><span className="truncate">{p.name}</span></span>;
}

/** Section wrapper with a dense header and optional expand/collapse toggle. */
export function Section({ id, title, icon: Icon, count, actions, children, className, bodyClassName, onExpand, expanded, description }: { id?: string; title: React.ReactNode; icon?: LucideIcon; count?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; onExpand?: () => void; expanded?: boolean; description?: React.ReactNode }) {
  return (
    <section id={id} className={cn("flex min-w-0 flex-col rounded-xl border bg-card shadow-xs", expanded && "h-full", className)}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3.5">
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {count != null && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-medium tabular text-muted-foreground">{count}</span>}
        {description && <span className="hidden truncate text-[11px] text-muted-foreground md:inline">{description}</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-1">{actions}</div>
        {onExpand && (
          <Tip label={expanded ? "Back to overview" : "Expand"} shortcut={expanded ? "Esc" : undefined}>
            <Button variant="ghost" size="icon-xs" onClick={onExpand} aria-label={expanded ? "Collapse" : "Expand"}>{expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</Button>
          </Tip>
        )}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyRow({ icon: Icon, title, hint, action, className }: { icon?: LucideIcon; title: string; hint?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center", className)}>
      {Icon && <Icon className="size-5 text-muted-foreground/70" />}
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-xs text-xs text-muted-foreground">{hint}</div>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-0.5 text-primary hover:underline underline-offset-2", className)} onClick={(e) => e.stopPropagation()}>{children}<ArrowUpRight className="size-3" /></a>;
}

/** Native date/time inputs styled like our Input. */
export function DateInput({ value, onChange, className, ...rest }: { value: string; onChange: (v: string) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none tabular", className)} {...rest} />;
}

export function TimeInput({ value, onChange, className, ...rest }: { value: string; onChange: (v: string) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return <input type="time" value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none tabular", className)} {...rest} />;
}

export function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground", className)}>{children}</div>;
}

/** Sentinel for "none" in Radix selects (empty string is not allowed). */
export const NONE = "__none__";
