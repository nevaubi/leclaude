import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { errorResponse, matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { addStandardIssueCodes, createIssueCode, listIssueCodes } from "@/modules/ediscovery/service";
import type { IssueCodeInput } from "@/modules/ediscovery/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  return Response.json({ codes: listIssueCodes(m.matterId) });
}

/** POST { matterId, code, label, … } → 201 { code }; POST { matterId, preset: "standard" } → 201 { created, skipped }. */
export async function POST(req: NextRequest) {
  const body = await readJson<IssueCodeInput & { matterId?: string; preset?: string }>(req);
  if (body?.preset === "standard") {
    const m = matterFrom(req, body);
    if ("error" in m) return m.error;
    return Response.json(addStandardIssueCodes(m.matterId), { status: 201 });
  }
  if (!body?.code) return jsonError("`code` is required");
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  try {
    return Response.json({ code: createIssueCode(m.matterId, body) }, { status: 201 });
  } catch (e) {
    return errorResponse({ ...(e as Error), message: (e as Error).message, status: 409 });
  }
}
