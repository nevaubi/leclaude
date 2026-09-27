import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { documentText, safeName } from "@/modules/office/pdf/service";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromParams } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Extracted text as .txt (?markers=0 to omit page markers). */
async function handleGET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const r = await documentText(id, req.nextUrl.searchParams.get("markers") !== "0");
    if (!r) return jsonError("Document not found", 404);
    return new Response(r.text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${safeName(r.title)}.txt"` } });
  } catch (e) {
    return jsonError(`Extraction failed: ${(e as Error).message}`, 500);
  }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: officeDocFromParams }));
