/**
 * Next.js instrumentation hook. `register()` runs once when the server boots.
 * On the Node runtime it starts the intelligence job runner, which also
 * starts the workflow scheduler (60s tick) and the integrity scan timer (6h),
 * so background work no longer waits for the first request.
 *
 * Disable with LECLAUDE_BACKGROUND=off; on Vercel set LECLAUDE_BACKGROUND=cron
 * and let the cron in vercel.json call POST /api/intel/jobs/tick instead.
 *
 * The dynamic import must sit inside the NEXT_RUNTIME check: Next compiles
 * this file for the edge runtime too, and the DefinePlugin-substituted
 * condition lets webpack drop the whole block (and every server-only module
 * behind it, node:crypto and node:sqlite included) from that bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const mode = (process.env.LECLAUDE_BACKGROUND ?? "").trim().toLowerCase();
    if (mode === "off") return;
    try {
      const { ensureIntelBackground } = await import("@/modules/intel/background");
      const state = ensureIntelBackground();
      if (state.mode === "inline") console.log("[leclaude] background runner started (intel jobs every 30s, workflows every 60s, integrity scans every 6h)");
      else console.log(`[leclaude] background runner idle (LECLAUDE_BACKGROUND=${state.mode}); POST /api/intel/jobs/tick drives due work`);
    } catch (e) {
      console.warn("[leclaude] background runner failed to start:", (e as Error).message);
    }
  }
}
