import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { listActivity } from "@/modules/library/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return Response.json({ activity: listActivity({ itemId: sp.get("item") || undefined, limit: Math.min(Number(sp.get("limit") ?? 40) || 40, 200) }) });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => refs.library() }));
