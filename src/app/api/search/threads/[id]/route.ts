import { jsonError } from "@/lib/ai/sse";
import { deleteThread, getThread, renameThread, setThreadPins } from "@/modules/search/engine/threads";
import type { ResearchPin } from "@/modules/search/engine/types";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: Request, { params }: Params) {
  const { id } = await params;
  const thread = getThread(id);
  if (!thread) return jsonError("Not found", 404);
  return Response.json({ thread });
}

/** PUT {pins?: ResearchPin[], title?: string} — pins and title are the only client-editable fields. */
async function handlePUT(req: Request, { params }: Params) {
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

async function handleDELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteThread(id) });
}

export const GET = withAuth(handleGET, { action: "read", resource: (_req, { id }) => refs.research(id) });
export const PUT = withAuth(handlePUT, { action: "write", resource: (_req, { id }) => refs.research(id) });
export const DELETE = withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => refs.research(id) });
