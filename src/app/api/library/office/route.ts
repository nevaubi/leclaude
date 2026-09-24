import { NextRequest } from "next/server";
import type { OfficeKind } from "@/lib/types/domain";
import { listOfficeDocSummaries, officeHomeData } from "@/modules/office/home/service";
import { withAuth } from "@/lib/auth/route";
import { queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** Office home data: documents with version/comment counts, templates, matters. ?kind= filters docs; ?full=1 returns the whole payload. */
async function handleGET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") as OfficeKind | null) || undefined;
  if (sp.get("full")) return Response.json(officeHomeData(kind));
  return Response.json({ docs: listOfficeDocSummaries({ kind, matterId: sp.get("matter") || undefined, q: sp.get("q") || undefined, limit: Number(sp.get("limit") ?? 200) || 200 }) });
}

export const GET = withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "office_doc", matterId: queryParam(req, "matter", "matterId") }) });
