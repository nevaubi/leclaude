import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { clearRuns, listRuns } from "@/modules/search/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(req: NextRequest) {
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 40)));
  const full = req.nextUrl.searchParams.get("full") === "1";
  const runs = listRuns(limit).map((r) => (full ? r : { ...r, synthesis: r.synthesis ? r.synthesis.slice(0, 400) : undefined, topHits: undefined }));
  return Response.json({ runs });
}

async function handleDELETE() {
  clearRuns();
  return Response.json({ ok: true });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => refs.research() }));
export const DELETE = withDb(withAuth(handleDELETE, { action: "delete", resource: () => refs.research() }));
