import "server-only";
/**
 * Server bootstrap for the integrity layer: importing this module registers
 * every module-level scan (e-discovery, workflows, library) on top of the
 * built-in ones, so `runScans()` sees them regardless of which route or job
 * triggered it. Import it from the scan/review API routes and from tests.
 */
import "./scans";
import "@/modules/ediscovery/scans";
import "@/modules/workflows/scans";
import "@/modules/library/scans";
import "@/modules/intel/scans";

export { runScans, listScans, lastReport, fixFinding, ensureScheduledScans } from "./scans";
