import { jsonError } from "@/lib/ai/sse";
import { deleteSavedSearch, savedSearches, updateSavedSearch } from "@/modules/search/service";
import type { SavedSearch } from "@/modules/search/types";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: Request, { params }: Params) {
  const { id } = await params;
  const saved = savedSearches().get(id);
  if (!saved) return jsonError("Not found", 404);
  return Response.json({ saved });
}

async function handlePUT(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Partial<Pick<SavedSearch, "name" | "query" | "settings" | "tags" | "notes" | "pinned">> | null;
  if (!body) return jsonError("Invalid body");
  const saved = updateSavedSearch(id, body);
  if (!saved) return jsonError("Not found", 404);
  return Response.json({ saved });
}

async function handleDELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteSavedSearch(id) });
}

export const GET = withAuth(handleGET, { action: "read", resource: (_req, { id }) => refs.research(id) });
export const PUT = withAuth(handlePUT, { action: "write", resource: (_req, { id }) => refs.research(id) });
export const DELETE = withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => refs.research(id) });
