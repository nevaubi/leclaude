import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { matterFrom, readJson } from "@/modules/ediscovery/api-utils";
import { getCodingRules, setCodingRules } from "@/modules/ediscovery/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const m = matterFrom(req);
  if ("error" in m) return m.error;
  return Response.json({ matterId: m.matterId, rules: getCodingRules(m.matterId) });
}

export async function PUT(req: NextRequest) {
  const body = await readJson<{ matterId?: string; rules?: string }>(req);
  if (typeof body?.rules !== "string") return jsonError("`rules` is required");
  const m = matterFrom(req, body);
  if ("error" in m) return m.error;
  return Response.json({ matterId: m.matterId, rules: setCodingRules(m.matterId, body.rules) });
}
