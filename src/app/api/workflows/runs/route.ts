import { bootstrap, param } from "@/modules/workflows/api-utils";
import { listRuns } from "@/modules/workflows/service";

export const runtime = "nodejs";

/** GET /api/workflows/runs?workflowId=&status=&matterId=&triggeredBy=&q=&limit=&offset= */
export async function GET(req: Request) {
  bootstrap();
  const url = new URL(req.url);
  const res = listRuns({ workflowId: param(url, "workflowId"), status: param(url, "status"), matterId: param(url, "matterId"), triggeredBy: param(url, "triggeredBy"), q: param(url, "q"), limit: Math.min(200, Number(param(url, "limit") ?? 50)), offset: Number(param(url, "offset") ?? 0) });
  return Response.json(res);
}
