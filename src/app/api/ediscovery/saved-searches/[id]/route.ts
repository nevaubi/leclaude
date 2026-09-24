import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import type { SavedSearchRecord } from "@/lib/types/domain";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { deleteSavedSearch, runSavedSearch, updateSavedSearch } from "@/modules/ediscovery/review-service";

export const runtime = "nodejs";

/** PATCH { name?, q?, shared?, … } → { search } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<Partial<SavedSearchRecord>>(req);
  if (!body) return jsonError("Invalid JSON body");
  try {
    const search = updateSavedSearch(id, body);
    if (!search) return jsonError(`No saved search ${id}`, 404);
    return Response.json({ search });
  } catch (e) { return errorResponse(e); }
}

/** POST → runs the search and records its count: { search, total } */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { return Response.json(await runSavedSearch(id)); } catch (e) { return errorResponse(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return deleteSavedSearch(id) ? Response.json({ ok: true }) : jsonError(`No saved search ${id}`, 404);
}
