"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { MessageSquareText, Globe, Database, ShieldCheck, Info, type LucideIcon } from "lucide-react";

export const SETTINGS_GROUPS: { id: string; label: string; icon: LucideIcon; anchors?: string[] }[] = [
  { id: "ai", label: "AI", icon: MessageSquareText },
  { id: "research", label: "Research providers", icon: Globe },
  { id: "data", label: "Data & automation", icon: Database, anchors: ["sources", "jobs"] },
  { id: "integrity", label: "Integrity", icon: ShieldCheck, anchors: ["review", "scans", "audit"] },
  { id: "about", label: "About", icon: Info },
];

/** Left navigation for the Settings sections; follows the hash and the scroll position. */
export function SettingsNav({ className }: { className?: string }) {
  const [active, setActive] = React.useState<string>("ai");
  React.useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "");
      const g = SETTINGS_GROUPS.find((x) => x.id === h || x.anchors?.includes(h));
      if (g) setActive(g.id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    const sections = SETTINGS_GROUPS.map((g) => document.getElementById(`group-${g.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => { const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (vis) setActive(vis.target.id.replace("group-", "")); }, { rootMargin: "-10% 0px -70% 0px" });
    sections.forEach((s) => io.observe(s));
    return () => { window.removeEventListener("hashchange", fromHash); io.disconnect(); };
  }, []);
  return (
    <nav className={cn("flex gap-0.5 overflow-x-auto no-scrollbar md:flex-col", className)} aria-label="Settings sections">
      {SETTINGS_GROUPS.map((g) => (
        <a key={g.id} href={`#${g.id}`} onClick={() => setActive(g.id)} className={cn("flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors", active === g.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")} aria-current={active === g.id ? "true" : undefined}>
          <g.icon className={cn("size-3.5", active === g.id ? "text-primary" : "")} />{g.label}
        </a>
      ))}
    </nav>
  );
}
