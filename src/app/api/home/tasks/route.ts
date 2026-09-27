import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { createTask, listTasks } from "@/modules/home/service";
import { taskCreateSchema } from "@/modules/home/schemas";
import { currentUserId } from "@/modules/home/types";
import type { Task } from "@/lib/types/domain";
import { param, parseBody } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";
import { bodyMatterId, queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const tasks = listTasks({
    matterId: param(url, "matter"),
    assigneeId: url.searchParams.get("mine") === "1" ? currentUserId() : param(url, "assignee"),
    status: param(url, "status") as Task["status"] | null,
    overdue: url.searchParams.get("overdue") === "1",
    includeDone: url.searchParams.get("includeDone") !== "0",
  });
  return Response.json({ tasks });
}

async function handlePOST(req: Request) {
  const body = await parseBody(req, taskCreateSchema);
  if (!body.ok) return body.res;
  try {
    const task = createTask(body.data);
    return Response.json({ task }, { status: 201 });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not create task", 500);
  }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "task", matterId: queryParam(req, "matter") }) }));
export const POST = withDb(withAuth(handlePOST, { action: "write", resource: async (req) => ({ kind: "task", matterId: await bodyMatterId(req) }) }));
