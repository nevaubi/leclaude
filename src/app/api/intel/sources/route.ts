import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { adapterInfos } from "@/modules/intel/adapters";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { providerStatuses } from "@/modules/intel/config";
import { createSource, IntelServiceError, listSources, sourceSummary, type CreateSourceInput } from "@/modules/intel/service";

export const runtime = "nodejs";

/** GET ?enabled=&adapter= → { sources (with counts and last job), adapters (with configured flags) }. */
export async function GET(req: NextRequest) {
  intelBootstrap();
  const url = new URL(req.url);
  const enabledParam = url.searchParams.get("enabled");
  const enabled = enabledParam == null || enabledParam === "" ? undefined : enabledParam === "1" || enabledParam === "true";
  const adapter = url.searchParams.get("adapter") ?? undefined;
  return Response.json({ sources: listSources({ enabled, adapter }).map(sourceSummary), adapters: adapterInfos(providerStatuses()) });
}

/** POST { adapter, name, description?, config?, schedule?, scope?, enabled? } → 201 { source }. */
export async function POST(req: NextRequest) {
  intelBootstrap();
  let body: CreateSourceInput;
  try { body = (await req.json()) as CreateSourceInput; } catch { return jsonError("Invalid JSON body"); }
  if (!body || typeof body !== "object" || !body.adapter || !body.name) return jsonError("adapter and name are required", 422);
  try {
    const source = createSource({ adapter: body.adapter, name: body.name, description: body.description, config: body.config, schedule: body.schedule, scope: body.scope, enabled: body.enabled });
    return Response.json({ source: sourceSummary(source) }, { status: 201 });
  } catch (e) {
    if (e instanceof IntelServiceError) return jsonError(e.message, e.status, { issues: e.issues });
    return jsonError((e as Error).message, 500);
  }
}
