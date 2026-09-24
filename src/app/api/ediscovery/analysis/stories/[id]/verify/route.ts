import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { verifyStory } from "@/modules/ediscovery/analysis/service-stories";

export const runtime = "nodejs";

/** POST → { story, report: StoryCiteReport } — every Bates / page:line / record id checked against the matter record. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = verifyStory(id);
  if (!r) return jsonError(`No story ${id}`, 404);
  return Response.json(r);
}
