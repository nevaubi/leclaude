"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronLeft, ChevronRight, Moon, Search, Sun, Sparkles, Monitor, Menu, X, KeyRound, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV, SECONDARY_NAV } from "./nav";
import { useShellStore } from "./shell-store";
import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/ui/avatar";
import { CommandPalette } from "./command-palette";
import { Badge } from "@/components/ui/badge";
import { SWMark, BrandLockup } from "@/components/brand/logo";

const CURRENT_USER = { name: "Jordan Whitfield", role: "Partner", email: "jwhitfield@seegerweiss.com" };

/**
 * Application shell: a slim icon rail (expandable to labels), a quiet top bar
 * that pages fill through <TopbarSlot>, and the ⌘K palette. Designed around a
 * litigator's day: one glance to orient, one key to move.
 */
export function AppShell({ children, appName, firmName }: { children: React.ReactNode; appName: string; firmName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar, setPaletteOpen } = useShellStore();
  const [hydrated, setHydrated] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  React.useEffect(() => { setMobileOpen(false); }, [pathname]);

  React.useEffect(() => {
    let chord: string | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (target?.isContentEditable) return;
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (chord === "g") {
        const map: Record<string, string> = { h: "/", s: "/search", e: "/ediscovery", w: "/workflows", o: "/office", l: "/library" };
        const dest = map[e.key.toLowerCase()];
        chord = null;
        if (dest) { e.preventDefault(); router.push(dest); }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        chord = "g";
        clearTimeout(chordTimer);
        chordTimer = setTimeout(() => (chord = null), 900);
      }
      if (e.key === "[" && !typing) { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, setPaletteOpen, toggleSidebar]);

  // Icon rail is the default; labels expand on demand ("[" or the chevron).
  const expanded = hydrated && !sidebarCollapsed;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const railItem = (item: (typeof NAV)[number]) => {
    const active = isActive(item.href);
    const link = (
      <Link
        href={item.href}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center rounded-lg text-[13px] font-medium transition-colors",
          expanded ? "gap-3 px-2.5 py-2" : "size-10 justify-center",
          active ? "bg-primary/10 text-primary dark:bg-primary/15" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        )}
      >
        {active && <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary md:block" aria-hidden />}
        <item.icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "")} strokeWidth={active ? 2.25 : 1.9} />
        {expanded && <span className="flex-1 truncate">{item.label}</span>}
        {expanded && item.shortcut && <span className="text-[10px] text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">{item.shortcut}</span>}
      </Link>
    );
    return expanded ? <div key={item.href}>{link}</div> : <Tip key={item.href} label={item.label} side="right" shortcut={item.shortcut}>{link}</Tip>;
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside
        className={cn(
          "h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          expanded ? "md:w-[228px]" : "md:w-[68px]",
          "fixed inset-y-0 left-0 z-50 w-[248px] md:static md:z-auto md:flex",
          mobileOpen ? "flex shadow-2xl" : "hidden",
        )}
      >
        <div className={cn("flex h-14 items-center border-b border-sidebar-border", expanded ? "px-3.5" : "justify-center px-0")}>
          <Link href="/" className="flex min-w-0 items-center" aria-label={`${appName} home`}>
            {expanded || mobileOpen ? <BrandLockup /> : <SWMark size={32} />}
          </Link>
        </div>

        <div className={cn("pt-3", expanded ? "px-3" : "px-0 flex justify-center")}>
          <Tip label="Search or jump to anything" side="right" shortcut="⌘K">
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Search or jump to anything"
              className={cn(
                "flex items-center rounded-lg border border-transparent bg-background/70 text-muted-foreground shadow-xs transition-colors hover:border-border hover:bg-background hover:text-foreground cursor-pointer",
                expanded ? "h-9 w-full gap-2 px-2.5 text-xs" : "size-10 justify-center",
              )}
            >
              <Search className="size-4 shrink-0" />
              {expanded && (<><span className="flex-1 text-left">Search or jump to…</span><kbd className="hidden sm:inline">⌘K</kbd></>)}
            </button>
          </Tip>
        </div>

        <nav className={cn("mt-3 flex flex-1 flex-col gap-1 overflow-y-auto no-scrollbar", expanded ? "px-3" : "items-center px-0")} aria-label="Primary">
          {NAV.map(railItem)}
        </nav>

        <div className={cn("flex flex-col gap-1 border-t border-sidebar-border py-2", expanded ? "px-3" : "items-center px-0")}>
          {SECONDARY_NAV.map(railItem)}
          <Tip label={expanded ? "Collapse" : "Expand"} side="right" shortcut="[">
            <button onClick={toggleSidebar} aria-label={expanded ? "Collapse navigation" : "Expand navigation"} className={cn("flex items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground cursor-pointer", expanded ? "gap-3 px-2.5 py-2 text-[13px]" : "size-10 justify-center")}>
              {expanded ? <><ChevronLeft className="size-[18px]" /> Collapse</> : <ChevronRight className="size-[18px]" />}
            </button>
          </Tip>
          <Tip label="Sign out" side="right">
            <button aria-label="Sign out" className={cn("flex items-center rounded-lg text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground cursor-pointer", expanded ? "gap-3 px-2.5 py-2 text-[13px]" : "size-10 justify-center")} disabled>
              <LogOut className="size-[18px]" />{expanded && "Sign out"}
            </button>
          </Tip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-3 backdrop-blur md:px-4">
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen((o) => !o)}>{mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}</Button>
          <div className="min-w-0 flex-1" id="topbar-slot" />
          <div className="flex items-center gap-1">
            <AiStatusBadge />
            <ThemeToggle />
            <Tip label="Notifications">
              <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications"><Bell className="size-4" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-destructive" /></Button>
            </Tip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 rounded-full ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer" aria-label="Account menu"><PersonAvatar name={CURRENT_USER.name} /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium text-foreground">{CURRENT_USER.name}</div>
                  <div className="text-xs">{CURRENT_USER.role} · {firmName}</div>
                  <div className="text-xs text-muted-foreground">{CURRENT_USER.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/settings#ai">AI configuration</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/settings#integrity">Data integrity</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}

function AiStatusBadge() {
  const [status, setStatus] = React.useState<{ configured: boolean; model: string } | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/ai/status").then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setStatus({ configured: Boolean(j.configured), model: String(j.model ?? "") }); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!status) return null;
  return status.configured ? (
    <Tip label={`OpenAI · ${status.model}`}><Badge variant="success" className="hidden md:inline-flex gap-1.5 rounded-full px-2.5 py-1"><Sparkles className="size-3" /> AI live</Badge></Tip>
  ) : (
    <Tip label="Add OPENAI_API_KEY to .env.local to enable AI features"><Link href="/settings#ai"><Badge variant="warning" className="hidden md:inline-flex gap-1.5 rounded-full px-2.5 py-1 cursor-pointer"><KeyRound className="size-3" /> AI: add key</Badge></Link></Tip>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme"><Sun className="size-4 dark:hidden" /><Moon className="size-4 hidden dark:block" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")} className={cn(theme === "light" && "bg-accent")}><Sun /> Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className={cn(theme === "dark" && "bg-accent")}><Moon /> Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className={cn(theme === "system" && "bg-accent")}><Monitor /> System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Portal a page's own header content into the top bar. */
export function TopbarSlot({ children }: { children: React.ReactNode }) {
  const [el, setEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => setEl(document.getElementById("topbar-slot")), []);
  if (!el) return null;
  return createPortal(<div className="flex min-w-0 items-center gap-2 text-sm">{children}</div>, el);
}
