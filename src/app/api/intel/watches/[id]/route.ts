import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { deleteWatch, updateWatch } from "@/modules/intel/analysis/watches";
import { intelWatches } from "@/modules/intel/store";
import type { IntelWatch } from "@/modules/intel/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET → { watch } */
export async function GET(_req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  const watch = intelWatches().get(id);
  return watch ? Response.json({ watch }) : jsonError("Watch not found", 404);
}

/** PATCH { label?, channels?, matterId? } → { watch } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  if (!intelWatches().has(id)) return jsonError("Watch not found", 404);
  const body = (await req.json().catch(() => ({}))) as Partial<Pick<IntelWatch, "label" | "channels" | "matterId">>;
  return Response.json({ watch: updateWatch(id, { label: body.label, channels: body.channels, matterId: body.matterId }) });
}

/** DELETE → { deleted } */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  intelAnalysisBootstrap();
  const { id } = await params;
  if (!intelWatches().has(id)) return jsonError("Watch not found", 404);
  return Response.json({ deleted: deleteWatch(id) });
}
