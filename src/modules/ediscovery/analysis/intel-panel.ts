import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/integrity/audit";
import type { MatterIntelPanel } from "./types";

/**
 * Intelligence for a matter, read through the intel analysis module. Every
 * section degrades to an empty state: when the intel modules are not seeded,
 * when their sources are disabled, or when a lookup throws, the panel still
 * renders with `available: false` or empty lists rather than failing the tab.
 */
export async function matterIntelPanel(matterId: string): Promise<MatterIntelPanel> {
  const empty: MatterIntelPanel = { matterId, available: false, sources: { enabled: 0, total: 0, disabled: [] }, judge: null, docket: [], regulatory: [], mdl: null, chronology: { entries: 0, merged: 0, alreadyOnTimeline: 0 }, generatedAt: new Date().toISOString() };
  if (!db().matters.get(matterId)) throw Object.assign(new Error(`Unknown matter ${matterId}`), { status: 404 });
  let ctx: Awaited<ReturnType<typeof import("@/modules/intel/context/user-context").buildMatterContext>> = null;
  try {
    const { intelAnalysisBootstrap } = await import("@/modules/intel/analysis/bootstrap");
    intelAnalysisBootstrap();
    const { buildMatterContext } = await import("@/modules/intel/context/user-context");
    ctx = buildMatterContext(matterId);
  } catch { return empty; }
  if (!ctx) return empty;
  const out: MatterIntelPanel = { ...empty, available: true };
  try {
    const { listSources } = await import("@/modules/intel/service");
    const sources = listSources();
    out.sources = { enabled: sources.filter((s) => s.enabled).length, total: sources.length, disabled: sources.filter((s) => !s.enabled).map((s) => s.name) };
  } catch { /* sources unavailable */ }
  try {
    const judgeId = ctx.matter.entities.judgeId;
    if (judgeId) {
      const { entityProfile } = await import("@/modules/intel/analysis/profiles");
      const { entityHref } = await import("@/modules/intel/analysis/pure");
      const p = entityProfile(judgeId, { recent: 6 });
      if (p) out.judge = { id: p.entity.id, name: p.entity.name, court: typeof p.entity.attributes.court === "string" ? p.entity.attributes.court : ctx.matter.court, documents: p.counts.documents, tendencies: p.tendencies.map((t) => ({ motion: t.motion, label: t.label, total: t.total, grantRate: t.grantRate })), recent: p.recent.map((r) => ({ id: r.id, title: r.title, date: r.date, kind: r.kind, url: r.url })), href: entityHref({ type: p.entity.type, id: p.entity.id }) };
    } else if (ctx.judge) out.judge = { id: ctx.judge.id, name: ctx.judge.name, court: ctx.matter.court, documents: 0, tendencies: [], recent: [], href: `/intel/judge/${ctx.judge.id}` };
  } catch { /* judge profile unavailable */ }
  try {
    out.docket = ctx.activity.docket.slice(0, 12).map((r) => ({ id: r.id, title: r.title, date: r.date, kind: r.kind, docketNumber: r.docketNumber, url: r.url, confidence: r.confidence, flagged: r.flags.length > 0 }));
  } catch { /* no docket */ }
  try {
    const { buildChronology } = await import("@/modules/intel/analysis/chronology");
    const reg = buildChronology({ matterId, includeEdiscovery: false, kinds: ["regulation", "register_notice", "recall", "adverse_event", "statute"], limit: 40 });
    out.regulatory = reg.entries.map((e) => ({ at: e.at, title: e.title, kind: e.kind, confidence: e.confidence, docIds: e.evidence.map((ev) => ev.docId) })).sort((a, b) => b.at.localeCompare(a.at));
    const all = buildChronology({ matterId, includeEdiscovery: false, limit: 500 });
    const existing = new Set(db().timeline.find((e) => e.matterId === matterId).flatMap((e) => e.sources.map((s) => s.id).filter((x): x is string => !!x)));
    out.chronology = { entries: all.entries.length, merged: all.merged, alreadyOnTimeline: all.entries.filter((e) => e.evidence.some((ev) => existing.has(ev.docId))).length };
  } catch { /* chronology unavailable */ }
  try {
    const { intelDocuments, intelEntities } = await import("@/modules/intel/store");
    const { documentHref, entityHref } = await import("@/modules/intel/analysis/pure");
    const mdlId = ctx.matter.entities.mdlId;
    const mdlDoc = intelDocuments().find((d) => d.kind === "mdl" && d.matterIds.includes(matterId)).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    const ent = mdlId ? intelEntities().get(mdlId) : null;
    if (mdlDoc || ent || ctx.mdl) {
      const attrs = (ent?.attributes ?? {}) as Record<string, unknown>;
      out.mdl = { id: mdlDoc?.id ?? ent?.id ?? ctx.mdl!.id, name: mdlDoc?.caseName ?? mdlDoc?.title ?? ent?.name ?? ctx.mdl!.name, number: typeof attrs.mdlNumber === "string" ? attrs.mdlNumber : mdlDoc?.title.match(/MDL\s*(?:No\.?\s*)?(\d+)/)?.[1], court: mdlDoc?.court ?? (typeof attrs.transfereeCourt === "string" ? attrs.transfereeCourt : undefined), status: typeof attrs.status === "string" ? attrs.status : mdlDoc?.tags.includes("closed") ? "closed" : "pending", detail: mdlDoc?.summary ?? ctx.mdl?.detail, updatedAt: mdlDoc?.dates.modified ?? mdlDoc?.updatedAt, href: mdlDoc ? documentHref(mdlDoc.id) : ent ? entityHref({ type: ent.type, id: ent.id }) : "/intel", flagged: !!mdlDoc?.flags.length };
    }
  } catch { /* mdl unavailable */ }
  return out;
}

/** Merge the intelligence chronology into the matter timeline (gated, deduped, with provenance); audited. */
export async function mergeIntelChronology(matterId: string, opts: { minConfidence?: number } = {}) {
  if (!db().matters.get(matterId)) throw Object.assign(new Error(`Unknown matter ${matterId}`), { status: 404 });
  const { intelAnalysisBootstrap } = await import("@/modules/intel/analysis/bootstrap");
  intelAnalysisBootstrap();
  const { exportChronologyToTimeline } = await import("@/modules/intel/analysis/chronology");
  const res = exportChronologyToTimeline(matterId, { minConfidence: opts.minConfidence });
  audit("import", { kind: "timeline", label: `intelligence chronology → timeline`, matterId }, { created: res.created, skippedDuplicates: res.skippedDuplicates, belowGate: res.belowGate, minConfidence: opts.minConfidence });
  return res;
}
