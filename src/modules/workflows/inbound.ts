import "server-only";
import { db } from "@/lib/db";
import type { Workflow } from "@/lib/types/domain";
import { bootstrap } from "@/modules/workflows/api-utils";
import { startRun } from "@/modules/workflows/engine";

export type InboundEventType = "document_added" | "docket_update" | "email";

export interface InboundEvent {
  type: InboundEventType;
  matterId?: string;
  payload?: Record<string, unknown>;
}

const TRIGGER_FOR: Record<InboundEventType, Workflow["nodes"][number]["type"]> = { document_added: "trigger.document_added", docket_update: "trigger.docket_update", email: "trigger.email" };

function matches(type: InboundEventType, config: Record<string, unknown>, matterId: string | undefined, payload: Record<string, unknown>) {
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
 * Inbound event bus: every active workflow whose trigger matches starts a run
 * with the payload. Called by POST /api/workflows/events and directly by other
 * modules (library uploads/imports, docket alerts, inbound mail).
 */
export async function dispatchInboundEvent(event: InboundEvent): Promise<{ workflowId: string; runId: string }[]> {
  bootstrap();
  const { type, matterId } = event;
  const payload = event.payload ?? {};
  const triggerType = TRIGGER_FOR[type];
  const started: { workflowId: string; runId: string }[] = [];
  for (const w of db().workflows.find((w) => !w.isTemplate && w.status === "active")) {
    const trigger = w.nodes.find((n) => n.type === triggerType);
    if (!trigger || !matches(type, trigger.config, matterId, payload)) continue;
    const inputs: Record<string, unknown> = {};
    for (const inp of w.inputs ?? []) if (payload[inp.key] !== undefined) inputs[inp.key] = payload[inp.key];
    if (payload.text && !inputs.text) inputs.text = payload.text;
    const run = await startRun(w, { inputs, matterId: matterId ?? (trigger.config.matterId ? String(trigger.config.matterId) : undefined), triggeredBy: "event", event: { ...payload, eventType: type } });
    started.push({ workflowId: w.id, runId: run.id });
  }
  return started;
}
