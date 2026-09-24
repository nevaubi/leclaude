import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { db } from "@/lib/db";
import { audit } from "@/lib/integrity/audit";
import type { Provenance } from "@/lib/integrity/types";

export const runtime = "nodejs";

interface AppliedProposal { id: string; kind: string; title: string; summary?: string; target?: string; targetLabel?: string; status?: "applied" | "discarded" | "failed"; risk?: string; provenance?: Provenance }

/**
 * POST /api/office/docs/[id]/audit-apply { proposals: AppliedProposal[], mode?, message?, discarded?: number }
 * → { ok, eventId, applied, discarded, failed }
 * Editors call this after applying (or discarding) the agent's edit proposals so every AI application is on the audit
 * trail with the proposal ids, targets and the provenance the agent attached to them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = db().officeDocs.get(id);
  if (!doc) return jsonError("Not found", 404);
  const body = (await req.json().catch(() => null)) as { proposals?: AppliedProposal[]; mode?: string; message?: string; discarded?: number } | null;
  if (!body || !Array.isArray(body.proposals)) return jsonError("`proposals` (array) is required");
  const applied = body.proposals.filter((p) => (p.status ?? "applied") === "applied");
  const discarded = body.proposals.filter((p) => p.status === "discarded").length + (body.discarded ?? 0);
  const failed = body.proposals.filter((p) => p.status === "failed").length;
  const ev = audit("ai.apply", { kind: "officeDoc", id: doc.id, label: doc.title, matterId: doc.matterId }, {
    surface: `office.${doc.kind}`,
    mode: body.mode,
    message: body.message?.slice(0, 300),
    applied: applied.length,
    discarded,
    failed,
    proposals: applied.slice(0, 40).map((p) => ({ id: p.id, kind: p.kind, title: p.title, target: p.targetLabel ?? p.target, risk: p.risk, verification: p.provenance?.verification?.status, sources: p.provenance?.sources?.length })),
    contentVersion: doc.contentVersion,
  });
  return Response.json({ ok: true, eventId: ev.id, applied: applied.length, discarded, failed });
}
