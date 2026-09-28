import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { can } from "@/lib/auth/policy";
import { refs } from "@/lib/auth/resources";
import type { Principal, ResourceRef } from "@/lib/auth/types";
import { withAuth } from "@/lib/auth/route";
import { batesStampDocuments, type BatesSetRequest } from "@/modules/office/pdf/service";
import { BATES_FONTS } from "@/modules/office/pdf/model";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Bates-stamp a set of PDF documents with one continuous sequence (in the given order), drawn onto each
 * document's original bytes. Body: { docIds[], prefix, start, digits?, position?, fontSize?, font?, legend?,
 * legendPosition?, ranges?: { [docId]: "1-3,7" }, force? }. Every document must be writable by the principal:
 * the resolver returns the first one that is not, so the policy denies the whole request.
 */
async function resolveAll(req: Request, _params: unknown, principal: Principal): Promise<ResourceRef> {
  const body = (await req.clone().json().catch(() => null)) as { docIds?: unknown } | null;
  const ids = Array.isArray(body?.docIds) ? body!.docIds.filter((x): x is string => typeof x === "string") : [];
  if (!ids.length) return { kind: "office_doc" };
  for (const id of ids) { const ref = refs.officeDoc(id); if (!can(principal, "write", ref)) return ref; }
  return refs.officeDoc(ids[0]);
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as BatesSetRequest | null;
  if (!body || !Array.isArray(body.docIds) || !body.docIds.length) return jsonError("`docIds` is required");
  if (body.docIds.length > 500) return jsonError("At most 500 documents per request");
  if (typeof body.prefix !== "string" || body.prefix.length > 40) return jsonError("`prefix` must be a string (≤ 40 chars)");
  if (!Number.isInteger(body.start) || body.start < 0) return jsonError("`start` must be a non-negative integer");
  if (body.digits !== undefined && (!Number.isInteger(body.digits) || body.digits < 1 || body.digits > 12)) return jsonError("`digits` must be 1–12");
  if (body.font !== undefined && !BATES_FONTS.includes(body.font)) return jsonError(`\`font\` must be one of ${BATES_FONTS.join(", ")}`);
  try {
    const r = await batesStampDocuments(body);
    return Response.json(r);
  } catch (e) {
    return jsonError(`Bates stamping failed: ${(e as Error).message}`, 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: resolveAll }));
