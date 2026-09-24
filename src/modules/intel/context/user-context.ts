import "server-only";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import type { CalendarEvent, Matter, Person, Task } from "@/lib/types/domain";
import type { IntelDocument, IntelInsight } from "../types";
import { intelDocuments, intelEntities } from "../store";
import { buildChronology } from "../analysis/chronology";
import { dateOf, entityDetail } from "../analysis/entities";
import { rankInsights } from "../analysis/insights";
import { docLite } from "../analysis/profiles";
import { listWatches } from "../analysis/watches";
import type { DocLite } from "../analysis/types";
import type { ContextEvent, ContextMatter, ContextPerson, ContextTask, MatterActivity, MatterContext, UpcomingPrep, UserContext } from "./types";

/**
 * Personal, team and matter context: who the user is, who they work with,
 * their active matters, the next two weeks of calendar, due tasks, watches,
 * recent research and documents, ranked insights, docket/regulatory activity
 * on their matters and preparation material for upcoming events. Read by
 * Home, matter headers, GET /api/intel/context and the agents' context tool.
 */

const DOCKET_KINDS = new Set<IntelDocument["kind"]>(["docket", "docket_entry", "opinion", "mdl"]);
const REGULATORY_KINDS = new Set<IntelDocument["kind"]>(["regulation", "register_notice", "recall", "adverse_event", "court_rule", "statute"]);

function person(p: Person): ContextPerson {
  return { id: p.id, name: p.name, title: p.title, role: p.role, organization: p.organization };
}

function daysUntil(iso: string, now: Date): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86400_000);
}

function matterEntities(docs: IntelDocument[]): ContextMatter["entities"] {
  const count = (ids: (string | undefined)[]) => { const m = new Map<string, number>(); for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1); return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]; };
  return { judgeId: count(docs.flatMap((d) => d.judgeIds)), mdlId: count(docs.map((d) => d.mdlId)), courtId: count(docs.map((d) => d.courtId)) };
}

export function contextMatter(m: Matter, now: Date, docs = intelDocuments().find((d) => d.matterIds.includes(m.id))): ContextMatter {
  const day30 = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  return {
    id: m.id, shortName: m.shortName, name: m.name, caption: m.caption, client: m.client, status: m.status, stage: m.stage, court: m.court, judge: m.judge, practiceArea: m.practiceArea, leadAttorneyId: m.leadAttorneyId, teamIds: m.teamIds,
    keyDates: (m.keyDates ?? []).map((k) => ({ ...k, daysUntil: daysUntil(k.date, now) })).sort((a, b) => a.date.localeCompare(b.date)),
    records: docs.length,
    recentRecords: docs.filter((d) => (dateOf(d) ?? "") >= day30).length,
    entities: matterEntities(docs),
  };
}

function contextEvent(e: CalendarEvent, now: Date): ContextEvent {
  return { id: e.id, title: e.title, matterId: e.matterId, startsAt: e.startsAt, endsAt: e.endsAt, kind: e.kind, location: e.location, daysUntil: daysUntil(e.startsAt, now) };
}

function contextTask(t: Task, now: Date): ContextTask {
  return { id: t.id, title: t.title, matterId: t.matterId, status: t.status, priority: t.priority, dueAt: t.dueAt, overdue: Boolean(t.dueAt && t.dueAt < now.toISOString() && t.status !== "done") };
}

/** Docket, regulatory and other records on a matter in the last `days` days (default 30), newest first. */
export function matterActivity(matterId: string, opts: { now?: Date; days?: number; limit?: number } = {}): MatterActivity {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.days ?? 30) * 86400_000).toISOString().slice(0, 10);
  const limit = opts.limit ?? 8;
  const m = db().matters.get(matterId);
  const docs = intelDocuments().find((d) => d.matterIds.includes(matterId) && (dateOf(d) ?? "") >= since).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? ""));
  const pick = (test: (d: IntelDocument) => boolean): DocLite[] => docs.filter(test).slice(0, limit).map(docLite);
  return { matterId, shortName: m?.shortName ?? matterId, docket: pick((d) => DOCKET_KINDS.has(d.kind)), regulatory: pick((d) => REGULATORY_KINDS.has(d.kind)), other: pick((d) => !DOCKET_KINDS.has(d.kind) && !REGULATORY_KINDS.has(d.kind)), total: docs.length, lastAt: docs[0] ? dateOf(docs[0]) : undefined };
}

/** Matters the user works on (team member or lead), active first. */
export function userMatters(userId: string): Matter[] {
  const order: Record<Matter["status"], number> = { active: 0, "pre-suit": 1, "on hold": 2, closed: 3 };
  return db().matters.find((m) => m.teamIds.includes(userId) || m.leadAttorneyId === userId).sort((a, b) => order[a.status] - order[b.status] || a.shortName.localeCompare(b.shortName));
}

function upcomingPrep(events: ContextEvent[], insights: IntelInsight[], now: Date): UpcomingPrep[] {
  return events.slice(0, 6).map((event) => {
    const matter = event.matterId ? db().matters.get(event.matterId) : null;
    const words = event.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
    const related = insights.filter((i) => (event.matterId && i.scope.matterId === event.matterId) || words.some((w) => i.title.toLowerCase().includes(w))).slice(0, 3);
    const records = event.matterId ? intelDocuments().find((d) => d.matterIds.includes(event.matterId!) && (d.kind === "docket_entry" || d.kind === "court_rule" || d.kind === "opinion") && (words.some((w) => d.title.toLowerCase().includes(w)) || (dateOf(d) ?? "") >= new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10))).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? "")).slice(0, 3).map(docLite) : [];
    return { event, matter: matter ? { id: matter.id, shortName: matter.shortName } : undefined, insights: related, records };
  });
}

export function buildUserContext(userId = currentUser().id, opts: { now?: Date; horizonDays?: number; insights?: number } = {}): UserContext {
  const now = opts.now ?? new Date();
  const horizonDays = opts.horizonDays ?? 14;
  const d = db();
  const me = d.people.get(userId);
  const matters = userMatters(userId);
  const matterIds = new Set(matters.map((m) => m.id));
  const teamIds = new Set<string>();
  for (const m of matters) { for (const id of m.teamIds) teamIds.add(id); if (m.leadAttorneyId) teamIds.add(m.leadAttorneyId); }
  teamIds.delete(userId);
  const team = Array.from(teamIds).map((id) => d.people.get(id)).filter((p): p is Person => Boolean(p)).map(person);
  const horizon = new Date(now.getTime() + horizonDays * 86400_000).toISOString();
  const nowIso = now.toISOString();
  const calendar = d.events.find((e) => e.startsAt >= nowIso.slice(0, 10) && e.startsAt <= horizon && (!e.matterId || matterIds.has(e.matterId) || (e.attendeeIds ?? []).includes(userId))).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((e) => contextEvent(e, now));
  const tasks = d.tasks.find((t) => t.status !== "done" && (t.assigneeId === userId || Boolean(!t.assigneeId && t.matterId && matterIds.has(t.matterId))) && (!t.dueAt || t.dueAt <= horizon)).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")).map((t) => contextTask(t, now)).slice(0, 20);
  const watches = listWatches({ userId });
  const threads = d.collection<{ id: string; title: string; matterId: string | null; ownerId: string; updatedAt: string; messages?: unknown[] }>("search_threads").find((t) => t.ownerId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const recentDocs = [
    ...d.officeDocs.find((o) => o.createdById === userId || (o.matterId ? matterIds.has(o.matterId) : false)).map((o) => ({ id: o.id, title: o.title, kind: `office:${o.kind}`, matterId: o.matterId, updatedAt: o.updatedAt, href: `/office/${o.kind}/${o.id}` })),
    ...d.library.find((l) => l.ownerId === userId && l.type !== "folder").map((l) => ({ id: l.id, title: l.name, kind: `library:${l.type}`, matterId: l.matterId, updatedAt: l.updatedAt, href: `/library?q=${encodeURIComponent(l.name)}` })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const insights = rankInsights({ userId, limit: opts.insights ?? 8, now });
  const matterActivityList = matters.filter((m) => m.status === "active").map((m) => matterActivity(m.id, { now })).filter((a) => a.total > 0).sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return {
    userId,
    user: me ? person(me) : { id: userId, name: currentUser().name, role: "attorney" },
    team,
    matters: matters.map((m) => contextMatter(m, now)),
    calendar,
    tasks,
    watches,
    recentResearch: threads.map((t) => ({ id: t.id, title: t.title, matterId: t.matterId, updatedAt: t.updatedAt, messages: Array.isArray(t.messages) ? t.messages.length : 0 })),
    recentDocs,
    insights,
    matterActivity: matterActivityList,
    upcoming: upcomingPrep(calendar, insights, now),
    generatedAt: nowIso,
    horizonDays,
  };
}

export function buildMatterContext(matterId: string, opts: { now?: Date; userId?: string } = {}): MatterContext | null {
  const now = opts.now ?? new Date();
  const d = db();
  const m = d.matters.get(matterId);
  if (!m) return null;
  const docs = intelDocuments().find((x) => x.matterIds.includes(matterId));
  const cm = contextMatter(m, now, docs);
  const ent = (id?: string) => (id ? intelEntities().get(id) : null);
  const judge = ent(cm.entities.judgeId);
  const mdl = ent(cm.entities.mdlId);
  const court = cm.entities.courtId ? intelEntities().findOne((e) => e.type === "court" && (e.externalIds?.courtlistener === cm.entities.courtId || e.attributes.courtId === cm.entities.courtId)) : null;
  const byKind: MatterContext["byKind"] = {};
  for (const x of docs) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
  const horizon = new Date(now.getTime() + 14 * 86400_000).toISOString();
  return {
    matter: cm,
    team: [...m.teamIds, ...(m.leadAttorneyId ? [m.leadAttorneyId] : [])].filter((id, i, arr) => arr.indexOf(id) === i).map((id) => d.people.get(id)).filter((p): p is Person => Boolean(p)).map(person),
    judge: judge ? { id: judge.id, name: judge.name, detail: entityDetail(judge) } : undefined,
    court: court ? { id: court.id, name: court.name } : undefined,
    mdl: mdl ? { id: mdl.id, name: mdl.name, detail: entityDetail(mdl) } : undefined,
    activity: matterActivity(matterId, { now }),
    chronology: buildChronology({ matterId, includeEdiscovery: true, limit: 30 }).entries.map((e) => ({ at: e.at, title: e.title, kind: e.kind, confidence: e.confidence })),
    insights: rankInsights({ userId: opts.userId, matterId, limit: 8, now }),
    watches: listWatches({ matterId }),
    calendar: d.events.find((e) => e.matterId === matterId && e.startsAt >= now.toISOString().slice(0, 10) && e.startsAt <= horizon).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((e) => contextEvent(e, now)),
    tasks: d.tasks.find((t) => t.matterId === matterId && t.status !== "done").sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")).slice(0, 15).map((t) => contextTask(t, now)),
    byKind,
    generatedAt: now.toISOString(),
  };
}

/** Ranked insights for a user and/or matter (Home "For you", matter headers). */
export function insightsFor(o: { userId?: string; matterId?: string; limit?: number; now?: Date } = {}): IntelInsight[] {
  return rankInsights({ userId: o.userId, matterId: o.matterId, limit: o.limit ?? 8, now: o.now });
}
