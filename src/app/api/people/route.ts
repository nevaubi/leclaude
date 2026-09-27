import { withDb } from "@/lib/db/request";
import type { NextRequest } from "next/server";
import { withAuth, requirePrincipal } from "@/lib/auth/route";
import { AuthError } from "@/lib/auth/errors";
import { canManageWorkspace, createMember, listTeam } from "@/modules/workspace/service";
import { readJsonObject, serviceErrorResponse } from "@/modules/workspace/errors";

export const runtime = "nodejs";

/** GET /api/people?inactive=1&q=… — firm team members (attorneys, paralegals, staff). */
async function handleGET(req: NextRequest) {
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("inactive") === "1" || url.searchParams.get("inactive") === "true";
  const people = listTeam({ includeInactive, q: url.searchParams.get("q") ?? undefined });
  return Response.json({ people, canManage: canManageWorkspace(requirePrincipal()) });
}

/** POST /api/people — add a team member (201); the owner, a partner or an admin only. 409 on a duplicate email. */
async function handlePOST(req: NextRequest) {
  if (!canManageWorkspace(requirePrincipal())) throw AuthError.forbidden("only the workspace owner, a partner or an admin may manage the team");
  try {
    const body = await readJsonObject(req);
    return Response.json({ person: createMember(body) }, { status: 201 });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => ({ kind: "settings" }) }));
export const POST = withDb(withAuth(handlePOST, { action: "write", resource: () => ({ kind: "settings" }) }));
