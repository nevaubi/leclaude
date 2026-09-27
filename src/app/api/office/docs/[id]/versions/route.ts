import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { checkpoint, getVersion, listVersions, restoreVersion } from "@/modules/office/shared/docs-service";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromParams } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

async function handleGET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const versionId = req.nextUrl.searchParams.get("versionId");
  if (versionId) {
    const v = getVersion(id, versionId);
    return v ? Response.json({ version: v }) : jsonError("Not found", 404);
  }
  return Response.json({ versions: listVersions(id) });
}

async function handlePOST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action: "checkpoint" | "restore"; label?: string; versionId?: string } | null;
  if (!body) return jsonError("Invalid body");
  if (body.action === "checkpoint") {
    const v = checkpoint(id, body.label?.trim() || "Checkpoint");
    return v ? Response.json({ version: { ...v, content: undefined } }) : jsonError("Not found", 404);
  }
  if (body.action === "restore" && body.versionId) {
    const doc = restoreVersion(id, body.versionId);
    return doc ? Response.json({ doc }) : jsonError("Not found", 404);
  }
  return jsonError("Unknown action");
}

export const GET = withAuth(handleGET, { action: "read", resource: officeDocFromParams });
export const POST = withAuth(handlePOST, { action: "write", resource: officeDocFromParams });
