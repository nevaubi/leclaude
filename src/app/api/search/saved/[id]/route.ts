import { jsonError } from "@/lib/ai/sse";
import { deleteSavedSearch, savedSearches, updateSavedSearch } from "@/modules/search/service";
import type { SavedSearch } from "@/modules/search/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const saved = savedSearches().get(id);
  if (!saved) return jsonError("Not found", 404);
  return Response.json({ saved });
}

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Partial<Pick<SavedSearch, "name" | "query" | "settings" | "tags" | "notes" | "pinned">> | null;
  if (!body) return jsonError("Invalid body");
  const saved = updateSavedSearch(id, body);
  if (!saved) return jsonError("Not found", 404);
  return Response.json({ saved });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteSavedSearch(id) });
}
