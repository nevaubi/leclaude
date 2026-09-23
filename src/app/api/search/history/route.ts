import { NextRequest } from "next/server";
import { clearRuns, listRuns } from "@/modules/search/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 40)));
  const full = req.nextUrl.searchParams.get("full") === "1";
  const runs = listRuns(limit).map((r) => (full ? r : { ...r, synthesis: r.synthesis ? r.synthesis.slice(0, 400) : undefined, topHits: undefined }));
  return Response.json({ runs });
}

export async function DELETE() {
  clearRuns();
  return Response.json({ ok: true });
}
