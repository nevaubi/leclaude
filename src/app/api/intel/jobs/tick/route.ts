import { withDb } from "@/lib/db/request";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelConfig } from "@/modules/intel/config";
import { intelHealth } from "@/modules/intel/health";
import { runDue } from "@/modules/intel/jobs";
import { ensureIntelSeeded } from "@/modules/intel/seed";
import { scheduleAutoConfigure } from "@/modules/intel/autoconfig";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";
/** Vercel Hobby functions stop at 60s; the tick works for up to ~50s and returns. */
export const maxDuration = 60;

/**
 * External cron driver. Runs due intel jobs for up to 50 seconds and also the
 * housekeeping cadences (workflow scheduler tick, integrity scans, sweep,
 * embedding backfill) that the in-process loop would otherwise cover.
 * vercel.json schedules it hourly (each run wakes the shared database, so a tighter cadence exhausts a free-tier database quota); note that Vercel Hobby plans only
 * allow one cron invocation per day, so use an external cron (or the inline
 * runner on a persistent host) for the intended cadence. When CRON_SECRET is
 * set, the request must carry "Authorization: Bearer <secret>".
 */
async function tick(req: NextRequest) {
  const { cronSecret } = intelConfig();
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) return jsonError("Unauthorized", 401);
  }
  try { ensureIntelSeeded(); } catch { /* seeded by db() on first access */ }
  scheduleAutoConfigure();
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200));
  const deadlineMs = Math.max(1000, Math.min(Number(url.searchParams.get("deadlineMs") ?? 50_000) || 50_000, 55_000));
  const housekeeping = url.searchParams.get("housekeeping") !== "0";
  const result = await runDue({ limit, deadlineMs, housekeeping });
  return Response.json({ ...result, health: intelHealth() });
}

async function handlePOST(req: NextRequest) { return tick(req); }
/** Vercel cron jobs use GET. */
async function handleGET(req: NextRequest) { return tick(req); }

export const POST = withDb(withAuth(handlePOST, { action: "run", resource: () => refs.intel() }));
export const GET = withDb(withAuth(handleGET, { action: "run", resource: () => refs.intel() }));
