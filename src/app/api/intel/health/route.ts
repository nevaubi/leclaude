import { intelBootstrap } from "@/modules/intel/bootstrap";
import { loopState } from "@/modules/intel/background";
import { intelHealth } from "@/modules/intel/health";
import { lastSweepReport } from "@/modules/intel/steward";
import { intelStats } from "@/modules/intel/store";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";

/** GET → { health: IntelHealth, sweep, loop, stats } */
async function handleGET() {
  intelBootstrap();
  const loop = loopState();
  return Response.json({
    health: intelHealth(),
    sweep: lastSweepReport(),
    loop: loop ? { mode: loop.mode, startedAt: loop.startedAt, lastTickAt: loop.lastTickAt, ticks: loop.ticks, lastError: loop.lastError, busy: loop.busy } : null,
    stats: intelStats(),
    time: new Date().toISOString(),
  });
}

export const GET = withAuth(handleGET, { action: "read", resource: () => refs.intel() });
