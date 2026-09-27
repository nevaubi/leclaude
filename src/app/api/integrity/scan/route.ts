import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { ensureScheduledScans, fixFinding, lastReport, listScans, runScans } from "@/lib/integrity/bootstrap";
import { reviewCounts } from "@/lib/integrity/review";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";

/** GET → { scans, report, review: { pending, byKind } } (module scans are registered by the bootstrap import). */
async function handleGET() {
  ensureScheduledScans();
  return Response.json({ scans: listScans(), report: lastReport(), review: reviewCounts() });
}

/** POST { only?: string[] } runs the scans; POST { fix: findingId } applies an auto-fix. */
async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { fix?: string; only?: string[] };
  if (body.fix) return Response.json(fixFinding(body.fix));
  try {
    return Response.json({ report: runScans("manual", body.only) });
  } catch (e) { return jsonError((e as Error).message, 500); }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => ({ kind: "audit" }) }));
export const POST = withDb(withAuth(handlePOST, { action: "admin", resource: () => ({ kind: "audit" }) }));
