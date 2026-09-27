import { NextRequest } from "next/server";
import { allTemplates } from "@/modules/office/shared/template-registry";
import { withAuth } from "@/lib/auth/route";
import { officeCollection } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";

async function handleGET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const templates = allTemplates().filter((t) => !kind || t.kind === kind).map(({ build: _b, ...rest }) => { void _b; return rest; });
  return Response.json({ templates });
}

export const GET = withAuth(handleGET, { action: "read", resource: officeCollection });
