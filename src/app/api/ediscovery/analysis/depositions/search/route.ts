import type { NextRequest } from "next/server";
import { matterFrom } from "@/modules/ediscovery/api-utils";
import { searchAllTranscripts } from "@/modules/ediscovery/analysis/service";
import type { QAFlag } from "@/modules/ediscovery/analysis/types";

export const runtime = "nodejs";

/** GET ?matter=&q=&flags=admission,key&deposition=&limit= → { hits: TranscriptHit[] } */
export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const flags = (sp.get("flags") ?? "").split(",").filter(Boolean) as QAFlag[];
  const hits = searchAllTranscripts(m.matterId, q, { flags, depositionId: sp.get("deposition") ?? undefined, limit: Number(sp.get("limit") ?? 200) });
  return Response.json({ q, hits, total: hits.length });
}
