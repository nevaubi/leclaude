import { withDb } from "@/lib/db/request";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { refs } from "@/lib/auth/resources";
import { requirePrincipal, scopeFor, withAuth } from "@/lib/auth/route";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { matterCoverage } from "@/modules/intel/analysis/matter-coverage";

export const runtime = "nodejs";

/**
 * GET ?matterId= → CoverageResponse: per matter, the sources serving it and their state, the searches they run,
 * records / entities / relations / insights, plus live and recently failed source runs. Read-only.
 * The view is narrowed to the matters the principal may read; a requested matter outside that scope is a 403.
 */
async function handleGET(req: NextRequest) {
  intelBootstrap();
  const principal = requirePrincipal();
  const matterId = new URL(req.url).searchParams.get("matterId")?.trim() || undefined;
  const scope = scopeFor(principal, matterId, "read", "GET /api/intel/coverage");
  try {
    return Response.json(matterCoverage(scope.matterIds, { restricted: principal.matterIds !== "*" }));
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => refs.intel(new URL(req.url).searchParams.get("matterId")?.trim() || undefined) }));
