import { jsonError } from "@/lib/ai/sse";
import { providersPayload } from "@/modules/settings/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provider configuration status (env presence only; never values). */
export async function GET() {
  try {
    return Response.json(providersPayload(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
