import { jsonError } from "@/lib/ai/sse";
import { createTask, listTasks } from "@/modules/home/service";
import { taskCreateSchema } from "@/modules/home/schemas";
import { CURRENT_USER_ID } from "@/modules/home/types";
import type { Task } from "@/lib/types/domain";
import { param, parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tasks = listTasks({
    matterId: param(url, "matter"),
    assigneeId: url.searchParams.get("mine") === "1" ? CURRENT_USER_ID : param(url, "assignee"),
    status: param(url, "status") as Task["status"] | null,
    overdue: url.searchParams.get("overdue") === "1",
    includeDone: url.searchParams.get("includeDone") !== "0",
  });
  return Response.json({ tasks });
}

export async function POST(req: Request) {
  const body = await parseBody(req, taskCreateSchema);
  if (!body.ok) return body.res;
  try {
    const task = createTask(body.data);
    return Response.json({ task }, { status: 201 });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not create task", 500);
  }
}
