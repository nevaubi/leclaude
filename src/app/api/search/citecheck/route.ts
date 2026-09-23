import { jsonError } from "@/lib/ai/sse";
import { checkCitations } from "@/modules/search/service";

export const runtime = "nodejs";

/** POST /api/search/citecheck {text} → extracted citations + CourtListener resolution (graceful when offline). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim() ?? "";
  if (!text) return jsonError("`text` is required");
  if (text.length > 120_000) return jsonError("Text is too long (max 120,000 characters)");
  const result = await checkCitations(text, req.signal);
  return Response.json(result);
}
