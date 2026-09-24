import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { listJobs } from "@/modules/intel/jobs";
import { deleteSource, getSource, IntelServiceError, sourceSummary, updateSource, type UpdateSourceInput } from "@/modules/intel/service";
import { listDocuments } from "@/modules/intel/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET → { source, jobs (latest 10), documents: { total, byKind } }. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  intelBootstrap();
  const { id } = await params;
  const source = getSource(id);
  if (!source) return jsonError("Source not found", 404);
  const docs = listDocuments({ sourceId: id, limit: 500 });
  const byKind: Record<string, number> = {};
  for (const d of docs.items) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  return Response.json({ source: sourceSummary(source), jobs: listJobs({ sourceId: id, limit: 10 }).items, documents: { total: docs.total, byKind } });
}

/** PATCH { name?, description?, config?, schedule?, scope?, enabled? } → { source }. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  intelBootstrap();
  const { id } = await params;
  let body: UpdateSourceInput;
  try { body = (await req.json()) as UpdateSourceInput; } catch { return jsonError("Invalid JSON body"); }
  try {
    return Response.json({ source: sourceSummary(updateSource(id, body)) });
  } catch (e) {
    if (e instanceof IntelServiceError) return jsonError(e.message, e.status, { issues: e.issues });
    return jsonError((e as Error).message, 500);
  }
}

/** DELETE ?keepDocuments=1 → { deleted, documentsRemoved }. System sources cannot be deleted (409). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  intelBootstrap();
  const { id } = await params;
  const keep = new URL(req.url).searchParams.get("keepDocuments");
  try {
    return Response.json(deleteSource(id, { keepDocuments: keep === "1" || keep === "true" }));
  } catch (e) {
    if (e instanceof IntelServiceError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message, 500);
  }
}
