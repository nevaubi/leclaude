"use client";
import * as React from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, CheckSquare, ChevronRight, Gavel, MessageSquareText, Plus, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { countdown, fmtDate, fmtDateLong, fmtTime, greetingFor, DATE_ONLY_RE } from "../time";
import { EVENT_KIND_LABEL } from "../types";
import { useHomeUI } from "../store";
import { useHome } from "./home-provider";
import { computeTodaySpine, deadlineTone, type SpineDeadline } from "./today-spine-model";
import { KindDot, PriorityBadge } from "./shared";

/**
 * The "Today" spine: one dense strip that answers the litigator's first three
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
    <section className="rounded-md border bg-card" aria-label="Today">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="font-serif text-[16px] leading-tight tracking-tight">{greetingFor(now)}, {first}.</h1>
            <span className="text-[11px] tabular text-muted-foreground">{fmtDateLong(now)}{matter ? ` · ${matter.shortName}` : ""}</span>
          </div>
          <p className="text-[12px] text-muted-foreground">{spine.summary}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="xs" onClick={() => openTaskDialog({})}><Plus className="size-3" /> Task</Button>
          <Button variant="outline" size="xs" onClick={() => openEventDialog({})}><CalendarClock className="size-3" /> Event</Button>
          <Button variant="outline" size="xs" onClick={() => askAssistant("What should I focus on today? Use my calendar, overdue tasks and matter deadlines, and cite the matter for each item.")}><MessageSquareText className="size-3" /> Ask about today</Button>
        </div>
      </div>
      <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        <SpineColumn icon={Gavel} title="Next deadlines" count={spine.deadlines.length} onOpen={() => setFocus("calendar")} openLabel="Calendar">
          {spine.deadlines.length === 0 ? <Quiet>No deadlines in the next 120 days{matter ? ` on ${matter.shortName}` : ""}.</Quiet> : (
            <ul>{spine.deadlines.map((d) => <DeadlineRow key={d.id} d={d} now={now} matterName={matterById(d.matterId)?.shortName} onOpen={() => (d.source === "event" ? openEvent(d.id) : undefined)} />)}</ul>
          )}
        </SpineColumn>
        <SpineColumn icon={CalendarDays} title="Today" count={spine.todayEvents.length} onOpen={() => setFocus("calendar")} openLabel="Calendar">
          {spine.todayEvents.length === 0 ? <Quiet>Nothing on the calendar today.</Quiet> : (
            <ul>
              {spine.todayEvents.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <button onClick={() => openEvent(e.id)} className="flex h-[26px] w-full items-center gap-2 rounded px-1.5 text-left hover:bg-accent/60 cursor-pointer focus-ring">
                    <span className="w-[52px] shrink-0 text-[11px] tabular text-muted-foreground">{e.allDay || DATE_ONLY_RE.test(e.startsAt) ? "All day" : fmtTime(e.startsAt)}</span>
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
            <ul>
              {myTasks.map((t) => {
                const c = countdown(t.dueAt!, now, { deadline: true });
                return (
                  <li key={t.id}>
                    <button onClick={() => openTaskDialog({ taskId: t.id })} className="flex h-[26px] w-full items-center gap-2 rounded px-1.5 text-left hover:bg-accent/60 cursor-pointer focus-ring">
                      <PriorityBadge priority={t.priority} compact />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</span>
                      <Chip tone={c.urgency === "overdue" ? "danger" : "warning"} className="shrink-0 tabular">{c.label}</Chip>
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
    <div className="min-w-0 px-2 py-1.5">
      <div className="mb-0.5 flex h-6 items-center gap-1.5 px-1.5">
        <Icon className={cn("size-3.5", tone === "danger" ? "text-destructive" : "text-muted-foreground")} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className={cn("section-count", tone === "danger" && count > 0 && "text-destructive")}>{count}</span>
        <button onClick={onOpen} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary cursor-pointer focus-ring rounded">{openLabel}<ChevronRight className="size-3" /></button>
      </div>
      {children}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1.5 text-[12px] text-muted-foreground">{children}</p>;
}

function DeadlineRow({ d, now, matterName, onOpen }: { d: SpineDeadline; now: Date; matterName?: string; onOpen: () => void }) {
  const c = countdown(d.date, now, { deadline: true });
  const tone = deadlineTone(d.days);
  const Icon = d.kind === "hearing" ? Gavel : d.kind === "key-date" ? Scale : CalendarClock;
  const inner = (
    <>
      <Icon className={cn("size-3.5 shrink-0", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{d.title}</span>
      <span className="hidden shrink-0 text-[11px] tabular text-muted-foreground lg:inline">{fmtDate(d.date, { weekday: "short", month: "short", day: "numeric" })}{matterName ? ` · ${matterName}` : ""}</span>
      <Chip tone={tone} className="shrink-0 tabular" title={new Date(d.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>{c.label}</Chip>
    </>
  );
  const cls = "flex h-[26px] w-full items-center gap-2 rounded px-1.5 text-left hover:bg-accent/60 cursor-pointer focus-ring";
  return <li>{d.source === "event" ? <button onClick={onOpen} className={cls}>{inner}</button> : <Link href={d.href ?? "#"} className={cls}>{inner}</Link>}</li>;
}
