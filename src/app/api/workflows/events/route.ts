import { z } from "zod";
import { errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { dispatchInboundEvent } from "@/modules/workflows/inbound";

export const runtime = "nodejs";

const eventSchema = z.object({
  type: z.enum(["document_added", "docket_update", "email"]),
  matterId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

/**
 * POST /api/workflows/events { type, matterId?, payload } — inbound event bus.
 * Other modules (library uploads, docket alerts, an inbound mail hook) post here;
 * every active workflow whose trigger matches starts a run with the payload.
 */
export async function POST(req: Request) {
  const body = await parseBody(req, eventSchema);
  if (!body.ok) return body.res;
  try {
    const started = await dispatchInboundEvent(body.data);
    return Response.json({ started }, { status: started.length ? 202 : 200 });
  } catch (e) { return errorResponse(e); }
}
