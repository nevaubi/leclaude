"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { INTEL_NAV, activeNav } from "./models";

/**
 * 36px sub-navigation for /intel: Explorer, Trends, Clusters, Graph,
 * Chronologies, Insights, Watches. Plain text links, underline on the active
 * item, no icons; the trailing slot takes a page's own controls.
 */
export function IntelNav({ children, className }: { children?: React.ReactNode; className?: string }) {
  const pathname = usePathname() ?? "/intel";
  const active = activeNav(pathname);
  return (
    <nav className={cn("toolbar shrink-0 gap-0.5 overflow-x-auto scrollbar-thin", className)} aria-label="Intelligence sections">
      {INTEL_NAV.map((item) => {
        const on = active?.href === item.href;
        return (
          <Link key={item.href} href={item.href} aria-current={on ? "page" : undefined} className={cn("relative flex h-full shrink-0 items-center px-2.5 text-[12.5px] font-medium transition-colors", on ? "text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground")}>
            {item.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      {children}
    </nav>
  );
}
