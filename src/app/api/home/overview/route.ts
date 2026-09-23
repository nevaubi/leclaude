import { aiConfig } from "@/lib/ai/config";
import { loadHomeInitialData } from "@/modules/home/service";

export const runtime = "nodejs";

/** Everything the home page needs, for client-side refreshes. */
export async function GET() {
  return Response.json(loadHomeInitialData({ aiConfigured: aiConfig().hasKey }));
}
