import { withDb } from "@/lib/db/request";
import { aiConfig } from "@/lib/ai/config";
import { loadHomeInitialData } from "@/modules/home/service";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";

/** Everything the home page needs, for client-side refreshes. */
async function handleGET() {
  return Response.json(loadHomeInitialData({ aiConfigured: aiConfig().hasKey }));
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => ({ kind: "brief" }) }));
