import type { NextRequest } from "next/server";
import { errorResponse } from "@/modules/ediscovery/api-utils";
import { getProduction, runProductionQc } from "@/modules/ediscovery/review-service";

export const runtime = "nodejs";

/** POST → runs the QC checks and stores the report: { production } */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { runProductionQc(id); return Response.json({ production: getProduction(id) }); } catch (e) { return errorResponse(e); }
}
