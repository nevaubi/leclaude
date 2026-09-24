"use client";
import * as React from "react";
import { TopbarSlot } from "./app-shell";

/**
 * Standard page chrome inside the 44px top bar: icon, title, optional context
 * text and whatever the page adds (breadcrumb, one primary action). `icon` is a
 * rendered node (e.g. `<Radar className="size-4" />`) so server pages can pass it.
 */
export function PageTopbar({ icon, title, context, children }: { icon?: React.ReactNode; title: React.ReactNode; context?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <TopbarSlot>
      {icon && <span className="flex shrink-0 items-center text-muted-foreground [&>svg]:size-4" aria-hidden>{icon}</span>}
      <span className="shrink-0 text-[13px] font-semibold">{title}</span>
      {context && <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground md:inline">{context}</span>}
      {children}
    </TopbarSlot>
  );
}
