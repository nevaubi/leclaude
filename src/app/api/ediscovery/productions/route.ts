import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { ensureReview, errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { createProduction, listProductions } from "@/modules/ediscovery/review-service";
import type { ProductionCreateInput } from "@/modules/ediscovery/types";

export const runtime = "nodejs";

/** GET ?matter= → { productions: ProductionSummary2[] } */
export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  ensureReview();
  return Response.json({ productions: listProductions(m.matterId) });
}

/** POST ProductionCreateInput → 201 { production } — freezes the document set and assigns production Bates numbers. */
export async function POST(req: NextRequest) {
  const body = await readJson<ProductionCreateInput>(req);
  if (!body) return jsonError("Invalid JSON body");
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  ensureReview();
  try { return Response.json({ production: await createProduction({ ...body, matterId: m.matterId }) }, { status: 201 }); } catch (e) { return errorResponse(e); }
}
