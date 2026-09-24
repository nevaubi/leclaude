"use client";
import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { TopbarSlot } from "./app-shell";

/**
 * Standard page chrome inside the 44px top bar: icon, title, optional context
 * text and whatever the page adds (breadcrumb, one primary action).
 */
export function PageTopbar({ icon: Icon, title, context, children }: { icon?: LucideIcon; title: React.ReactNode; context?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <TopbarSlot>
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="shrink-0 text-[13px] font-semibold">{title}</span>
      {context && <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground md:inline">{context}</span>}
      {children}
    </TopbarSlot>
  );
}
