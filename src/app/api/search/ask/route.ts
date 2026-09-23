import { jsonError, sseResponse } from "@/lib/ai/sse";
import { askAboutSource, type AskSourceBody } from "@/modules/search/service";

export const runtime = "nodejs";

/** POST /api/search/ask — "Ask about this source" mini chat (useAgent-compatible body + {source, text}). */
export async function POST(req: Request) {
  let body: AskSourceBody;
  try { body = (await req.json()) as AskSourceBody; } catch { return jsonError("Invalid JSON body"); }
  if (!body?.message?.trim()) return jsonError("`message` is required");
  if (!body.source?.title || typeof body.text !== "string") return jsonError("`source` and `text` are required");
  return sseResponse(async (send, signal) => {
    await askAboutSource(body, send, signal);
  });
}
