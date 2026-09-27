import "server-only";
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

/** Collection routes: the matter filter or target from the query string or the JSON body. */
export async function officeCollection(req: Request): Promise<ResourceRef> {
  const fromQuery = queryParam(req, "matterId", "matter");
  const fromBody = req.method === "GET" || req.method === "HEAD" ? undefined : await bodyString(req, "matterId", "matter");
  return { kind: "office_doc", matterId: fromQuery ?? fromBody };
}

/** Multipart uploads (import): the target matter from the form. */
export async function officeUploadTarget(req: Request): Promise<ResourceRef> {
  const form = await req.clone().formData().catch(() => null);
  const m = form?.get("matterId");
  return { kind: "office_doc", matterId: typeof m === "string" && m.trim() ? m.trim() : undefined };
}
