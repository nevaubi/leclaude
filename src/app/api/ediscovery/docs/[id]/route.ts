import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { cachedAnalysis } from "@/modules/ediscovery/ai";
import { getDocument, updateCoding } from "@/modules/ediscovery/service";
import type { CodingPatch } from "@/modules/ediscovery/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getDocument(id, { recordView: req.nextUrl.searchParams.get("view") !== "0" });
  if (!detail) return jsonError(`No document ${id}`, 404);
  return Response.json({ ...detail, analysis: cachedAnalysis(detail.doc.id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ coding?: CodingPatch; reviewerId?: string }>(req);
  if (!body?.coding) return jsonError("`coding` is required");
  try {
    const doc = updateCoding(id, body.coding, body.reviewerId);
    if (!doc) return jsonError(`No document ${id}`, 404);
    return Response.json({ doc: { id: doc.id, coding: doc.coding } });
  } catch (e) {
    return errorResponse(e);
  }
}
