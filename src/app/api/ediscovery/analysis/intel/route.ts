import type { NextRequest } from "next/server";
import { errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { matterIntelPanel, mergeIntelChronology } from "@/modules/ediscovery/analysis/intel-panel";

export const runtime = "nodejs";

/** GET ?matter= → MatterIntelPanel (judge profile, docket activity, regulatory chronology, MDL status; empty states when sources are off). */
export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  try { return Response.json(await matterIntelPanel(m.matterId), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return errorResponse(e); }
}

/** POST { matterId, minConfidence? } → ChronologyExportResult — merge the intelligence chronology into the matter timeline (deduped, gated, with provenance). */
export async function POST(req: NextRequest) {
  const body = await readJson<{ matterId?: string; minConfidence?: number }>(req);
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  try { return Response.json(await mergeIntelChronology(m.matterId, { minConfidence: typeof body?.minConfidence === "number" ? body.minConfidence : undefined })); }
  catch (e) { return errorResponse(e); }
}
