import { withDb } from "@/lib/db/request";
import { aiConfig } from "@/lib/ai/config";

export const runtime = "nodejs";

async function GET__handler() {
  const cfg = aiConfig();
  return Response.json({ configured: cfg.hasKey, model: cfg.model, fastModel: cfg.fastModel, embeddingModel: cfg.embeddingModel, imageModel: cfg.imageModel, reasoningEffort: cfg.reasoningEffort, baseURL: cfg.baseURL ?? null });
}

export const GET = withDb(withDb(GET__handler));
