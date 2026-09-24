"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { MessageSquareText, Globe, Database, ShieldCheck, Info, type LucideIcon } from "lucide-react";
import { SETTINGS_GROUPS, sectionForHash, type SettingsGroup } from "./settings-groups";

export { SETTINGS_GROUPS } from "./settings-groups";

const ICONS: Record<SettingsGroup["id"], LucideIcon> = { ai: MessageSquareText, research: Globe, data: Database, integrity: ShieldCheck, about: Info };

/** Left navigation for the Settings sections; follows the hash and the scroll position. */
export function SettingsNav({ className }: { className?: string }) {
  const [active, setActive] = React.useState<string>("ai");
  const lockUntil = React.useRef(0);
  React.useEffect(() => {
    // A hash (from a link like /settings#review) decides the section; the observer takes over once the user scrolls.
    const fromHash = () => { const id = sectionForHash(window.location.hash); if (id) { setActive(id); lockUntil.current = Date.now() + 1500; } };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    const sections = SETTINGS_GROUPS.map((g) => document.getElementById(`group-${g.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => { if (Date.now() < lockUntil.current) return; const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (vis) setActive(vis.target.id.replace("group-", "")); }, { rootMargin: "-10% 0px -70% 0px" });
    sections.forEach((s) => io.observe(s));
    return () => { window.removeEventListener("hashchange", fromHash); io.disconnect(); };
  }, []);
  return (
    <nav className={cn("flex gap-0.5 overflow-x-auto no-scrollbar md:flex-col", className)} aria-label="Settings sections">
      {SETTINGS_GROUPS.map((g) => { const Icon = ICONS[g.id]; return (
        <a key={g.id} href={`#${g.id}`} onClick={() => setActive(g.id)} className={cn("flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors", active === g.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")} aria-current={active === g.id ? "true" : undefined}>
          <Icon className={cn("size-3.5", active === g.id ? "text-primary" : "")} />{g.label}
        </a>
      ); })}
    </nav>
  );
}
