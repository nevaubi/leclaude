import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One Settings section: an anchored heading, a one-line description and a
 * flat body (tables and key/value lists, never nested cards). Other rounds
 * mount their panels through this component, e.g. Data & automation.
 */
export function SettingsSection({ id, title, description, actions, children, className }: { id: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={`group-${id}`} className={cn("scroll-mt-3", className)} aria-labelledby={`${id}-title`}>
      <div id={id} className="flex h-9 scroll-mt-3 items-center gap-3 border-b">
        <h2 id={`${id}-title`} className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="hidden min-w-0 truncate text-[11.5px] text-muted-foreground md:block">{description}</p>}
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
            {description && <div className="text-[11px] text-muted-foreground">{description}</div>}
          </div>
          <div className="flex-1" />
          {actions}
        </div>
      )}
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
