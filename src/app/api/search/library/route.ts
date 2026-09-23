import { jsonError } from "@/lib/ai/sse";
import { saveHitToLibrary } from "@/modules/search/service";
import type { SearchHit } from "@/modules/search/types";

export const runtime = "nodejs";

/** POST /api/search/library {hit, matterId?, note?} → saves an authority into the shared library ("Saved research" folder). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { hit?: SearchHit; matterId?: string | null; note?: string } | null;
  if (!body?.hit?.id || !body.hit.source || !body.hit.title) return jsonError("`hit` with id, source and title is required");
  const item = saveHitToLibrary(body.hit, { matterId: body.matterId ?? null, note: body.note });
  return Response.json({ item }, { status: 201 });
}
