import { withDb } from "@/lib/db/request";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { deleteWatch, updateWatch } from "@/modules/intel/analysis/watches";
import { intelWatches } from "@/modules/intel/store";
import type { IntelWatch } from "@/modules/intel/types";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET → { watch } */
async function handleGET(_req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  const watch = intelWatches().get(id);
  return watch ? Response.json({ watch }) : jsonError("Watch not found", 404);
}

/** PATCH { label?, channels?, matterId? } → { watch } */
async function handlePATCH(req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  if (!intelWatches().has(id)) return jsonError("Watch not found", 404);
  const body = (await req.json().catch(() => ({}))) as Partial<Pick<IntelWatch, "label" | "channels" | "matterId">>;
  return Response.json({ watch: updateWatch(id, { label: body.label, channels: body.channels, matterId: body.matterId }) });
}

/** DELETE → { deleted } */
async function handleDELETE(_req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  if (!intelWatches().has(id)) return jsonError("Watch not found", 404);
  return Response.json({ deleted: deleteWatch(id) });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (_req, { id }) => ({ kind: "intel", id }) }));
export const PATCH = withDb(withAuth(handlePATCH, { action: "write", resource: (_req, { id }) => ({ kind: "intel", id }) }));
export const DELETE = withDb(withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => ({ kind: "intel", id }) }));
