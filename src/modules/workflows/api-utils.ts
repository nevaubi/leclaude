import "server-only";
import type { ZodType } from "zod";
import { AIConfigError } from "@/lib/ai/config";
import { jsonError } from "@/lib/ai/sse";
import { StepError } from "./executors";
import { ensureScheduler } from "./scheduler";

/** Every workflows API call boots the lazy scheduler (guarded on globalThis). */
export function bootstrap() {
  try { ensureScheduler(); } catch (e) { console.warn("[workflows] scheduler start failed", (e as Error).message); }
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { ok: false, res: jsonError("Invalid JSON body") }; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: jsonError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), 422, { issues: parsed.error.issues }) };
  return { ok: true, data: parsed.data };
}

/** Map engine/service errors to HTTP responses with stable codes. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AIConfigError) return jsonError(e.message, 503, { code: "no_api_key" });
  if (e instanceof StepError) {
    const status = e.code === "not_found" ? 404 : e.code === "not_waiting" ? 409 : e.code === "invalid_workflow" || e.code === "missing_inputs" || e.code === "invalid_inputs" ? 422 : 400;
    return jsonError(e.message, status, { code: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return jsonError(msg, 500);
}

export function param(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  return v == null || v === "" ? undefined : v;
}

export function boolParam(url: URL, key: string): boolean | undefined {
  const v = url.searchParams.get(key);
  if (v == null || v === "") return undefined;
  return v === "1" || v === "true";
}
