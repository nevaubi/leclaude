import "server-only";
import { blobs, db } from "@/lib/db";
import { firstAccessibleMatter } from "./policy";
import type { Principal, ResourceRef, Sensitivity } from "./types";

/**
 * ResourceRef builders for route wrappers. Each looks the record up so the policy sees the real matter and
 * sensitivity; when the record does not exist the ref carries no matter and the handler's own 404 stands.
 * Lookups are cached collection reads (sub-millisecond).
 */

/** Read a JSON body without consuming the request the handler will parse (clones the request). */
export async function jsonBody<T extends Record<string, unknown> = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    const v = (await req.clone().json()) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<T>) : {};
  } catch {
    return {};
  }
}

/** First non-empty query parameter among `names`. */
export function queryParam(req: Request, ...names: string[]): string | undefined {
  const url = new URL(req.url);
  for (const n of names) {
    const v = url.searchParams.get(n);
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** A string field of the JSON body (cloned), or undefined. */
export async function bodyString(req: Request, ...keys: string[]): Promise<string | undefined> {
  const body = await jsonBody(req);
  for (const k of keys) {
    const v = str(body[k]);
    if (v) return v;
  }
  return undefined;
}

/** The matter a JSON body targets (`matterId` or `matter`), or undefined. */
export function bodyMatterId(req: Request): Promise<string | undefined> {
  return bodyString(req, "matterId", "matter");
}

export const refs = {
  matter(id: string | undefined): ResourceRef {
    return id ? { kind: "matter", id } : { kind: "matter" };
  },
  library(id?: string): ResourceRef {
    const item = id ? db().library.get(id) : null;
    return { kind: "library_item", id, matterId: item?.matterId };
  },
  officeDoc(id?: string): ResourceRef {
    const doc = id ? db().officeDocs.get(id) : null;
    return { kind: "office_doc", id, matterId: doc?.matterId };
  },
  task(id?: string): ResourceRef {
    const t = id ? db().tasks.get(id) : null;
    return { kind: "task", id, matterId: t?.matterId };
  },
  event(id?: string): ResourceRef {
    const e = id && !id.startsWith("kd_") ? db().events.get(id) : null;
    return { kind: "event", id, matterId: e?.matterId };
  },
  update(id?: string): ResourceRef {
    const u = id ? db().updates.get(id) : null;
    return { kind: "update", id, matterId: u?.matterId };
  },
  workflow(id?: string): ResourceRef {
    return { kind: "workflow", id };
  },
  workflowRun(runId?: string): ResourceRef {
    const run = runId ? db().workflowRuns.get(runId) : null;
    return { kind: "workflow_run", id: runId, matterId: run?.matterId };
  },
  blob(id?: string): ResourceRef {
    const meta = id ? blobs.meta(id) : null;
    return { kind: "blob", id, matterId: str(meta?.meta?.matterId) };
  },
  edoc(id?: string): ResourceRef {
    const doc = id ? db().edocs.get(id) : null;
    const sensitivity: Sensitivity | undefined = doc?.coding?.privileged === true ? "privileged" : undefined;
    return { kind: "document", id, matterId: doc?.matterId, sensitivity };
  },
  deposition(id?: string): ResourceRef {
    const dep = id ? db().depositions.get(id) : null;
    return { kind: "deposition", id, matterId: dep?.matterId };
  },
  /** Intel documents may be linked to several matters; the policy checks the first one the principal can access. */
  intelDocument(id: string | undefined, principal: Principal): ResourceRef {
    const doc = id ? db().collection<{ id: string; matterIds?: string[] }>("intel_documents").get(id) : null;
    return { kind: "intel", id, matterId: firstAccessibleMatter(principal, doc?.matterIds) };
  },
  intel(matterId?: string): ResourceRef {
    return { kind: "intel", matterId };
  },
  research(id?: string, matterId?: string): ResourceRef {
    return { kind: "research", id, matterId };
  },
  settings(): ResourceRef {
    return { kind: "settings" };
  },
};
