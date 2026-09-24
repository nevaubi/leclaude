import { z } from "zod";
import { db } from "@/lib/db";
import { bootstrap, errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { startRun } from "@/modules/workflows/engine";
import type { Workflow } from "@/lib/types/domain";

export const runtime = "nodejs";

const eventSchema = z.object({
  type: z.enum(["document_added", "docket_update", "email"]),
  matterId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const TRIGGER_FOR: Record<z.infer<typeof eventSchema>["type"], Workflow["nodes"][number]["type"]> = { document_added: "trigger.document_added", docket_update: "trigger.docket_update", email: "trigger.email" };

function matches(type: z.infer<typeof eventSchema>["type"], config: Record<string, unknown>, matterId: string | undefined, payload: Record<string, unknown>) {
  if (config.matterId && matterId && config.matterId !== matterId) return false;
  if (type === "document_added") {
    const kinds = Array.isArray(config.kinds) ? (config.kinds as string[]) : [];
    if (kinds.length && payload.kind && !kinds.includes(String(payload.kind))) return false;
    if (config.folderName && payload.folderName && !String(payload.folderName).toLowerCase().includes(String(config.folderName).toLowerCase())) return false;
  }
  if (type === "email" && config.subjectContains && !String(payload.subject ?? "").toLowerCase().includes(String(config.subjectContains).toLowerCase())) return false;
  return true;
}

/**
 * POST /api/workflows/events { type, matterId?, payload } — inbound event bus.
 * Other modules (library uploads, docket alerts, an inbound mail hook) post here;
 * every active workflow whose trigger matches starts a run with the payload.
 */
export async function POST(req: Request) {
  bootstrap();
  const body = await parseBody(req, eventSchema);
  if (!body.ok) return body.res;
  const { type, matterId, payload } = body.data;
  const triggerType = TRIGGER_FOR[type];
  const started: { workflowId: string; runId: string }[] = [];
  try {
    for (const w of db().workflows.find((w) => !w.isTemplate && w.status === "active")) {
      const trigger = w.nodes.find((n) => n.type === triggerType);
      if (!trigger || !matches(type, trigger.config, matterId, payload)) continue;
      const inputs: Record<string, unknown> = {};
      for (const inp of w.inputs ?? []) if (payload[inp.key] !== undefined) inputs[inp.key] = payload[inp.key];
      if (payload.text && !inputs.text) inputs.text = payload.text;
      const run = await startRun(w, { inputs, matterId: matterId ?? (trigger.config.matterId ? String(trigger.config.matterId) : undefined), triggeredBy: "event", event: { ...payload, eventType: type } });
      started.push({ workflowId: w.id, runId: run.id });
    }
    return Response.json({ started }, { status: started.length ? 202 : 200 });
  } catch (e) { return errorResponse(e); }
}
