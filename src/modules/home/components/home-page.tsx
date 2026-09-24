"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, CheckSquare, ChevronDown, Home as HomeIcon, Keyboard, MessageSquarePlus, Plus, RefreshCw, Scale, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { HomeInitialData } from "../types";
import { fmtDateLong, greetingFor } from "../time";
import { useHomeUI, type HomeSection } from "../store";
import { HomeProvider, useHome } from "./home-provider";
import { BriefStats, DailyBriefCard } from "./daily-brief";
import { CalendarFocus, CalendarOverview, EventDialog, EventSheet } from "./calendar";
import { TaskDialog, TasksFocus, TasksOverview } from "./tasks";
import { NewsFocus, NewsOverview } from "./news-feed";
import { UpdatesFocus, UpdatesOverview } from "./team-updates";
import { MattersFocus, MattersOverview } from "./matters-overview";
import { AssistantDock } from "./assistant-dock";

export function HomePage({ initial }: { initial: HomeInitialData }) {
  return (
    <HomeProvider initial={initial}>
      <HomeLayout />
      <EventSheet />
      <EventDialog />
      <TaskDialog />
      <React.Suspense fallback={null}><DeepLinkHandler /></React.Suspense>
    </HomeProvider>
  );
}

/** Honors /?task=<id>, /?event=<id> and /?section=<calendar|tasks|news|updates|matters> deep links (command palette, workflow artifacts). */
function DeepLinkHandler() {
  const params = useSearchParams();
  const openTaskDialog = useHomeUI((s) => s.openTaskDialog);
  const openEvent = useHomeUI((s) => s.openEvent);
  const setFocus = useHomeUI((s) => s.setFocus);
  const task = params.get("task");
  const event = params.get("event");
  const section = params.get("section") as HomeSection | null;
  React.useEffect(() => {
    if (task) openTaskDialog({ taskId: task });
    if (event) openEvent(event);
    if (section && ["calendar", "tasks", "news", "updates", "matters"].includes(section)) setFocus(section);
  }, [task, event, section, openTaskDialog, openEvent, setFocus]);
  return null;
}

const ALL = "__all__";

function HomeLayout() {
  const focus = useHomeUI((s) => s.focus);
  const setFocus = useHomeUI((s) => s.setFocus);
  const mainRef = React.useRef<HTMLDivElement>(null);
  useHomeShortcuts();

  // Reset scroll when switching between overview and a focused section.
  React.useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [focus]);

  return (
    <div className="flex h-full min-h-0">
      <Topbar />
      <div ref={mainRef} className={cn("flex min-w-0 flex-1 flex-col overflow-y-auto scrollbar-thin", focus && "overflow-hidden")}>
        {focus ? (
          <div className="flex h-full min-h-0 flex-col p-3">
            <FocusedSection section={focus} onClose={() => setFocus(null)} />
          </div>
        ) : (
          <Overview />
        )}
      </div>
      <AssistantDock />
    </div>
  );
}

function Overview() {
  const { now, userName } = useHome();
  const first = userName.split(" ")[0];
  return (
    <div className="@container mx-auto w-full max-w-[1600px] space-y-4 p-4 pb-8">
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @6xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="flex flex-col gap-1 py-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{fmtDateLong(now)}</div>
          <h1 className="font-serif text-3xl leading-tight tracking-tight text-balance">{greetingFor(now)}, {first}.</h1>
          <p className="max-w-md text-sm text-muted-foreground">Your calendar, tasks, matter deadlines and the team&rsquo;s updates in one place. The brief on the right is rebuilt each morning.</p>
          <QuickActions />
          <BriefStats className="mt-4" />
        </div>
        <DailyBriefCard />
      </div>
      {/* 1 column → 2 columns (calendar/tasks/matters left, news/updates right) → 3 columns; driven by the container width so the assistant dock can open/close without breaking the layout. */}
      <div className="grid gap-4 @3xl:grid-cols-2 @5xl:grid-cols-[minmax(0,10fr)_minmax(0,13fr)_minmax(0,10fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CalendarOverview />
        </div>
        <div className="flex min-w-0 flex-col gap-4 @3xl:col-start-2 @3xl:row-span-2 @5xl:col-start-auto @5xl:row-span-1">
          <NewsOverview />
          <UpdatesOverview />
        </div>
        <div className="flex min-w-0 flex-col gap-4 @3xl:col-start-1 @5xl:col-start-auto">
          <TasksOverview />
          <MattersOverview />
        </div>
      </div>
    </div>
  );
}

function QuickActions() {
  const openTaskDialog = useHomeUI((s) => s.openTaskDialog);
  const openEventDialog = useHomeUI((s) => s.openEventDialog);
  const focusComposer = useHomeUI((s) => s.focusComposer);
  const askAssistant = useHomeUI((s) => s.askAssistant);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Button variant="outline" size="xs" onClick={() => openTaskDialog({})}><CheckSquare className="size-3" /> Task</Button>
      <Button variant="outline" size="xs" onClick={() => openEventDialog({})}><CalendarPlus className="size-3" /> Event</Button>
      <Button variant="outline" size="xs" onClick={focusComposer}><MessageSquarePlus className="size-3" /> Update</Button>
      <Button variant="outline" size="xs" onClick={() => askAssistant("What should I focus on today? Use my calendar, overdue tasks and matter deadlines.")}><Sparkles className="size-3 text-primary" /> Ask about today</Button>
    </div>
  );
}

function FocusedSection({ section, onClose }: { section: HomeSection; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  switch (section) {
    case "calendar": return <CalendarFocus />;
    case "tasks": return <TasksFocus />;
    case "news": return <NewsFocus />;
    case "updates": return <UpdatesFocus />;
    case "matters": return <MattersFocus />;
  }
}

function Topbar() {
  const { matters, matterFilter, setMatterFilter, refresh, refreshing } = useHome();
  const focus = useHomeUI((s) => s.focus);
  const setFocus = useHomeUI((s) => s.setFocus);
  const openTaskDialog = useHomeUI((s) => s.openTaskDialog);
  const openEventDialog = useHomeUI((s) => s.openEventDialog);
  const focusComposer = useHomeUI((s) => s.focusComposer);
  const dockOpen = useHomeUI((s) => s.dockOpen);
  const setDockOpen = useHomeUI((s) => s.setDockOpen);
  const sectionLabel: Record<HomeSection, string> = { calendar: "Calendar", tasks: "Tasks", news: "News", updates: "Team updates", matters: "Matters" };
  return (
    <TopbarSlot>
      <HomeIcon className="size-4 text-muted-foreground" />
      <button onClick={() => setFocus(null)} className="shrink-0 text-sm font-semibold hover:text-primary cursor-pointer">Home</button>
      {focus && <><span className="text-muted-foreground">/</span><span className="text-sm text-muted-foreground">{sectionLabel[focus]}</span><Button variant="ghost" size="icon-xs" onClick={() => setFocus(null)} aria-label="Back to overview"><X className="size-3.5" /></Button></>}
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        <Select value={matterFilter ?? ALL} onValueChange={(v) => setMatterFilter(v === ALL ? null : v)}>
          <SelectTrigger size="sm" className={cn("h-7 w-auto min-w-[150px] max-w-[240px] gap-1.5 text-[12px]", matterFilter && "border-primary/40 bg-primary/5 text-primary")} aria-label="Matter filter">
            <Scale className="size-3.5 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="All matters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All matters</SelectItem>
            {matters.map((m) => <SelectItem key={m.id} value={m.id}>{m.shortName} <span className="text-muted-foreground">· {m.caption ?? m.practiceArea}</span></SelectItem>)}
          </SelectContent>
        </Select>
        {matterFilter && <Badge variant="info" className="hidden lg:inline-flex">Filtered</Badge>}
      </div>
      <div className="flex-1" />
      <Tip label="Refresh data"><Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh"><RefreshCw className={cn("size-4", refreshing && "animate-spin")} /></Button></Tip>
      <ShortcutsHelp />
      <Tip label={dockOpen ? "Hide assistant" : "Show assistant"} shortcut="A"><Button variant={dockOpen ? "secondary" : "ghost"} size="icon-sm" onClick={() => setDockOpen(!dockOpen)} aria-label="Toggle assistant"><Sparkles className="size-4" /></Button></Tip>
      <div className="ml-1 flex items-center">
        <Button size="sm" className="rounded-r-none" onClick={() => openTaskDialog({})}><Plus className="size-4" /> New task</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-2" aria-label="More new items"><ChevronDown className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Create</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => openTaskDialog({})}><CheckSquare /> Task<DropdownMenuShortcut>N T</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => openEventDialog({})}><CalendarPlus /> Event<DropdownMenuShortcut>N E</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={focusComposer}><MessageSquarePlus /> Team update<DropdownMenuShortcut>N U</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setFocus("calendar"); }}>Open calendar<DropdownMenuShortcut>C</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => { useHomeUI.getState().setTasksView("board"); setFocus("tasks"); }}>Open task board<DropdownMenuShortcut>K</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TopbarSlot>
  );
}

function ShortcutsHelp() {
  const rows: [string, string][] = [["N T / N E / N U", "New task / event / update"], ["A", "Toggle assistant"], ["C", "Open calendar"], ["K", "Open task board"], ["Esc", "Back to overview"], ["[ ]  T  M W D", "Calendar: prev/next, today, month/week/agenda"], ["↵ Space S E ⌫", "Task row: rename, complete, next status, details, delete"], ["⌘K", "Command palette"], ["G H / G S / G E", "Go to Home / Search / E-Discovery"]];
  return (
    <Popover>
      <Tip label="Keyboard shortcuts"><PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts"><Keyboard className="size-4" /></Button></PopoverTrigger></Tip>
      <PopoverContent align="end" className="w-80">
        <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Keyboard shortcuts</div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([k, v]) => <React.Fragment key={k}><dt><kbd className="whitespace-nowrap">{k}</kbd></dt><dd className="text-muted-foreground">{v}</dd></React.Fragment>)}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** Page-level chords and single-key shortcuts (ignored while typing or when a dialog is open). */
function useHomeShortcuts() {
  React.useEffect(() => {
    let chord: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const s = useHomeUI.getState();
      const k = e.key.toLowerCase();
      if (chord === "n") {
        chord = null;
        if (k === "t") { e.preventDefault(); s.openTaskDialog({}); }
        else if (k === "e") { e.preventDefault(); s.openEventDialog({}); }
        else if (k === "u") { e.preventDefault(); s.focusComposer(); }
        return;
      }
      if (chord === "g") { chord = null; return; } // shell navigation chord
      if (k === "n" || k === "g") { chord = k; clearTimeout(timer); timer = setTimeout(() => (chord = null), 900); return; }
      if (k === "a") { e.preventDefault(); s.setDockOpen(!s.dockOpen); }
      else if (k === "c") { e.preventDefault(); s.setFocus("calendar"); }
      else if (k === "k") { e.preventDefault(); s.setTasksView("board"); s.setFocus("tasks"); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, []);
}

