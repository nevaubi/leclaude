import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { deleteOfficeDoc, getOfficeDoc, saveOfficeDoc } from "@/modules/office/shared/docs-service";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/auth/route";
import { requirePrincipal } from "@/lib/auth/context";
import { hasMatterAccess } from "@/lib/auth/policy";
import { officeDocFromParams } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const doc = getOfficeDoc(id);
  if (!doc) return jsonError("Not found", 404);
  return Response.json({ doc });
}

async function handlePUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { title?: string; content?: unknown; meta?: Record<string, unknown>; matterId?: string | null; tags?: string[]; version?: { label?: string; summary?: string; authorName?: string; force?: boolean } } | null;
  if (!body) return jsonError("Invalid body");
  // Moving a document to another matter needs access to that matter as well (the wrapper checked the current one).
  if (body.matterId && !hasMatterAccess(requirePrincipal(), body.matterId)) return jsonError("You do not have access to that matter", 403, { code: "matter_forbidden" });
  const doc = saveOfficeDoc(id, body);
  if (!doc) return jsonError("Not found", 404);
  if (body.title) for (const li of db().library.find((l) => l.officeDocId === id)) db().library.update(li.id, { name: doc.title, updatedAt: doc.updatedAt, size: doc.size });
  const { content: _c, ...rest } = doc; void _c;
  return Response.json({ doc: rest });
}

async function handleDELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteOfficeDoc(id) });
}

export const GET = withAuth(handleGET, { action: "read", resource: officeDocFromParams });
export const PUT = withAuth(handlePUT, { action: "write", resource: officeDocFromParams });
export const DELETE = withAuth(handleDELETE, { action: "delete", resource: officeDocFromParams });
/** POST is an alias of PUT for keepalive/sendBeacon saves on page unload (beacons can only POST). */
export const POST = withAuth(handlePUT, { action: "write", resource: officeDocFromParams });
