import { bootstrap } from "@/modules/workflows/api-utils";
import { workflowMeta } from "@/modules/workflows/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** People, matters and AI status for the builder's config panel and run form. */
async function handleGET() {
  bootstrap();
  return Response.json(workflowMeta());
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.workflow() });
