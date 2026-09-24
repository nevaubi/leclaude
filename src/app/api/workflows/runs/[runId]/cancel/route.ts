import { jsonError } from "@/lib/ai/sse";
import { bootstrap } from "@/modules/workflows/api-utils";
import { cancelRun } from "@/modules/workflows/engine";
import { summarizeRun } from "@/modules/workflows/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handlePOST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  bootstrap();
  const { runId } = await params;
  const run = cancelRun(runId);
  if (!run) return jsonError("Run not found", 404);
  return Response.json({ run: summarizeRun(run) });
}

export const POST = withAuth(handlePOST, { action: "run", resource: (_req, { runId }) => refs.workflowRun(runId) });
