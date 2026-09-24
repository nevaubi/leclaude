import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { digestDeposition } from "@/modules/ediscovery/analysis/ai";

export const runtime = "nodejs";

/** POST { force? } → { digest } (503 {code:'no_api_key'} without a key; cached on deposition.aiDigest) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ force?: boolean }>(req);
  try {
    const digest = await digestDeposition(id, { force: !!body?.force, signal: req.signal });
    return Response.json({ digest });
  } catch (e) { return errorResponse(e); }
}
