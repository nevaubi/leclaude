import type { NextRequest } from "next/server";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { graphExport } from "@/modules/intel/analysis/graph";
import { ENTITY_TYPES, RELATION_TYPES } from "@/modules/intel/analysis/pure";
import type { IntelEntityType, IntelRelationType } from "@/modules/intel/types";

export const runtime = "nodejs";

/** GET ?entityId=&depth=1&types=&entityTypes=&minWeight=&limit=80 → { nodes, links, center, depth, truncated } for d3-force. */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const types = p("types")?.split(",").map((s) => s.trim()).filter((s): s is IntelRelationType => RELATION_TYPES.includes(s as IntelRelationType));
  const entityTypes = p("entityTypes")?.split(",").map((s) => s.trim()).filter((s): s is IntelEntityType => ENTITY_TYPES.includes(s as IntelEntityType));
  return Response.json(graphExport({
    entityId: p("entityId"),
    depth: Math.max(1, Math.min(Number(p("depth") ?? 1) || 1, 3)),
    types: types?.length ? types : undefined,
    entityTypes: entityTypes?.length ? entityTypes : undefined,
    minWeight: Number(p("minWeight") ?? 1) || 1,
    limit: Math.max(5, Math.min(Number(p("limit") ?? 80) || 80, 300)),
  }));
}
