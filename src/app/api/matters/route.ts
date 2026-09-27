import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/route";
import { createMatter, listMatters } from "@/modules/matters/service";
import { MATTER_STATUS_FILTERS, type MatterStatusFilter } from "@/modules/matters/types";
import { readJsonObject, serviceErrorResponse } from "@/modules/workspace/errors";
import { jsonError } from "@/lib/ai/sse";

export const runtime = "nodejs";

/** GET /api/matters?status=open|active|pre-suit|on hold|closed|archived|all&q=… — matters the principal may access. */
async function handleGET(req: NextRequest) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("status") ?? "open";
  if (!(MATTER_STATUS_FILTERS as readonly string[]).includes(raw)) return jsonError(`status must be one of ${MATTER_STATUS_FILTERS.join(", ")}`, 400, { code: "bad_status" });
  const matters = listMatters({ status: raw as MatterStatusFilter, q: url.searchParams.get("q") ?? undefined });
  return Response.json({ matters, total: matters.length });
}

/** POST /api/matters — create a matter (201). 422 with per-field messages on validation, 409 when the matter number is already used. */
async function handlePOST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    return Response.json({ matter: createMatter(body) }, { status: 201 });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

export const GET = withAuth(handleGET, { action: "read", resource: () => ({ kind: "matter" }) });
export const POST = withAuth(handlePOST, { action: "write", resource: () => ({ kind: "matter" }) });
