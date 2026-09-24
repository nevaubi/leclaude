"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Moon, Search, Sun, Monitor, Menu, X, KeyRound, LogOut, ShieldAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { GO_CHORD, NAV, SECONDARY_NAV } from "./nav";
import { useShellStore } from "./shell-store";
import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/ui/avatar";
import { CommandPalette } from "./command-palette";
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
        const dest = GO_CHORD[e.key.toLowerCase()];
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
          "group relative flex items-center rounded-lg text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          expanded ? "gap-3 px-2.5 py-2" : "size-10 justify-center",
          active ? "bg-primary/10 text-primary dark:bg-primary/15" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        )}
      >
        {/* Active indicator: a short bar on the rail edge, aligned to the icon. */}
        <span className={cn("absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary transition-opacity", expanded ? "-left-3" : "-left-[14px]", active ? "opacity-100" : "opacity-0")} aria-hidden />
        <item.icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "")} strokeWidth={active ? 2.25 : 1.9} />
        {expanded && <span className="flex-1 truncate">{item.label}</span>}
        {expanded && item.shortcut && <span className="text-[10px] tabular text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">{item.shortcut}</span>}
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
        <div className={cn("flex h-[52px] items-center border-b border-sidebar-border", expanded ? "px-3.5" : "justify-center px-0")}>
          <Link href="/" className="flex min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`${appName} home`}>
            {expanded || mobileOpen ? <BrandLockup /> : <SWMark size={30} />}
          </Link>
        </div>

        <div className={cn("pt-3", expanded ? "px-3" : "px-0 flex justify-center")}>
          <Tip label="Search or jump to anything" side="right" shortcut="⌘K">
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Search or jump to anything"
              className={cn(
                "flex items-center rounded-lg border border-transparent bg-background/70 text-muted-foreground shadow-xs transition-colors hover:border-border hover:bg-background hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
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
            <button onClick={toggleSidebar} aria-label={expanded ? "Collapse navigation" : "Expand navigation"} className={cn("flex items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", expanded ? "gap-3 px-2.5 py-2 text-[13px]" : "size-10 justify-center")}>
              {expanded ? <><ChevronLeft className="size-[18px]" /> Collapse</> : <ChevronRight className="size-[18px]" />}
            </button>
          </Tip>
          {expanded && (
            <button aria-label="Sign out" className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground" disabled>
              <LogOut className="size-[18px]" /> Sign out
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b bg-background px-3 md:px-4">
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen((o) => !o)}>{mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}</Button>
          <div className="min-w-0 flex-1" id="topbar-slot" />
          <div className="flex items-center gap-0.5">
            <AiStatus />
            <ReviewQueueIndicator />
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 rounded-full ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer" aria-label="Account menu"><PersonAvatar name={CURRENT_USER.name} /></button>
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
                <DropdownMenuItem asChild><Link href="/settings#review">Review queue</Link></DropdownMenuItem>
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

/** Quiet AI indicator: a dot when live; a small "add key" chip when nothing is configured. */
function AiStatus() {
  const [status, setStatus] = React.useState<{ configured: boolean; model: string } | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/ai/status").then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setStatus({ configured: Boolean(j.configured), model: String(j.model ?? "") }); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!status) return null;
  return status.configured ? (
    <Tip label={`OpenAI · ${status.model}`}><span className="hidden h-8 items-center gap-1.5 px-2 text-[11px] text-muted-foreground md:inline-flex" aria-label="AI live"><span className="size-1.5 rounded-full bg-success" /> <Sparkles className="size-3" /></span></Tip>
  ) : (
    <Tip label="Add OPENAI_API_KEY to .env.local to enable AI features"><Link href="/settings#ai" className="chip chip-warning hidden md:inline-flex"><KeyRound className="size-3" /> AI: add key</Link></Tip>
  );
}

/** Pending AI records awaiting a human decision; links to the review queue. Hidden when none or when the endpoint is unavailable. */
function ReviewQueueIndicator() {
  const pathname = usePathname();
  const [pending, setPending] = React.useState<number | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/integrity/scan").then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j?.review) setPending(Number(j.review.pending ?? 0)); }).catch(() => {});
    return () => { alive = false; };
  }, [pathname]);
  if (!pending) return null;
  return (
    <Tip label={`${pending} AI record${pending === 1 ? "" : "s"} awaiting review`}>
      <Link href="/settings#review" className="chip chip-quiet hidden md:inline-flex" aria-label="Review queue"><ShieldAlert className="size-3 text-warning" /> {pending}</Link>
    </Tip>
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
