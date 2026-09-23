import { jsonError } from "@/lib/ai/sse";
import { deleteTask, getTask, updateTask } from "@/modules/home/service";
import { taskPatchSchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  return task ? Response.json({ task }) : jsonError("Task not found", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, taskPatchSchema);
  if (!body.ok) return body.res;
  const task = updateTask(id, body.data);
  return task ? Response.json({ task }) : jsonError("Task not found", 404);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return deleteTask(id) ? Response.json({ ok: true }) : jsonError("Task not found", 404);
}
