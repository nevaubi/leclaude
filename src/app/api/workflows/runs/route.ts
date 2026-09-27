import { withDb } from "@/lib/db/request";
import { bootstrap, param } from "@/modules/workflows/api-utils";
import { listRuns } from "@/modules/workflows/service";
import { withAuth } from "@/lib/auth/route";
import { queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** GET /api/workflows/runs?workflowId=&status=&matterId=&triggeredBy=&q=&limit=&offset= */
async function handleGET(req: Request) {
  bootstrap();
  const url = new URL(req.url);
  const res = listRuns({ workflowId: param(url, "workflowId"), status: param(url, "status"), matterId: param(url, "matterId"), triggeredBy: param(url, "triggeredBy"), q: param(url, "q"), limit: Math.min(200, Number(param(url, "limit") ?? 50)), offset: Number(param(url, "offset") ?? 0) });
  return Response.json(res);
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "workflow_run", matterId: queryParam(req, "matterId") }) }));
