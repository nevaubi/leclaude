import { matterOverview } from "@/modules/home/service";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";

async function handleGET() {
  return Response.json({ matters: matterOverview() });
}

export const GET = withAuth(handleGET, { action: "read", resource: () => ({ kind: "matter" }) });
