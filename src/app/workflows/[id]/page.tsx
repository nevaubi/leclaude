import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkflowBuilder } from "@/modules/workflows/components/builder/builder";
import { getWorkflow } from "@/modules/workflows/service";
import { ensureScheduler } from "@/modules/workflows/scheduler";
import Loading from "./loading";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const w = getWorkflow(id);
  return { title: w ? `${w.name} · Workflows` : "Workflow" };
}

export default async function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  ensureScheduler();
  const workflow = getWorkflow(id);
  if (!workflow) notFound();
  return (
    <Suspense fallback={<Loading />}>
      <WorkflowBuilder workflow={workflow} />
    </Suspense>
  );
}
