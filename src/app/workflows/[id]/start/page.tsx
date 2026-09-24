import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkflowFrontendPage } from "@/modules/workflows/components/frontend/frontend-page";
import { frontendFor } from "@/modules/workflows/frontend";
import { getWorkflow, listRuns } from "@/modules/workflows/service";
import { ensureScheduler } from "@/modules/workflows/scheduler";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const w = getWorkflow(id);
  return { title: w ? `${frontendFor(w).title} · Workflows` : "Start a workflow" };
}

/** One-page start form for a workflow: the front end on the left, what happens and recent runs on the right. */
export default async function WorkflowStartPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string }> }) {
  const { id } = await params;
  const { run } = await searchParams;
  ensureScheduler();
  const workflow = getWorkflow(id);
  if (!workflow) notFound();
  const recentRuns = listRuns({ workflowId: id, limit: 8 }).runs;
  return <WorkflowFrontendPage workflow={workflow} recentRuns={recentRuns} initialRunId={run && run !== "1" ? run : null} />;
}
