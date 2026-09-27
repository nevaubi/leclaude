import "server-only";
import { db } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/policy";
import { bodyString, queryParam, refs } from "@/lib/auth/resources";
import type { Principal, ResourceRef } from "@/lib/auth/types";

/**
 * Resource resolvers for the office API routes (constitution §22). Every office route authorizes the real
 * document (its matter comes from the stored record, never from the client) and, when the request also names
 * a matter, that matter too: the resolver returns whichever reference the principal cannot access so the
 * policy denies, instead of letting a second id slip past the check.
 */

function narrowest(principal: Principal, doc: ResourceRef, requestedMatter: string | undefined): ResourceRef {
  if (requestedMatter && requestedMatter !== doc.matterId && !hasMatterAccess(principal, requestedMatter)) return { kind: "office_doc", id: doc.id, matterId: requestedMatter };
  return doc;
}

/** `[id]` routes: the document named in the path. */
export const officeDocFromParams = (_req: Request, params: { id?: string }): ResourceRef => refs.officeDoc(params.id);

/** JSON-body routes that take `docId` (exports, agents) and optionally `matterId`. */
export async function officeDocFromBody(req: Request, _params: unknown, principal: Principal): Promise<ResourceRef> {
  const docId = await bodyString(req, "docId");
  const matterId = await bodyString(req, "matterId", "matter");
  const doc = docId ? refs.officeDoc(docId) : { kind: "office_doc" as const, matterId };
  return narrowest(principal, doc, matterId);
}

/** A target library folder that belongs to a matter the principal cannot open wins over the requested matter. */
function withFolder(principal: Principal, ref: ResourceRef, folderId: string | undefined): ResourceRef {
  const folderMatter = folderId ? db().library.get(folderId)?.matterId : undefined;
  if (folderMatter && !hasMatterAccess(principal, folderMatter)) return { kind: "office_doc", matterId: folderMatter };
  return ref;
}

/** Collection routes: the matter filter or target from the query string or the JSON body (and its target folder). */
export async function officeCollection(req: Request, _params: unknown, principal: Principal): Promise<ResourceRef> {
  const fromQuery = queryParam(req, "matterId", "matter");
  const write = !(req.method === "GET" || req.method === "HEAD");
  const fromBody = write ? await bodyString(req, "matterId", "matter") : undefined;
  const ref: ResourceRef = { kind: "office_doc", matterId: fromQuery ?? fromBody };
  return write ? withFolder(principal, ref, await bodyString(req, "folderId")) : ref;
}

/** Multipart uploads (import): the target matter and folder from the form. */
export async function officeUploadTarget(req: Request, _params: unknown, principal: Principal): Promise<ResourceRef> {
  const form = await req.clone().formData().catch(() => null);
  const field = (k: string) => { const v = form?.get(k); return typeof v === "string" && v.trim() ? v.trim() : undefined; };
  return withFolder(principal, { kind: "office_doc", matterId: field("matterId") }, field("folderId"));
}
