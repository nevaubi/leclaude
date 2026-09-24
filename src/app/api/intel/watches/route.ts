import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { currentUser } from "@/lib/current-user";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { createWatch, listWatches } from "@/modules/intel/analysis/watches";
import { intelEntities } from "@/modules/intel/store";
import type { IntelWatch, IntelWatchKind } from "@/modules/intel/types";

export const runtime = "nodejs";

/** GET ?userId=&kind=&matterId= → { watches } (entity names and types resolved). */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const watches = listWatches({ userId: p("userId") ?? currentUser().id, kind: p("kind") as IntelWatchKind | undefined, matterId: p("matterId") }).map((w) => { const e = intelEntities().get(w.target); return { ...w, entity: e ? { id: e.id, type: e.type, name: e.name, documents: e.docIds.length } : null }; });
  return Response.json({ watches });
}

/** POST { kind, target, label?, matterId?, channels?, userId? } → 201 { watch }. */
export async function POST(req: NextRequest) {
  intelAnalysisBootstrap();
  const body = (await req.json().catch(() => ({}))) as { kind?: IntelWatchKind; target?: string; label?: string; matterId?: string; channels?: IntelWatch["channels"]; userId?: string };
  if (!body.kind || !body.target) return jsonError("kind and target are required", 422);
  try {
    const watch = createWatch({ kind: body.kind, target: body.target, label: body.label, matterId: body.matterId, channels: body.channels, userId: body.userId });
    return Response.json({ watch }, { status: 201 });
  } catch (e) {
    return jsonError((e as Error).message, 422);
  }
}
