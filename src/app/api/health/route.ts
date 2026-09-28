import { db } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import { diagnoseStorage } from "@/lib/db/diagnose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health: storage start-up diagnosis (step by step, no secrets) plus AI configuration and record counts.
 * Deliberately not wrapped in withDb, so it still answers, with the failing step and its reason, when the shared
 * database cannot be reached.
 */
export async function GET() {
  const storage = await diagnoseStorage();
  let ai: Record<string, unknown> | { error: string } = {};
  try { const cfg = aiConfig(); ai = { configured: cfg.hasKey, model: cfg.model, fastModel: cfg.fastModel }; } catch (e) { ai = { error: (e as Error).message }; }
  let counts: Record<string, number> | null = null;
  if (storage.ok) {
    try { const d = db(); counts = { matters: d.matters.count(), people: d.people.count(), edocs: d.edocs.count(), officeDocs: d.officeDocs.count(), library: d.library.count(), workflows: d.workflows.count() }; } catch { counts = null; }
  }
  return Response.json({ ok: storage.ok, time: new Date().toISOString(), storage, ai, counts }, { status: storage.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
