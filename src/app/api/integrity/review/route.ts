import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { ensureScheduledScans } from "@/lib/integrity/bootstrap";
import { decideReview, listReviewQueue, reviewCounts } from "@/lib/integrity/review";
import type { ProvenanceKind } from "@/lib/integrity/types";
import { withAuth } from "@/lib/auth/route";
import { queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

/**
 * GET /api/integrity/review?matter=&kind=&status=pending|approved|rejected|all&limit=
 * → { items: ReviewQueueItem[], counts: { pending, byKind } }
 */
async function handleGET(req: NextRequest) {
  ensureScheduledScans();
  const p = req.nextUrl.searchParams;
  const matterId = p.get("matter") ?? p.get("matterId") ?? undefined;
  const status = (p.get("status") as "pending" | "approved" | "rejected" | "all" | null) ?? "pending";
  const items = listReviewQueue({ matterId, kind: (p.get("kind") as ProvenanceKind | null) ?? undefined, status, limit: Number(p.get("limit") ?? 200) });
  return Response.json({ items, counts: reviewCounts(matterId) });
}

/**
 * POST /api/integrity/review { kind, id, decision: "approved" | "rejected", note? }
 * or { decisions: [{ kind, id, decision, note? }] } → { results: [{ kind, id, ok, provenance?, message? }], counts }
 * (200 when every decision applied, 207 when some failed)
 */
async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { kind?: ProvenanceKind; id?: string; decision?: "approved" | "rejected"; note?: string; decisions?: { kind: ProvenanceKind; id: string; decision: "approved" | "rejected"; note?: string }[] } | null;
  if (!body) return jsonError("Invalid JSON body");
  const decisions = body.decisions?.length ? body.decisions : body.kind && body.id && body.decision ? [{ kind: body.kind, id: body.id, decision: body.decision, note: body.note }] : [];
  if (!decisions.length) return jsonError("`kind`, `id` and `decision` (approved | rejected) are required");
  if (decisions.length > 200) return jsonError("Too many decisions (max 200)");
  const results = decisions.map((dcn) => {
    if (dcn.decision !== "approved" && dcn.decision !== "rejected") return { kind: dcn.kind, id: dcn.id, ok: false, message: "decision must be approved or rejected" };
    return { kind: dcn.kind, id: dcn.id, ...decideReview(dcn) };
  });
  const ok = results.every((r) => r.ok);
  return Response.json({ results, counts: reviewCounts() }, { status: ok ? 200 : 207 });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "review", matterId: queryParam(req, "matter", "matterId") }) }));
export const POST = withDb(withAuth(handlePOST, { action: "approve", resource: () => ({ kind: "review" }) }));
