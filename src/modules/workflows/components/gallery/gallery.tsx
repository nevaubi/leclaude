"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowRight, CalendarClock, Copy, Loader2, MoreHorizontal, PenLine, Play, Plus, Search, Settings2, Trash2, UserCheck, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RelativeTime } from "@/components/ui/relative-time";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { WORKFLOW_CATEGORIES } from "../../registry";
import { describeSchedule } from "../../schedule";
import { apiJson, ApiError, useWorkflowMeta } from "../../hooks";
import type { RunSummary } from "../../service";
import type { WorkflowListItem, WorkflowStats } from "../../types";
import { CATEGORY_LABEL, formatTokens, formatUsd, NodeTypeStrip, RunStatusBadge, WorkflowStatusBadge } from "../shared";
import { RunsTable } from "../run/runs-table";
import { DescribeWorkflowDialog } from "./describe-dialog";
import { filterWorkflows, startHref } from "./gallery-helpers";

export { filterWorkflows, startHref };

export type GalleryTab = "templates" | "mine" | "system" | "runs";

export interface GalleryProps {
  templates: WorkflowListItem[];
  mine: WorkflowListItem[];
  /** System (automation) workflows: scheduled background work of the platform. */
  system?: WorkflowListItem[];
  stats: WorkflowStats;
  recentRuns: RunSummary[];
  initialTab?: GalleryTab;
}

export function WorkflowsGallery({ templates, mine: mineInitial, system: systemInitial = [], stats, recentRuns, initialTab }: GalleryProps) {
  const router = useRouter();
  const meta = useWorkflowMeta();
  const [tab, setTab] = React.useState<GalleryTab>(initialTab ?? (mineInitial.length ? "mine" : "templates"));
  const [q, setQ] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [describeOpen, setDescribeOpen] = React.useState(false);
  const [describeText, setDescribeText] = React.useState("");
  const [mine, setMine] = React.useState(mineInitial);
  const [system, setSystem] = React.useState(systemInitial);
  // `?tab=` links (e.g. "All runs") re-render this page in place, so follow the prop instead of only reading it once.
  React.useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const term = q.trim().toLowerCase();
  const shownTemplates = filterWorkflows(templates, term, category);
  const archivedCount = mine.filter((w) => w.status === "archived").length;
  const shownMine = filterWorkflows(mine, term, category).filter((w) => w.status !== "archived" || term || showArchived);
  const shownSystem = filterWorkflows(system, term, "");

  const customize = async (id: string) => {
    setBusy(id);
    try {
      const res = await apiJson<{ workflow: { id: string } }>(`/api/workflows/${id}/clone`, { method: "POST", body: JSON.stringify({}) });
      toast.success("Template copied to your workflows");
      router.push(`/workflows/${res.workflow.id}`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not copy the template"); } finally { setBusy(null); }
  };
  const newBlank = async () => {
    setBusy("new");
    try {
      const res = await apiJson<{ workflow: { id: string } }>("/api/workflows", { method: "POST", body: JSON.stringify({ name: "Untitled workflow", category: "operations", status: "draft", nodes: [{ id: "start", type: "trigger.manual", label: "Manual trigger", position: { x: 80, y: 120 }, config: {} }], edges: [], inputs: [], tags: [] }) });
      router.push(`/workflows/${res.workflow.id}`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not create a workflow"); } finally { setBusy(null); }
  };
  const patch = React.useCallback(async (id: string, body: Record<string, unknown>, success: string) => {
    try {
      const res = await apiJson<{ workflow: WorkflowListItem }>(`/api/workflows/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      const apply = (ms: WorkflowListItem[]) => ms.map((w) => (w.id === id ? { ...w, ...body, status: res.workflow.status } as WorkflowListItem : w));
      setMine(apply); setSystem(apply);
      toast.success(success);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Update failed"); }
  }, []);
  const remove = async (w: WorkflowListItem) => {
    if (!confirm(`Delete “${w.name}” and its run history? This cannot be undone.`)) return;
    try { await apiJson(`/api/workflows/${w.id}`, { method: "DELETE" }); setMine((ms) => ms.filter((x) => x.id !== w.id)); toast.success("Workflow deleted"); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Delete failed"); }
  };
  const duplicate = async (w: WorkflowListItem) => {
    try { const res = await apiJson<{ workflow: { id: string } }>(`/api/workflows/${w.id}/clone`, { method: "POST", body: JSON.stringify({}) }); router.push(`/workflows/${res.workflow.id}`); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not duplicate"); }
  };
  const runNow = async (w: WorkflowListItem) => {
    setBusy(`run-${w.id}`);
    try {
      const res = await apiJson<{ run: { id: string } }>(`/api/workflows/${w.id}/run`, { method: "POST", body: JSON.stringify({ inputs: {}, triggeredBy: "manual" }) });
      toast.success(`${w.name} started`);
      router.push(`/workflows/runs/${res.run.id}`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not start the run"); } finally { setBusy(null); }
  };

  const mineColumns = React.useMemo<DataTableColumn<WorkflowListItem>[]>(() => [
    { id: "name", header: "Workflow", minWidth: 200, sortable: true, accessor: (w) => w.name, render: (w) => (
      <span className="flex min-w-0 items-center gap-2" title={w.description}>
        <NodeTypeStrip types={w.nodeTypes} max={4} className="hidden shrink-0 xl:flex" />
        <span className="truncate font-medium">{w.name}</span>
      </span>
    ) },
    { id: "category", header: "Category", width: 110, minWidth: 80, sortable: true, accessor: (w) => w.category, render: (w) => <span className="truncate text-muted-foreground">{CATEGORY_LABEL[w.category] ?? w.category}</span> },
    { id: "status", header: "Status", width: 96, minWidth: 80, sortable: true, accessor: (w) => w.status, render: (w) => <WorkflowStatusBadge status={w.status} /> },
    { id: "schedule", header: "Schedule", width: 150, minWidth: 110, sortable: true, accessor: (w) => (w.schedule ? describeSchedule(w.schedule) : ""), render: (w) => <span className="truncate text-muted-foreground">{w.schedule ? describeSchedule(w.schedule) : "Manual"}</span> },
    { id: "next", header: "Next", width: 100, minWidth: 80, sortable: true, defaultHidden: true, accessor: (w) => w.nextRunAt ?? "", render: (w) => <span className="truncate text-muted-foreground">{w.nextRunAt ? <RelativeTime value={w.nextRunAt} /> : "—"}</span> },
    { id: "lastRun", header: "Last run", width: 190, minWidth: 130, sortable: true, accessor: (w) => w.lastRunAt ?? "", render: (w) => w.lastRunAt ? <span className="flex min-w-0 items-center gap-1.5">{w.lastRunStatus && <RunStatusBadge status={w.lastRunStatus} />}<span className="truncate text-[11px] text-muted-foreground"><RelativeTime value={w.lastRunAt} /></span></span> : <span className="text-muted-foreground">Never</span> },
    { id: "description", header: "Description", width: 260, minWidth: 120, defaultHidden: true, accessor: (w) => w.description ?? "", render: (w) => <span className="truncate text-muted-foreground">{w.description}</span> },
    { id: "runs", header: "Runs", width: 64, minWidth: 50, align: "right", sortable: true, accessor: (w) => w.runsCount ?? 0, render: (w) => <span className="tabular">{w.runsCount ?? 0}</span> },
    { id: "approval", header: "Review", width: 70, minWidth: 60, defaultHidden: true, accessor: (w) => (w.hasApproval ? 1 : 0), render: (w) => (w.hasApproval ? <span className="inline-flex items-center gap-1 text-muted-foreground"><UserCheck className="size-3" /> yes</span> : <span className="text-muted-foreground">—</span>) },
    { id: "tags", header: "Tags", width: 180, minWidth: 100, defaultHidden: true, accessor: (w) => (w.tags ?? []).join(" "), render: (w) => <span className="truncate text-muted-foreground">{(w.tags ?? []).join(" · ")}</span> },
  ], []);

  const systemColumns = React.useMemo<DataTableColumn<WorkflowListItem>[]>(() => [
    { id: "name", header: "Automation", minWidth: 200, sortable: true, accessor: (w) => w.name, render: (w) => <span className="truncate font-medium" title={w.description}>{w.name}</span> },
    { id: "description", header: "What it does", minWidth: 200, accessor: (w) => w.description ?? "", render: (w) => <span className="truncate text-muted-foreground" title={w.description}>{w.description}</span> },
    { id: "enabled", header: "On", width: 56, minWidth: 50, sortable: true, accessor: (w) => (w.status === "active" ? 1 : 0), render: (w) => <span onClick={(e) => e.stopPropagation()}><Switch size="sm" checked={w.status === "active"} onCheckedChange={(v) => patch(w.id, { status: v ? "active" : "draft" }, v ? `${w.name} on` : `${w.name} paused`)} aria-label={`${w.name} enabled`} /></span> },
    { id: "schedule", header: "Schedule", width: 160, minWidth: 110, sortable: true, accessor: (w) => (w.schedule ? describeSchedule(w.schedule) : ""), render: (w) => <span className="truncate text-muted-foreground">{w.schedule ? describeSchedule(w.schedule) : "Manual"}</span> },
    { id: "next", header: "Next", width: 110, minWidth: 80, sortable: true, accessor: (w) => w.nextRunAt ?? "", render: (w) => <span className="truncate text-muted-foreground">{w.nextRunAt ? <RelativeTime value={w.nextRunAt} /> : "—"}</span> },
    { id: "lastRun", header: "Last run", width: 190, minWidth: 130, sortable: true, accessor: (w) => w.lastRunAt ?? "", render: (w) => w.lastRunAt ? <span className="flex min-w-0 items-center gap-1.5">{w.lastRunStatus && <RunStatusBadge status={w.lastRunStatus} />}<span className="truncate text-[11px] text-muted-foreground"><RelativeTime value={w.lastRunAt} /></span></span> : <span className="text-muted-foreground">Never</span> },
    { id: "error", header: "Last error", width: 220, minWidth: 120, defaultHidden: true, accessor: (w) => w.lastRunError ?? "", render: (w) => <span className="truncate text-destructive">{w.lastRunError ?? ""}</span> },
    { id: "runs", header: "Runs", width: 64, minWidth: 50, align: "right", sortable: true, accessor: (w) => w.runsCount ?? 0, render: (w) => <span className="tabular">{w.runsCount ?? 0}</span> },
    { id: "steps", header: "Steps", width: 64, minWidth: 50, align: "right", defaultHidden: true, accessor: (w) => w.nodeCount, render: (w) => <span className="tabular">{w.nodeCount}</span> },
  ], [patch]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopbarSlot>
        <span className="flex items-center gap-1.5 text-sm font-medium"><WorkflowIcon className="size-4 text-muted-foreground" /> Workflows</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => { setDescribeText(""); setDescribeOpen(true); }}><PenLine className="size-3.5" /> Describe a workflow</Button>
          <Button size="sm" onClick={newBlank} disabled={busy === "new"}>{busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} New</Button>
        </div>
      </TopbarSlot>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Stat line: plain tabular text. */}
        <div className="hairline-b flex h-9 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 overflow-hidden px-4 text-[12px] md:px-5" aria-label="Workflow statistics">
          <StatInline label="Workflows" value={stats.workflows} hint={`${stats.active} active · ${stats.templates} templates · ${stats.system} system`} />
          <StatInline label="Runs this week" value={stats.runsThisWeek} hint={`${stats.succeededThisWeek} ok · ${stats.failedThisWeek} failed`} />
          <StatInline label="Success" value={`${stats.successRate}%`} hint={`${stats.runs} runs`} />
          <StatInline label="Awaiting approval" value={stats.waitingApproval} hint={stats.running ? `${stats.running} running` : undefined} tone={stats.waitingApproval ? "warning" : undefined} />
          <StatInline label="AI usage (7d)" value={formatTokens(stats.tokensThisWeek)} hint={`≈ ${formatUsd(stats.costThisWeekUsd)}`} />
          <StatInline label="Next scheduled" value={stats.nextScheduled[0] ? <RelativeTime value={stats.nextScheduled[0].at} /> : "—"} hint={stats.nextScheduled[0]?.name} />
        </div>

        {/* Tabs + filters: one 36px toolbar. */}
        <div className="hairline-b flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1 md:px-5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as GalleryTab)}>
            <TabsList variant="underline" className="h-9 border-0">
              <TabsTrigger value="mine" className="text-xs">My workflows <span className="ml-1 tabular text-muted-foreground">{mine.filter((w) => w.status !== "archived").length}</span></TabsTrigger>
              <TabsTrigger value="templates" className="text-xs">Templates <span className="ml-1 tabular text-muted-foreground">{templates.length}</span></TabsTrigger>
              <TabsTrigger value="system" className="text-xs">System <span className="ml-1 tabular text-muted-foreground">{system.length}</span></TabsTrigger>
              <TabsTrigger value="runs" className="text-xs">Runs <span className="ml-1 tabular text-muted-foreground">{stats.runs}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          {tab !== "runs" && (
            <>
              <div className="relative ml-auto min-w-[200px]">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "system" ? "Search automations…" : "Search workflows and templates…"} size="xs" className="pl-7" aria-label="Search workflows" />
              </div>
              {tab !== "system" && (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Category filter">
                  <FilterChip active={!category} onClick={() => setCategory("")}>All</FilterChip>
                  {WORKFLOW_CATEGORIES.filter((c) => c.value !== "automation").map((c) => <FilterChip key={c.value} active={category === c.value} onClick={() => setCategory(category === c.value ? "" : c.value)}>{c.label}</FilterChip>)}
                  {tab === "mine" && archivedCount > 0 && <FilterChip active={showArchived} onClick={() => setShowArchived((v) => !v)}><Archive className="mr-1 inline size-3" />Archived {archivedCount}</FilterChip>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {tab === "templates" && (
            <div className="grid gap-2 p-4 md:grid-cols-2 md:p-5 xl:grid-cols-3">
              {shownTemplates.map((t) => <TemplateCard key={t.id} t={t} onCustomize={() => customize(t.id)} busy={busy === t.id} />)}
              {shownTemplates.length === 0 && <div className="md:col-span-2 xl:col-span-3"><EmptyState icon={Search} title="No templates match" description="Try another search or category." /></div>}
            </div>
          )}

          {tab === "mine" && (
            <div className="grid min-h-full gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-h-[360px] min-w-0 flex-col">
                {shownMine.length === 0 ? (
                  <EmptyState icon={WorkflowIcon} title={term || category ? "No workflows match" : archivedCount ? "No active workflows" : "No workflows yet"} description={term || category ? "Try another search or category." : archivedCount ? `${archivedCount} archived workflow${archivedCount === 1 ? " is" : "s are"} hidden — use the Archived filter to see ${archivedCount === 1 ? "it" : "them"}.` : "Start from a template or describe what you need."} action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setTab("templates")}>Browse templates</Button><Button size="sm" onClick={() => setDescribeOpen(true)}><PenLine className="size-3.5" /> Describe a workflow</Button></div>} />
                ) : (
                  <DataTable<WorkflowListItem>
                    rows={shownMine}
                    columns={mineColumns}
                    rowId={(w) => w.id}
                    defaultSort={{ columnId: "lastRun", dir: "desc" }}
                    selectionMode="single"
                    onRowActivate={(w) => router.push(`/workflows/${w.id}`)}
                    onRowClick={(w) => router.push(`/workflows/${w.id}`)}
                    columnChooser
                    summary={false}
                    noun="workflow"
                    rowActions={(w) => (
                      <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                        <Switch size="sm" checked={w.status === "active"} onCheckedChange={(v) => patch(w.id, { status: v ? "active" : "draft" }, v ? "Activated" : "Set to draft")} aria-label="Active" />
                        <Button variant="ghost" size="xs" asChild><Link href={startHref(w)}><Play className="size-3" /> Start</Link></Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="More"><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/workflows/${w.id}`)}><Settings2 /> Customize</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => router.push(startHref(w))}><Play /> Start</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicate(w)}><Copy /> Duplicate</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => patch(w.id, { status: w.status === "archived" ? "draft" : "archived" }, w.status === "archived" ? "Restored" : "Archived")}><Archive /> {w.status === "archived" ? "Restore" : "Archive"}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(w)}><Trash2 /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    )}
                    virtualize={false}
                    className="rounded-md border"
                    ariaLabel="My workflows"
                  />
                )}
              </div>
              <div className="space-y-4">
                <RecentRuns runs={recentRuns} />
                {stats.nextScheduled.length > 0 && (
                  <section>
                    <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>Upcoming</span><span className="normal-case tracking-normal tabular">{stats.nextScheduled.length}</span></div>
                    <ul className="divide-y divide-line-quiet">
                      {stats.nextScheduled.map((s) => <li key={s.workflowId} className="flex h-7 items-center justify-between gap-2 text-[12px]"><Link href={`/workflows/${s.workflowId}`} className="min-w-0 truncate hover:underline">{s.name}{s.system && <span className="ml-1 text-[10.5px] text-muted-foreground">system</span>}</Link><span className="shrink-0 tabular text-[11px] text-muted-foreground"><RelativeTime value={s.at} /></span></li>)}
                    </ul>
                  </section>
                )}
              </div>
            </div>
          )}

          {tab === "system" && (
            <div className="flex min-h-full flex-col gap-3 p-4 md:p-5">
              <p className="text-[12px] text-muted-foreground">The platform&apos;s own background work, expressed as workflows: authority refresh, docket and regulatory watches, profiles, chronologies, verification sweeps and the team digest. Each run is stewarded, verified and audited like any other; pause one with its switch, or open it to see the steps.</p>
              {shownSystem.length === 0 ? (
                <EmptyState icon={CalendarClock} title={term ? "No automations match" : "No system workflows"} description={term ? "Try another search." : "System workflows are seeded with the database."} />
              ) : (
                <DataTable<WorkflowListItem>
                  rows={shownSystem}
                  columns={systemColumns}
                  rowId={(w) => w.id}
                  defaultSort={{ columnId: "next", dir: "asc" }}
                  selectionMode="single"
                  onRowActivate={(w) => router.push(`/workflows/${w.id}`)}
                  onRowClick={(w) => router.push(`/workflows/${w.id}`)}
                  columnChooser
                  summary={false}
                  noun="automation"
                  rowActions={(w) => (
                    <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="xs" onClick={() => runNow(w)} disabled={busy === `run-${w.id}`}>{busy === `run-${w.id}` ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Run now</Button>
                      <Button variant="ghost" size="xs" asChild><Link href={`/workflows/${w.id}`}><ArrowRight className="size-3" /> Open</Link></Button>
                    </span>
                  )}
                  virtualize={false}
                  className="rounded-md border"
                  ariaLabel="System workflows"
                />
              )}
            </div>
          )}

          {tab === "runs" && <div className="flex h-full min-h-[480px] flex-col p-4 md:p-5"><RunsTable className="min-h-0 flex-1" workflows={[...mine, ...system].map((w) => ({ id: w.id, name: w.name }))} refreshMs={15000} /></div>}
        </div>
      </div>

      <DescribeWorkflowDialog open={describeOpen} onOpenChange={setDescribeOpen} meta={meta} initialText={describeText} />
    </div>
  );
}

function StatInline({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warning" }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular", tone === "warning" && "text-warning-foreground dark:text-warning")}>{value}</span>
      {hint && <span className="hidden truncate text-[11px] text-muted-foreground 2xl:inline">· {hint}</span>}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("h-6 rounded-[var(--radius-chip)] border px-2 text-[11px] font-medium transition-colors cursor-pointer", active ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>{children}</button>;
}

function TemplateCard({ t, onCustomize, busy }: { t: WorkflowListItem; onCustomize: () => void; busy: boolean }) {
  return (
    <div className="group flex flex-col gap-1.5 rounded-md border bg-card p-3 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-2">
        <NodeTypeStrip types={t.nodeTypes} max={4} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <Link href={startHref(t)} className="block truncate text-[13px] font-semibold leading-tight hover:underline underline-offset-2" title={t.name}>{t.name}</Link>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span>{CATEGORY_LABEL[t.category] ?? t.category}</span><span aria-hidden>·</span><span className="tabular">{t.nodeCount} steps</span>{t.usesAI && <><span aria-hidden>·</span><span>AI</span></>}{t.hasApproval && <><span aria-hidden>·</span><span className="inline-flex items-center gap-0.5"><UserCheck className="size-3" /> review</span></>}{t.schedule && <><span aria-hidden>·</span><span className="inline-flex items-center gap-0.5"><CalendarClock className="size-3" /> scheduled</span></>}</div>
        </div>
      </div>
      <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground" title={t.description}>{t.description}</p>
      <div className="flex items-center justify-between">
        <span className="truncate text-[11px] text-muted-foreground">{(t.tags ?? []).slice(0, 3).join(" · ")}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" onClick={onCustomize} disabled={busy}>{busy ? <Loader2 className="size-3 animate-spin" /> : <Settings2 className="size-3" />} Customize</Button>
          <Button size="xs" variant="outline" asChild><Link href={startHref(t)}><Play className="size-3" /> Start</Link></Button>
        </div>
      </div>
    </div>
  );
}

function RecentRuns({ runs }: { runs: RunSummary[] }) {
  return (
    <section>
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>Recent runs</span><Link href="/workflows?tab=runs" className="normal-case tracking-normal text-primary hover:underline">All runs</Link></div>
      {runs.length === 0 ? <div className="text-[12px] text-muted-foreground">No runs yet.</div> : (
        <ul className="divide-y divide-line-quiet">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/workflows/runs/${r.id}`} className="flex h-8 items-center gap-2 text-[12px] hover:bg-accent/50">
                <RunStatusBadge status={r.status} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.workflowName}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{r.matterName ? `${r.matterName} · ` : ""}{r.stepCounts.succeeded}/{r.stepTotal} steps{r.error ? ` · ${r.error}` : ""}</span>
                </span>
                <span className="shrink-0 tabular text-[10.5px] text-muted-foreground"><RelativeTime value={r.startedAt} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
