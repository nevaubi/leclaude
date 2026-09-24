"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, FileSearch, Filter, Library, MoreHorizontal, Scale, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MatterOverview as MatterOverviewRow } from "../types";
import { countdown } from "../time";
import { fmtDate } from "../time";
import { useHomeUI } from "../store";
import { useHome } from "./home-provider";
import { EmptyRow, PeopleStack, Section } from "./shared";
import { hotCell, keyDateTone, matterMeta, matterRows, taskCell } from "./matters-table-model";

/** Matters as one dense table: name, stage, next key date, due, open tasks, hot docs, events, team. */
export function MattersOverview() {
  const { matterOverview, matterFilter, setMatterFilter } = useHome();
  const setFocus = useHomeUI((s) => s.setFocus);
  const rows = React.useMemo(() => matterRows(matterOverview, matterFilter), [matterOverview, matterFilter]);
  return (
    <Section id="matters" title="Matters" icon={Briefcase} count={rows.length} onExpand={() => setFocus("matters")} actions={matterFilter ? <Button variant="ghost" size="xs" onClick={() => setMatterFilter(null)}><X className="size-3" /> Clear filter</Button> : undefined}>
      {rows.length === 0 ? <EmptyRow icon={Briefcase} title="No active matters" /> : <MattersTable rows={rows} virtualize={false} />}
    </Section>
  );
}

export function MattersFocus() {
  const { matterOverview, matterFilter } = useHome();
  const setFocus = useHomeUI((s) => s.setFocus);
  const rows = React.useMemo(() => matterRows(matterOverview, null), [matterOverview]);
  return (
    <Section id="matters" title="Matters" icon={Briefcase} count={rows.length} expanded onExpand={() => setFocus(null)} bodyClassName="flex min-h-0 flex-col">
      <MattersTable rows={rows} virtualize activeId={matterFilter} density="comfortable" />
    </Section>
  );
}

function MattersTable({ rows, virtualize, activeId, density }: { rows: MatterOverviewRow[]; virtualize: boolean; activeId?: string | null; density?: "compact" | "comfortable" }) {
  const router = useRouter();
  const { now, matterFilter, setMatterFilter, personById } = useHome();
  const columns = React.useMemo<DataTableColumn<MatterOverviewRow>[]>(() => [
    {
      id: "matter", header: "Matter", width: 260, minWidth: 160, sortable: true, locked: true, accessor: (m) => m.shortName,
      render: (m) => (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <Link href={`/ediscovery?matter=${m.id}`} className="truncate font-medium hover:underline underline-offset-2" onClick={(e) => e.stopPropagation()}>{m.shortName}</Link>
          <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground xl:inline" title={matterMeta(m)}>{matterMeta(m)}</span>
        </span>
      ),
    },
    { id: "stage", header: "Stage", width: 150, minWidth: 90, sortable: true, accessor: (m) => m.stage ?? "", render: (m) => <span className="truncate text-muted-foreground">{m.stage ?? "—"}</span> },
    {
      id: "keyDate", header: "Next key date", width: 240, minWidth: 140, sortable: true, accessor: (m) => m.nextKeyDate?.daysUntil ?? null,
      render: (m) => m.nextKeyDate ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{m.nextKeyDate.label}</span>
          <span className="shrink-0 tabular text-[11px] text-muted-foreground">{fmtDate(m.nextKeyDate.date, { month: "short", day: "numeric" })}</span>
        </span>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      id: "due", header: "Due", width: 96, minWidth: 72, sortable: true, accessor: (m) => m.nextKeyDate?.daysUntil ?? null,
      render: (m) => {
        if (!m.nextKeyDate) return <span className="text-muted-foreground">—</span>;
        const c = countdown(m.nextKeyDate.date, now, { deadline: true });
        const tone = keyDateTone(m.nextKeyDate.daysUntil);
        return <Chip tone={tone === "destructive" ? "danger" : tone === "warning" ? "warning" : "quiet"} className="tabular">{c.label}</Chip>;
      },
    },
    {
      id: "tasks", header: "Tasks", width: 90, minWidth: 60, align: "right", sortable: true, accessor: (m) => m.openTasks,
      render: (m) => { const t = taskCell(m); return <span title={t.title} className={cn("tabular", t.late && "text-destructive")}>{t.text}</span>; },
    },
    {
      id: "hot", header: "Hot / docs", width: 90, minWidth: 70, align: "right", sortable: true, accessor: (m) => m.hotDocs,
      render: (m) => { const h = hotCell(m); return <span className={cn("tabular", h.hot && "text-destructive")}>{h.text}</span>; },
    },
    { id: "events", header: "Events", width: 72, minWidth: 56, align: "right", sortable: true, accessor: (m) => m.upcomingEvents, render: (m) => <span className="tabular" title={m.nextEvent ? `Next: ${m.nextEvent.title}` : undefined}>{m.upcomingEvents}</span> },
    {
      id: "team", header: "Team", width: 130, minWidth: 80, accessor: (m) => m.teamIds.length,
      render: (m) => { const lead = personById(m.leadAttorneyId); return <span className="flex items-center gap-1.5"><PeopleStack ids={m.teamIds} max={4} /><span className="hidden truncate text-[11px] text-muted-foreground 2xl:inline">{lead?.name}</span></span>; },
    },
    { id: "area", header: "Practice area", width: 130, minWidth: 90, sortable: true, defaultHidden: true, accessor: (m) => m.practiceArea },
    { id: "client", header: "Client", width: 160, minWidth: 90, sortable: true, defaultHidden: true, accessor: (m) => m.client },
  ], [now, personById]);

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowId={(m) => m.id}
      noun="matter"
      density={density ?? "compact"}
      selectionMode="none"
      virtualize={virtualize}
      fill={virtualize}
      summary={virtualize}
      columnChooser={virtualize}
      activeId={activeId ?? undefined}
      ariaLabel="Matters"
      onRowActivate={(m) => router.push(`/ediscovery?matter=${m.id}`)}
      rowClassName={(m) => (matterFilter === m.id ? "row-selected" : undefined)}
      rowActions={(m) => (
        <span className="flex items-center">
          <Tip label={matterFilter === m.id ? "Clear matter filter" : "Filter Home to this matter"}>
            <Button variant="ghost" size="icon-xs" className="size-6" data-row-action onClick={(e) => { e.stopPropagation(); setMatterFilter(matterFilter === m.id ? null : m.id); }} aria-label="Filter to matter"><Filter className={cn("size-3.5", matterFilter === m.id && "text-primary")} /></Button>
          </Tip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="size-6" data-row-action onClick={(e) => e.stopPropagation()} aria-label="Matter actions"><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild><Link href={`/ediscovery?matter=${m.id}`}><FileSearch /> E-Discovery</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/library?matter=${m.id}`}><Library /> Library</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/search?q=${encodeURIComponent(m.shortName)}`}><Scale /> Research</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMatterFilter(matterFilter === m.id ? null : m.id)}><Filter /> {matterFilter === m.id ? "Clear filter" : "Filter Home"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
    />
  );
}
