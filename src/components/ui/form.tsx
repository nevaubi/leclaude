"use client";
import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Field: label / control / help / error
// ---------------------------------------------------------------------------

export interface FieldProps {
  label?: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  /** Label beside the control (160px column) instead of above it. */
  inline?: boolean;
  /** Small right-aligned text next to the label (counter, shortcut). */
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, help, error, required, htmlFor, inline, hint, className, children }: FieldProps) {
  const id = React.useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const labelEl = label != null && (
    <div className={cn("flex items-baseline justify-between gap-2", inline ? "min-h-7 pt-1" : "mb-1")}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium leading-tight text-foreground">
        {label}{required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </label>
      {hint && <span className="text-[11px] tabular text-muted-foreground">{hint}</span>}
    </div>
  );
  const body = (
    <div className="min-w-0">
      <div data-invalid={error ? "true" : undefined} aria-describedby={[helpId, errorId].filter(Boolean).join(" ") || undefined}>{children}</div>
      {error ? <p id={errorId} className="mt-1 text-[11.5px] leading-snug text-destructive" role="alert">{error}</p> : help ? <p id={helpId} className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{help}</p> : null}
    </div>
  );
  if (inline) return <div className={cn("grid grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-start gap-x-3", className)}>{labelEl || <span />}{body}</div>;
  return <div className={cn("min-w-0", className)}>{labelEl}{body}</div>;
}

/** Group fields with a quiet heading; keeps the 12px rhythm. */
export function FieldGroup({ title, description, children, className }: { title?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn("min-w-0 space-y-3", className)}>
      {(title || description) && (
        <legend className="mb-2 block">
          {title && <div className="text-[12.5px] font-semibold tracking-tight">{title}</div>}
          {description && <div className="text-[11.5px] text-muted-foreground">{description}</div>}
        </legend>
      )}
      {children}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// KeyValue list
// ---------------------------------------------------------------------------

export interface KeyValueItem { label: React.ReactNode; value: React.ReactNode; mono?: boolean; muted?: boolean; title?: string }

export function KeyValueList({ items, columns = 1, dense, labelWidth = 140, className }: { items: KeyValueItem[]; columns?: 1 | 2; dense?: boolean; labelWidth?: number; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6", columns === 2 ? "sm:grid-cols-2" : "", className)}>
      {items.map((it, i) => (
        <div key={i} className={cn("grid items-baseline gap-x-3 border-b border-line-quiet", dense ? "min-h-6 py-0.5" : "min-h-7 py-1")} style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }} title={it.title}>
          <dt className="truncate text-[11.5px] text-muted-foreground">{it.label}</dt>
          <dd className={cn("min-w-0 truncate text-[12.5px]", it.mono && "font-mono text-[11.5px]", it.muted && "text-muted-foreground")}>{it.value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// SegmentedControl
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> { value: T; label: React.ReactNode; icon?: LucideIcon; disabled?: boolean; title?: string }

export function SegmentedControl<T extends string>({ options, value, onChange, size = "sm", className, ariaLabel, grow }: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; size?: "xs" | "sm"; className?: string; ariaLabel?: string; grow?: boolean }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex shrink-0 items-center rounded-md border bg-background p-0.5", size === "xs" ? "h-7" : "h-8", grow && "flex w-full", className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)} className={cn("flex h-full items-center justify-center gap-1 rounded-[4px] px-2 font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50", size === "xs" ? "text-[11px]" : "text-[11.5px]", grow && "flex-1", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
            {Icon && <Icon className={size === "xs" ? "size-3" : "size-3.5"} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
