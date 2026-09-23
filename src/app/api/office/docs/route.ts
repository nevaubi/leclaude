import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { createOfficeDoc, listOfficeDocs } from "@/modules/office/shared/docs-service";
import { getTemplate } from "@/modules/office/shared/template-registry";
import type { OfficeKind } from "@/lib/types/domain";
import { db } from "@/lib/db";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") as OfficeKind | null;
  const matterId = req.nextUrl.searchParams.get("matterId") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const docs = listOfficeDocs({ kind: kind ?? undefined, matterId, limit }).map(({ content: _c, ...rest }) => { void _c; return rest; });
  return Response.json({ docs });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { kind?: OfficeKind; title?: string; content?: unknown; matterId?: string; folderId?: string; templateId?: string; meta?: Record<string, unknown>; addToLibrary?: boolean; tags?: string[] } | null;
  if (!body?.kind || !["word", "sheet", "slides", "pdf"].includes(body.kind)) return jsonError("`kind` must be word | sheet | slides | pdf");
  let content = body.content;
  let title = body.title;
  if (body.templateId) {
    const t = getTemplate(body.templateId);
    if (!t) return jsonError(`Unknown template ${body.templateId}`, 404);
    content = t.build({ matterId: body.matterId, title });
    title = title ?? t.name;
  }
  if (content === undefined) return jsonError("`content` or `templateId` is required");
  const doc = createOfficeDoc({ kind: body.kind, title, content, matterId: body.matterId, folderId: body.folderId, templateId: body.templateId, meta: body.meta, tags: body.tags });
  if (body.addToLibrary !== false) {
    const now = new Date().toISOString();
    const ext = { word: "docx", sheet: "xlsx", slides: "pptx", pdf: "pdf" }[doc.kind] as "docx" | "xlsx" | "pptx" | "pdf";
    db().library.put({ id: `lib_${nanoid(10)}`, parentId: body.folderId ?? null, name: doc.title, type: ext, matterId: doc.matterId, officeDocId: doc.id, createdAt: now, updatedAt: now, size: doc.size, ownerId: doc.createdById, sharedWith: ["firm"] });
  }
  return Response.json({ doc });
}
