"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronsLeft, ChevronsRight, Moon, Scale, Search, Sun, Sparkles, Monitor, Menu, X, KeyRound } from "lucide-react";
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

const CURRENT_USER = { name: "Jordan Whitfield", role: "Partner", email: "jwhitfield@callowayreyes.com" };

export function AppShell({ children, appName, firmName }: { children: React.ReactNode; appName: string; firmName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar, setPaletteOpen } = useShellStore();
  const [hydrated, setHydrated] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  React.useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Global keyboard shortcuts: ⌘K palette, "g" chords for navigation.
  React.useEffect(() => {
    let chord: string | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (target?.isContentEditable) return; // editors use ⌘K for links
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, setPaletteOpen]);

  const collapsed = hydrated && sidebarCollapsed;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex h-full w-full overflow-hidden">
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={cn("h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200", collapsed ? "md:w-[60px]" : "md:w-[236px]", "fixed inset-y-0 left-0 z-50 w-[260px] md:static md:z-auto md:flex", mobileOpen ? "flex shadow-2xl" : "hidden")}>
        <div className={cn("flex h-14 items-center gap-2 border-b border-sidebar-border px-3", collapsed && "justify-center px-0")}>
          <Link href="/" className="flex items-center gap-2 min-w-0">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Scale className="size-4" /></span>
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold">{appName}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{firmName}</span>
              </span>
            )}
          </Link>
        </div>

        <div className="px-2 pt-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className={cn("flex w-full items-center gap-2 rounded-md border bg-background/70 px-2.5 text-left text-xs text-muted-foreground shadow-xs hover:bg-background hover:text-foreground transition-colors h-8 cursor-pointer", collapsed && "justify-center px-0")}
          >
            <Search className="size-3.5 shrink-0" />
            {!collapsed && (<><span className="flex-1">Search or jump to…</span><kbd className="hidden sm:inline">⌘K</kbd></>)}
          </button>
        </div>

        <nav className="mt-3 flex-1 space-y-0.5 px-2 overflow-y-auto no-scrollbar">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-sidebar-primary/10 text-sidebar-primary dark:bg-sidebar-primary/15" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-foreground")} />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {!collapsed && item.shortcut && <span className="text-[10px] text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity">{item.shortcut}</span>}
              </Link>
            );
            return collapsed ? (
              <Tip key={item.href} label={item.label} side="right" shortcut={item.shortcut}>{link}</Tip>
            ) : (
              <div key={item.href}>
                {link}
                {item.children && active && (
                  <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l pl-2">
                    {item.children.map((c) => (
                      <Link key={c.href} href={c.href} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
                        {c.icon && <c.icon className="size-3.5" />}{c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2 space-y-0.5">
          {SECONDARY_NAV.map((item) => (
            <Link key={item.href} href={item.href} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-sidebar-foreground/80 hover:bg-sidebar-accent", collapsed && "justify-center px-0", isActive(item.href) && "bg-sidebar-primary/10 text-sidebar-primary")}>
              <item.icon className="size-4 text-muted-foreground" />
              {!collapsed && item.label}
            </Link>
          ))}
          <button onClick={toggleSidebar} className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-muted-foreground hover:bg-sidebar-accent cursor-pointer", collapsed && "justify-center px-0")} aria-label="Toggle sidebar">
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-3 md:px-4 backdrop-blur">
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen((o) => !o)}>{mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}</Button>
          <div className="min-w-0 flex-1" id="topbar-slot" />
          <div className="flex items-center gap-1.5">
            <AiStatusBadge />
            <ThemeToggle />
            <Tip label="Notifications">
              <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications"><Bell className="size-4" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-destructive" /></Button>
            </Tip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 rounded-full ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"><PersonAvatar name={CURRENT_USER.name} /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium text-foreground">{CURRENT_USER.name}</div>
                  <div className="text-xs">{CURRENT_USER.role} · {CURRENT_USER.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/settings#ai">AI configuration</Link></DropdownMenuItem>
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
