import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { createOfficeDoc, listOfficeDocs } from "@/modules/office/shared/docs-service";
import { getTemplate } from "@/modules/office/shared/template-registry";
import type { OfficeKind } from "@/lib/types/domain";
import { db } from "@/lib/db";
import { nanoid } from "nanoid";
import { matterFolderId, LIBRARY_FOLDERS } from "@/modules/library/ids";
import { withAuth } from "@/lib/auth/route";
import { requirePrincipal } from "@/lib/auth/context";
import { hasMatterAccess } from "@/lib/auth/policy";
import { officeCollection } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";

async function handleGET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") as OfficeKind | null;
  const matterId = req.nextUrl.searchParams.get("matterId") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const principal = requirePrincipal();
  const docs = listOfficeDocs({ kind: kind ?? undefined, matterId, limit }).filter((d) => !d.matterId || hasMatterAccess(principal, d.matterId)).map(({ content: _c, ...rest }) => { void _c; return rest; });
  return Response.json({ docs });
}

async function handlePOST(req: NextRequest) {
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
    db().library.put({ id: `lib_${nanoid(10)}`, parentId: body.folderId ?? (doc.matterId ? matterFolderId(doc.matterId) : LIBRARY_FOLDERS.myFiles), name: doc.title, type: ext, matterId: doc.matterId, officeDocId: doc.id, createdAt: now, updatedAt: now, size: doc.size, ownerId: doc.createdById, sharedWith: ["firm"] });
  }
  return Response.json({ doc });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: officeCollection }));
export const POST = withDb(withAuth(handlePOST, { action: "write", resource: officeCollection }));
