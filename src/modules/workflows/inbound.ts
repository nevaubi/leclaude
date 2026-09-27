import "server-only";
import { db } from "@/lib/db";
import type { Workflow } from "@/lib/types/domain";
import { bootstrap } from "@/modules/workflows/api-utils";
import { startRun } from "@/modules/workflows/engine";
import { StepError } from "@/modules/workflows/executors";
import { validateUploadedFile } from "@/modules/workflows/output-files";

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
 * Files an inbound event refers to (`blobId`, `files[].blobId`, `attachments[].blobId`)
 * are validated against the blob store before any run starts: the blob must
 * exist, stay within the size limit and match the type it claims. Rejected
 * with a stable error code so the events route answers 400 (never a run).
 */
export function validateInboundFiles(payload: Record<string, unknown>): string[] {
  const refs: { blobId: string; name?: string; mime?: string; path: string }[] = [];
  const push = (v: unknown, path: string) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.blobId === "string" && o.blobId) refs.push({ blobId: o.blobId, name: typeof o.name === "string" ? o.name : undefined, mime: typeof o.mime === "string" ? o.mime : undefined, path });
  };
  if (typeof payload.blobId === "string") push({ blobId: payload.blobId, name: payload.name ?? payload.filename, mime: payload.mime }, "payload");
  for (const key of ["files", "attachments"]) {
    const list = payload[key];
    if (Array.isArray(list)) list.slice(0, 50).forEach((f, i) => push(f, `${key}[${i}]`));
  }
  const errors: string[] = [];
  for (const ref of refs) {
    const rec = db().blobs.get(ref.blobId);
    if (!rec) { errors.push(`${ref.path}: uploaded file ${ref.blobId} was not found`); continue; }
    const verdict = validateUploadedFile({ bytes: rec.bytes, name: ref.name ?? rec.name, mime: ref.mime ?? rec.mime });
    if (!verdict.ok) errors.push(`${ref.path}: ${verdict.reason}`);
  }
  return errors;
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
  const fileErrors = validateInboundFiles(payload);
  if (fileErrors.length) throw new StepError(`Invalid upload${fileErrors.length > 1 ? "s" : ""}: ${fileErrors.join("; ")}`, "invalid_upload");
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
