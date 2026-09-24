import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { deleteLayout, listLayouts, saveLayout } from "@/modules/ediscovery/review-service";
import type { ReviewLayoutInput } from "@/modules/ediscovery/types";

export const runtime = "nodejs";

/** GET ?matter= → { layouts: ReviewLayout[] } for the current user. */
export async function GET(req: NextRequest) {
  return Response.json({ layouts: listLayouts(undefined, req.nextUrl.searchParams.get("matter") ?? undefined) });
}

/** POST ReviewLayoutInput → { layout } (upsert by name). */
export async function POST(req: NextRequest) {
  const body = await readJson<ReviewLayoutInput>(req);
  if (!body) return jsonError("Invalid JSON body");
  try { return Response.json({ layout: saveLayout(body) }, { status: 201 }); } catch (e) { return errorResponse(e); }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("`id` is required");
  return deleteLayout(id) ? Response.json({ ok: true }) : jsonError(`No layout ${id}`, 404);
}
