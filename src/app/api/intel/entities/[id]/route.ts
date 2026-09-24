import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { currentUser } from "@/lib/current-user";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { entityDocuments } from "@/modules/intel/analysis/entities";
import { entityProfile, profileSummary } from "@/modules/intel/analysis/profiles";
import { toggleEntityWatch } from "@/modules/intel/analysis/watches";
import { intelEntities } from "@/modules/intel/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET ?userId=&compact=1 → the entity profile (attributes, activity, tendencies, related, recent, timeline, watch). */
export async function GET(req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") ?? currentUser().id;
  if (url.searchParams.get("compact") === "1") {
    const entity = intelEntities().get(id);
    if (!entity) return jsonError("Entity not found", 404);
    return Response.json({ entity, ...profileSummary(entity, entityDocuments(id)) });
  }
  const profile = entityProfile(id, { userId });
  if (!profile) return jsonError("Entity not found", 404);
  return Response.json(profile);
}

/** POST { action: "watch", userId?, matterId? } → { watched, watch? } (toggles the watch for the user). */
export async function POST(req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  if (!intelEntities().has(id)) return jsonError("Entity not found", 404);
  const body = (await req.json().catch(() => ({}))) as { action?: string; userId?: string; matterId?: string };
  if (body.action !== "watch") return jsonError('Provide { action: "watch" }', 422);
  try {
    return Response.json(toggleEntityWatch(id, { userId: body.userId, matterId: body.matterId }));
  } catch (e) {
    return jsonError((e as Error).message, 422);
  }
}
