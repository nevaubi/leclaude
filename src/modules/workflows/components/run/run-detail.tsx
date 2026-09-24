"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Workflow as WorkflowIcon } from "lucide-react";
import type { WorkflowRunStep } from "@/lib/types/domain";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import type { WorkflowRunRecord } from "../../types";
import { CategoryBadge } from "../shared";
import { CanvasPreview } from "../builder/canvas-preview";
import { RunPanel } from "./run-panel";

export function RunDetail({ run, workflow }: { run: WorkflowRunRecord; workflow: { id: string; name: string; category: string; isTemplate?: boolean } | null }) {
  const router = useRouter();
  const [statuses, setStatuses] = React.useState<Record<string, WorkflowRunStep["status"]>>(() => Object.fromEntries(run.steps.map((s) => [s.nodeId, s.status])));
  const onStepStatuses = React.useCallback((s: Record<string, WorkflowRunStep["status"]>) => setStatuses(s), []);
  const snapshot = run.snapshot;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopbarSlot>
        <nav className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link href="/workflows" className="flex items-center gap-1 text-muted-foreground hover:text-foreground"><WorkflowIcon className="size-4" /> Workflows</Link>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          {workflow ? <Link href={`/workflows/${workflow.id}`} className="truncate text-muted-foreground hover:text-foreground">{workflow.name}</Link> : <span className="text-muted-foreground">{run.workflowName ?? run.workflowId}</span>}
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="truncate font-medium">Run <span className="font-mono text-xs text-muted-foreground">{run.id}</span></span>
          {workflow && <CategoryBadge category={workflow.category} className="hidden md:inline-flex" />}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          {workflow && <Button variant="outline" size="sm" asChild><Link href={`/workflows/${workflow.id}`}>Open workflow</Link></Button>}
        </div>
      </TopbarSlot>
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="hidden min-h-0 flex-col gap-3 p-4 xl:flex">
          {snapshot ? (
            <CanvasPreview workflow={{ id: run.workflowId, nodes: snapshot.nodes, edges: snapshot.edges }} statuses={statuses} className="min-h-0 flex-1" />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No graph snapshot was stored for this run.</div>
          )}
          <div className="text-[11px] text-muted-foreground">Graph as it was when the run started. Colors follow step status; expand a step on the right for logs and outputs.</div>
        </div>
        <div className="min-h-0 border-l bg-card">
          <RunPanel runId={run.id} initialRun={run} detailLink={false} wide onStepStatuses={onStepStatuses} onRerun={(id) => router.push(`/workflows/runs/${id}`)} className="h-full" />
        </div>
      </div>
    </div>
  );
}
