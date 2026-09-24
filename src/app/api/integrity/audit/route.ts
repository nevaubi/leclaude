import { NextRequest } from "next/server";
import { listAudit, verifyAuditChain } from "@/lib/integrity/audit";
import type { AuditAction } from "@/lib/integrity/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("verify")) return Response.json(verifyAuditChain());
  return Response.json({ events: listAudit({ limit: Number(p.get("limit") ?? 100), action: (p.get("action") as AuditAction | null) ?? undefined, targetKind: p.get("kind") ?? undefined, targetId: p.get("id") ?? undefined, matterId: p.get("matter") ?? undefined, since: p.get("since") ?? undefined }) });
}
