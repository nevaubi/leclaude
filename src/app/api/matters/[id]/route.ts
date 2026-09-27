import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";
import { jsonError } from "@/lib/ai/sse";
import { archiveMatter, getMatter, updateMatter } from "@/modules/matters/service";
import { readJsonObject, serviceErrorResponse } from "@/modules/workspace/errors";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const matter = getMatter(id);
  if (!matter) return jsonError("Matter not found", 404, { code: "not_found" });
  return Response.json({ matter });
}

/** PATCH — edit fields; `{ archived: false }` restores an archived matter. */
async function handlePATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJsonObject(req);
    return Response.json({ matter: updateMatter(id, body) });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

/** DELETE — archives the matter (status change); matters are never hard-deleted. */
async function handleDELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    return Response.json({ matter: archiveMatter(id) });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

export const GET = withAuth(handleGET, { action: "read", resource: (_req, { id }) => refs.matter(id) });
export const PATCH = withAuth(handlePATCH, { action: "write", resource: (_req, { id }) => refs.matter(id) });
export const DELETE = withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => refs.matter(id) });
