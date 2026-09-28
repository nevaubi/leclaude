import "server-only";
import { after } from "next/server";
import { generateJSON } from "@/lib/ai/agent";
import { AIConfigError } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { flushDb, remoteEnabled } from "@/lib/db/sync";
import { audit } from "@/lib/integrity/audit";
import type { Matter } from "@/lib/types/domain";
import { getWorkspace } from "@/lib/workspace";
import type { AutoconfigState, MatterIntelPlan, PlannedQuery, SourceChange } from "./autoconfig-types";
import { kickRunner } from "./background";
import { enqueueJob, runDue } from "./jobs";
import { ensureIntelSeeded, SEED_SOURCE_IDS } from "./seed";
import { listSources, updateSource, validateConfig } from "./service";
import type { IntelAdapterId, IntelSource } from "./types";

/**
 * Configure the intelligence sources from the firm's matters.
 *
 * Facts (docket numbers, MDL numbers, judges, courts, statute and CFR citations) come only from the matter
 * record, by regex and a deterministic court table; nothing is guessed. Search wording (case-law, regulatory,
 * statute and news queries, products) is proposed by the fast model over the matter record (privacy
 * "internal": matter data never goes to the external router), validated and tagged origin "model"; without a
 * model the wording falls back to record-derived rules. The plan is merged into the system sources
 * (union, never removal), enabled only where a source now has something to search, with modest per-run
 * volumes, then runs are enqueued (never executed inline here).
 */

export const AUTOCONFIG_KEY = "intel:autoconfig";
export const AUTO_FLAG_KEY = "intel:autoconfig:auto-v1";
const SYSTEM_ACTOR = { id: "svc_intel_autoconfig", name: "Intelligence setup (automatic)" };

// ---------------------------------------------------------------------------
// Facts from the matter record
// ---------------------------------------------------------------------------

/** Federal civil/criminal/MDL docket numbers: "2:24-cv-04055", "3:25-md-03140", "2:18-mn-02873". */
const DOCKET_RE = /\b\d{1,2}:\d{2}-[a-z]{1,4}-\d{3,6}\b/gi;
const MDL_RE = /\bMDL\s*(?:No\.?\s*)?(\d{3,4})\b/gi;
const USC_RE = /\b(\d{1,2})\s*U\.?\s?S\.?\s?C\.?\s*(?:§+\s*)?(\d+[a-z]?(?:-\d+)?)/gi;
const CFR_RE = /\b(\d{1,2})\s*C\.?\s?F\.?\s?R\.?\s*(?:§+\s*)?(\d{1,4}\.\d{1,5})\b/gi;

/**
 * Deterministic court table: text patterns in `court`/`jurisdiction`/caption → CourtListener court ids.
 * Unknown courts map to nothing (never guessed).
 */
const COURT_TABLE: [RegExp, string][] = [
  [/\bN\.\s?D\.\s?Cal\b|Northern District of California/i, "cand"],
  [/\bC\.\s?D\.\s?Cal\b|Central District of California/i, "cacd"],
  [/\bS\.\s?D\.\s?Cal\b|Southern District of California/i, "casd"],
  [/\bE\.\s?D\.\s?Cal\b|Eastern District of California/i, "caed"],
  [/\bD\.\s?S\.\s?C\.|District of South Carolina/i, "dsc"],
  [/\bD\.\s?D\.\s?C\.|District Court for the District of Columbia/i, "dcd"],
  [/\bD\.\s?N\.\s?J\.|District of New Jersey/i, "njd"],
  [/\bS\.\s?D\.\s?N\.\s?Y\.|Southern District of New York/i, "nysd"],
  [/\bE\.\s?D\.\s?N\.\s?Y\.|Eastern District of New York/i, "nyed"],
  [/\bN\.\s?D\.\s?Fla\b|Northern District of Florida/i, "flnd"],
  [/\bS\.\s?D\.\s?Fla\b|Southern District of Florida/i, "flsd"],
  [/\bM\.\s?D\.\s?Fla\b|Middle District of Florida/i, "flmd"],
  [/\bN\.\s?D\.\s?Ill\b|Northern District of Illinois/i, "ilnd"],
  [/\bD\.\s?Mass\b|District of Massachusetts/i, "mad"],
  [/\bD\.\s?Del\b|District of Delaware/i, "ded"],
  [/\bE\.\s?D\.\s?Pa\b|Eastern District of Pennsylvania/i, "paed"],
  [/\bW\.\s?D\.\s?Pa\b|Western District of Pennsylvania/i, "pawd"],
  [/\bN\.\s?D\.\s?Tex\b|Northern District of Texas/i, "txnd"],
  [/\bS\.\s?D\.\s?Tex\b|Southern District of Texas/i, "txsd"],
  [/\bE\.\s?D\.\s?Tex\b|Eastern District of Texas/i, "txed"],
  [/\bW\.\s?D\.\s?Tex\b|Western District of Texas/i, "txwd"],
  [/\bD\.\s?Minn\b|District of Minnesota/i, "mnd"],
  [/\bE\.\s?D\.\s?La\b|Eastern District of Louisiana/i, "laed"],
  [/\bW\.\s?D\.\s?Wash\b|Western District of Washington/i, "wawd"],
  [/\bN\.\s?D\.\s?Ohio\b|Northern District of Ohio/i, "ohnd"],
  [/\bS\.\s?D\.\s?Ohio\b|Southern District of Ohio/i, "ohsd"],
  [/\bD\.\s?Ariz\b|District of Arizona/i, "azd"],
  [/\bD\.\s?Colo\b|District of Colorado/i, "cod"],
  [/\b(?:1st|First)\s+Cir(?:cuit|\.)/i, "ca1"],
  [/\b(?:2d|2nd|Second)\s+Cir(?:cuit|\.)/i, "ca2"],
  [/\b(?:3d|3rd|Third)\s+Cir(?:cuit|\.)/i, "ca3"],
  [/\b(?:4th|Fourth)\s+Cir(?:cuit|\.)/i, "ca4"],
  [/\b(?:5th|Fifth)\s+Cir(?:cuit|\.)/i, "ca5"],
  [/\b(?:6th|Sixth)\s+Cir(?:cuit|\.)/i, "ca6"],
  [/\b(?:7th|Seventh)\s+Cir(?:cuit|\.)/i, "ca7"],
  [/\b(?:8th|Eighth)\s+Cir(?:cuit|\.)/i, "ca8"],
  [/\b(?:9th|Ninth)\s+Cir(?:cuit|\.)/i, "ca9"],
  [/\b(?:10th|Tenth)\s+Cir(?:cuit|\.)/i, "ca10"],
  [/\b(?:11th|Eleventh)\s+Cir(?:cuit|\.)/i, "ca11"],
  [/\bD\.\s?C\.\s+Cir(?:cuit|\.)|Court of Appeals for the District of Columbia Circuit/i, "cadc"],
  [/\bFed\.\s+Cir\.|Federal Circuit/i, "cafc"],
  [/(?:U\.\s?S\.|United States)\s+Supreme Court|Supreme Court of the United States|\bSCOTUS\b|^\s*Supreme Court\s*$/i, "scotus"],
  [/Judicial Panel on Multidistrict Litigation|\bJ\.\s?P\.\s?M\.\s?L\./i, "jpml"],
];

export function courtIdsFor(...texts: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const [re, id] of COURT_TABLE) if (re.test(t) && !out.includes(id)) out.push(id);
  }
  return out;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function uniqCI(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}

function matches(re: RegExp, text: string): RegExpMatchArray[] {
  return Array.from(text.matchAll(new RegExp(re.source, re.flags)));
}

/** The record text facts are read from: name, caption and description (not free-form tags or client). */
function recordText(m: Matter): string {
  return [m.name, m.shortName, m.caption, m.description].filter(Boolean).join("\n");
}

/** A judge named in the record, without honorifics/parentheticals; none when the record marks it fictional. */
function recordJudges(m: Matter): { judges: string[]; notes: string[] } {
  const raw = m.judge?.trim();
  if (!raw) return { judges: [], notes: [] };
  if (/\b(fictional|demo|synthetic|placeholder)\b/i.test(raw)) return { judges: [], notes: ["The judge on the matter record is marked fictional; no judge profile is watched."] };
  const name = raw.replace(/\(.*?\)/g, "").replace(/^(?:the\s+)?(?:hon\.?|honorable|judge|chief judge|magistrate judge)\s+/i, "").replace(/\s+/g, " ").trim();
  return { judges: name.length >= 4 && name.length <= 80 ? [name] : [], notes: [] };
}

export interface MatterFacts {
  dockets: string[];
  mdls: string[];
  judges: string[];
  courts: string[];
  statutes: string[];
  cfr: { title: number; section: string }[];
  notes: string[];
}

export function factsForMatter(m: Matter): MatterFacts {
  const text = recordText(m);
  const dockets = uniq(matches(DOCKET_RE, text).map((x) => x[0].toLowerCase()));
  const mdls = uniq(matches(MDL_RE, text).map((x) => x[1]));
  const { judges, notes } = recordJudges(m);
  const courts = courtIdsFor(m.court, m.jurisdiction, m.caption);
  const statutes = uniq(matches(USC_RE, text).map((x) => `${x[1]} U.S.C. ${x[2]}`));
  const cfrSeen = new Set<string>();
  const cfr: { title: number; section: string }[] = [];
  for (const x of matches(CFR_RE, text)) {
    const k = `${x[1]}:${x[2]}`;
    if (cfrSeen.has(k)) continue;
    cfrSeen.add(k);
    cfr.push({ title: Number(x[1]), section: x[2] });
  }
  if (!courts.length && (m.court || m.jurisdiction)) notes.push(`Court "${m.court ?? m.jurisdiction}" is not in the court table; case-law searches are not limited to a court for this matter.`);
  return { dockets, mdls, judges, courts, statutes, cfr, notes };
}

// ---------------------------------------------------------------------------
// Search wording: rules (no model) and model proposals
// ---------------------------------------------------------------------------

const GENERIC_TAGS = new Set(["demo", "synthetic", "class action", "litigation", "tracked", "regulatory", "active", "urgent"]);

/** The distinctive part of the matter name: "In re X Litigation (…) — DEMO" → "X". */
export function coreName(m: Matter): string {
  return m.name
    .replace(/\s+[—–-]+\s*(demo|demonstration|synthetic).*$/i, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/^in re:?\s*/i, "")
    .replace(/\s*\blitigation\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[,;:\s]+$/, "")
    .trim();
}

function quote(s: string): string {
  return `"${s.replace(/"/g, "").trim()}"`;
}

function ruleWording(m: Matter): Pick<MatterIntelPlan, "caseLaw" | "regulatory" | "statutes" | "news" | "products"> {
  const core = coreName(m);
  const tags = (m.tags ?? []).map((t) => t.trim()).filter((t) => t.length >= 3 && !GENERIC_TAGS.has(t.toLowerCase()));
  const caseLaw: PlannedQuery[] = [];
  if (core.length >= 4) caseLaw.push({ text: quote(core), origin: "rule" });
  if (tags.length >= 2) caseLaw.push({ text: tags.slice(0, 3).map(quote).join(" AND "), origin: "rule" });
  else if (tags.length === 1 && core.length >= 4) caseLaw.push({ text: `${quote(tags[0])} AND ${quote(core)}`, origin: "rule" });
  const news: PlannedQuery[] = core.length >= 4 ? [{ text: core.slice(0, 120), origin: "rule" }] : [];
  return { caseLaw: dedupeQueries(caseLaw), regulatory: [], statutes: [], news, products: [] };
}

interface ModelWording {
  caseLaw: string[];
  regulatory: string[];
  statutes: string[];
  news: string[];
  products: string[];
  cfrSections: { title: number; section: string }[];
}

const WORDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caseLaw", "regulatory", "statutes", "news", "products", "cfrSections"],
  properties: {
    caseLaw: { type: "array", items: { type: "string" }, description: "2-5 CourtListener opinion searches (boolean syntax, quoted phrases, AND/OR)." },
    regulatory: { type: "array", items: { type: "string" }, description: "0-3 Federal Register full-text searches; empty when no agency action is relevant." },
    statutes: { type: "array", items: { type: "string" }, description: "0-3 U.S. Code searches (a citation like '15 U.S.C. 2' or a short act name)." },
    news: { type: "array", items: { type: "string" }, description: "0-3 news searches." },
    products: { type: "array", items: { type: "string" }, description: "Drug, device or food products to watch for FDA recalls; empty unless the matter concerns an FDA-regulated product." },
    cfrSections: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "section"], properties: { title: { type: "integer" }, section: { type: "string" } } }, description: "CFR sections central to the matter (title number and section like '314.70'); empty when none." },
  },
} as const;

const INSTRUCTIONS = [
  "You configure legal-intelligence searches for one litigation matter at a law firm.",
  "Return search WORDING only. Facts such as docket numbers, MDL numbers, judges and courts are taken from the matter record by the application; never put docket numbers, MDL numbers, judge names, court names, court ids or field filters (docketNumber:, judge:, court_id:) in any query.",
  "Case-law queries use CourtListener syntax: quoted phrases, AND, OR, parentheses. Target the legal theories, doctrines and conduct at issue so new opinions on them surface; 2 to 5 queries.",
  "Regulatory queries target Federal Register rules/notices on the subject (0 to 3). Statute queries name U.S. Code provisions central to the claims (0 to 3). News queries are short plain phrases (0 to 3).",
  "Products only for drug, device or food matters (FDA recalls); otherwise empty. CFR sections only when you are certain of the exact section; otherwise empty.",
  "No URLs. Keep each query under 160 characters. Do not invent facts about the matter.",
].join("\n");

const URL_RE = /https?:|www\.|\.(?:com|org|gov|net)\b/i;
const FIELD_RE = /\b(?:docket_?number|docket_?id|judge|court_?id|court|case_?name|mdl)\s*:/i;

/** Drop model wording that smuggles in facts the record does not have. */
function wordingOk(text: string, facts: MatterFacts, maxLen: number): boolean {
  if (text.length < 3 || text.length > maxLen) return false;
  if (URL_RE.test(text) || FIELD_RE.test(text)) return false;
  if ((text.match(/"/g) ?? []).length % 2 !== 0) return false;
  for (const d of matches(DOCKET_RE, text)) if (!facts.dockets.includes(d[0].toLowerCase())) return false;
  for (const n of matches(MDL_RE, text)) if (!facts.mdls.includes(n[1])) return false;
  return true;
}

function dedupeQueries(qs: PlannedQuery[]): PlannedQuery[] {
  const seen = new Set<string>();
  return qs.filter((q) => {
    const k = q.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
}

export function validateWording(raw: unknown, facts: MatterFacts): { wording: Pick<MatterIntelPlan, "caseLaw" | "regulatory" | "statutes" | "news" | "products">; cfr: { title: number; section: string }[]; dropped: number } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let dropped = 0;
  const pick = (key: string, max: number, maxLen: number): PlannedQuery[] => {
    const all = strs(o[key]);
    const ok = all.filter((t) => wordingOk(t, facts, maxLen));
    dropped += all.length - ok.length;
    return dedupeQueries(ok.map((text) => ({ text, origin: "model" as const }))).slice(0, max);
  };
  const products = uniqCI(strs(o.products).filter((p) => {
    const ok = p.length >= 2 && p.length <= 80 && !URL_RE.test(p) && !FIELD_RE.test(p) && matches(DOCKET_RE, p).length === 0;
    if (!ok) dropped++;
    return ok;
  })).slice(0, 5);
  const cfr: { title: number; section: string }[] = [];
  if (Array.isArray(o.cfrSections)) {
    for (const s of o.cfrSections as unknown[]) {
      const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const title = typeof r.title === "number" ? r.title : Number(r.title);
      const section = typeof r.section === "string" ? r.section.replace(/^§\s*/, "").trim() : "";
      if (Number.isInteger(title) && title >= 1 && title <= 50 && /^\d{1,4}\.\d{1,5}$/.test(section)) {
        if (!cfr.some((c) => c.title === title && c.section === section)) cfr.push({ title, section });
      } else dropped++;
    }
  }
  return {
    wording: { caseLaw: pick("caseLaw", 5, 200), regulatory: pick("regulatory", 3, 160), statutes: pick("statutes", 3, 120), news: pick("news", 3, 120), products },
    cfr: cfr.slice(0, 5),
    dropped,
  };
}

function matterBrief(m: Matter, facts: MatterFacts): string {
  const rec = {
    name: m.name,
    shortName: m.shortName,
    caption: m.caption,
    court: m.court,
    jurisdiction: m.jurisdiction,
    practiceArea: m.practiceArea,
    clientSide: m.clientSide,
    stage: m.stage,
    description: m.description?.slice(0, 2500),
    tags: m.tags,
    keyDates: m.keyDates?.slice(0, 10),
  };
  return `Matter record (confidential):\n${JSON.stringify(rec, null, 2)}\n\nFacts already taken from the record (do not repeat in queries): courts=${facts.courts.join(", ") || "none"}; dockets=${facts.dockets.length}; MDLs=${facts.mdls.join(", ") || "none"}.`;
}

export interface PlanOptions {
  /** Use the model for wording (default true); false forces rules. */
  useModel?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Derive the searches for one matter. Never throws for model problems: falls back to rules. */
export async function planForMatter(m: Matter, opts: PlanOptions = {}): Promise<MatterIntelPlan> {
  const facts = factsForMatter(m);
  const notes = [...facts.notes];
  let method: MatterIntelPlan["method"] = "rules";
  let wording = ruleWording(m);
  let cfr = facts.cfr;
  if (opts.useModel !== false) {
    try {
      const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 25_000);
      const raw = await generateJSON<ModelWording>({ fast: true, privacy: "internal", matterId: m.id, taskType: "extract", instructions: INSTRUCTIONS, input: matterBrief(m, facts), schema: WORDING_SCHEMA as unknown as Record<string, unknown>, name: "matter_intel_searches", maxOutputTokens: 1500, signal });
      const v = validateWording(raw, facts);
      if (v.wording.caseLaw.length) {
        wording = v.wording;
        method = "model";
        cfr = [...facts.cfr, ...v.cfr.filter((c) => !facts.cfr.some((f) => f.title === c.title && f.section === c.section))];
        if (v.dropped) notes.push(`${v.dropped} proposed search${v.dropped === 1 ? "" : "es"} dropped by validation.`);
      } else notes.push("The model proposed no usable case-law searches; record-derived searches are used instead.");
    } catch (e) {
      if (!(e instanceof AIConfigError)) notes.push(`Model unavailable (${(e as Error).message.slice(0, 160)}); record-derived searches are used instead.`);
    }
  }
  const statutes = dedupeQueries([...facts.statutes.map((text) => ({ text, origin: "matter_record" as const })), ...wording.statutes]).slice(0, 5);
  const plan: MatterIntelPlan = {
    matterId: m.id,
    matterName: m.shortName || m.name,
    caseLaw: wording.caseLaw,
    courts: facts.courts,
    dockets: facts.dockets,
    mdls: facts.mdls,
    judges: facts.judges,
    regulatory: wording.regulatory,
    statutes,
    products: wording.products,
    news: wording.news,
    method,
    notes: notes.length ? notes : undefined,
  };
  if (cfr.length) plan.cfrSections = cfr;
  return plan;
}

export function activeMatters(ids?: string[]): Matter[] {
  const all = db().matters.all().filter((m) => m.status === "active");
  if (!ids) return all;
  const want = new Set(ids);
  return all.filter((m) => want.has(m.id));
}

/** Plan several matters with bounded concurrency. */
export async function planForMatters(matters: Matter[], opts: PlanOptions & { concurrency?: number } = {}): Promise<MatterIntelPlan[]> {
  const out: MatterIntelPlan[] = new Array(matters.length);
  let next = 0;
  const worker = async () => {
    while (next < matters.length) {
      const i = next++;
      out[i] = await planForMatter(matters[i], opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, matters.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const NEWS_KEYS = ["TAVILY_API_KEY", "FIRECRAWL_API_KEY"];
const newsConfigured = () => NEWS_KEYS.some((k) => Boolean(process.env[k]?.trim()));

/** Per-run volume settings written only where the source does not set them yet (user edits are kept). */
const VOLUME: Partial<Record<IntelAdapterId, Record<string, unknown>>> = {
  "courtlistener-opinions": { sinceDays: 90, maxResults: 5, fetchText: true, maxTextChars: 40_000 },
  "courtlistener-dockets": { maxEntries: 25, entrySinceDays: 90 },
  "courtlistener-judges": { maxJudges: 5 },
  "federal-register": { sinceDays: 60, maxResults: 5, fetchText: true, maxTextChars: 40_000 },
  govinfo: { maxResults: 3, fetchText: false },
  "openfda-recalls": { sinceDays: 90, maxResults: 10 },
  news: { sinceDays: 30, maxResults: 5 },
  ecfr: { maxResults: 5, maxTextChars: 40_000 },
  "jpml-mdls": { maxResults: 25 },
};

/** Document budget for the runs this apply starts. */
const RUN_MAX_DOCS = 40;

interface Additions {
  lists: Record<string, string[]>;
  courts: string[];
  sections: { title: number; section: string }[];
  matterIds: string[];
}

function emptyAdditions(): Additions {
  return { lists: {}, courts: [], sections: [], matterIds: [] };
}

function push(a: Additions, key: string, values: string[], matterId: string) {
  if (!values.length) return;
  a.lists[key] = [...(a.lists[key] ?? []), ...values];
  if (!a.matterIds.includes(matterId)) a.matterIds.push(matterId);
}

function additionsByAdapter(plans: MatterIntelPlan[]): Map<IntelAdapterId, Additions> {
  const m = new Map<IntelAdapterId, Additions>();
  const get = (id: IntelAdapterId) => { let a = m.get(id); if (!a) { a = emptyAdditions(); m.set(id, a); } return a; };
  for (const p of plans) {
    const op = get("courtlistener-opinions");
    push(op, "queries", p.caseLaw.map((q) => q.text), p.matterId);
    if (p.caseLaw.length) op.courts.push(...p.courts);
    push(get("courtlistener-dockets"), "docketNumbers", p.dockets, p.matterId);
    push(get("courtlistener-judges"), "names", p.judges, p.matterId);
    push(get("federal-register"), "queries", p.regulatory.map((q) => q.text), p.matterId);
    push(get("govinfo"), "queries", p.statutes.map((q) => q.text), p.matterId);
    push(get("openfda-recalls"), "products", p.products, p.matterId);
    push(get("news"), "queries", p.news.map((q) => q.text), p.matterId);
    push(get("jpml-mdls"), "watch", p.mdls, p.matterId);
    if (p.cfrSections?.length) {
      const e = get("ecfr");
      e.sections.push(...p.cfrSections);
      if (!e.matterIds.includes(p.matterId)) e.matterIds.push(p.matterId);
    }
  }
  return m;
}

const LABEL: Record<string, [string, string]> = {
  queries: ["query", "queries"],
  docketNumbers: ["docket", "dockets"],
  names: ["judge", "judges"],
  products: ["product", "products"],
  watch: ["MDL", "MDLs"],
};

const QUERY_LABEL: Partial<Record<IntelAdapterId, [string, string]>> = {
  "courtlistener-opinions": ["case-law query", "case-law queries"],
  "federal-register": ["regulatory query", "regulatory queries"],
  govinfo: ["statute query", "statute queries"],
  news: ["news query", "news queries"],
};

function plural(n: number, [one, many]: [string, string]) {
  return `+${n} ${n === 1 ? one : many}`;
}

function systemSourceFor(adapter: IntelAdapterId): IntelSource | null {
  const all = listSources({ adapter, system: true });
  const preferred = Object.values(SEED_SOURCE_IDS);
  return all.find((s) => preferred.includes(s.id)) ?? all[0] ?? null;
}

/** True when the (validated) config has something to search. */
function hasWork(adapter: IntelAdapterId, cfg: Record<string, unknown>): boolean {
  const n = (k: string) => (Array.isArray(cfg[k]) ? (cfg[k] as unknown[]).length : 0);
  switch (adapter) {
    case "courtlistener-opinions": case "federal-register": case "govinfo": case "news": return n("queries") > 0;
    case "courtlistener-dockets": return n("docketNumbers") > 0 || n("docketIds") > 0;
    case "courtlistener-judges": return n("names") > 0;
    case "openfda-recalls": return n("products") > 0 || n("firms") > 0 || n("labels") > 0;
    case "ecfr": return n("sections") > 0 || n("queries") > 0;
    case "jpml-mdls": return n("watch") > 0;
    default: return false;
  }
}

export interface ApplyOptions {
  run?: boolean;
  by?: { id: string; name: string };
  now?: Date;
}

export interface ApplyResult {
  state: AutoconfigState;
  plans: MatterIntelPlan[];
  changes: SourceChange[];
  jobs: { id: string; sourceId: string }[];
}

/**
 * Merge the plans into the system sources (union; nothing is removed), enable sources that now have
 * something to search, record the state, audit, and enqueue runs. Idempotent: a second apply of the same
 * plans changes no source and starts no run.
 */
export function applyPlans(plans: MatterIntelPlan[], opts: ApplyOptions = {}): ApplyResult {
  ensureIntelSeeded();
  const now = opts.now ?? new Date();
  const by = opts.by ?? SYSTEM_ACTOR;
  const changes: SourceChange[] = [];
  const jobs: { id: string; sourceId: string }[] = [];
  for (const [adapter, add] of additionsByAdapter(plans)) {
    const hasAdditions = Object.values(add.lists).some((v) => v.length) || add.sections.length > 0;
    if (!hasAdditions) continue;
    const src = systemSourceFor(adapter);
    if (!src) continue;
    const cur = { ...(src.config ?? {}) } as Record<string, unknown>;
    const next: Record<string, unknown> = { ...cur };
    const added: string[] = [];
    for (const [key, values] of Object.entries(add.lists)) {
      const existing = Array.isArray(cur[key]) ? (cur[key] as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const have = new Set(existing.map((x) => x.trim().toLowerCase()));
      const fresh = uniqCI(values).filter((v) => !have.has(v.toLowerCase()));
      if (!fresh.length) continue;
      next[key] = [...existing, ...fresh];
      added.push(plural(fresh.length, key === "queries" ? QUERY_LABEL[adapter] ?? LABEL.queries : LABEL[key] ?? [key, key]));
    }
    if (add.sections.length) {
      const existing = Array.isArray(cur.sections) ? (cur.sections as { title: number; section?: string; part?: string }[]) : [];
      const fresh = add.sections.filter((s, i, arr) => arr.findIndex((x) => x.title === s.title && x.section === s.section) === i && !existing.some((e) => e.title === s.title && e.section === s.section));
      if (fresh.length) { next.sections = [...existing, ...fresh]; added.push(plural(fresh.length, ["CFR section", "CFR sections"])); }
    }
    if (adapter === "courtlistener-opinions" && added.length && add.courts.length) {
      const have = typeof cur.courts === "string" ? cur.courts.split(/\s+/).filter(Boolean) : [];
      const fresh = uniq(add.courts).filter((c) => !have.includes(c));
      if (fresh.length) { next.courts = [...have, ...fresh].join(" "); added.push(plural(fresh.length, ["court", "courts"])); }
    }
    const scopeIds = src.scope?.matterIds ?? [];
    const newScope = added.length ? uniq([...scopeIds, ...add.matterIds]) : scopeIds;
    const skippedReason = adapter === "news" && !newsConfigured() ? "needs TAVILY_API_KEY or FIRECRAWL_API_KEY" : undefined;
    let enabledAfter = src.enabled;
    if (added.length) {
      for (const [k, v] of Object.entries(VOLUME[adapter] ?? {})) if (!(k in cur)) next[k] = v;
      const validated = validateConfig(adapter, next);
      if (!src.enabled && !skippedReason && hasWork(adapter, validated)) enabledAfter = true;
      updateSource(src.id, { config: validated, scope: { ...(src.scope ?? {}), matterIds: newScope }, ...(enabledAfter !== src.enabled ? { enabled: enabledAfter } : {}) }, now);
      if (opts.run && enabledAfter) {
        // New searches get their full look-back window, not the incremental window since the source's last success.
        const days = typeof validated.sinceDays === "number" ? validated.sinceDays : typeof validated.entrySinceDays === "number" ? validated.entrySinceDays : undefined;
        const since = days ? new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10) : undefined;
        const job = enqueueJob({ kind: "source.run", sourceId: src.id, payload: { trigger: "autoconfig", maxDocs: RUN_MAX_DOCS, ...(since ? { since } : {}) }, priority: 3, dedupeKey: `source.run:${src.id}` }, now);
        if (!jobs.some((j) => j.id === job.id)) jobs.push({ id: job.id, sourceId: src.id });
      }
    }
    changes.push({ sourceId: src.id, adapter, name: src.name, enabledBefore: src.enabled, enabledAfter, added, skippedReason, matterIds: newScope });
  }
  const prev = autoconfigState();
  const anyChange = changes.some((c) => c.added.length > 0 || c.enabledAfter !== c.enabledBefore);
  const state: AutoconfigState = { plans, changes, appliedAt: now.toISOString(), appliedBy: by.name, jobs: jobs.length ? jobs : anyChange ? [] : prev?.jobs ?? [] };
  db().kv.set(AUTOCONFIG_KEY, state);
  audit("settings.change", { kind: "intel", id: "autoconfig", label: "Intelligence sources configured from matters" }, {
    matters: plans.map((p) => p.matterId),
    methods: uniq(plans.map((p) => p.method)),
    changes: changes.filter((c) => c.added.length || c.enabledAfter !== c.enabledBefore).map((c) => ({ sourceId: c.sourceId, added: c.added, enabled: c.enabledAfter })),
    jobs: jobs.map((j) => j.id),
  }, by);
  if (jobs.length) {
    // A persistent host's in-process loop picks the jobs up; on serverless hosts that loop does not exist, so also
    // work the queue right after the response instead of leaving the runs for the next cron tick.
    try { kickRunner(); } catch { /* inline runner only */ }
    drainQueuedRunsSoon();
  }
  return { state, plans, changes, jobs };
}

/**
 * After the current response, run due jobs for a bounded time (the function's remaining budget) and persist the
 * results. Jobs hold leases, so this never double-runs work claimed by another worker; anything left over is picked
 * up by the next cron tick.
 */
export function drainQueuedRunsSoon(o: { deadlineMs?: number; limit?: number } = {}): void {
  const task = async () => {
    try {
      await runDue({ limit: o.limit ?? 10, deadlineMs: o.deadlineMs ?? 25_000, housekeeping: false });
      if (remoteEnabled()) await flushDb();
    } catch (e) {
      console.warn("[intel] could not run the configured sources now:", (e as Error).message);
    }
  };
  try {
    after(task);
  } catch {
    // Outside a request scope (tests, scripts): the in-process runner or the next tick handles the queue.
  }
}

export function autoconfigState(): AutoconfigState | null {
  return db().kv.get<AutoconfigState>(AUTOCONFIG_KEY);
}

/** Plan (and unless dryRun, apply) for the given or all active matters. */
export async function autoconfigure(o: { matterIds?: string[]; run?: boolean; dryRun?: boolean; by?: { id: string; name: string }; useModel?: boolean } = {}): Promise<ApplyResult> {
  const plans = await planForMatters(activeMatters(o.matterIds), { useModel: o.useModel });
  if (o.dryRun) return { state: autoconfigState() ?? { plans: [], changes: [], jobs: [] }, plans, changes: [], jobs: [] };
  return applyPlans(plans, { run: o.run ?? true, by: o.by });
}

// ---------------------------------------------------------------------------
// One-time automatic apply
// ---------------------------------------------------------------------------

interface AutoFlag { status: "running" | "applied" | "skipped" | "failed"; at: string; attempts: number; reason?: string; error?: string }

const LIST_KEYS = ["queries", "docketNumbers", "docketIds", "names", "products", "firms", "labels", "sections", "watch", "urls", "rules"];

/** True when any system source already carries searches someone entered (then the firm configured it; do not touch). */
function userConfiguredSources(): boolean {
  return listSources({ system: true }).some((s) => s.adapter !== "local-corpus" && LIST_KEYS.some((k) => Array.isArray(s.config?.[k]) && (s.config[k] as unknown[]).length > 0));
}

type G = typeof globalThis & { __leclaudeIntelAutoconfig?: Promise<AutoFlag | null> };

/**
 * Configure the sources from the matters once per workspace: when the flag is unset, at least one active
 * matter exists, the workspace is set up and no system source has searches yet. Sets the flag so it never
 * runs again (a failure is retried at most three times).
 */
export async function maybeAutoConfigure(o: { now?: Date; useModel?: boolean } = {}): Promise<AutoFlag | null> {
  const g = globalThis as G;
  if (g.__leclaudeIntelAutoconfig) return g.__leclaudeIntelAutoconfig;
  const p = (async (): Promise<AutoFlag | null> => {
    const kv = db().kv;
    const flag = kv.get<AutoFlag>(AUTO_FLAG_KEY);
    if (flag && !(flag.status === "failed" && flag.attempts < 3)) return null;
    if (!getWorkspace().configured) return null;
    ensureIntelSeeded();
    const matters = activeMatters();
    if (!matters.length) return null;
    const now = o.now ?? new Date();
    const attempts = (flag?.attempts ?? 0) + 1;
    if (userConfiguredSources()) {
      const f: AutoFlag = { status: "skipped", at: now.toISOString(), attempts, reason: "sources already have searches" };
      kv.set(AUTO_FLAG_KEY, f);
      return f;
    }
    kv.set(AUTO_FLAG_KEY, { status: "running", at: now.toISOString(), attempts } satisfies AutoFlag);
    try {
      const plans = await planForMatters(matters.slice(0, 25), { useModel: o.useModel });
      const r = applyPlans(plans, { run: true, by: SYSTEM_ACTOR, now });
      const f: AutoFlag = { status: "applied", at: new Date().toISOString(), attempts, reason: `${plans.length} matters, ${r.changes.filter((c) => c.added.length).length} sources, ${r.jobs.length} runs` };
      kv.set(AUTO_FLAG_KEY, f);
      console.log(`[intel] autoconfigured sources from matters: ${f.reason}`);
      return f;
    } catch (e) {
      const f: AutoFlag = { status: "failed", at: new Date().toISOString(), attempts, error: (e as Error).message.slice(0, 500) };
      kv.set(AUTO_FLAG_KEY, f);
      console.warn("[intel] autoconfigure failed:", f.error);
      return f;
    }
  })();
  g.__leclaudeIntelAutoconfig = p;
  try { return await p; } finally { g.__leclaudeIntelAutoconfig = undefined; }
}

/** Cheap synchronous check: true when the one-time apply may still be due. */
function autoConfigureMaybeDue(): boolean {
  try {
    const flag = db().kv.get<AutoFlag>(AUTO_FLAG_KEY);
    return !flag || (flag.status === "failed" && flag.attempts < 3);
  } catch {
    return false;
  }
}

/**
 * Non-blocking trigger for pages and the cron tick: after the response (next/server `after`), run
 * maybeAutoConfigure and persist its writes. Once the flag is set this is a single kv read.
 */
export function scheduleAutoConfigure(): void {
  if (!autoConfigureMaybeDue()) return;
  const task = async () => {
    try {
      const flag = await maybeAutoConfigure();
      // Start the first runs in this same background step (a nested after() is not dependable here).
      if (flag && autoconfigState()?.jobs.length) await runDue({ limit: 10, deadlineMs: 25_000, housekeeping: false });
      if (remoteEnabled()) await flushDb();
    } catch (e) {
      console.warn("[intel] autoconfigure failed:", (e as Error).message);
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}
