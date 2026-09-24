import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { deletePrivilegeEntry, listPrivilegeLog, privilegedDocsWithoutEntry, updatePrivilegeEntry } from "@/modules/ediscovery/service";
import type { PrivilegeLogEntry } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  return Response.json({ entries: listPrivilegeLog(m.matterId), missing: privilegedDocsWithoutEntry(m.matterId).map((d) => ({ id: d.id, bates: d.bates, subject: d.subject })) });
}

export async function PATCH(req: NextRequest) {
  const body = await readJson<{ id?: string; patch?: Partial<Pick<PrivilegeLogEntry, "description" | "status" | "basis" | "templateId">> }>(req);
  if (!body?.id || !body.patch) return jsonError("`id` and `patch` are required");
  const entry = updatePrivilegeEntry(body.id, body.patch);
  if (!entry) return jsonError(`No entry ${body.id}`, 404);
  return Response.json({ entry });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("`id` is required");
  return Response.json({ ok: deletePrivilegeEntry(id) });
}
