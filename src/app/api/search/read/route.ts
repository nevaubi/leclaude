import { jsonError } from "@/lib/ai/sse";
import { parseReadRef, providerMessage, readSource } from "@/modules/search/service";

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
    // Network failures and proxy/provider refusals (403/407/429) are "unreachable" for the UI: same wording as the results tabs, with a retry hint.
    const unreachable = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|timeout|ETIMEDOUT|ECONNRESET|network|\b(401|403|407|429)\b/i.test(msg);
    if (unreachable) return jsonError(providerMessage(e), 502, { code: "provider_unreachable" });
    return jsonError(msg, /^No /.test(msg) ? 404 : 502, { code: "read_failed" });
  }
}
