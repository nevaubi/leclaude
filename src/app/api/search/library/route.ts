import { jsonError } from "@/lib/ai/sse";
import { saveHitToLibrary } from "@/modules/search/service";
import type { SearchHit } from "@/modules/search/types";
import { withAuth } from "@/lib/auth/route";
import { bodyMatterId } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** POST /api/search/library {hit, matterId?, note?} → saves an authority into the shared library ("Saved research" folder). */
async function handlePOST(req: Request) {
  const body = (await req.json().catch(() => null)) as { hit?: SearchHit; matterId?: string | null; note?: string } | null;
  if (!body?.hit?.id || !body.hit.source || !body.hit.title) return jsonError("`hit` with id, source and title is required");
  const item = saveHitToLibrary(body.hit, { matterId: body.matterId ?? null, note: body.note });
  return Response.json({ item }, { status: 201 });
}

export const POST = withAuth(handlePOST, { action: "write", resource: async (req) => ({ kind: "library_item", matterId: await bodyMatterId(req) }) });
