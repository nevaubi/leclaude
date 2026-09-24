import "server-only";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import type { IntelDocument, IntelEntity, IntelInsight, IntelSeries } from "../types";
import { intelEntities, intelInsights } from "../store";
import { buildChronology } from "./chronology";
import { dateOf, entityDocuments } from "./entities";
import { relationsOf } from "./graph";
import { bucketByMonth, monthKey, MOTION_LABEL, addMonths } from "./pure";
import { motionOutcomes } from "./trends";
import { findWatch } from "./watches";
import type { DocLite, EntityProfile, MotionTendency, RelatedEntity } from "./types";

/**
 * Profiles for judges, attorneys, firms, MDLs, products (and every other
 * entity type): counts by record kind, monthly activity, motion tendencies
 * where derivable from orders and opinions, related entities from the graph,
 * recent documents and an evidence-linked timeline. Everything links back to
 * the documents it was computed from.
 */

export function docLite(d: IntelDocument): DocLite {
  return { id: d.id, kind: d.kind, title: d.title, date: dateOf(d), court: d.court, citation: d.citation, docketNumber: d.docketNumber, url: d.url, confidence: d.confidence, flags: d.flags, matterIds: d.matterIds, summary: d.summary };
}

function activitySeries(docs: IntelDocument[], months = 24, now = new Date()): IntelSeries {
  const to = monthKey(now.toISOString())!;
  const from = addMonths(to, -(months - 1));
  const { series } = bucketByMonth(docs, { date: dateOf, group: () => "documents", from, to });
  return series[0] ?? { label: "documents", points: [] };
}

/** Motion tendencies from the orders/opinions among a set of documents. */
export function tendencies(docs: IntelDocument[]): MotionTendency[] {
  return motionOutcomes(docs).map((row) => {
    const decided = row.granted + row.denied + row.partial;
    return {
      motion: row.motion,
      label: MOTION_LABEL[row.motion],
      total: row.total,
      granted: row.granted,
      denied: row.denied,
      partial: row.partial,
      other: row.other,
      grantRate: decided ? Number(((row.granted + row.partial * 0.5) / decided).toFixed(2)) : null,
      evidence: row.docs.slice(0, 12).map(({ doc, outcome }) => ({ docId: doc.id, title: doc.title, date: dateOf(doc), outcome, url: doc.url })),
    };
  });
}

export function relatedEntities(entityId: string, limit = 24): RelatedEntity[] {
  return relationsOf(entityId).slice(0, limit).map((r): RelatedEntity | null => {
    const otherId = r.from === entityId ? r.to : r.from;
    const other = intelEntities().get(otherId);
    if (!other) return null;
    return { entity: { id: other.id, type: other.type, name: other.name }, relation: r.type, direction: r.from === entityId ? "out" : "in", weight: r.weight, confidence: r.confidence, evidence: r.evidence.slice(0, 4) };
  }).filter((x): x is RelatedEntity => Boolean(x));
}

export function entityProfile(id: string, opts: { userId?: string; now?: Date; recent?: number } = {}): EntityProfile | null {
  const entity = intelEntities().get(id);
  if (!entity) return null;
  const now = opts.now ?? new Date();
  const userId = opts.userId ?? currentUser().id;
  const docs = entityDocuments(id);
  const byKind: EntityProfile["counts"]["byKind"] = {};
  const matterIds = new Set<string>();
  for (const d of docs) { byKind[d.kind] = (byKind[d.kind] ?? 0) + 1; for (const m of d.matterIds) matterIds.add(m); }
  const related = relatedEntities(id);
  const matters = Array.from(matterIds).map((mid) => db().matters.get(mid)).filter((m): m is NonNullable<typeof m> => Boolean(m)).map((m) => ({ id: m.id, shortName: m.shortName, name: m.name }));
  const watch = findWatch(userId, id) ?? undefined;
  const insights = intelInsights().find((i) => i.scope.entityIds.includes(id) && i.status !== "dismissed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const timeline = buildChronology({ entityId: id, includeEdiscovery: false, limit: 60 }).entries;
  return {
    entity,
    counts: { documents: docs.length, byKind, matters: matters.length, relations: related.length },
    activity: activitySeries(docs, 24, now),
    tendencies: tendencies(docs),
    related,
    recent: docs.slice(0, opts.recent ?? 12).map(docLite),
    timeline,
    matters,
    watched: Boolean(watch),
    watch,
    insights,
  };
}

/** Compact profile for insight payloads and the agent tool (no timeline, fewer rows). */
export function profileSummary(entity: IntelEntity, docs = entityDocuments(entity.id)): { counts: EntityProfile["counts"]; tendencies: MotionTendency[]; related: RelatedEntity[]; recent: DocLite[] } {
  const byKind: EntityProfile["counts"]["byKind"] = {};
  const matters = new Set<string>();
  for (const d of docs) { byKind[d.kind] = (byKind[d.kind] ?? 0) + 1; for (const m of d.matterIds) matters.add(m); }
  const related = relatedEntities(entity.id, 10);
  return { counts: { documents: docs.length, byKind, matters: matters.size, relations: related.length }, tendencies: tendencies(docs), related, recent: docs.slice(0, 6).map(docLite) };
}

export function insightsForEntity(id: string): IntelInsight[] {
  return intelInsights().find((i) => i.scope.entityIds.includes(id) && i.status !== "dismissed");
}
