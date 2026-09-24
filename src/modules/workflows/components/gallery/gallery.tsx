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
import { CategoryBadge, formatTokens, formatUsd, NodeTypeStrip, RunStatusBadge, WorkflowStatusBadge } from "../shared";
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
  const [busy, setBusy] = React.useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const filter = (w: WorkflowListItem) => (!category || w.category === category) && (!term || `${w.name} ${w.description ?? ""} ${(w.tags ?? []).join(" ")}`.toLowerCase().includes(term));
  const shownTemplates = templates.filter(filter);
  const shownMine = mine.filter(filter).filter((w) => w.status !== "archived" || term);

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
        <span className="hidden text-xs text-muted-foreground md:inline">· playbooks that run research, drafting and review steps for you</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => { setDescribeText(""); setDescribeOpen(true); }}><Sparkles className="size-3.5" /> Describe a workflow</Button>
          <Button size="sm" onClick={newBlank} disabled={busy === "new"}>{busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} New</Button>
        </div>
      </TopbarSlot>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[1400px] space-y-5 p-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile icon={WorkflowIcon} label="Workflows" value={stats.workflows} hint={`${stats.active} active · ${stats.templates} templates`} />
            <StatTile icon={Activity} label="Runs this week" value={stats.runsThisWeek} hint={`${stats.succeededThisWeek} succeeded · ${stats.failedThisWeek} failed`} />
            <StatTile icon={CheckCircle2} label="Success rate" value={`${stats.successRate}%`} hint={`${stats.runs} runs all time`} tone={stats.successRate >= 80 ? "success" : "warning"} />
            <StatTile icon={UserCheck} label="Awaiting approval" value={stats.waitingApproval} hint={stats.running ? `${stats.running} running` : "nothing running"} tone={stats.waitingApproval ? "warning" : undefined} />
            <StatTile icon={Coins} label="AI usage (7d)" value={formatTokens(stats.tokensThisWeek)} hint={`≈ ${formatUsd(stats.costThisWeekUsd)} estimated`} />
            <StatTile icon={CalendarClock} label="Next scheduled" value={stats.nextScheduled[0] ? <RelativeTime value={stats.nextScheduled[0].at} className="text-base" /> : "—"} hint={stats.nextScheduled[0]?.name ?? `${stats.scheduled} scheduled`} />
          </div>

          {/* Describe */}
          <Card className="flex flex-col gap-3 border-primary/25 bg-gradient-to-r from-primary/6 via-card to-card p-4 md:flex-row md:items-center">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Build a workflow from a sentence</div>
              <div className="text-xs text-muted-foreground">Describe the playbook — inputs, research, drafting, approvals, tasks — and the AI builder lays out the steps for you to refine.</div>
            </div>
            <form className="flex w-full gap-2 md:w-[440px]" onSubmit={(e) => { e.preventDefault(); setDescribeOpen(true); }}>
              <Input value={describeText} onChange={(e) => setDescribeText(e.target.value)} placeholder="When a deposition transcript is uploaded, digest it and…" className="h-9 bg-background" />
              <Button type="submit" size="sm" className="h-9"><Zap className="size-3.5" /> Build</Button>
            </form>
          </Card>

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
                </div>
              </>
            )}
          </div>

          {tab === "templates" && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shownTemplates.map((t) => <TemplateCard key={t.id} t={t} onUse={() => applyTemplate(t.id)} busy={busy === t.id} />)}
              {shownTemplates.length === 0 && <div className="md:col-span-2 xl:col-span-3"><EmptyState icon={Search} title="No templates match" description="Try another search or category." /></div>}
            </div>
          )}

          {tab === "mine" && (
            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <div className="min-w-0 overflow-hidden rounded-lg border">
                {shownMine.length === 0 ? (
                  <EmptyState icon={WorkflowIcon} title={term || category ? "No workflows match" : "No workflows yet"} description={term || category ? "Try another search or category." : "Start from a template or describe what you need."} action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setTab("templates")}>Browse templates</Button><Button size="sm" onClick={() => setDescribeOpen(true)}><Sparkles className="size-3.5" /> Describe a workflow</Button></div>} className="m-4" />
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

function StatTile({ icon: Icon, label, value, hint, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "success" | "warning" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>{label}</span><Icon className={cn("size-3.5", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground/70")} /></div>
      <div className={cn("mt-1 text-xl font-semibold tabular", tone === "warning" && "text-warning-foreground dark:text-warning")}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("rounded-full border px-2.5 py-1 text-[11px] transition-colors cursor-pointer", active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>{children}</button>;
}

function TemplateCard({ t, onUse, busy }: { t: WorkflowListItem; onUse: () => void; busy: boolean }) {
  return (
    <Card className="group flex flex-col p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><CategoryBadge category={t.category} />{t.usesAI && <Badge variant="info" className="text-[10px]">AI</Badge>}{t.hasApproval && <Badge variant="warning" className="text-[10px]"><UserCheck className="size-3" /> approval</Badge>}{t.schedule && <Badge variant="outline" className="text-[10px]"><CalendarClock className="size-3" /> scheduled</Badge>}</div>
          <Link href={`/workflows/${t.id}`} className="mt-1.5 block text-sm font-semibold leading-tight hover:underline">{t.name}</Link>
        </div>
        <NodeTypeStrip types={t.nodeTypes} max={4} className="shrink-0" />
      </div>
      <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">{(t.tags ?? []).slice(0, 4).map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>)}</div>
      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <span className="text-[11px] text-muted-foreground">{t.nodeCount} steps · {(t.inputs ?? []).length} inputs</span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="xs" asChild><Link href={`/workflows/${t.id}`}>Preview</Link></Button>
          <Button size="xs" onClick={onUse} disabled={busy}>{busy ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />} Use template</Button>
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
