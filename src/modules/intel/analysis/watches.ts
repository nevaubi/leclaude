import "server-only";
import { nanoid } from "nanoid";
import { audit } from "@/lib/integrity/audit";
import { currentUser } from "@/lib/current-user";
import type { IntelWatch, IntelWatchKind } from "../types";
import { intelEntities, intelWatches } from "../store";
import { WATCH_KIND_FOR_ENTITY } from "./pure";

/** Watches: a user follows a judge, docket, MDL, product, regulation, attorney, firm, court or query. */
export interface CreateWatchInput {
  userId?: string;
  kind: IntelWatchKind;
  target: string;
  label?: string;
  matterId?: string;
  channels?: IntelWatch["channels"];
}

const KINDS: IntelWatchKind[] = ["judge", "docket", "mdl", "product", "regulation", "attorney", "firm", "query", "court"];

export function listWatches(o: { userId?: string; kind?: IntelWatchKind; matterId?: string; target?: string } = {}): IntelWatch[] {
  return intelWatches().find((w) => (!o.userId || w.userId === o.userId) && (!o.kind || w.kind === o.kind) && (!o.matterId || w.matterId === o.matterId) && (!o.target || w.target === o.target)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findWatch(userId: string, target: string): IntelWatch | null {
  return intelWatches().findOne((w) => w.userId === userId && w.target === target);
}

/** Entity ids and query strings a user watches. */
export function watchedTargets(userId: string): Set<string> {
  return new Set(intelWatches().find((w) => w.userId === userId).map((w) => w.target));
}

export function createWatch(input: CreateWatchInput, now = new Date().toISOString()): IntelWatch {
  const userId = input.userId ?? currentUser().id;
  if (!KINDS.includes(input.kind)) throw new Error(`Unknown watch kind: ${input.kind}`);
  const target = input.target.trim();
  if (!target) throw new Error("Watch target is required");
  const existing = findWatch(userId, target);
  if (existing) return existing;
  const entity = input.kind === "query" ? null : intelEntities().get(target);
  if (input.kind !== "query" && input.kind !== "docket" && !entity) throw new Error(`Entity not found: ${target}`);
  const watch: IntelWatch = { id: `iwatch_${nanoid(10)}`, userId, kind: input.kind, target, label: input.label?.trim() || entity?.name || target, matterId: input.matterId, channels: input.channels?.length ? input.channels : ["home"], createdAt: now };
  intelWatches().put(watch);
  audit("create", { kind: "intel.watch", id: watch.id, label: watch.label, matterId: watch.matterId }, { watchKind: watch.kind, target });
  return watch;
}

export function deleteWatch(id: string): boolean {
  const w = intelWatches().get(id);
  if (!w) return false;
  intelWatches().delete(id);
  audit("delete", { kind: "intel.watch", id, label: w.label, matterId: w.matterId }, { watchKind: w.kind, target: w.target });
  return true;
}

/** Toggle a watch on an entity for a user; returns the new state. */
export function toggleEntityWatch(entityId: string, o: { userId?: string; matterId?: string } = {}): { watched: boolean; watch?: IntelWatch } {
  const userId = o.userId ?? currentUser().id;
  const existing = findWatch(userId, entityId);
  if (existing) { deleteWatch(existing.id); return { watched: false }; }
  const entity = intelEntities().get(entityId);
  if (!entity) throw new Error(`Entity not found: ${entityId}`);
  const kind = WATCH_KIND_FOR_ENTITY[entity.type];
  if (!kind) throw new Error(`${entity.type} entities cannot be watched`);
  const watch = createWatch({ userId, kind, target: entityId, label: entity.name, matterId: o.matterId });
  return { watched: true, watch };
}

export function updateWatch(id: string, patch: Partial<Pick<IntelWatch, "label" | "channels" | "matterId" | "lastNotifiedAt">>): IntelWatch | null {
  return intelWatches().update(id, (w) => ({ ...w, ...patch, label: patch.label?.trim() || w.label, channels: patch.channels?.length ? patch.channels : w.channels }));
}
