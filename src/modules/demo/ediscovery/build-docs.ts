import type { EDocument } from "@/lib/types/domain";
import { fakeHash } from "@/modules/ediscovery/seed-helpers";
import { detectNearDuplicates, nearDuplicateMap } from "@/modules/ediscovery/near-dup";
import { formatBates } from "@/modules/ediscovery/query";
import type { DocSpec } from "./doc-spec";
import { KEY_DOCS_A } from "./docs-key-a";
import { KEY_DOCS_B } from "./docs-key-b";
import { PRIVILEGED_DOCS } from "./docs-privileged";
import { buildGeneratedSpecs } from "./docs-generated";
import { APPLE_DEMO_BATES_PREFIX, APPLE_DEMO_BATES_WIDTH, BY_NAME, CUST, CUSTODIAN_ORDER, M, addr, tagged } from "./people";

/** Line appended to every document so an exported or printed page can never pass for a real record. */
export const SYNTHETIC_FOOTER = "[Synthetic demonstration record — fictional content]";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function emailDate(date: string, time = "09:00"): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${time}:00 -0800`;
}

export function allSpecs(): DocSpec[] {
  return [...KEY_DOCS_A, ...KEY_DOCS_B, ...PRIVILEGED_DOCS, ...buildGeneratedSpecs()];
}

/** Resolve exact duplicates: a duplicate carries the original's content under another custodian. */
function resolveDuplicates(specs: DocSpec[]): DocSpec[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  return specs.map((s) => {
    if (!s.dupOf) return s;
    const o = byId.get(s.dupOf);
    if (!o) throw new Error(`demo corpus: ${s.id} duplicates unknown ${s.dupOf}`);
    return { ...s, type: o.type, subject: o.subject, from: o.from ?? CUST[o.cust].name, to: o.to, cc: o.cc, body: o.body, pages: o.pages, time: o.time, date: o.date, aiSummary: o.aiSummary, aiIssues: o.aiIssues, aiScore: o.aiScore, coding: s.coding ?? o.coding, entities: o.entities };
  });
}

/** Production order: custodian, then date, with attachments immediately after their parent email. */
function order(specs: DocSpec[]): DocSpec[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const custRank = (k: DocSpec["cust"]) => CUSTODIAN_ORDER.indexOf(k);
  const roots = specs.filter((s) => !s.parent).sort((a, b) => custRank(a.cust) - custRank(b.cust) || a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id));
  const out: DocSpec[] = [];
  for (const r of roots) {
    out.push(r);
    for (const a of r.attachments ?? []) {
      const s = byId.get(a);
      if (!s) throw new Error(`demo corpus: ${r.id} lists unknown attachment ${a}`);
      if (s.parent !== r.id) throw new Error(`demo corpus: attachment ${a} does not point back to ${r.id}`);
      out.push(s);
    }
  }
  if (out.length !== specs.length) throw new Error(`demo corpus: ${specs.length - out.length} attachment(s) without a parent listing`);
  return out;
}

const cleanOrg = (org: string) => org.replace(/\s*\((demo|fictional)\)\s*$/i, "");

function textFor(s: DocSpec): string {
  const body = s.body.trim();
  if (s.type !== "Email") return `${body}\n\n${SYNTHETIC_FOOTER}`;
  const header = [
    `From: ${addr(s.from ?? CUST[s.cust].name)}`,
    `To: ${(s.to ?? []).map(addr).join("; ")}`,
    s.cc?.length ? `Cc: ${s.cc.map(addr).join("; ")}` : null,
    `Date: ${emailDate(s.date, s.time)}`,
    `Subject: ${s.subject}`,
    s.attachments?.length ? `Attachments: ${s.attachments.length}` : null,
  ].filter(Boolean).join("\n");
  return `${header}\n\n${body}\n\n${SYNTHETIC_FOOTER}`;
}

/** Build the whole review set (pure and deterministic). */
export function buildCorpus(): EDocument[] {
  const specs = order(resolveDuplicates(allSpecs()));
  const specById = new Map(specs.map((s) => [s.id, s]));
  const ids = new Set<string>();
  for (const s of specs) { if (ids.has(s.id)) throw new Error(`demo corpus: duplicate id ${s.id}`); ids.add(s.id); }
  let n = 1;
  const hashes = new Map<string, string>();
  const docs: EDocument[] = specs.map((s) => {
    const pages = Math.max(1, s.pages ?? (s.body.match(/\f/g)?.length ?? 0) + 1);
    const bates = formatBates(APPLE_DEMO_BATES_PREFIX, n, APPLE_DEMO_BATES_WIDTH);
    const batesEnd = pages > 1 ? formatBates(APPLE_DEMO_BATES_PREFIX, n + pages - 1, APPLE_DEMO_BATES_WIDTH) : undefined;
    n += pages;
    const cust = CUST[s.cust];
    // An exact duplicate is byte-identical to its original (same header, attachment line and body).
    const text = textFor(s.dupOf ? specById.get(s.dupOf)! : s);
    const hashKey = s.dupOf ?? s.id;
    const hash = hashes.get(hashKey) ?? fakeHash(`${M}:${text}`);
    hashes.set(hashKey, hash);
    const names = Array.from(new Set([s.from ?? cust.name, ...(s.to ?? []), ...(s.cc ?? [])].filter(Boolean)));
    const orgs = Array.from(new Set(names.map((x) => BY_NAME.get(x)?.org).filter((x): x is string => !!x).map(cleanOrg)));
    const family = s.thread || s.parent || s.attachments?.length ? { ...(s.thread ? { threadId: s.thread } : {}), ...(s.parent ? { parentId: s.parent } : {}), ...(s.attachments?.length ? { attachmentIds: s.attachments } : {}) } : undefined;
    const doc: EDocument = {
      id: s.id, matterId: M, bates, ...(batesEnd ? { batesEnd } : {}), date: s.date, custodianId: cust.id, custodianName: cust.name, type: s.type, subject: s.subject,
      ...(s.from || s.type === "Email" ? { from: s.from ?? cust.name } : {}),
      ...(s.to?.length ? { to: s.to } : {}), ...(s.cc?.length ? { cc: s.cc } : {}),
      text, pages, ...(family ? { family } : {}), hash,
      ...(s.aiScore != null ? { aiScore: s.aiScore } : {}), ...(s.aiSummary ? { aiSummary: s.aiSummary } : {}), ...(s.aiIssues ? { aiIssues: s.aiIssues } : {}),
      entities: s.entities ?? { people: names, orgs, places: [] },
      coding: { responsive: null, privileged: null, issues: [], ...(s.coding ?? {}) },
      ...(s.dupOf ? { isDuplicateOf: s.dupOf } : {}),
      source: `${cust.name} custodial collection (synthetic demo)`,
      ...(s.tags?.length ? { tags: s.tags } : {}),
    };
    return tagged(doc);
  });
  // Near-duplicates (MinHash, same detector the app runs), excluding exact duplicates and shared hashes.
  const byId = new Map(docs.map((d) => [d.id, d]));
  const res = detectNearDuplicates(docs.filter((d) => !d.isDuplicateOf).map((d) => ({ id: d.id, text: d.text })), { threshold: 0.5 });
  const map = nearDuplicateMap(res.pairs.filter((p) => byId.get(p.a)?.hash !== byId.get(p.b)?.hash));
  return docs.map((d) => {
    const found = map.get(d.id);
    if (!found || !Object.keys(found).length) return d;
    const idsSorted = Object.keys(found).sort();
    const scores: Record<string, number> = {};
    for (const id of idsSorted) scores[id] = Math.round(found[id] * 1000) / 1000;
    return { ...d, nearDuplicateIds: idsSorted, nearDuplicateScores: scores };
  });
}
