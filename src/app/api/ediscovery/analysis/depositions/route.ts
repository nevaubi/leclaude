import type { NextRequest } from "next/server";
import { matterFrom } from "@/modules/ediscovery/api-utils";
import { listDepositions } from "@/modules/ediscovery/analysis/service";

export const runtime = "nodejs";

/** GET ?matter= → { depositions: DepositionSummary[] } */
export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  return Response.json({ depositions: listDepositions(m.matterId) });
}
