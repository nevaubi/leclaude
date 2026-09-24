import "server-only";
import { ensureIntelBackground } from "./background";
import { ensureIntelSeeded } from "./seed";

/** Called by every intel API route: seeds older databases and starts the in-process runner if instrumentation did not. */
export function intelBootstrap() {
  try { ensureIntelSeeded(); } catch (e) { console.warn("[intel] seed failed", (e as Error).message); }
  try { ensureIntelBackground(); } catch (e) { console.warn("[intel] background start failed", (e as Error).message); }
}
