import "server-only";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/ai/sse";
import { AIConfigError } from "@/lib/ai/config";
import { ensureReviewSeeded } from "./seed-review";

/** Make sure the review-workflow records (batches, saved searches, productions…) exist on databases seeded before phase 3. */
export function ensureReview() {
  ensureReviewSeeded(db());
}

/** Resolve `?matter=` (or `?matterId=`) and validate it exists. */
export function matterFrom(req: NextRequest, body?: { matterId?: string } | null): { matterId: string } | { error: Response } {
  const id = body?.matterId ?? req.nextUrl.searchParams.get("matter") ?? req.nextUrl.searchParams.get("matterId") ?? "";
  if (!id) return { error: jsonError("`matter` is required") };
  if (!db().matters.get(id)) return { error: jsonError(`Unknown matter ${id}`, 404) };
  return { matterId: id };
}

export async function readJson<T>(req: NextRequest): Promise<T | null> {
  return (await req.json().catch(() => null)) as T | null;
}

/** Map thrown errors to JSON; AIConfigError → 503 with code no_api_key so the UI can show the key prompt. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AIConfigError || (e as { name?: string })?.name === "AIConfigError") return jsonError((e as Error).message, 503, { code: "no_api_key" });
  const err = e as { message?: string; status?: number };
  const status = typeof err.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
  return jsonError(err.message ?? "Unexpected error", status);
}

export function isAIConfigError(e: unknown) {
  return e instanceof AIConfigError || (e as { name?: string })?.name === "AIConfigError";
}
