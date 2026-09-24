import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { deleteIssueCode, updateIssueCode } from "@/modules/ediscovery/service";
import type { IssueCodeInput } from "@/modules/ediscovery/types";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<Partial<IssueCodeInput>>(req);
  if (!body) return jsonError("Invalid JSON body");
  try {
    const code = updateIssueCode(id, body);
    if (!code) return jsonError(`No issue code ${id}`, 404);
    return Response.json({ code });
  } catch (e) {
    return errorResponse({ message: (e as Error).message, status: 409 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteIssueCode(id);
  if (!ok) return jsonError(`No issue code ${id}`, 404);
  return Response.json({ ok: true });
}
