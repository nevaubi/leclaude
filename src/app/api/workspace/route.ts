import type { NextRequest } from "next/server";
import { withAuth, requirePrincipal } from "@/lib/auth/route";
import { AuthError } from "@/lib/auth/errors";
import { canManageWorkspace, setupWorkspace, updateWorkspace, workspaceView } from "@/modules/workspace/service";
import { readJsonObject, serviceErrorResponse } from "@/modules/workspace/errors";

export const runtime = "nodejs";

/** GET /api/workspace — { configured, firmName, owner }. No secrets, no settings. */
async function handleGET() {
  return Response.json(workspaceView());
}

/** POST /api/workspace — first-run setup (201). 409 once the workspace is configured. */
async function handlePOST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    return Response.json(setupWorkspace(body), { status: 201 });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

/** PUT /api/workspace — firm name and owner profile; the owner (or a partner/admin) only. */
async function handlePUT(req: NextRequest) {
  if (!canManageWorkspace(requirePrincipal())) throw AuthError.forbidden("only the workspace owner, a partner or an admin may edit the workspace");
  try {
    const body = await readJsonObject(req);
    return Response.json(updateWorkspace(body));
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

export const GET = withAuth(handleGET, { action: "read", resource: () => ({ kind: "settings" }) });
export const POST = withAuth(handlePOST, { action: "write", resource: () => ({ kind: "settings" }) });
export const PUT = withAuth(handlePUT, { action: "write", resource: () => ({ kind: "settings" }) });
