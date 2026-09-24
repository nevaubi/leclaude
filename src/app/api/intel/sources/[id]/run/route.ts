import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { kickRunner } from "@/modules/intel/background";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { runSourceNow } from "@/modules/intel/jobs";
import { getSource } from "@/modules/intel/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST { wait?: boolean, maxDocs?: number } → { job }. With wait, the run executes inline and the finished job is returned. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  intelBootstrap();
  const { id } = await params;
  if (!getSource(id)) return jsonError("Source not found", 404);
  const body = (await req.json().catch(() => ({}))) as { wait?: boolean; maxDocs?: number };
  try {
    const job = await runSourceNow(id, { wait: Boolean(body.wait), maxDocs: typeof body.maxDocs === "number" ? body.maxDocs : undefined });
    if (!body.wait) kickRunner();
    return Response.json({ job });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
