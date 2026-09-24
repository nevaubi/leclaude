import { NextRequest } from "next/server";
import { listActivity } from "@/modules/library/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return Response.json({ activity: listActivity({ itemId: sp.get("item") || undefined, limit: Math.min(Number(sp.get("limit") ?? 40) || 40, 200) }) });
}
