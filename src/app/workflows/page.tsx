import type { Metadata } from "next";
import { WorkflowsGallery } from "@/modules/workflows/components/gallery/gallery";
import { listRuns, listWorkflows, workflowStats } from "@/modules/workflows/service";
import { ensureScheduler } from "@/modules/workflows/scheduler";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  ensureScheduler();
  const templates = listWorkflows({ template: true });
  const mine = listWorkflows({ template: false });
  const stats = workflowStats();
  const recentRuns = listRuns({ limit: 8 }).runs;
  const initialTab = tab === "templates" || tab === "mine" || tab === "runs" ? tab : undefined;
  return <WorkflowsGallery templates={templates} mine={mine} stats={stats} recentRuns={recentRuns} initialTab={initialTab} />;
}
