import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { aiConfig, AIConfigError } from "@/lib/ai/config";
import { indexStatus, rebuildIndex } from "@/modules/library/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";
export const maxDuration = 300;

async function handleGET() {
  return Response.json({ status: indexStatus(), aiConfigured: aiConfig().hasKey });
}

/** Rebuild the library (and office) search index; embeds when an OpenAI key is configured, keyword-only otherwise. */
async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { embed?: boolean; includeOffice?: boolean };
  try {
    const r = await rebuildIndex({ embed: body.embed, includeOffice: body.includeOffice });
    return Response.json({ ...r, aiConfigured: aiConfig().hasKey, note: r.embed ? undefined : "Keyword-only index: add OPENAI_API_KEY to enable semantic embeddings." });
  } catch (e) {
    if (e instanceof AIConfigError) return jsonError(e.message, 503, { code: "no_api_key" });
    return jsonError((e as Error).message, 500);
  }
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.library() });
export const POST = withAuth(handlePOST, { action: "admin", resource: () => refs.library() });
