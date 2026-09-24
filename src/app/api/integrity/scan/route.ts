import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { ensureScheduledScans, fixFinding, lastReport, listScans, runScans } from "@/lib/integrity/bootstrap";
import { reviewCounts } from "@/lib/integrity/review";

export const runtime = "nodejs";

/** GET → { scans, report, review: { pending, byKind } } (module scans are registered by the bootstrap import). */
export async function GET() {
  ensureScheduledScans();
  return Response.json({ scans: listScans(), report: lastReport(), review: reviewCounts() });
}

/** POST { only?: string[] } runs the scans; POST { fix: findingId } applies an auto-fix. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { fix?: string; only?: string[] };
  if (body.fix) return Response.json(fixFinding(body.fix));
  try {
    return Response.json({ report: runScans("manual", body.only) });
  } catch (e) { return jsonError((e as Error).message, 500); }
}
