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
    <div className={cn("flex flex-col items-center justify-center gap-1.5 rounded-md text-center", compact ? "p-5" : "p-10", className)} role="status">
      {Icon && (
        <span className={cn("mb-1.5 flex items-center justify-center rounded-full bg-muted text-muted-foreground", compact ? "size-7" : "size-9")} aria-hidden>
          <Icon className={compact ? "size-3.5" : "size-4"} strokeWidth={1.75} />
        </span>
      )}
      <div className={cn("font-medium text-foreground", compact ? "text-[12.5px]" : "text-[13.5px]")}>{title}</div>
      {description && <div className={cn("max-w-sm text-pretty text-muted-foreground", compact ? "text-[11.5px] leading-snug" : "text-[12px] leading-relaxed")}>{description}</div>}
      {action && <div className={compact ? "mt-2" : "mt-3"}>{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, className, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; eyebrow?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[12px] text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 max-w-[var(--measure)] text-[12.5px] leading-snug text-muted-foreground">{description}</p>}
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
  const toneCls = tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning-foreground dark:text-warning" : "";
  return (
    <div className={cn("min-w-0 px-3 py-2 leading-tight", className)}>
      <div className="truncate text-[11.5px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-medium tabular tracking-[-0.01em]", size === "sm" ? "text-[15px]" : "text-[18px]", toneCls)}>{value}</div>
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
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />}
      <Tag className={cn("min-w-0 truncate font-medium", size === "sm" ? "text-[12.5px]" : "text-[13px]")}>{title}</Tag>
      {count != null && count !== "" && <CountChip>{count}</CountChip>}
      {description && <span className="hidden min-w-0 truncate text-[11.5px] text-muted-foreground md:inline">{description}</span>}
      <div className="flex-1" />
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/** Small tabular count next to a title. Plain text, never a pill; a tone colours it for decision states. */
export function CountChip({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "muted" | "primary" | "destructive" | "warning" | "success" }) {
  // Only red and amber carry meaning; primary/success read as ordinary counts.
  const tones = { muted: "text-muted-foreground", primary: "text-foreground", destructive: "text-destructive", warning: "text-warning-foreground dark:text-warning", success: "text-muted-foreground" } as const;
  return <span className={cn("inline-flex h-[18px] min-w-[14px] items-center justify-center px-0.5 text-[11px] font-medium tabular", tones[tone ?? "muted"], className)}>{children}</span>;
}

/**
 * Quiet chip: a very light neutral fill, no border, muted text. Semantic tones
 * (primary/accent, destructive/danger, warning, success, info) add a 6px dot in a
 * muted semantic colour instead of a coloured fill. Use it for facts (Bates,
 * stage, counts), not for shouting.
 */
export type ChipTone = "outline" | "muted" | "primary" | "destructive" | "warning" | "success" | "info" | "quiet" | "accent" | "danger";

export function Chip({ children, className, icon: Icon, tone = "outline", title, onClick, active }: { children: React.ReactNode; className?: string; icon?: LucideIcon; tone?: ChipTone; title?: string; onClick?: () => void; active?: boolean }) {
  const dots: Partial<Record<ChipTone, string>> = {
    primary: "bg-primary", accent: "bg-primary", destructive: "bg-destructive", danger: "bg-destructive", warning: "bg-warning", success: "bg-success/75", info: "bg-muted-foreground/60",
  };
  const dot = dots[tone];
  const cls = cn(
    "inline-flex h-5 max-w-full items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] border border-transparent bg-muted px-1.5 text-[11px] font-medium leading-none text-muted-foreground",
    tone === "outline" && "bg-transparent",
    onClick && "cursor-pointer transition-colors hover:bg-accent hover:text-foreground",
    active && "bg-primary/8 text-primary",
    className,
  );
  const inner = <>{dot ? <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden /> : null}{Icon && <Icon className="size-3 shrink-0" aria-hidden />}<span className="truncate">{children}</span></>;
  if (onClick) return <button type="button" onClick={onClick} className={cls} title={title} aria-pressed={active}>{inner}</button>;
  return <span className={cls} title={title}>{inner}</span>;
}

/** Quiet status dot for timelines and lists (no text, tone only). */
export function StatusDot({ tone = "muted", pulse, className, label }: { tone?: "muted" | "primary" | "success" | "warning" | "destructive" | "info"; pulse?: boolean; className?: string; label?: string }) {
  const tones = { muted: "bg-muted-foreground/45", primary: "bg-primary", success: "bg-success/75", warning: "bg-warning", destructive: "bg-destructive", info: "bg-muted-foreground/60" } as const;
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", tones[tone], pulse && "animate-pulse-soft", className)} aria-label={label} role={label ? "img" : undefined} />;
}

/** Two-line key/value used in condensed headers ("Stage" / "Fact discovery"). */
export function Fact({ label, children, className, tone }: { label: string; children: React.ReactNode; className?: string; tone?: "destructive" | "warning" | "primary" }) {
  return (
    <div className={cn("min-w-0 leading-tight", className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("truncate text-[12.5px] font-medium tabular", tone === "destructive" && "text-destructive", tone === "warning" && "text-warning-foreground dark:text-warning", tone === "primary" && "text-primary")}>{children}</div>
    </div>
  );
}
