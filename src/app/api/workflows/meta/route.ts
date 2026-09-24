import { bootstrap } from "@/modules/workflows/api-utils";
import { workflowMeta } from "@/modules/workflows/service";

export const runtime = "nodejs";

/** People, matters and AI status for the builder's config panel and run form. */
export async function GET() {
  bootstrap();
  return Response.json(workflowMeta());
}
