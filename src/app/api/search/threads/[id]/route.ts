import { jsonError } from "@/lib/ai/sse";
import { deleteThread, getThread, renameThread, setThreadPins } from "@/modules/search/engine/threads";
import type { ResearchPin } from "@/modules/search/engine/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const thread = getThread(id);
  if (!thread) return jsonError("Not found", 404);
  return Response.json({ thread });
}

/** PUT {pins?: ResearchPin[], title?: string} — pins and title are the only client-editable fields. */
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { pins?: ResearchPin[]; title?: string } | null;
  if (!body) return jsonError("Invalid body");
  let thread = getThread(id);
  if (!thread) return jsonError("Not found", 404);
  if (Array.isArray(body.pins)) {
    const pins = body.pins.filter((p) => p && typeof p.id === "string" && (p.kind === "source" || p.kind === "passage")).map((p) => ({ ...p, note: typeof p.note === "string" ? p.note.slice(0, 2000) : undefined, text: typeof p.text === "string" ? p.text.slice(0, 4000) : undefined }));
    thread = setThreadPins(id, pins) ?? thread;
  }
  if (typeof body.title === "string") thread = renameThread(id, body.title) ?? thread;
  return Response.json({ thread });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteThread(id) });
}
