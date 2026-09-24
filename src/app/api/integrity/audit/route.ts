import { NextRequest } from "next/server";
import { listAudit, verifyAuditChain } from "@/lib/integrity/audit";
import type { AuditAction } from "@/lib/integrity/types";
import { withAuth } from "@/lib/auth/route";
import { queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("verify")) return Response.json(verifyAuditChain());
  return Response.json({ events: listAudit({ limit: Number(p.get("limit") ?? 100), action: (p.get("action") as AuditAction | null) ?? undefined, targetKind: p.get("kind") ?? undefined, targetId: p.get("id") ?? undefined, matterId: p.get("matter") ?? undefined, since: p.get("since") ?? undefined }) });
}

export const GET = withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "audit", matterId: queryParam(req, "matter") }) });
