import { jsonError } from "@/lib/ai/sse";
import { createEvent, listEvents } from "@/modules/home/service";
import { eventCreateSchema } from "@/modules/home/schemas";
import { param, parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const events = listEvents({ from: param(url, "from") ?? undefined, to: param(url, "to") ?? undefined, matterId: param(url, "matter"), includeKeyDates: url.searchParams.get("keyDates") !== "0" });
  return Response.json({ events });
}

export async function POST(req: Request) {
  const body = await parseBody(req, eventCreateSchema);
  if (!body.ok) return body.res;
  try {
    const event = createEvent(body.data);
    return Response.json({ event }, { status: 201 });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not create event", 500);
  }
}
