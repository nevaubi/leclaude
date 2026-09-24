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
  const mine = listWorkflows({ template: false, system: false });
  const system = listWorkflows({ template: false, system: true });
  const stats = workflowStats();
  const recentRuns = listRuns({ limit: 8 }).runs;
  const initialTab = tab === "templates" || tab === "mine" || tab === "runs" || tab === "system" ? (tab as "templates" | "mine" | "runs" | "system") : undefined;
  return <WorkflowsGallery templates={templates} mine={mine} system={system} stats={stats} recentRuns={recentRuns} initialTab={initialTab} />;
}
