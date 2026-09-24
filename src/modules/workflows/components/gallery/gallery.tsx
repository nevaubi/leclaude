"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Archive, ArrowRight, CalendarClock, CheckCircle2, Coins, Copy, Loader2, MoreHorizontal, PauseCircle, Play, Plus, Search, Sparkles, Trash2, UserCheck, Workflow as WorkflowIcon, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RelativeTime } from "@/components/ui/relative-time";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { WORKFLOW_CATEGORIES } from "../../registry";
import { describeSchedule } from "../../schedule";
import { apiJson, ApiError, useWorkflowMeta } from "../../hooks";
import type { RunSummary } from "../../service";
import type { WorkflowListItem, WorkflowStats } from "../../types";
import { CATEGORY_LABEL, CategoryBadge, formatTokens, formatUsd, NodeTypeStrip, RunStatusBadge, WorkflowStatusBadge } from "../shared";
import { RunsTable } from "../run/runs-table";
import { DescribeWorkflowDialog } from "./describe-dialog";

export interface GalleryProps {
  templates: WorkflowListItem[];
  mine: WorkflowListItem[];
  stats: WorkflowStats;
  recentRuns: RunSummary[];
  initialTab?: "templates" | "mine" | "runs";
}

export function WorkflowsGallery({ templates, mine: mineInitial, stats, recentRuns, initialTab }: GalleryProps) {
  const router = useRouter();
  const meta = useWorkflowMeta();
  const [tab, setTab] = React.useState<"templates" | "mine" | "runs">(initialTab ?? (mineInitial.length ? "mine" : "templates"));
  const [q, setQ] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [describeOpen, setDescribeOpen] = React.useState(false);
  const [describeText, setDescribeText] = React.useState("");
  const [mine, setMine] = React.useState(mineInitial);
  // `?tab=` links (e.g. "All runs") re-render this page in place, so follow the prop instead of only reading it once.
  React.useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const term = q.trim().toLowerCase();
  const filter = (w: WorkflowListItem) => (!category || w.category === category) && (!term || `${w.name} ${w.description ?? ""} ${(w.tags ?? []).join(" ")}`.toLowerCase().includes(term));
  const shownTemplates = templates.filter(filter);
  const archivedCount = mine.filter((w) => w.status === "archived").length;
  const shownMine = mine.filter(filter).filter((w) => w.status !== "archived" || term || showArchived);

  const applyTemplate = async (id: string) => {
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
  const patch = async (id: string, body: Record<string, unknown>, success: string) => {
    try {
      const res = await apiJson<{ workflow: WorkflowListItem }>(`/api/workflows/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMine((ms) => ms.map((w) => (w.id === id ? { ...w, ...body, status: res.workflow.status } as WorkflowListItem : w)));
      toast.success(success);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Update failed"); }
  };
  const remove = async (w: WorkflowListItem) => {
    if (!confirm(`Delete “${w.name}” and its run history? This cannot be undone.`)) return;
    try { await apiJson(`/api/workflows/${w.id}`, { method: "DELETE" }); setMine((ms) => ms.filter((x) => x.id !== w.id)); toast.success("Workflow deleted"); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Delete failed"); }
  };
  const duplicate = async (w: WorkflowListItem) => {
    try { const res = await apiJson<{ workflow: { id: string } }>(`/api/workflows/${w.id}/clone`, { method: "POST", body: JSON.stringify({}) }); router.push(`/workflows/${res.workflow.id}`); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not duplicate"); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopbarSlot>
        <span className="flex items-center gap-1.5 text-sm font-medium"><WorkflowIcon className="size-4 text-muted-foreground" /> Workflows</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => { setDescribeText(""); setDescribeOpen(true); }}><Sparkles className="size-3.5" /> Describe a workflow</Button>
          <Button size="sm" onClick={newBlank} disabled={busy === "new"}>{busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} New</Button>
        </div>
      </TopbarSlot>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-5">
          {/* Quiet stat strip: one line, tabular, no tiles. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border bg-card px-4 py-2.5 text-[12px]" aria-label="Workflow statistics">
            <StatInline icon={WorkflowIcon} label="Workflows" value={stats.workflows} hint={`${stats.active} active · ${stats.templates} templates`} />
            <StatInline icon={Activity} label="Runs this week" value={stats.runsThisWeek} hint={`${stats.succeededThisWeek} ok · ${stats.failedThisWeek} failed`} />
            <StatInline icon={CheckCircle2} label="Success" value={`${stats.successRate}%`} hint={`${stats.runs} runs`} tone={stats.successRate >= 80 ? "success" : "warning"} />
            <StatInline icon={UserCheck} label="Awaiting approval" value={stats.waitingApproval} hint={stats.running ? `${stats.running} running` : undefined} tone={stats.waitingApproval ? "warning" : undefined} />
            <StatInline icon={Coins} label="AI usage (7d)" value={formatTokens(stats.tokensThisWeek)} hint={`≈ ${formatUsd(stats.costThisWeekUsd)}`} />
            <StatInline icon={CalendarClock} label="Next scheduled" value={stats.nextScheduled[0] ? <RelativeTime value={stats.nextScheduled[0].at} /> : "—"} hint={stats.nextScheduled[0]?.name} />
          </div>

          {/* Describe: one compact row, not a banner. */}
          <form className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2" onSubmit={(e) => { e.preventDefault(); setDescribeOpen(true); }}>
            <Sparkles className="size-4 shrink-0 text-primary" />
            <Input value={describeText} onChange={(e) => setDescribeText(e.target.value)} placeholder="Describe a playbook in one sentence — the builder lays out the steps for you to refine" className="h-8 border-0 bg-transparent px-1 text-[13px] shadow-none focus-visible:ring-0" aria-label="Describe a workflow" />
            <Button type="submit" size="sm" variant="outline"><Zap className="size-3.5" /> Build</Button>
          </form>

          {/* Tabs + filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="mine">My workflows <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular">{mine.filter((w) => w.status !== "archived").length}</span></TabsTrigger>
                <TabsTrigger value="templates">Templates <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular">{templates.length}</span></TabsTrigger>
                <TabsTrigger value="runs">Runs <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular">{stats.runs}</span></TabsTrigger>
              </TabsList>
            </Tabs>
            {tab !== "runs" && (
              <>
                <div className="relative ml-auto min-w-[220px]">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workflows and templates…" className="h-8 pl-7 text-xs" />
                </div>
                <div className="flex flex-wrap gap-1">
                  <CategoryChip active={!category} onClick={() => setCategory("")}>All</CategoryChip>
                  {WORKFLOW_CATEGORIES.map((c) => <CategoryChip key={c.value} active={category === c.value} onClick={() => setCategory(category === c.value ? "" : c.value)}>{c.label}</CategoryChip>)}
                  {tab === "mine" && archivedCount > 0 && <CategoryChip active={showArchived} onClick={() => setShowArchived((v) => !v)}><Archive className="mr-1 inline size-3" />Archived {archivedCount}</CategoryChip>}
                </div>
              </>
            )}
          </div>

          {tab === "templates" && (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {shownTemplates.map((t) => <TemplateCard key={t.id} t={t} onUse={() => applyTemplate(t.id)} busy={busy === t.id} />)}
              {shownTemplates.length === 0 && <div className="md:col-span-2 xl:col-span-3"><EmptyState icon={Search} title="No templates match" description="Try another search or category." /></div>}
            </div>
          )}

          {tab === "mine" && (
            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <div className="min-w-0 overflow-hidden rounded-lg border">
                {shownMine.length === 0 ? (
                  <EmptyState icon={WorkflowIcon} title={term || category ? "No workflows match" : archivedCount ? "No active workflows" : "No workflows yet"} description={term || category ? "Try another search or category." : archivedCount ? `${archivedCount} archived workflow${archivedCount === 1 ? " is" : "s are"} hidden — use the Archived filter to see ${archivedCount === 1 ? "it" : "them"}.` : "Start from a template or describe what you need."} action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setTab("templates")}>Browse templates</Button><Button size="sm" onClick={() => setDescribeOpen(true)}><Sparkles className="size-3.5" /> Describe a workflow</Button></div>} className="m-4" />
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead>Workflow</TableHead>
                        <TableHead className="w-[90px]">Status</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Last run</TableHead>
                        <TableHead className="text-right">Runs</TableHead>
                        <TableHead className="w-[130px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shownMine.map((w) => (
                        <TableRow key={w.id} className="cursor-pointer" onClick={() => router.push(`/workflows/${w.id}`)}>
                          <TableCell className="max-w-[420px]">
                            <div className="flex items-start gap-2.5">
                              <NodeTypeStrip types={w.nodeTypes} max={5} className="mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{w.name}</span><CategoryBadge category={w.category} /></div>
                                <div className="line-clamp-1 text-xs text-muted-foreground">{w.description}</div>
                                <div className="mt-1 flex flex-wrap gap-1">{(w.tags ?? []).slice(0, 4).map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}{w.hasApproval && <Badge variant="warning" className="text-[10px]"><UserCheck className="size-3" /> approval</Badge>}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><WorkflowStatusBadge status={w.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{w.schedule ? <div><div className="flex items-center gap-1"><CalendarClock className="size-3" /> {describeSchedule(w.schedule)}</div>{w.nextRunAt && <div className="text-[10.5px]">next <RelativeTime value={w.nextRunAt} /></div>}</div> : "Manual"}</TableCell>
                          <TableCell className="text-xs">{w.lastRunAt ? <div className="space-y-0.5">{w.lastRunStatus && <RunStatusBadge status={w.lastRunStatus} />}<div className="text-[10.5px] text-muted-foreground"><RelativeTime value={w.lastRunAt} /></div></div> : <span className="text-muted-foreground">Never</span>}</TableCell>
                          <TableCell className="text-right tabular text-xs">{w.runsCount ?? 0}</TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Switch size="sm" checked={w.status === "active"} onCheckedChange={(v) => patch(w.id, { status: v ? "active" : "draft" }, v ? "Activated" : "Set to draft")} aria-label="Active" />
                              <Button variant="outline" size="xs" asChild><Link href={`/workflows/${w.id}?run=1`}><Play className="size-3" /> Run</Link></Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="More"><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => router.push(`/workflows/${w.id}`)}><ArrowRight /> Open in builder</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => duplicate(w)}><Copy /> Duplicate</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => patch(w.id, { status: w.status === "archived" ? "draft" : "archived" }, w.status === "archived" ? "Restored" : "Archived")}><Archive /> {w.status === "archived" ? "Restore" : "Archive"}</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(w)}><Trash2 /> Delete</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
              <div className="space-y-3">
                <RecentRuns runs={recentRuns} />
                {stats.nextScheduled.length > 0 && (
                  <Card className="p-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Upcoming scheduled runs</div>
                    <ul className="space-y-1.5">
                      {stats.nextScheduled.map((s) => <li key={s.workflowId} className="flex items-center justify-between gap-2 text-xs"><Link href={`/workflows/${s.workflowId}`} className="truncate hover:underline">{s.name}</Link><span className="shrink-0 text-muted-foreground"><RelativeTime value={s.at} /></span></li>)}
                    </ul>
                  </Card>
                )}
              </div>
            </div>
          )}

          {tab === "runs" && <RunsTable className="min-h-[520px]" workflows={mine.map((w) => ({ id: w.id, name: w.name }))} refreshMs={15000} />}
        </div>
      </div>

      <DescribeWorkflowDialog open={describeOpen} onOpenChange={setDescribeOpen} meta={meta} initialText={describeText} />
    </div>
  );
}

function StatInline({ icon: Icon, label, value, hint, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "success" | "warning" }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className={cn("size-3.5 shrink-0", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground/70")} />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular", tone === "warning" && "text-warning-foreground dark:text-warning")}>{value}</span>
      {hint && <span className="hidden truncate text-[11px] text-muted-foreground xl:inline">· {hint}</span>}
    </div>
  );
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("h-6 rounded-md border px-2 text-[11px] font-medium transition-colors cursor-pointer", active ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>{children}</button>;
}

function TemplateCard({ t, onUse, busy }: { t: WorkflowListItem; onUse: () => void; busy: boolean }) {
  return (
    <Card className="group flex flex-col gap-2 p-3.5 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-2">
        <NodeTypeStrip types={t.nodeTypes} max={4} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <Link href={`/workflows/${t.id}`} className="block truncate text-[13px] font-semibold leading-tight hover:underline underline-offset-2" title={t.name}>{t.name}</Link>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span>{CATEGORY_LABEL[t.category] ?? t.category}</span><span aria-hidden>·</span><span className="tabular">{t.nodeCount} steps</span>{t.usesAI && <><span aria-hidden>·</span><span className="text-primary">AI</span></>}{t.hasApproval && <><span aria-hidden>·</span><span className="inline-flex items-center gap-0.5"><UserCheck className="size-3" /> approval</span></>}{t.schedule && <><span aria-hidden>·</span><span className="inline-flex items-center gap-0.5"><CalendarClock className="size-3" /> scheduled</span></>}</div>
        </div>
      </div>
      <p className="line-clamp-1 text-[12px] leading-relaxed text-muted-foreground" title={t.description}>{t.description}</p>
      <div className="flex items-center justify-between">
        <span className="truncate text-[11px] text-muted-foreground">{(t.tags ?? []).slice(0, 3).join(" · ")}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" asChild><Link href={`/workflows/${t.id}`}>Preview</Link></Button>
          <Button size="xs" variant="outline" onClick={onUse} disabled={busy}>{busy ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />} Use</Button>
        </div>
      </div>
    </Card>
  );
}

function RecentRuns({ runs }: { runs: RunSummary[] }) {
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recent runs</span><Link href="/workflows?tab=runs" className="text-[11px] text-primary hover:underline">All runs</Link></div>
      {runs.length === 0 ? <div className="text-xs text-muted-foreground">No runs yet.</div> : (
        <ul className="space-y-1">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/workflows/runs/${r.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent/60">
                {r.status === "waiting_approval" ? <PauseCircle className="size-3.5 shrink-0 text-warning" /> : r.status === "failed" ? <Zap className="size-3.5 shrink-0 text-destructive" /> : r.status === "running" ? <Loader2 className="size-3.5 shrink-0 animate-spin text-info" /> : <CheckCircle2 className={cn("size-3.5 shrink-0", r.status === "succeeded" ? "text-success" : "text-muted-foreground")} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{r.workflowName}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{r.matterName ? `${r.matterName} · ` : ""}{r.stepCounts.succeeded}/{r.stepTotal} steps{r.error ? ` · ${r.error}` : ""}</span>
                </span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground"><RelativeTime value={r.startedAt} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
