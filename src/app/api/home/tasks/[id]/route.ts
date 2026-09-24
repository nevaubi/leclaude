import { jsonError } from "@/lib/ai/sse";
import { deleteTask, getTask, updateTask } from "@/modules/home/service";
import { taskPatchSchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  return task ? Response.json({ task }) : jsonError("Task not found", 404);
}

async function handlePATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, taskPatchSchema);
  if (!body.ok) return body.res;
  const task = updateTask(id, body.data);
  return task ? Response.json({ task }) : jsonError("Task not found", 404);
}

async function handleDELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return deleteTask(id) ? Response.json({ ok: true }) : jsonError("Task not found", 404);
}

export const GET = withAuth(handleGET, { action: "read", resource: (_req, { id }) => refs.task(id) });
export const PATCH = withAuth(handlePATCH, { action: "write", resource: (_req, { id }) => refs.task(id) });
export const DELETE = withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => refs.task(id) });
