import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { AIConfigError } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { autoTagItem, compareClause, NoApiKeyError, summarizeItem } from "@/modules/library/service";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body { action: "summarize" | "autotag" | "compare"; id?: string; officeDocId?: string; text?: string; againstId?: string }

/**
 * Library AI actions. Every action returns a 503 with code "no_api_key" when
 * OPENAI_API_KEY is missing (autotag returns { skipped: true } instead so uploads never fail).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action) return jsonError("`action` is required");
  let id = body.id;
  if (!id && body.officeDocId) id = db().library.findOne((l) => l.officeDocId === body.officeDocId)?.id;
  if (!id) return jsonError("`id` (or `officeDocId`) is required");
  try {
    switch (body.action) {
      case "summarize": return Response.json(await summarizeItem(id));
      case "autotag": return Response.json(await autoTagItem(id));
      case "compare": return Response.json(await compareClause(id, { text: body.text, againstId: body.againstId }));
      default: return jsonError("Unknown action");
    }
  } catch (e) {
    if (e instanceof AIConfigError || e instanceof NoApiKeyError) return jsonError(e.message, 503, { code: "no_api_key" });
    const err = e as { status?: number; message?: string };
    return jsonError(err.message ?? String(e), err.status && err.status >= 400 && err.status < 600 ? err.status : 500);
  }
}
