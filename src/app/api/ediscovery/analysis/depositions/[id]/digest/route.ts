import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { digestDeposition } from "@/modules/ediscovery/analysis/ai";

export const runtime = "nodejs";

/**
 * POST { force?, verify? } → { digest: Digest & { provenance }, provenance }
 * 503 {code:'no_api_key'} without a key; cached on deposition.aiDigest with provenance in the integrity store.
 * The summary is claim-verified against the transcript, admissions are self-corrected, and page:line / Bates cites
 * that do not resolve are marked [VERIFY].
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ force?: boolean; verify?: boolean }>(req);
  try {
    const digest = await digestDeposition(id, { force: !!body?.force, verify: body?.verify, signal: req.signal });
    return Response.json({ digest, provenance: digest.provenance ?? null });
  } catch (e) { return errorResponse(e); }
}
