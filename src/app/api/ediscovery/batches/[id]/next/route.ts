import type { NextRequest } from "next/server";
import { errorResponse } from "@/modules/ediscovery/api-utils";
import { nextInBatch } from "@/modules/ediscovery/review-service";

export const runtime = "nodejs";

/** GET ?current=<docId>&qc=1 → { id: string | null, remaining } — the next document needing a decision in the batch (or its QC sample). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  try {
    return Response.json(nextInBatch(id, sp.get("current"), sp.get("qc") === "1"));
  } catch (e) { return errorResponse(e); }
}
