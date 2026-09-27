"use client";
import * as React from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, MessageSquareText, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { dueText, fmtDate, fmtDateLong, fmtTime, greetingFor, DATE_ONLY_RE } from "../time";
import { EVENT_KIND_LABEL } from "../types";
import { useHomeUI } from "../store";
import { useHome } from "./home-provider";
import { computeTodaySpine, type SpineDeadline } from "./today-spine-model";

/** "Good morning, Dana." with the first name, or no name at all before setup. */
export function greetingLine(now: Date, userName: string): string {
  const first = userName.trim().split(/\s+/)[0] ?? "";
  return `${greetingFor(now)}${first ? `, ${first}` : ""}.`;
}

/**
 * The "Today" spine: the greeting, then three quiet columns that answer the
 * litigator's first questions — what is due next, what is on today, and what
 * of mine is late. Due dates are plain text; only overdue items use the danger
 * color. Before the first matter exists and with nothing scheduled, only the
 * greeting and the create actions are shown.
 */
export function TodaySpine({ firstRun = false }: { firstRun?: boolean }) {
  const { now, userId, userName, events, tasks, matterOverview, matterFilter, matterById, aiConfigured } = useHome();
  const setFocus = useHomeUI((s) => s.setFocus);
  const setTaskFilter = useHomeUI((s) => s.setTaskFilter);
  const openEvent = useHomeUI((s) => s.openEvent);
  const openTaskDialog = useHomeUI((s) => s.openTaskDialog);
  const openEventDialog = useHomeUI((s) => s.openEventDialog);
  const askAssistant = useHomeUI((s) => s.askAssistant);
  const spine = React.useMemo(() => computeTodaySpine({ now, userId, matterFilter, events, tasks, matterOverview }), [now, userId, matterFilter, events, tasks, matterOverview]);
  const matter = matterById(matterFilter);
  const myTasks = [...spine.overdueTasks, ...spine.dueTodayTasks].slice(0, 5);
  const empty = spine.deadlines.length === 0 && spine.todayEvents.length === 0 && myTasks.length === 0;
  const showColumns = !(firstRun && empty);

  return (
    <section aria-label="Today">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-3">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold leading-tight tracking-tight">{greetingLine(now, userName)}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{fmtDateLong(now)}{matter ? ` · ${matter.shortName}` : ""}{showColumns ? ` · ${spine.summary}` : ""}</p>
        </div>
        {/* Creation lives in the top bar's New menu; the first-run page repeats it next to the greeting. */}
        {(firstRun || aiConfigured) && (
          <div className="flex flex-wrap items-center gap-1">
            {firstRun && <Button variant="ghost" size="xs" onClick={() => openTaskDialog({})}><Plus className="size-3" /> Task</Button>}
            {firstRun && <Button variant="ghost" size="xs" onClick={() => openEventDialog({})}><CalendarClock className="size-3" /> Event</Button>}
            {!firstRun && aiConfigured && <Button variant="ghost" size="xs" onClick={() => askAssistant("What should I focus on today? Use my calendar, overdue tasks and matter deadlines, and cite the matter for each item.")}><MessageSquareText className="size-3" /> Ask about today</Button>}
          </div>
        )}
      </div>
      {showColumns && (
        <div className="grid gap-x-8 gap-y-4 border-t pt-3 md:grid-cols-3">
          <SpineColumn title="Next deadlines" count={spine.deadlines.length} onOpen={() => setFocus("calendar")} openLabel="Calendar">
            {spine.deadlines.length === 0 ? <Quiet>No deadlines in the next 120 days{matter ? ` on ${matter.shortName}` : ""}.</Quiet> : (
              <ul>{spine.deadlines.map((d) => <DeadlineRow key={d.id} d={d} now={now} matterName={matterById(d.matterId)?.shortName} onOpen={() => (d.source === "event" ? openEvent(d.id) : undefined)} />)}</ul>
            )}
          </SpineColumn>
          <SpineColumn title="Today" count={spine.todayEvents.length} onOpen={() => setFocus("calendar")} openLabel="Calendar">
            {spine.todayEvents.length === 0 ? <Quiet>Nothing on the calendar today.</Quiet> : (
              <ul>
                {spine.todayEvents.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <button onClick={() => openEvent(e.id)} className={ROW}>
                      <span className="w-[52px] shrink-0 text-[11.5px] tabular text-muted-foreground">{e.allDay || DATE_ONLY_RE.test(e.startsAt) ? "All day" : fmtTime(e.startsAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{e.title}</span>
                      <span className="hidden shrink-0 text-[11.5px] text-muted-foreground lg:inline">{EVENT_KIND_LABEL[e.kind]}</span>
                    </button>
                  </li>
                ))}
                {spine.todayEvents.length > 5 && <li className="px-1.5 text-[11.5px] text-muted-foreground">{spine.todayEvents.length - 5} more</li>}
              </ul>
            )}
          </SpineColumn>
          <SpineColumn title="My tasks" count={spine.overdueTasks.length + spine.dueTodayTasks.length} onOpen={() => { setTaskFilter({ mine: true, overdue: false }); setFocus("tasks"); }} openLabel="All tasks">
            {myTasks.length === 0 ? <Quiet>Nothing of yours is overdue or due today.</Quiet> : (
              <ul>
                {myTasks.map((t) => {
                  const due = dueText(t.dueAt!, now);
                  return (
                    <li key={t.id}>
                      <button onClick={() => openTaskDialog({ taskId: t.id })} className={ROW}>
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</span>
                        <span className={cn("shrink-0 text-[11.5px] tabular", due.overdue ? "text-destructive" : "text-muted-foreground")}>{due.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SpineColumn>
        </div>
      )}
    </section>
  );
}

const ROW = "flex h-7 w-full items-center gap-2 rounded px-1.5 text-left hover:bg-accent/50 cursor-pointer focus-ring";

function SpineColumn({ title, count, onOpen, openLabel, children }: { title: string; count: number; onOpen: () => void; openLabel: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex h-6 items-center gap-2 px-1.5">
        <h2 className="text-[12.5px] font-medium">{title}</h2>
        {count > 0 && <span className="text-[11.5px] tabular text-muted-foreground">{count}</span>}
        <button onClick={onOpen} className="ml-auto inline-flex items-center gap-0.5 rounded text-[11.5px] text-muted-foreground hover:text-foreground cursor-pointer focus-ring">{openLabel}<ChevronRight className="size-3" /></button>
      </div>
      {children}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1 text-[12px] text-muted-foreground">{children}</p>;
}

function DeadlineRow({ d, now, matterName, onOpen }: { d: SpineDeadline; now: Date; matterName?: string; onOpen: () => void }) {
  const due = dueText(d.date, now);
  const inner = (
    <>
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{d.title}</span>
      <span className="hidden shrink-0 text-[11.5px] tabular text-muted-foreground xl:inline">{fmtDate(d.date, { month: "short", day: "numeric" })}{matterName ? ` · ${matterName}` : ""}</span>
      <span className={cn("w-[76px] shrink-0 text-right text-[11.5px] tabular", due.overdue ? "text-destructive" : "text-muted-foreground")} title={new Date(d.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>{due.text}</span>
    </>
  );
  return <li>{d.source === "event" ? <button onClick={onOpen} className={ROW}>{inner}</button> : <Link href={d.href ?? "#"} className={ROW}>{inner}</Link>}</li>;
}
