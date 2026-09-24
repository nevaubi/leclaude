import { jsonError, sseResponse } from "@/lib/ai/sse";
import { bootstrap } from "@/modules/workflows/api-utils";
import { subscribeRunEvents } from "@/modules/workflows/events";
import { getRun } from "@/modules/workflows/service";
import type { RunEvent } from "@/modules/workflows/types";

export const runtime = "nodejs";

const RESTING = new Set(["succeeded", "failed", "cancelled", "waiting_approval"]);

/**
 * GET /api/workflows/runs/[runId]/stream — SSE: a `snapshot` of the run, then
 * live step/run events until the run reaches a resting state (finished or
 * waiting for approval). Reconnect after approving to follow the remainder.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  bootstrap();
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return jsonError("Run not found", 404);
  return sseResponse(async (send, signal) => {
    send({ type: "snapshot", run } satisfies RunEvent);
    if (RESTING.has(run.status)) {
      if (run.errorCode === "no_api_key") send({ type: "error", message: run.error ?? "OpenAI key required", code: "no_api_key" } satisfies RunEvent);
      send({ type: "run.done", runId, status: run.status } satisfies RunEvent);
      return;
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; unsub(); resolve(); };
      const unsub = subscribeRunEvents(runId, (ev) => {
        send(ev);
        if (ev.type === "run.done") finish();
      });
      signal.addEventListener("abort", finish, { once: true });
      // The run may have settled between the snapshot and the subscription.
      const fresh = getRun(runId);
      if (fresh && RESTING.has(fresh.status)) {
        send({ type: "snapshot", run: fresh } satisfies RunEvent);
        send({ type: "run.done", runId, status: fresh.status } satisfies RunEvent);
        finish();
      }
      // Safety valve: never hold a connection longer than 30 minutes.
      const t = setTimeout(finish, 30 * 60_000);
      signal.addEventListener("abort", () => clearTimeout(t), { once: true });
    });
  });
}
