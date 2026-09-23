import { jsonError } from "@/lib/ai/sse";
import { deleteEvent, getEvent, updateEvent } from "@/modules/home/service";
import { eventPatchSchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = getEvent(id);
  return event ? Response.json({ event }) : jsonError("Event not found", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id.startsWith("kd_")) return jsonError("Matter key dates are edited on the matter, not the calendar", 409);
  const body = await parseBody(req, eventPatchSchema);
  if (!body.ok) return body.res;
  const event = updateEvent(id, body.data);
  return event ? Response.json({ event }) : jsonError("Event not found", 404);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id.startsWith("kd_")) return jsonError("Matter key dates cannot be deleted from the calendar", 409);
  return deleteEvent(id) ? Response.json({ ok: true }) : jsonError("Event not found", 404);
}
