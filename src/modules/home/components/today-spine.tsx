"use client";
import * as React from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, CheckSquare, ChevronRight, Gavel, Plus, Scale, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { countdown, fmtDate, fmtDateLong, fmtTime, greetingFor, DATE_ONLY_RE } from "../time";
import { EVENT_KIND_LABEL } from "../types";
import { useHomeUI } from "../store";
import { useHome } from "./home-provider";
import { computeTodaySpine, deadlineTone, type SpineDeadline } from "./today-spine-model";
import { KindDot, MatterBadge, PriorityBadge } from "./shared";

/**
 * The "Today" spine: one calm row that answers the litigator's first three
 * questions — what is due next, what is on today, and what of mine is late.
 */
export function TodaySpine() {
  const { now, userId, userName, events, tasks, matterOverview, matterFilter, matterById } = useHome();
  const setFocus = useHomeUI((s) => s.setFocus);
  const setTaskFilter = useHomeUI((s) => s.setTaskFilter);
  const openEvent = useHomeUI((s) => s.openEvent);
  const openTaskDialog = useHomeUI((s) => s.openTaskDialog);
  const openEventDialog = useHomeUI((s) => s.openEventDialog);
  const askAssistant = useHomeUI((s) => s.askAssistant);
  const spine = React.useMemo(() => computeTodaySpine({ now, userId, matterFilter, events, tasks, matterOverview }), [now, userId, matterFilter, events, tasks, matterOverview]);
  const first = userName.split(" ")[0];
  const matter = matterById(matterFilter);
  const myTasks = [...spine.overdueTasks, ...spine.dueTodayTasks].slice(0, 5);

  return (
    <section className="rounded-xl border bg-card shadow-xs" aria-label="Today">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{fmtDateLong(now)}{matter ? ` · ${matter.shortName}` : ""}</div>
          <h1 className="mt-0.5 font-serif text-[22px] leading-tight tracking-tight text-balance">{greetingFor(now)}, {first}.</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{spine.summary}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="xs" onClick={() => openTaskDialog({})}><Plus className="size-3" /> Task</Button>
          <Button variant="outline" size="xs" onClick={() => openEventDialog({})}><CalendarClock className="size-3" /> Event</Button>
          <Button variant="outline" size="xs" onClick={() => askAssistant("What should I focus on today? Use my calendar, overdue tasks and matter deadlines, and cite the matter for each item.")}><Sparkles className="size-3 text-primary" /> Ask about today</Button>
        </div>
      </div>
      <div className="grid divide-y border-t md:grid-cols-3 md:divide-x md:divide-y-0">
        <SpineColumn icon={Gavel} title="Next deadlines" count={spine.deadlines.length} onOpen={() => setFocus("calendar")} openLabel="Calendar">
          {spine.deadlines.length === 0 ? <Quiet>No deadlines in the next 120 days{matter ? ` on ${matter.shortName}` : ""}.</Quiet> : (
            <ul className="space-y-0.5">{spine.deadlines.map((d) => <DeadlineRow key={d.id} d={d} now={now} onOpen={() => (d.source === "event" ? openEvent(d.id) : undefined)} />)}</ul>
          )}
        </SpineColumn>
        <SpineColumn icon={CalendarDays} title="Today" count={spine.todayEvents.length} onOpen={() => setFocus("calendar")} openLabel="Calendar">
          {spine.todayEvents.length === 0 ? <Quiet>Nothing on the calendar today.</Quiet> : (
            <ul className="space-y-0.5">
              {spine.todayEvents.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <button onClick={() => openEvent(e.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/60 cursor-pointer focus-ring">
                    <span className="w-[54px] shrink-0 text-[11px] tabular text-muted-foreground">{e.allDay || DATE_ONLY_RE.test(e.startsAt) ? "All day" : fmtTime(e.startsAt)}</span>
                    <KindDot kind={e.kind} className="size-1.5" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{e.title}</span>
                    <span className="hidden text-[10.5px] text-muted-foreground lg:inline">{EVENT_KIND_LABEL[e.kind]}</span>
                  </button>
                </li>
              ))}
              {spine.todayEvents.length > 5 && <li className="px-1.5 text-[11px] text-muted-foreground">+{spine.todayEvents.length - 5} more</li>}
            </ul>
          )}
        </SpineColumn>
        <SpineColumn icon={CheckSquare} title="My tasks" count={spine.overdueTasks.length + spine.dueTodayTasks.length} tone={spine.overdueTasks.length ? "danger" : undefined} onOpen={() => { setTaskFilter({ mine: true, overdue: false }); setFocus("tasks"); }} openLabel="All tasks">
          {myTasks.length === 0 ? <Quiet>Nothing of yours is overdue or due today.</Quiet> : (
            <ul className="space-y-0.5">
              {myTasks.map((t) => {
                const c = countdown(t.dueAt!, now, { deadline: true });
                return (
                  <li key={t.id}>
                    <button onClick={() => openTaskDialog({ taskId: t.id })} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/60 cursor-pointer focus-ring">
                      <PriorityBadge priority={t.priority} compact />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</span>
                      <Chip tone={c.urgency === "overdue" ? "danger" : "warning"} className="shrink-0">{c.label}</Chip>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SpineColumn>
      </div>
    </section>
  );
}

function SpineColumn({ icon: Icon, title, count, tone, onOpen, openLabel, children }: { icon: React.ComponentType<{ className?: string }>; title: string; count: number; tone?: "danger"; onOpen: () => void; openLabel: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
        <Icon className={cn("size-3.5", tone === "danger" ? "text-destructive" : "text-muted-foreground")} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className={cn("section-count", tone === "danger" && count > 0 && "bg-destructive/10 text-destructive")}>{count}</span>
        <button onClick={onOpen} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary cursor-pointer focus-ring rounded">{openLabel}<ChevronRight className="size-3" /></button>
      </div>
      {children}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-2 text-[12px] text-muted-foreground">{children}</p>;
}

function DeadlineRow({ d, now, onOpen }: { d: SpineDeadline; now: Date; onOpen: () => void }) {
  const c = countdown(d.date, now, { deadline: true });
  const tone = deadlineTone(d.days);
  const Icon = d.kind === "hearing" ? Gavel : d.kind === "key-date" ? Scale : CalendarClock;
  const inner = (
    <>
      <Icon className={cn("size-3.5 shrink-0", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium leading-snug">{d.title}</span>
        <span className="block truncate text-[10.5px] tabular text-muted-foreground">{fmtDate(d.date, { weekday: "short", month: "short", day: "numeric" })}{d.matterId ? " · " : ""}<MatterBadge matterId={d.matterId} className="inline-flex h-4 border-transparent px-0 text-[10.5px]" /></span>
      </span>
      <Tip label={new Date(d.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}><Chip tone={tone} className="shrink-0 tabular">{c.label}</Chip></Tip>
    </>
  );
  const cls = "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/60 cursor-pointer focus-ring";
  return <li>{d.source === "event" ? <button onClick={onOpen} className={cls}>{inner}</button> : <Link href={d.href ?? "#"} className={cls}>{inner}</Link>}</li>;
}
