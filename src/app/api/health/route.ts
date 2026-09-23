import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";

export const runtime = "nodejs";

export async function GET() {
  const d = db();
  const cfg = aiConfig();
  return Response.json({
    ok: true,
    time: new Date().toISOString(),
    ai: { configured: cfg.hasKey, model: cfg.model, fastModel: cfg.fastModel, embeddingModel: cfg.embeddingModel },
    counts: { matters: d.matters.count(), people: d.people.count(), edocs: d.edocs.count(), depositions: d.depositions.count(), workflows: d.workflows.count(), officeDocs: d.officeDocs.count(), library: d.library.count(), tasks: d.tasks.count(), events: d.events.count(), news: d.news.count() },
  });
}
