import { jsonError } from "@/lib/ai/sse";
import { createSavedSearch, listSavedSearches } from "@/modules/search/service";
import type { SearchSettings } from "@/modules/search/types";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ saved: listSavedSearches() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string; query?: string; settings?: Partial<SearchSettings>; tags?: string[]; notes?: string; pinned?: boolean } | null;
  if (!body?.query?.trim()) return jsonError("`query` is required");
  const saved = createSavedSearch({ name: body.name, query: body.query, settings: body.settings, tags: body.tags, notes: body.notes, pinned: body.pinned });
  return Response.json({ saved }, { status: 201 });
}
