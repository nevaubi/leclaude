import * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return <Loader2 className={cn("animate-spin text-muted-foreground", className)} style={{ width: size, height: size }} aria-label="Loading" />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center", className)}>{children}</kbd>;
}

/**
 * Consistent empty state. `compact` renders a quieter, single-column version for
 * panels and drawers; the default is for page-level surfaces.
 */
export function EmptyState({ icon: Icon, title, description, action, className, compact }: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-center", compact ? "p-5" : "p-8", className)} role="status">
      {Icon && <Icon className={cn("mb-0.5 text-muted-foreground", compact ? "size-4" : "size-5")} aria-hidden />}
      <div className={cn("font-medium", compact ? "text-[12.5px]" : "text-[13px]")}>{title}</div>
      {description && <div className="max-w-sm text-[11.5px] leading-snug text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, className, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; eyebrow?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * One quiet number: a small label, a tabular value and an optional hint. No
 * card; stats sit in a row separated by hairlines (`hairline-x`) or in a grid.
 */
export function Stat({ label, value, hint, className, tone, size = "md" }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; className?: string; tone?: "destructive" | "warning" | "success" | "primary"; size?: "sm" | "md" }) {
  const toneCls = tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning-foreground dark:text-warning" : tone === "success" ? "text-success" : tone === "primary" ? "text-primary" : "";
  return (
    <div className={cn("min-w-0 px-3 py-2 leading-tight", className)}>
      <div className="truncate text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-semibold tabular", size === "sm" ? "text-[15px]" : "text-[18px]", toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn("inline-block size-1.5 rounded-full bg-current", className)} />;
}

// ---------------------------------------------------------------------------
// Litigator UI primitives (additive). One header pattern, one chip, one dot.
// ---------------------------------------------------------------------------

/**
 * One section header pattern for cards, tabs and panels: icon, title, an
 * optional count, an optional one-line description and right-aligned actions.
 * 36px tall, thin bottom rule, 8px rhythm.
 */
export function SectionHeader({ icon: Icon, title, count, description, actions, className, as: Tag = "h2", size = "md" }: { icon?: LucideIcon; title: React.ReactNode; count?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; as?: "h1" | "h2" | "h3" | "div"; size?: "sm" | "md" }) {
  return (
    <header className={cn("flex shrink-0 items-center gap-2 border-b", size === "sm" ? "h-8 px-2.5" : "h-9 px-3", className)}>
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <Tag className={cn("min-w-0 truncate font-semibold tracking-tight", size === "sm" ? "text-[12.5px]" : "text-[13px]")}>{title}</Tag>
      {count != null && count !== "" && <CountChip>{count}</CountChip>}
      {description && <span className="hidden min-w-0 truncate text-[11.5px] text-muted-foreground md:inline">{description}</span>}
      <div className="flex-1" />
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/** Small tabular count next to a title. Plain text, never a pill; a tone colours it for decision states. */
export function CountChip({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "muted" | "primary" | "destructive" | "warning" | "success" }) {
  const tones = { muted: "text-muted-foreground", primary: "text-primary", destructive: "text-destructive", warning: "text-warning-foreground dark:text-warning", success: "text-success" } as const;
  return <span className={cn("inline-flex h-[18px] min-w-[14px] items-center justify-center px-0.5 text-[11px] font-medium tabular", tones[tone ?? "muted"], className)}>{children}</span>;
}

/**
 * Quiet chip: small rounded, thin border, muted text; `tone` adds a soft fill.
 * Use it for facts (Bates, stage, counts), not for shouting.
 */
export type ChipTone = "outline" | "muted" | "primary" | "destructive" | "warning" | "success" | "info" | "quiet" | "accent" | "danger";

export function Chip({ children, className, icon: Icon, tone = "outline", title, onClick, active }: { children: React.ReactNode; className?: string; icon?: LucideIcon; tone?: ChipTone; title?: string; onClick?: () => void; active?: boolean }) {
  const tones: Record<ChipTone, string> = {
    outline: "border-border text-muted-foreground bg-transparent",
    muted: "border-transparent bg-muted text-muted-foreground",
    quiet: "border-transparent bg-muted text-muted-foreground",
    primary: "border-primary/25 bg-primary/8 text-primary",
    accent: "border-primary/25 bg-primary/8 text-primary",
    destructive: "border-destructive/25 bg-destructive/8 text-destructive",
    danger: "border-destructive/25 bg-destructive/8 text-destructive",
    warning: "border-warning/40 bg-warning/12 text-warning-foreground dark:text-warning",
    success: "border-success/30 bg-success/10 text-success",
    info: "border-info/30 bg-info/10 text-info",
  };
  const cls = cn("inline-flex h-5 max-w-full items-center gap-1 whitespace-nowrap rounded-[var(--radius-chip)] border px-1.5 text-[11px] font-medium leading-none", tones[tone], onClick && "cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground", active && "border-primary/40 bg-primary/10 text-primary", className);
  const inner = <>{Icon && <Icon className="size-3 shrink-0" aria-hidden />}<span className="truncate">{children}</span></>;
  if (onClick) return <button type="button" onClick={onClick} className={cls} title={title} aria-pressed={active}>{inner}</button>;
  return <span className={cls} title={title}>{inner}</span>;
}

/** Quiet status dot for timelines and lists (no text, tone only). */
export function StatusDot({ tone = "muted", pulse, className, label }: { tone?: "muted" | "primary" | "success" | "warning" | "destructive" | "info"; pulse?: boolean; className?: string; label?: string }) {
  const tones = { muted: "bg-muted-foreground/50", primary: "bg-primary", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive", info: "bg-info" } as const;
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", tones[tone], pulse && "animate-pulse-soft", className)} aria-label={label} role={label ? "img" : undefined} />;
}

/** Two-line key/value used in condensed headers ("Stage" / "Fact discovery"). */
export function Fact({ label, children, className, tone }: { label: string; children: React.ReactNode; className?: string; tone?: "destructive" | "warning" | "primary" }) {
  return (
    <div className={cn("min-w-0 leading-tight", className)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("truncate text-[12.5px] font-medium tabular", tone === "destructive" && "text-destructive", tone === "warning" && "text-warning-foreground dark:text-warning", tone === "primary" && "text-primary")}>{children}</div>
    </div>
  );
}
