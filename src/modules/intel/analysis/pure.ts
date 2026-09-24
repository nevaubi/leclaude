/**
 * Pure, client-safe helpers for the analysis layer: labels, month buckets,
 * motion/outcome classifiers, cite extraction, z-score anomalies, insight
 * ranking and chronology merging. No I/O, no server imports; shared by the
 * server analyses, the /intel components and the tests.
 */
import { eventDuplicateKey, findNearDuplicateEvent, tokenSimilarity } from "@/lib/integrity/dedupe";
import type { IntelDocumentKind, IntelEntityType, IntelFlagKind, IntelInsight, IntelInsightKind, IntelRelationType, IntelSeries, IntelTimelineEntry, IntelWatchKind } from "../types";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const ENTITY_TYPE_LABEL: Record<IntelEntityType, string> = {
  judge: "Judge", attorney: "Attorney", firm: "Firm", party: "Party", court: "Court", mdl: "MDL", product: "Product", agency: "Agency", regulation: "Regulation", statute: "Statute", expert: "Expert",
};

export const ENTITY_TYPE_PLURAL: Record<IntelEntityType, string> = {
  judge: "Judges", attorney: "Attorneys", firm: "Firms", party: "Parties", court: "Courts", mdl: "MDLs", product: "Products", agency: "Agencies", regulation: "Regulations", statute: "Statutes", expert: "Experts",
};

export const ENTITY_TYPES: IntelEntityType[] = ["judge", "attorney", "firm", "party", "court", "mdl", "product", "agency", "regulation", "statute", "expert"];

export const RELATION_LABEL: Record<IntelRelationType, string> = {
  presides: "presides over", appears_in: "appears in", member_of: "sits on", represents: "represents", opposes: "opposes", cites: "cites", regulates: "regulates", recalled: "recalled", transferred_to: "transferred to", co_counsel: "co-counsel with", before_judge: "appears before", employed_by: "practices at", manufactures: "manufactures", mentions: "mentions",
};

export const RELATION_TYPES: IntelRelationType[] = ["presides", "appears_in", "member_of", "represents", "opposes", "cites", "regulates", "recalled", "transferred_to", "co_counsel", "before_judge", "employed_by", "manufactures", "mentions"];

export const DOC_KIND_LABEL: Record<IntelDocumentKind, string> = {
  opinion: "Opinion", docket: "Docket", docket_entry: "Docket entry", court_rule: "Court rule", regulation: "Regulation", register_notice: "Federal Register", recall: "Recall", adverse_event: "Adverse event", mdl: "MDL", judge: "Judge", attorney: "Attorney", firm: "Firm", news: "News", local_file: "Local file", web_page: "Web page", statute: "Statute", expert: "Expert",
};

export const INSIGHT_KIND_LABEL: Record<IntelInsightKind, string> = { trend: "Trend", cluster: "Cluster", pattern: "Pattern", chronology: "Chronology", profile: "Profile", anomaly: "Anomaly", alert: "Alert", digest: "Digest" };

export const INSIGHT_STATUS_LABEL: Record<IntelInsight["status"], string> = { draft: "Draft", verified: "Verified", flagged: "Flagged", published: "Published", dismissed: "Dismissed" };

export const FLAG_LABEL: Record<IntelFlagKind, string> = { low_confidence: "Low confidence", unverified: "Unverified", contradicted: "Contradicted", stale: "Stale", parse_error: "Parse error", duplicate: "Duplicate", needs_review: "Needs review", broken_link: "Broken link" };

/** Entity types that can be watched, mapped to the watch kind. */
export const WATCH_KIND_FOR_ENTITY: Partial<Record<IntelEntityType, IntelWatchKind>> = { judge: "judge", attorney: "attorney", firm: "firm", mdl: "mdl", product: "product", regulation: "regulation", court: "court" };

export function entityHref(e: { type: IntelEntityType; id: string }): string {
  return `/intel/${e.type}/${encodeURIComponent(e.id)}`;
}

export function documentHref(docId: string): string {
  return `/intel/documents/${encodeURIComponent(docId)}`;
}

// ---------------------------------------------------------------------------
// Dates and month buckets
// ---------------------------------------------------------------------------

/** "2024-03-17T..." → "2024-03"; undefined for unparseable input. */
export function monthKey(iso: string | undefined | null): string | undefined {
  const m = iso?.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : undefined;
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

/** Inclusive list of month keys between two keys (capped at 600 months). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 600) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[(m ?? 1) - 1]} ${y}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400_000);
}

// ---------------------------------------------------------------------------
// Motion and outcome classification (docket entries, opinions)
// ---------------------------------------------------------------------------

export type MotionType = "dismiss" | "summary_judgment" | "daubert" | "class_certification" | "preemption" | "transfer" | "remand" | "case_management" | "settlement" | "protective_order" | "compel" | "sanctions" | "stay" | "in_limine" | "post_trial" | "bellwether" | "appointment" | "other";

export const MOTION_LABEL: Record<MotionType, string> = {
  dismiss: "Motion to dismiss", summary_judgment: "Summary judgment", daubert: "Daubert / Rule 702", class_certification: "Class certification", preemption: "Preemption", transfer: "Transfer / § 1407", remand: "Remand", case_management: "Case management order", settlement: "Settlement", protective_order: "Protective order", compel: "Motion to compel", sanctions: "Sanctions", stay: "Stay", in_limine: "Motion in limine", post_trial: "Post-trial", bellwether: "Bellwether", appointment: "Leadership appointment", other: "Other",
};

const MOTION_RULES: [MotionType, RegExp][] = [
  ["daubert", /\bdaubert\b|rule\s*702|exclude\s+(?:the\s+)?(?:expert|testimony|opinions?)|expert\s+(?:testimony|opinion)s?\s+(?:is|are)\s+(?:excluded|admissible)/i],
  ["summary_judgment", /summary\s+judgment/i],
  ["class_certification", /class\s+certification|certif(?:y|ication of)\s+(?:the\s+|a\s+)?class|rule\s*23/i],
  ["preemption", /preempt(?:ion|ed|s)\b/i],
  ["dismiss", /motion\s+to\s+dismiss|rule\s*12\(b\)|\bdismiss(?:al|ed)?\b/i],
  ["transfer", /transfer\s+order|\b1407\b|centraliz(?:e|ation)|transferee/i],
  ["remand", /\bremand/i],
  ["in_limine", /in\s+limine/i],
  ["compel", /motion\s+to\s+compel|compel\s+(?:production|discovery|responses)/i],
  ["protective_order", /protective\s+order|confidentiality\s+order/i],
  ["sanctions", /\bsanction/i],
  ["stay", /\bstay(?:ed|s)?\b\s+(?:of|the|all|pending|proceedings)|motion\s+to\s+stay/i],
  ["post_trial", /judgment\s+as\s+a\s+matter\s+of\s+law|new\s+trial|rule\s*50|rule\s*59/i],
  ["settlement", /settlement|settle(?:d|s)?\b|final\s+approval|preliminar(?:y|ily)\s+approv/i],
  ["bellwether", /bellwether/i],
  ["appointment", /appoint(?:ing|ment|s)?\s+(?:of\s+)?(?:lead|liaison|co-lead|executive\s+committee|steering|plaintiffs'|counsel)/i],
  ["case_management", /case\s+management\s+order|\bcmo\b|scheduling\s+order|pretrial\s+order/i],
];

/** Classify a docket entry / opinion title (and optionally its text) into a motion type. */
export function classifyMotion(title: string, text?: string): MotionType | null {
  const head = `${title} ${text?.slice(0, 600) ?? ""}`;
  for (const [type, re] of MOTION_RULES) if (re.test(head)) return type;
  return null;
}

export type MotionOutcome = "granted" | "denied" | "partial" | "affirmed" | "reversed";

export const OUTCOME_LABEL: Record<MotionOutcome, string> = { granted: "Granted", denied: "Denied", partial: "Granted in part", affirmed: "Affirmed", reversed: "Reversed / vacated" };

/** Outcome from an order's title/text; null when the record does not state one. */
export function classifyOutcome(title: string, text?: string): MotionOutcome | null {
  const s = `${title} ${text?.slice(0, 800) ?? ""}`;
  if (/granted\s+in\s+part|denied\s+in\s+part|in\s+part\s+and\s+denied|in\s+part\s+and\s+granted/i.test(s)) return "partial";
  if (/\b(?:reversed|vacated)\b/i.test(s) && !/\baffirmed\b/i.test(s)) return "reversed";
  if (/\baffirm(?:ed|s|ing)\b/i.test(s)) return "affirmed";
  if (/\b(?:denying|denied|denies)\b|\boverrul(?:ed|ing)\b|\brejected\b/i.test(s)) return "denied";
  if (/\b(?:granting|granted|grants)\b|\bsustain(?:ed|ing)\b|\bapprov(?:ed|ing)\b/i.test(s)) return "granted";
  return null;
}

// ---------------------------------------------------------------------------
// Citation extraction
// ---------------------------------------------------------------------------

/** "40 C.F.R. § 705.3" / "40 CFR 705.3" → canonical "40 C.F.R. § 705.3" (part-level cites keep the part). */
export function extractCfrCites(text: string): string[] {
  const out = new Set<string>();
  const re = /(\d{1,2})\s*C\.?\s*F\.?\s*R\.?\s*(?:§+|part|pt\.)?\s*(\d{1,4}(?:\.\d{1,4})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(`${m[1]} C.F.R. § ${m[2]}`);
  return Array.from(out).slice(0, 40);
}

/** "15 U.S.C. § 2607" / "28 USC 1407" → canonical "15 U.S.C. § 2607". */
export function extractUscCites(text: string): string[] {
  const out = new Set<string>();
  const re = /(\d{1,2})\s*U\.?\s*S\.?\s*C\.?\s*(?:A\.?\s*)?(?:§+)?\s*(\d{1,5}[a-z]?(?:\([a-z0-9]{1,3}\))*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(`${m[1]} U.S.C. § ${m[2]}`);
  return Array.from(out).slice(0, 40);
}

/** Reporter citations for case law ("487 U.S. 500", "357 F. Supp. 3d 1391"). */
export function extractReporterCites(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(\d{1,4})\s+(U\.S\.|S\.\s?Ct\.|F\.(?:2d|3d|4th)|F\.\s?Supp\.(?:\s?[23]d)?|F\.R\.D\.)\s+(\d{1,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(`${m[1]} ${m[2].replace(/\s+/g, " ")} ${m[3]}`);
  return Array.from(out).slice(0, 40);
}

// ---------------------------------------------------------------------------
// Series and anomalies
// ---------------------------------------------------------------------------

export interface SeriesPoint { t: string; v: number }

/** Count items into month buckets per group; every group shares the same month axis. */
export function bucketByMonth<T>(items: T[], opts: { date: (t: T) => string | undefined; group: (t: T) => string | string[] | undefined; from?: string; to?: string; fill?: boolean }): { months: string[]; series: IntelSeries[] } {
  const counts = new Map<string, Map<string, number>>();
  let min: string | undefined, max: string | undefined;
  for (const it of items) {
    const mk = monthKey(opts.date(it));
    if (!mk) continue;
    if (opts.from && mk < opts.from) continue;
    if (opts.to && mk > opts.to) continue;
    const g = opts.group(it);
    const groups = g == null ? [] : Array.isArray(g) ? g : [g];
    if (!groups.length) continue;
    if (!min || mk < min) min = mk;
    if (!max || mk > max) max = mk;
    for (const label of groups) {
      const s = counts.get(label) ?? new Map<string, number>();
      s.set(mk, (s.get(mk) ?? 0) + 1);
      counts.set(label, s);
    }
  }
  const months = min && max ? monthsBetween(opts.from ?? min, opts.to ?? max) : [];
  const series: IntelSeries[] = Array.from(counts.entries()).map(([label, s]) => ({ label, points: (opts.fill === false ? Array.from(s.keys()).sort() : months).map((t) => ({ t, v: s.get(t) ?? 0 })) }));
  series.sort((a, b) => sum(b.points) - sum(a.points) || a.label.localeCompare(b.label));
  return { months, series };
}

export function sum(points: SeriesPoint[]): number {
  return points.reduce((n, p) => n + p.v, 0);
}

export interface Anomaly { t: string; v: number; mean: number; sd: number; z: number; direction: "up" | "down" }

/**
 * Rolling z-score anomalies: each point is compared with the mean and standard
 * deviation of the preceding `window` points (at least `minHistory`). Points with
 * |z| >= threshold are returned; ties and zero-variance histories use a floor
 * so a single event after a quiet stretch does not explode.
 */
export function zScoreAnomalies(points: SeriesPoint[], opts: { window?: number; threshold?: number; minHistory?: number; sdFloor?: number } = {}): Anomaly[] {
  const window = opts.window ?? 6;
  const threshold = opts.threshold ?? 2;
  const minHistory = opts.minHistory ?? 3;
  const sdFloor = opts.sdFloor ?? 1;
  const out: Anomaly[] = [];
  for (let i = 0; i < points.length; i++) {
    const hist = points.slice(Math.max(0, i - window), i).map((p) => p.v);
    if (hist.length < minHistory) continue;
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
    const sd = Math.max(sdFloor, Math.sqrt(variance));
    const z = (points[i].v - mean) / sd;
    if (Math.abs(z) >= threshold) out.push({ t: points[i].t, v: points[i].v, mean: round(mean, 2), sd: round(sd, 2), z: round(z, 2), direction: z > 0 ? "up" : "down" });
  }
  return out;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Linear trend slope per month over the series (least squares), plus the share change between halves. */
export function seriesTrend(points: SeriesPoint[]): { slope: number; first: number; last: number; changePct: number | null } {
  const n = points.length;
  if (!n) return { slope: 0, first: 0, last: 0, changePct: null };
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
  const half = Math.floor(n / 2);
  const first = ys.slice(0, half || 1).reduce((a, b) => a + b, 0);
  const last = ys.slice(half).reduce((a, b) => a + b, 0);
  return { slope: round(num / den, 3), first, last, changePct: first > 0 ? round(((last - first) / first) * 100, 1) : null };
}

// ---------------------------------------------------------------------------
// Insight ranking
// ---------------------------------------------------------------------------

export interface RankContext {
  userId?: string;
  matterId?: string;
  teamId?: string;
  /** Matters the user works on (active). */
  activeMatterIds?: string[];
  /** Entity ids and query strings the user watches. */
  watchedTargets?: Set<string> | string[];
  now?: string | Date;
}

export interface InsightScore { score: number; recency: number; relevance: number; confidence: number; watch: number }

/**
 * recency × relevance × confidence × watch boost. Recency halves every 14
 * days; relevance is 1 for the requested matter/user, 0.7 for an active
 * matter, 0.45 for firm-wide items and 0.2 for other matters; watched
 * entities multiply by 1.5. Dismissed insights score 0.
 */
export function scoreInsight(insight: Pick<IntelInsight, "scope" | "confidence" | "status" | "updatedAt" | "createdAt" | "kind">, ctx: RankContext = {}): InsightScore {
  if (insight.status === "dismissed") return { score: 0, recency: 0, relevance: 0, confidence: 0, watch: 1 };
  const now = ctx.now ? new Date(ctx.now).getTime() : Date.now();
  const ageDays = Math.max(0, (now - new Date(insight.updatedAt ?? insight.createdAt).getTime()) / 86400_000);
  const recency = Math.pow(0.5, ageDays / 14);
  const active = new Set(ctx.activeMatterIds ?? []);
  const s = insight.scope;
  let relevance: number;
  if (ctx.matterId && s.matterId === ctx.matterId) relevance = 1;
  else if (ctx.userId && s.userId === ctx.userId) relevance = 1;
  else if (ctx.teamId && s.teamId === ctx.teamId) relevance = 0.85;
  else if (s.matterId && active.has(s.matterId)) relevance = 0.7;
  else if (!s.matterId && !s.userId && !s.teamId) relevance = 0.45;
  else if (ctx.matterId && s.matterId && s.matterId !== ctx.matterId) relevance = 0.1;
  else relevance = 0.2;
  const watched = ctx.watchedTargets instanceof Set ? ctx.watchedTargets : new Set(ctx.watchedTargets ?? []);
  const watch = s.entityIds.some((id) => watched.has(id)) ? 1.5 : 1;
  const confidence = Math.max(0.05, Math.min(1, insight.confidence));
  const kindWeight = insight.kind === "alert" || insight.kind === "anomaly" ? 1.15 : insight.kind === "digest" ? 0.9 : 1;
  return { score: round(recency * relevance * confidence * watch * kindWeight, 4), recency: round(recency, 3), relevance, confidence, watch };
}

export function rankInsightsPure<T extends Pick<IntelInsight, "scope" | "confidence" | "status" | "updatedAt" | "createdAt" | "kind">>(insights: T[], ctx: RankContext = {}, limit = 20): (T & { score: number })[] {
  return insights
    .map((i) => ({ ...i, score: scoreInsight(i, ctx).score }))
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Chronology merge (dedupe with the platform's timeline rules)
// ---------------------------------------------------------------------------

export interface MergeResult { entries: IntelTimelineEntry[]; merged: number }

/**
 * Merge timeline entries from several sources into one sorted chronology.
 * Entries on the same day with the same normalized title (or a near-identical
 * title, Jaccard ≥ 0.7) collapse into one; evidence is unioned and the
 * confidence takes the maximum. Uses the integrity dedupe rules so exports to
 * the e-discovery timeline stay idempotent.
 */
export function mergeTimelineEntries(lists: IntelTimelineEntry[][], opts: { threshold?: number } = {}): MergeResult {
  const kept: (IntelTimelineEntry & { id: string; date: string; title: string; sources: { cite?: string; id?: string }[] })[] = [];
  let merged = 0;
  for (const list of lists) {
    for (const e of list) {
      if (!e.at) continue;
      const incoming = { date: e.at, title: e.title, sources: e.evidence.map((ev) => ({ id: ev.docId, cite: ev.docId })) };
      const dup = findNearDuplicateEvent(kept, incoming, opts.threshold ?? 0.7);
      if (dup) {
        merged++;
        const seen = new Set(dup.evidence.map((ev) => `${ev.docId}|${ev.chunkId ?? ""}`));
        for (const ev of e.evidence) { const k = `${ev.docId}|${ev.chunkId ?? ""}`; if (!seen.has(k)) { dup.evidence.push(ev); seen.add(k); } }
        dup.confidence = Math.max(dup.confidence, e.confidence);
        if (!dup.detail && e.detail) dup.detail = e.detail;
        if (dup.title.length < e.title.length && tokenSimilarity(dup.title, e.title) >= 0.9) dup.title = e.title;
        continue;
      }
      kept.push({ ...e, evidence: [...e.evidence], id: `${eventDuplicateKey(incoming)}#${kept.length}`, date: e.at, title: e.title, sources: incoming.sources });
    }
  }
  const entries = kept.map(({ id: _id, date: _d, sources: _s, ...rest }) => { void _id; void _d; void _s; return rest as IntelTimelineEntry; }).sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title));
  return { entries, merged };
}

/** Stable key for an entry (date + normalized title), shared with the timeline dedupe. */
export function timelineEntryKey(e: Pick<IntelTimelineEntry, "at" | "title">): string {
  return eventDuplicateKey({ date: e.at, title: e.title });
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

export function fmtInt(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-US");
}

export function fmtPct(n: number | undefined | null, digits = 0): string {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Truncate to a word boundary with an ellipsis. */
export function clip(s: string | undefined | null, max = 160): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(40, cut.lastIndexOf(" ")))}…`;
}
