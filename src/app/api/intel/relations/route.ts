import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { buildRelations, relationsOf } from "@/modules/intel/analysis/graph";
import { RELATION_TYPES } from "@/modules/intel/analysis/pure";
import { intelEntities, intelRelations } from "@/modules/intel/store";
import type { IntelRelationType } from "@/modules/intel/types";

export const runtime = "nodejs";

/** GET ?entityId=&types=presides,cites&minWeight=&limit= → { relations, total } (entity names resolved on each row). */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const types = p("types")?.split(",").map((s) => s.trim()).filter((s): s is IntelRelationType => RELATION_TYPES.includes(s as IntelRelationType));
  const minWeight = Number(p("minWeight") ?? 1) || 1;
  const limit = Math.max(1, Math.min(Number(p("limit") ?? 200) || 200, 2000));
  const entityId = p("entityId");
  const all = entityId ? relationsOf(entityId, { types, minWeight }) : intelRelations().find((r) => (!types?.length || types.includes(r.type)) && r.weight >= minWeight).sort((a, b) => b.weight - a.weight);
  const name = (id: string) => intelEntities().get(id)?.name ?? id;
  const relations = all.slice(0, limit).map((r) => ({ ...r, fromName: name(r.from), toName: name(r.to), fromType: intelEntities().get(r.from)?.type, toType: intelEntities().get(r.to)?.type }));
  return Response.json({ relations, total: all.length });
}

/** POST { action: "rebuild", docIds?, reset? } → rebuild the relation graph. */
export async function POST(req: NextRequest) {
  intelAnalysisBootstrap();
  const body = (await req.json().catch(() => ({}))) as { action?: string; docIds?: string[]; reset?: boolean };
  if (body.action !== "rebuild") return jsonError('Provide { action: "rebuild" }', 422);
  return Response.json(buildRelations({ docIds: Array.isArray(body.docIds) ? body.docIds : undefined, reset: body.reset === true }));
}
