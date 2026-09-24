import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { kickRunner } from "@/modules/intel/background";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { cancelJob, getJob, retryJob } from "@/modules/intel/jobs";
import { intelSources } from "@/modules/intel/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET → { job, source? }. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  intelBootstrap();
  const { id } = await params;
  const job = getJob(id);
  if (!job) return jsonError("Job not found", 404);
  const source = job.sourceId ? intelSources().get(job.sourceId) : null;
  return Response.json({ job, source: source ? { id: source.id, name: source.name, adapter: source.adapter, health: source.health } : undefined });
}

/** POST { action: "retry" | "cancel", note? } → { job }. */
export async function POST(req: NextRequest, { params }: Ctx) {
  intelBootstrap();
  const { id } = await params;
  const job = getJob(id);
  if (!job) return jsonError("Job not found", 404);
  const body = (await req.json().catch(() => ({}))) as { action?: string; note?: string };
  if (body.action === "retry") {
    if (job.status === "queued" || job.status === "running") return jsonError(`Job is ${job.status}`, 409);
    const updated = retryJob(id, { by: "human", note: body.note });
    kickRunner();
    return Response.json({ job: updated });
  }
  if (body.action === "cancel") {
    if (job.status !== "queued" && job.status !== "running") return jsonError(`Job is ${job.status}`, 409);
    return Response.json({ job: cancelJob(id) });
  }
  return jsonError("action must be retry or cancel", 422);
}
