import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { audit } from "@/lib/integrity/audit";
import { matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { deletePrivilegeEntry, listPrivilegeLog, privilegedDocsWithoutEntry, updatePrivilegeEntry } from "@/modules/ediscovery/service";
import type { PrivilegeLogEntry } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  return Response.json({ entries: listPrivilegeLog(m.matterId), missing: privilegedDocsWithoutEntry(m.matterId).map((d) => ({ id: d.id, bates: d.bates, subject: d.subject })) });
}

/** PATCH { id, patch } → { entry } or { ids, patch } → { entries, updated } (status workflow / basis / description / template). */
export async function PATCH(req: NextRequest) {
  const body = await readJson<{ id?: string; ids?: string[]; patch?: Partial<Pick<PrivilegeLogEntry, "description" | "status" | "basis" | "templateId">> }>(req);
  if ((!body?.id && !body?.ids?.length) || !body.patch) return jsonError("`id` (or `ids`) and `patch` are required");
  if (body.patch.status && !["draft", "review", "final"].includes(body.patch.status)) return jsonError("status must be draft, review or final", 422);
  if (body.ids?.length) {
    const entries = body.ids.map((id) => updatePrivilegeEntry(id, body.patch!)).filter((e): e is PrivilegeLogEntry => !!e);
    if (entries.length) audit("update", { kind: "privilegeLog", label: `${entries.length} entries: ${Object.keys(body.patch).join(", ")}`, matterId: entries[0].matterId }, { ids: body.ids.slice(0, 200), patch: body.patch });
    return Response.json({ entries, updated: entries.length });
  }
  const entry = updatePrivilegeEntry(body.id!, body.patch);
  if (!entry) return jsonError(`No entry ${body.id}`, 404);
  audit("update", { kind: "privilegeEntry", id: entry.id, label: entry.bates, matterId: entry.matterId }, { patch: body.patch });
  return Response.json({ entry });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("`id` is required");
  return Response.json({ ok: deletePrivilegeEntry(id) });
}
