import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { deleteOfficeDoc, getOfficeDoc, saveOfficeDoc } from "@/modules/office/shared/docs-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const doc = getOfficeDoc(id);
  if (!doc) return jsonError("Not found", 404);
  return Response.json({ doc });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { title?: string; content?: unknown; meta?: Record<string, unknown>; matterId?: string | null; tags?: string[]; version?: { label?: string; summary?: string; authorName?: string; force?: boolean } } | null;
  if (!body) return jsonError("Invalid body");
  const doc = saveOfficeDoc(id, body);
  if (!doc) return jsonError("Not found", 404);
  if (body.title) for (const li of db().library.find((l) => l.officeDocId === id)) db().library.update(li.id, { name: doc.title, updatedAt: doc.updatedAt, size: doc.size });
  const { content: _c, ...rest } = doc; void _c;
  return Response.json({ doc: rest });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteOfficeDoc(id) });
}
