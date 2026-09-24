import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { currentUser } from "@/lib/current-user";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { buildMatterContext, buildUserContext } from "@/modules/intel/context/user-context";

export const runtime = "nodejs";

/**
 * GET ?userId=&horizonDays=14 → { user: UserContext }
 * GET ?matterId=&userId= → { matter: MatterContext }
 * The user context carries the ranked insights, docket/regulatory activity on active matters and preparation
 * material for upcoming events that Home renders; the matter context feeds matter headers and the agents.
 */
export async function GET(req: NextRequest) {
  intelAnalysisBootstrap();
  const url = new URL(req.url);
  const p = (k: string) => { const v = url.searchParams.get(k); return v == null || v === "" ? undefined : v; };
  const userId = p("userId") ?? currentUser().id;
  const matterId = p("matterId");
  try {
    if (matterId) {
      const matter = buildMatterContext(matterId, { userId });
      if (!matter) return jsonError("Matter not found", 404);
      return Response.json({ matter }, { headers: { "Cache-Control": "no-store" } });
    }
    const horizonDays = Math.max(1, Math.min(Number(p("horizonDays") ?? 14) || 14, 90));
    return Response.json({ user: buildUserContext(userId, { horizonDays }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
