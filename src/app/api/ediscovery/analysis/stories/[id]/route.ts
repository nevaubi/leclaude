import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { addFacts, deleteStory, getStory, storySources, updateStory, upsertFact } from "@/modules/ediscovery/analysis/service-stories";
import type { Story, StoryFact } from "@/modules/ediscovery/analysis/types";

export const runtime = "nodejs";

/** GET → { story, sources: { docs, depositions } } */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getStory(id);
  if (!s) return jsonError(`No story ${id}`, 404);
  return Response.json({ story: s, sources: storySources(s) });
}

/**
 * PATCH { title?, theme? } | { fact: Partial<StoryFact> } (upsert) | { removeFactId } | { addFacts: StoryFact[] } | { facts: StoryFact[] } (reorder/replace) → { story }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ title?: string; theme?: string; fact?: Partial<StoryFact>; removeFactId?: string; addFacts?: StoryFact[]; facts?: StoryFact[] }>(req);
  if (!body) return jsonError("Body required");
  try {
    let s: Story | null = null;
    if (body.removeFactId) s = upsertFact(id, { id: body.removeFactId }, { remove: true });
    else if (body.fact) s = upsertFact(id, body.fact);
    else if (body.addFacts) { const r = addFacts(id, body.addFacts); s = r?.story ?? null; if (r) return Response.json({ story: r.story, added: r.added, merged: r.merged }); }
    else s = updateStory(id, { title: body.title?.trim() || undefined, theme: body.theme, facts: body.facts });
    if (!s) return jsonError(`No story ${id}`, 404);
    return Response.json({ story: s });
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ ok: deleteStory(id) });
}
