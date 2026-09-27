import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One Settings section: an anchored heading, a one-line description and a
 * flat body (tables and key/value lists, never nested cards). Other rounds
 * mount their panels through this component, e.g. Data & automation.
 */
export function SettingsSection({ id, title, description, actions, children, className, bare }: { id: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; /** The panel renders its own heading (e.g. TeamSettings); keep only the anchor. */ bare?: boolean }) {
  if (bare) {
    return (
      <section id={`group-${id}`} className={cn("scroll-mt-3", className)} aria-label={typeof title === "string" ? title : undefined}>
        <div id={id} className="scroll-mt-3" />
        {children}
      </section>
    );
  }
  return (
    <section id={`group-${id}`} className={cn("scroll-mt-3", className)} aria-labelledby={`${id}-title`}>
      <div id={id} className="flex scroll-mt-3 items-end gap-3 border-b pb-2">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[14px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>}
        </div>
        <div className="flex-1" />
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="py-3">{children}</div>
    </section>
  );
}

/** A titled block inside a section: hairline rule, quiet title, dense body. */
export function SettingsBlock({ id, title, description, actions, children, className }: { id?: string; title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div id={id} className={cn("scroll-mt-3 rounded-md border", className)}>
      {(title || actions) && (
        <div className="flex min-h-8 items-center gap-2 border-b px-3 py-1">
          <div className="min-w-0 leading-tight">
            {title && <div className="text-[12.5px] font-medium">{title}</div>}
            {description && <div className="text-[11.5px] text-muted-foreground">{description}</div>}
          </div>
          <div className="flex-1" />
          {actions}
        </div>
      )}
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}
