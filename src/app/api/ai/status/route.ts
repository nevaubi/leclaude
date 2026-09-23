import { aiConfig } from "@/lib/ai/config";

export const runtime = "nodejs";

export async function GET() {
  const cfg = aiConfig();
  return Response.json({ configured: cfg.hasKey, model: cfg.model, fastModel: cfg.fastModel, embeddingModel: cfg.embeddingModel, imageModel: cfg.imageModel, reasoningEffort: cfg.reasoningEffort, baseURL: cfg.baseURL ?? null });
}
