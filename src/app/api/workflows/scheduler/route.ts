import { z } from "zod";
import { bootstrap, parseBody } from "@/modules/workflows/api-utils";
import { schedulerStatus, tick } from "@/modules/workflows/scheduler";

export const runtime = "nodejs";

/** GET → scheduler status (also starts it lazily). */
export async function GET() {
  bootstrap();
  return Response.json({ scheduler: schedulerStatus() });
}

/** POST { force?: [workflowId] } → evaluate schedules now (optionally forcing specific workflows). */
export async function POST(req: Request) {
  bootstrap();
  const body = await parseBody(req, z.object({ force: z.array(z.string()).optional() }).default({}));
  if (!body.ok) return body.res;
  const res = await tick(new Date(), { force: body.data.force });
  return Response.json({ ...res, scheduler: schedulerStatus() });
}
