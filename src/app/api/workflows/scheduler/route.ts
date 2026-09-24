import { z } from "zod";
import { bootstrap, parseBody } from "@/modules/workflows/api-utils";
import { schedulerStatus, tick } from "@/modules/workflows/scheduler";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** GET → scheduler status (also starts it lazily). */
async function handleGET() {
  bootstrap();
  return Response.json({ scheduler: schedulerStatus() });
}

/** POST { force?: [workflowId] } → evaluate schedules now (optionally forcing specific workflows). */
async function handlePOST(req: Request) {
  bootstrap();
  const body = await parseBody(req, z.object({ force: z.array(z.string()).optional() }).default({}));
  if (!body.ok) return body.res;
  const res = await tick(new Date(), { force: body.data.force });
  return Response.json({ ...res, scheduler: schedulerStatus() });
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.workflow() });
export const POST = withAuth(handlePOST, { action: "run", resource: () => refs.workflow() });
