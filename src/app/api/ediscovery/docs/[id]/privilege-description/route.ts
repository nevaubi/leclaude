import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { db } from "@/lib/db";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { draftPrivilegeDescription } from "@/modules/ediscovery/ai";
import { upsertPrivilegeEntry } from "@/modules/ediscovery/service";

export const runtime = "nodejs";

/** Draft a privilege-safe description; with `save: true` also upserts the privilege-log entry. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ save?: boolean }>(req);
  const doc = db().edocs.get(id);
  if (!doc) return jsonError(`No document ${id}`, 404);
  try {
    const res = await draftPrivilegeDescription(id, { signal: req.signal });
    const entry = body?.save ? upsertPrivilegeEntry(doc, res.description) : null;
    return Response.json({ ...res, entry });
  } catch (e) {
    return errorResponse(e);
  }
}
