import type { NextRequest } from "next/server";
import { errorResponse } from "@/modules/ediscovery/api-utils";
import { similarDocuments } from "@/modules/ediscovery/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const k = Math.min(25, Number(req.nextUrl.searchParams.get("k") ?? 10));
  try {
    return Response.json({ similar: await similarDocuments(id, k) });
  } catch (e) {
    return errorResponse(e);
  }
}
