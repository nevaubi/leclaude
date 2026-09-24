import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunDetail } from "@/modules/workflows/components/run/run-detail";
import { getRun, getWorkflow } from "@/modules/workflows/service";
import { ensureScheduler } from "@/modules/workflows/scheduler";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ runId: string }> }): Promise<Metadata> {
  const { runId } = await params;
  const run = getRun(runId);
  return { title: run ? `Run · ${run.workflowName ?? run.workflowId}` : "Run" };
}

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  ensureScheduler();
  const run = getRun(runId);
  if (!run) notFound();
  const workflow = getWorkflow(run.workflowId);
  return <RunDetail run={run} workflow={workflow ? { id: workflow.id, name: workflow.name, category: workflow.category, isTemplate: workflow.isTemplate } : null} />;
}
