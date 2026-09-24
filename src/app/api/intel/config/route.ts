import { intelBootstrap } from "@/modules/intel/bootstrap";
import { intelConfigView } from "@/modules/intel/health";
import { httpCacheStats } from "@/modules/intel/providers";
import { listSources } from "@/modules/intel/service";

export const runtime = "nodejs";

/** GET → non-secret configuration: background mode, corpus folders, provider status, adapters, runner settings, cache size. */
export async function GET() {
  intelBootstrap();
  const view = intelConfigView();
  return Response.json({ ...view, sources: listSources().map((s) => ({ id: s.id, name: s.name, adapter: s.adapter, enabled: s.enabled, schedule: s.schedule, system: Boolean(s.system) })), httpCache: httpCacheStats() });
}
