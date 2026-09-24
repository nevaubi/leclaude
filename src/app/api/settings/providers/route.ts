import { jsonError } from "@/lib/ai/sse";
import { providersPayload } from "@/modules/settings/providers";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provider configuration status (env presence only; never values). */
async function handleGET() {
  try {
    return Response.json(providersPayload(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}

export const GET = withAuth(handleGET, { action: "admin", resource: () => refs.settings() });
