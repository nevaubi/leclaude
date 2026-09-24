"use client";
import * as React from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { TrustBadge } from "@/components/ai/trust-badge";
import { useHome } from "./home-provider";
import { Section } from "./shared";
import { EVENT_KIND_LABEL } from "../types";
import type { UpcomingPrep } from "@/modules/intel/context/types";
import { INSIGHT_KIND_LABEL, fmtDate } from "@/modules/intel/analysis/pure";

/**
 * Upcoming events with preparation material: the insights and records the
 * intelligence layer links to each event in the next two weeks. Renders only
 * when at least one event has something to prepare with.
 */
export function UpcomingPrepSection() {
  const { userId, matterFilter, intelInsights } = useHome();
  const [items, setItems] = React.useState<UpcomingPrep[] | null>(null);
  React.useEffect(() => {
    if (!intelInsights) { setItems([]); return; }
    let alive = true;
    fetch(`/api/intel/context?userId=${encodeURIComponent(userId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setItems(Array.isArray(j?.user?.upcoming) ? (j.user.upcoming as UpcomingPrep[]) : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [userId, intelInsights]);
  const shown = (items ?? []).filter((u) => (u.insights.length || u.records.length) && (!matterFilter || u.event.matterId === matterFilter));
  if (!shown.length) return null;
  return (
    <Section id="upcoming-prep" title="Prepare" icon={CalendarClock} count={shown.length} description="What the intelligence layer has for your next events" actions={<Link href="/?section=calendar" className="text-[11px] text-muted-foreground hover:text-primary">Calendar</Link>}>
      <ul className="divide-y divide-line-quiet">
        {shown.slice(0, 4).map((u) => (
          <li key={u.event.id} className="px-3 py-1.5">
            <div className="flex items-center gap-3 text-[12.5px]">
              <span className="w-[80px] shrink-0 tabular text-[11px] text-muted-foreground">{fmtDate(u.event.startsAt)}</span>
              <span className="w-[70px] shrink-0 truncate text-[11px] text-muted-foreground">{EVENT_KIND_LABEL[u.event.kind]}</span>
              <Link href={`/?event=${u.event.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary">{u.event.title}</Link>
              {u.matter && <span className="hidden shrink-0 text-[11px] text-muted-foreground lg:inline">{u.matter.shortName}</span>}
              <span className="shrink-0 tabular text-[11px] text-muted-foreground">{u.event.daysUntil <= 0 ? "today" : `in ${u.event.daysUntil}d`}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 pl-[92px] text-[11.5px]">
              {u.insights.map((i) => <Link key={i.id} href={`/intel/insights?insight=${encodeURIComponent(i.id)}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-muted-foreground hover:text-primary"><span className="text-[10px] uppercase tracking-wider">{INSIGHT_KIND_LABEL[i.kind]}</span><span className="truncate">{i.title}</span><TrustBadge provenance={i.provenance} compact /></Link>)}
              {u.records.map((r) => <Link key={r.id} href={`/intel/documents/${encodeURIComponent(r.id)}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-muted-foreground hover:text-primary"><span className="text-[10px] uppercase tracking-wider">Record</span><span className="truncate">{r.title}</span></Link>)}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
