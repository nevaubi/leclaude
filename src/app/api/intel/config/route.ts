import { withDb } from "@/lib/db/request";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { intelConfigView } from "@/modules/intel/health";
import { httpCacheStats } from "@/modules/intel/providers";
import { listSources } from "@/modules/intel/service";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** GET → non-secret configuration: background mode, corpus folders, provider status, adapters, runner settings, cache size. */
async function handleGET() {
  intelBootstrap();
  const view = intelConfigView();
  return Response.json({ ...view, sources: listSources().map((s) => ({ id: s.id, name: s.name, adapter: s.adapter, enabled: s.enabled, schedule: s.schedule, system: Boolean(s.system) })), httpCache: httpCacheStats() });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => refs.intel() }));
