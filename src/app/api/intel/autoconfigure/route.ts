import { withDb } from "@/lib/db/request";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { accessibleMatterIds, requirePrincipal, withAuth } from "@/lib/auth/route";
import { AuthError } from "@/lib/auth/errors";
import { refs } from "@/lib/auth/resources";
import type { Principal } from "@/lib/auth/types";
import { canManageWorkspace } from "@/modules/workspace/service";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { activeMatters, applyPlans, autoconfigState, planForMatters } from "@/modules/intel/autoconfig";
import type { AutoconfigRequest, AutoconfigState, MatterIntelPlan, SourceChange } from "@/modules/intel/autoconfig-types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Only what the principal may see: plans for accessible matters; changes list only accessible matter ids. */
function visible(principal: Principal, plans: MatterIntelPlan[], changes: SourceChange[]) {
  const ok = new Set(accessibleMatterIds(principal));
  return {
    plans: plans.filter((p) => ok.has(p.matterId)),
    changes: changes.map((c) => ({ ...c, matterIds: c.matterIds.filter((id) => ok.has(id)) })),
  };
}

type G = typeof globalThis & { __leclaudeAutoconfigPreview?: { key: string; at: number; plans: MatterIntelPlan[] } };
const PREVIEW_TTL_MS = 10 * 60_000;

/** Dry-run plan for the preview (cached per matter set for ten minutes so a GET does not call the model each time). */
async function previewPlans(matterIds: string[]): Promise<MatterIntelPlan[]> {
  const matters = activeMatters(matterIds);
  const key = matters.map((m) => `${m.id}:${(m as { updatedAt?: string }).updatedAt ?? ""}`).sort().join("|");
  const g = globalThis as G;
  const hit = g.__leclaudeAutoconfigPreview;
  if (hit && hit.key === key && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.plans;
  const plans = await planForMatters(matters);
  g.__leclaudeAutoconfigPreview = { key, at: Date.now(), plans };
  return plans;
}

/** GET → AutoconfigState (the last apply), plus `preview` (a fresh dry-run plan) when it was never applied. */
async function handleGET() {
  intelBootstrap();
  const principal = requirePrincipal();
  const state = autoconfigState();
  if (state?.appliedAt) {
    const v = visible(principal, state.plans, state.changes);
    return Response.json({ ...state, ...v } satisfies AutoconfigState);
  }
  const preview = await previewPlans(accessibleMatterIds(principal));
  return Response.json({ plans: [], changes: [], jobs: [], preview: visible(principal, preview, []).plans });
}

/** POST AutoconfigRequest → { state, plans, changes, jobs }. dryRun returns the plan without changing sources. */
async function handlePOST(req: NextRequest) {
  intelBootstrap();
  const principal = requirePrincipal();
  const body = (await req.json().catch(() => ({}))) as AutoconfigRequest;
  const allowed = new Set(accessibleMatterIds(principal));
  let matterIds: string[];
  if (Array.isArray(body.matterIds)) {
    matterIds = body.matterIds.filter((x): x is string => typeof x === "string");
    const denied = matterIds.filter((id) => !allowed.has(id));
    if (denied.length) throw AuthError.forbidden(`no access to matter ${denied[0]}`);
    if (!matterIds.length) return jsonError("matterIds is empty", 422);
  } else {
    matterIds = Array.from(allowed);
  }
  const matters = activeMatters(matterIds);
  if (!matters.length) return jsonError("No active matters to configure from", 422, { code: "no_matters" });
  const plans = await planForMatters(matters);
  if (body.dryRun) {
    const state = autoconfigState() ?? { plans: [], changes: [], jobs: [] };
    return Response.json({ state: { ...state, ...visible(principal, state.plans, state.changes) }, plans: visible(principal, plans, []).plans, changes: [], jobs: [] });
  }
  try {
    const r = applyPlans(plans, { run: body.run !== false, by: { id: principal.id, name: principal.name || principal.id } });
    const v = visible(principal, r.state.plans, r.state.changes);
    return Response.json({ state: { ...r.state, ...v }, plans: v.plans, changes: v.changes, jobs: r.jobs });
  } catch (e) {
    const status = (e as { status?: number }).status;
    return jsonError((e as Error).message, typeof status === "number" ? status : 500);
  }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => refs.intel() }));
/**
 * Reconfiguring the shared sources administers the intelligence layer (partner/admin, or the workspace owner,
 * as for the other workspace-wide settings); a dry run only reads.
 */
export const POST = withDb(withAuth(handlePOST, {
  action: async (req, _params, principal) => {
    if (((await req.clone().json().catch(() => ({}))) as AutoconfigRequest).dryRun) return "read";
    return canManageWorkspace(principal) ? "run" : "admin";
  },
  resource: () => refs.intel(),
}));
