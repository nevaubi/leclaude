import { bootstrap } from "@/modules/workflows/api-utils";
import { workflowStats } from "@/modules/workflows/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET() {
  bootstrap();
  return Response.json({ stats: workflowStats() });
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.workflow() });
