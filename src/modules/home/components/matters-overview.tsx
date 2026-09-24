"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, CalendarClock, CheckSquare, FileSearch, Filter, Flame, Library, Scale, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import type { MatterOverview as MatterOverviewRow } from "../types";
import { fmtDate } from "../time";
import { useHomeUI } from "../store";
import { useHome } from "./home-provider";
import { CountdownChip, EmptyRow, PeopleStack, Section } from "./shared";

const SIDE_LABEL: Record<MatterOverviewRow["clientSide"], string> = { plaintiff: "Plaintiff", defendant: "Defendant", petitioner: "Petitioner", respondent: "Respondent", buyer: "Buyer", seller: "Seller", other: "Client" };

export function MattersOverview() {
  const { matterOverview, matterFilter, setMatterFilter } = useHome();
  const setFocus = useHomeUI((s) => s.setFocus);
  const rows = matterFilter ? matterOverview.filter((m) => m.id === matterFilter) : matterOverview;
  return (
    <Section id="matters" title="Matters" icon={Briefcase} count={rows.length} onExpand={() => setFocus("matters")} actions={matterFilter ? <Button variant="ghost" size="xs" onClick={() => setMatterFilter(null)}><X className="size-3" /> Clear filter</Button> : undefined}>
      {rows.length === 0 ? <EmptyRow icon={Briefcase} title="No active matters" /> : (
        <ul className="divide-y">{rows.map((m) => <MatterCard key={m.id} matter={m} />)}</ul>
      )}
    </Section>
  );
}

export function MattersFocus() {
  const { matterOverview } = useHome();
  const setFocus = useHomeUI((s) => s.setFocus);
  return (
    <Section id="matters" title="Matters" icon={Briefcase} count={matterOverview.length} expanded onExpand={() => setFocus(null)} bodyClassName="overflow-auto scrollbar-thin">
      <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
        {matterOverview.map((m) => <div key={m.id} className="rounded-lg border bg-card"><MatterCard matter={m} full /></div>)}
      </div>
    </Section>
  );
}

/**
 * One matter, one glance: name and stage, the next key date with a countdown,
 * then the three numbers a litigator checks (open tasks, hot docs, events).
 * At most two chip styles per card: the quiet practice-area chip and the countdown.
 */
function MatterCard({ matter: m, full }: { matter: MatterOverviewRow; full?: boolean }) {
  const { matterFilter, setMatterFilter, personById } = useHome();
  const active = matterFilter === m.id;
  const lead = personById(m.leadAttorneyId);
  return (
    <li className={cn("group list-none px-3.5 py-3 transition-colors hover:bg-accent/30", active && "bg-primary/5")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={`/ediscovery?matter=${m.id}`} className="truncate text-[13px] font-semibold leading-snug hover:underline underline-offset-2">{m.shortName}</Link>
            <Chip tone="quiet" className="shrink-0">{m.practiceArea}</Chip>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground" title={m.name}>{m.caption ?? m.name} · {SIDE_LABEL[m.clientSide]} · {m.client}{m.status === "pre-suit" ? " · Pre-suit" : ""}</div>
          {m.stage && <div className="mt-0.5 text-[11.5px] text-foreground/80">{m.stage}</div>}
        </div>
        <Tip label={active ? "Clear matter filter" : "Filter Home to this matter"}>
          <Button variant={active ? "secondary" : "ghost"} size="icon-xs" className={cn("opacity-0 group-hover:opacity-100 focus-visible:opacity-100", active && "opacity-100")} onClick={() => setMatterFilter(active ? null : m.id)} aria-label="Filter to matter"><Filter className="size-3.5" /></Button>
        </Tip>
      </div>

      {m.nextKeyDate ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border bg-background/70 px-2 py-1.5">
          <CalendarClock className={cn("size-3.5 shrink-0", m.nextKeyDate.daysUntil <= 7 ? "text-destructive" : m.nextKeyDate.daysUntil <= 30 ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12px] font-medium">{m.nextKeyDate.label}</div>
            <div className="text-[10.5px] tabular text-muted-foreground">{fmtDate(m.nextKeyDate.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</div>
          </div>
          <CountdownChip date={m.nextKeyDate.date} deadline />
        </div>
      ) : <div className="mt-2 text-[11px] text-muted-foreground">No upcoming key dates.</div>}

      {full && m.keyDates.length > 1 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
          {m.keyDates.filter((k) => k !== m.nextKeyDate).map((k) => <li key={k.label + k.date} className="flex items-center gap-2"><span className={cn("size-1 rounded-full", k.daysUntil < 0 ? "bg-muted-foreground/40" : "bg-primary/60")} /><span className={cn("truncate", k.daysUntil < 0 && "line-through")}>{k.label}</span><span className="ml-auto tabular">{fmtDate(k.date, { month: "short", day: "numeric", year: "2-digit" })}</span></li>)}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <PeopleStack ids={m.teamIds} max={full ? 6 : 4} />
        {lead && <span className="hidden truncate xl:inline">Lead: {lead.name}</span>}
        <div className="ml-auto flex items-center gap-2.5">
          <Tip label={`${m.openTasks} open task${m.openTasks === 1 ? "" : "s"}${m.overdueTasks ? ` · ${m.overdueTasks} overdue` : ""}${m.myOpenTasks ? ` · ${m.myOpenTasks} yours` : ""}`}>
            <span className={cn("inline-flex items-center gap-1 tabular", m.overdueTasks && "text-destructive")}>{m.overdueTasks ? <AlertTriangle className="size-3" /> : <CheckSquare className="size-3" />}{m.openTasks}{m.overdueTasks ? <span className="text-[10px]">({m.overdueTasks} late)</span> : null}</span>
          </Tip>
          <Tip label={`${m.hotDocs} hot document${m.hotDocs === 1 ? "" : "s"} of ${m.docCount} in review`}>
            <span className={cn("inline-flex items-center gap-1 tabular", m.hotDocs && "text-chart-5")}><Flame className="size-3" />{m.hotDocs}<span className="text-[10px] text-muted-foreground">/{m.docCount}</span></span>
          </Tip>
          <Tip label={`${m.upcomingEvents} upcoming event${m.upcomingEvents === 1 ? "" : "s"}${m.nextEvent ? ` · next: ${m.nextEvent.title}` : ""}`}>
            <span className="inline-flex items-center gap-1 tabular"><CalendarClock className="size-3" />{m.upcomingEvents}</span>
          </Tip>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
        <Link href={`/ediscovery?matter=${m.id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><FileSearch className="size-3" /> E-Discovery</Link>
        <Link href={`/library?matter=${m.id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><Library className="size-3" /> Library</Link>
        <Link href={`/search?q=${encodeURIComponent(m.shortName)}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><Scale className="size-3" /> Research</Link>
      </div>
    </li>
  );
}
