import { jsonError } from "@/lib/ai/sse";
import { createSavedSearch, listSavedSearches } from "@/modules/search/service";
import type { SearchSettings } from "@/modules/search/types";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET() {
  return Response.json({ saved: listSavedSearches() });
}

async function handlePOST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string; query?: string; settings?: Partial<SearchSettings>; tags?: string[]; notes?: string; pinned?: boolean } | null;
  if (!body?.query?.trim()) return jsonError("`query` is required");
  const saved = createSavedSearch({ name: body.name, query: body.query, settings: body.settings, tags: body.tags, notes: body.notes, pinned: body.pinned });
  return Response.json({ saved }, { status: 201 });
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.research() });
export const POST = withAuth(handlePOST, { action: "write", resource: () => refs.research() });
