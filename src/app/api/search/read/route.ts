import { jsonError } from "@/lib/ai/sse";
import { parseReadRef, readSource } from "@/modules/search/service";

export const runtime = "nodejs";

/** POST /api/search/read {kind, id|url|title+section, title?} → full text for the reader drawer. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const ref = parseReadRef(body);
  if (!ref) return jsonError("Invalid read reference: expected {kind: opinion|cfr|fr|url|statute|library|edoc, id|url|title+section}");
  try {
    const result = await readSource(ref, { title: typeof body?.title === "string" ? body.title : undefined, signal: req.signal });
    return Response.json({ result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unreachable = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|timeout|ETIMEDOUT|ECONNRESET/i.test(msg);
    return jsonError(unreachable ? "Provider unreachable (network). Retry when online." : msg, unreachable ? 502 : /^No /.test(msg) ? 404 : 502, { code: unreachable ? "provider_unreachable" : "read_failed" });
  }
}
