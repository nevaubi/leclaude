import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { createEvent, listEvents } from "@/modules/home/service";
import { eventCreateSchema } from "@/modules/home/schemas";
import { param, parseBody } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";
import { bodyMatterId, queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const events = listEvents({ from: param(url, "from") ?? undefined, to: param(url, "to") ?? undefined, matterId: param(url, "matter"), includeKeyDates: url.searchParams.get("keyDates") !== "0" });
  return Response.json({ events });
}

async function handlePOST(req: Request) {
  const body = await parseBody(req, eventCreateSchema);
  if (!body.ok) return body.res;
  try {
    const event = createEvent(body.data);
    return Response.json({ event }, { status: 201 });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not create event", 500);
  }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "event", matterId: queryParam(req, "matter") }) }));
export const POST = withDb(withAuth(handlePOST, { action: "write", resource: async (req) => ({ kind: "event", matterId: await bodyMatterId(req) }) }));
