"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkles, Globe, ShieldCheck, Info, type LucideIcon } from "lucide-react";

export const SETTINGS_GROUPS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "research", label: "Research providers", icon: Globe },
  { id: "integrity", label: "Data & integrity", icon: ShieldCheck },
  { id: "about", label: "About", icon: Info },
];

/** Left anchor navigation for the Settings groups; follows the hash and scroll position. */
export function SettingsNav({ className }: { className?: string }) {
  const [active, setActive] = React.useState<string>("ai");
  React.useEffect(() => {
    const fromHash = () => { const h = window.location.hash.replace("#", ""); if (h === "review") setActive("integrity"); else if (SETTINGS_GROUPS.some((g) => g.id === h)) setActive(h); };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    const sections = SETTINGS_GROUPS.map((g) => document.getElementById(`group-${g.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => { const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (vis) setActive(vis.target.id.replace("group-", "")); }, { rootMargin: "-20% 0px -60% 0px" });
    sections.forEach((s) => io.observe(s));
    return () => { window.removeEventListener("hashchange", fromHash); io.disconnect(); };
  }, []);
  return (
    <nav className={cn("flex gap-1 md:flex-col", className)} aria-label="Settings sections">
      {SETTINGS_GROUPS.map((g) => (
        <a key={g.id} href={`#${g.id}`} onClick={() => setActive(g.id)} className={cn("flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors", active === g.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")} aria-current={active === g.id ? "true" : undefined}>
          <g.icon className={cn("size-4", active === g.id ? "text-primary" : "")} />{g.label}
        </a>
      ))}
    </nav>
  );
}
