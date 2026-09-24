import "server-only";
import { nanoid } from "nanoid";
import { getAdapter } from "./adapters";
import { listJobs } from "./jobs";
import { computeNextRunAt } from "./schedule";
import { deleteSourceDocuments, intelDocuments, intelSources } from "./store";
import type { IntelAdapterId, IntelSchedule, IntelScope, IntelSource } from "./types";

/** Source CRUD with adapter-config validation. Errors carry an HTTP status for the API layer. */
export class IntelServiceError extends Error {
  constructor(message: string, public readonly status = 400, public readonly issues?: unknown) { super(message); this.name = "IntelServiceError"; }
}

export interface CreateSourceInput {
  id?: string;
  adapter: IntelAdapterId;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
  schedule?: IntelSchedule;
  scope?: IntelScope;
  enabled?: boolean;
  system?: boolean;
}

export type UpdateSourceInput = Partial<Pick<IntelSource, "name" | "description" | "config" | "schedule" | "scope" | "enabled">>;

const EVERY = new Set(["10m", "1h", "6h", "daily", "weekly", "manual"]);

export function validateSchedule(s: unknown): IntelSchedule {
  const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
  const every = typeof o.every === "string" && EVERY.has(o.every) ? (o.every as IntelSchedule["every"]) : null;
  if (!every) throw new IntelServiceError(`schedule.every must be one of ${Array.from(EVERY).join(", ")}`, 422);
  const at = typeof o.at === "string" && /^\d{1,2}:\d{2}$/.test(o.at) ? o.at : undefined;
  const weekday = typeof o.weekday === "number" && o.weekday >= 0 && o.weekday <= 6 ? Math.floor(o.weekday) : undefined;
  return { every, at, weekday };
}

export function validateConfig(adapterId: string, config: Record<string, unknown> | undefined): Record<string, unknown> {
  const adapter = getAdapter(adapterId);
  if (!adapter) throw new IntelServiceError(`Unknown adapter "${adapterId}"`, 422);
  const parsed = adapter.configSchema.safeParse({ ...adapter.defaults, ...(config ?? {}) });
  if (!parsed.success || parsed.data === undefined) throw new IntelServiceError(`Invalid configuration: ${parsed.error?.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ") ?? "invalid"}`, 422, parsed.error?.issues);
  return parsed.data;
}

export function listSources(o: { enabled?: boolean; adapter?: string; system?: boolean } = {}): IntelSource[] {
  return intelSources().list({ where: (s) => (o.enabled === undefined || s.enabled === o.enabled) && (!o.adapter || s.adapter === o.adapter) && (o.system === undefined || Boolean(s.system) === o.system), sortBy: "name" });
}

export function getSource(id: string): IntelSource | null {
  return intelSources().get(id);
}

export function createSource(input: CreateSourceInput, now = new Date()): IntelSource {
  if (!input.name?.trim()) throw new IntelServiceError("name is required", 422);
  const config = validateConfig(input.adapter, input.config);
  const schedule = input.schedule ? validateSchedule(input.schedule) : { every: "daily" as const, at: "06:00" };
  const enabled = input.enabled ?? true;
  const ts = now.toISOString();
  const source: IntelSource = {
    id: input.id ?? `isrc_${nanoid(10)}`,
    adapter: input.adapter,
    name: input.name.trim().slice(0, 120),
    description: input.description?.trim().slice(0, 500),
    config,
    schedule,
    enabled,
    scope: input.scope,
    status: enabled ? "idle" : "disabled",
    health: { ok: true, consecutiveFailures: 0 },
    nextRunAt: enabled ? computeNextRunAt(schedule, now)?.toISOString() : undefined,
    stats: { documents: 0, chunks: 0, entities: 0, lastAdded: 0 },
    system: input.system,
    createdAt: ts,
    updatedAt: ts,
  };
  if (intelSources().has(source.id)) throw new IntelServiceError(`Source ${source.id} already exists`, 409);
  intelSources().put(source);
  return source;
}

export function updateSource(id: string, patch: UpdateSourceInput, now = new Date()): IntelSource {
  const cur = intelSources().get(id);
  if (!cur) throw new IntelServiceError("Source not found", 404);
  const next: IntelSource = { ...cur, updatedAt: now.toISOString() };
  if (patch.name !== undefined) { if (!patch.name.trim()) throw new IntelServiceError("name cannot be empty", 422); next.name = patch.name.trim().slice(0, 120); }
  if (patch.description !== undefined) next.description = patch.description?.trim().slice(0, 500) || undefined;
  if (patch.config !== undefined) next.config = validateConfig(cur.adapter, patch.config);
  if (patch.scope !== undefined) next.scope = patch.scope ?? undefined;
  if (patch.schedule !== undefined) next.schedule = validateSchedule(patch.schedule);
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.schedule !== undefined || patch.enabled !== undefined) {
    next.nextRunAt = next.enabled ? computeNextRunAt(next.schedule, now)?.toISOString() : undefined;
    next.status = next.enabled ? (cur.status === "running" ? "running" : "idle") : "disabled";
    if (patch.enabled) next.health = { ...next.health, consecutiveFailures: 0 };
  }
  intelSources().put(next);
  return next;
}

export function deleteSource(id: string, o: { keepDocuments?: boolean } = {}): { deleted: boolean; documentsRemoved: number } {
  const cur = intelSources().get(id);
  if (!cur) throw new IntelServiceError("Source not found", 404);
  if (cur.system) throw new IntelServiceError("System sources cannot be deleted; disable them instead", 409);
  const documentsRemoved = o.keepDocuments ? 0 : deleteSourceDocuments(id);
  return { deleted: intelSources().delete(id), documentsRemoved };
}

/** Source plus live counts and the latest job for list views. */
export function sourceSummary(s: IntelSource) {
  const lastJob = listJobs({ sourceId: s.id, limit: 1 }).items[0];
  return { ...s, documents: intelDocuments().count((d) => d.sourceId === s.id), adapterName: getAdapter(s.adapter)?.name ?? s.adapter, lastJob: lastJob ? { id: lastJob.id, status: lastJob.status, finishedAt: lastJob.finishedAt, error: lastJob.error, result: lastJob.result } : undefined };
}
