import type { NextRequest } from "next/server";
import { aiConfig } from "@/lib/ai/config";
import { ensureReview, matterFrom } from "@/modules/ediscovery/api-utils";
import { matterStats } from "@/modules/ediscovery/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  ensureReview();
  return Response.json({ ...matterStats(m.matterId), aiConfigured: aiConfig().hasKey });
}
