import "server-only";
import type { MatterScope } from "@/lib/auth/types";
import { db } from "@/lib/db";
import type { Deposition, EDocument, ProductionSet } from "@/lib/types/domain";
import { extractCitations, formatBates, parseBatesToken, parseCitation, reporterCiteKey, surnameOf, type ParsedCitation } from "./cite-parse";
import type { Citation, CitationCheck, CitationState, EvidenceRef } from "./types";

/**
 * Citation resolution against the record (constitution §23). Every lookup is confined to `scope.matterIds`; an
 * empty scope resolves nothing (it never widens to "all matters"). Outcomes:
 *
 *   resolved         exactly one record exists in scope AND the cited location is valid in it
 *   unresolved       no record, or the location is invalid (page beyond the transcript, Bates outside every range)
 *   requires_review  more than one candidate matches; the candidates are listed and none is picked
 *   excluded         the token is not a citation (a case-number prefix, a clock time)
 *   retried          a second attempt still found nothing
 *
 * There is no fallback. Nothing here ever returns "the first document".
 */
export interface ResolveOptions {
  /** The deposition a bare page:line or "Ex. 3" refers to when the artifact is about one transcript (explicit context, not a guess). */
  defaultDepositionId?: string;
}

const INTEL_DOCUMENTS = "intel_documents";
const PRODUCTIONS = "ediscovery_productions";
const SEARCH_RUNS = "search_runs";
const MAX_LINE = 25;

interface IntelDocLite {
  id: string;
  kind: string;
  title: string;
  citation?: string;
  url?: string;
  matterIds?: string[];
  hash?: string;
  meta?: Record<string, unknown>;
  caseName?: string;
  docketNumber?: string;
}

interface SearchRunLite {
  id: string;
  matterId?: string | null;
  topHits?: { id: string; source: string; title: string; cite?: string; citations?: string[]; url?: string }[];
}

function scopeLabel(scope: MatterScope): string {
  return scope.matterIds.length ? scope.matterIds.join(", ") : "(empty scope)";
}

function citation(raw: string, state: CitationState, extra: Partial<Citation> = {}): Citation {
  return { raw, state, ...extra };
}

function review(raw: string, candidates: string[], what: string): Citation {
  return citation(raw, "requires_review", { reason: `${candidates.length} ${what} match; none was chosen: ${candidates.join("; ")}`, locationValid: true });
}

// ---------------------------------------------------------------------------
// Bates
// ---------------------------------------------------------------------------

interface BatesCandidate { doc: EDocument; start: number; end: number; via?: string }

function batesCandidates(prefix: string, start: number, end: number | undefined, scope: MatterScope): { candidates: BatesCandidate[]; prefixSeen: boolean } {
  const d = db();
  const inScope = new Set(scope.matterIds);
  const candidates: BatesCandidate[] = [];
  let prefixSeen = false;
  const contains = (s: number, e: number) => s <= start && (end ?? start) <= e;
  for (const doc of d.edocs.all()) {
    if (!inScope.has(doc.matterId)) continue;
    const b = parseBatesToken(doc.bates);
    if (!b || b.prefix !== prefix) continue;
    prefixSeen = true;
    const e = doc.batesEnd ? parseBatesToken(doc.batesEnd)?.number ?? b.number : b.number;
    if (contains(b.number, e)) candidates.push({ doc, start: b.number, end: e });
  }
  for (const p of d.collection<ProductionSet>(PRODUCTIONS).all()) {
    if (!inScope.has(p.matterId)) continue;
    for (const [docId, range] of Object.entries(p.bates ?? {})) {
      const b = parseBatesToken(range.begin);
      const e = parseBatesToken(range.end)?.number ?? b?.number;
      if (!b || e == null || b.prefix !== prefix) continue;
      prefixSeen = true;
      if (!contains(b.number, e)) continue;
      const doc = d.edocs.get(docId);
      if (doc && inScope.has(doc.matterId) && !candidates.some((c) => c.doc.id === doc.id)) candidates.push({ doc, start: b.number, end: e, via: `production ${p.volume}` });
    }
  }
  return { candidates, prefixSeen };
}

function resolveBates(c: Extract<ParsedCitation, { type: "bates" }>, scope: MatterScope): Citation {
  if (c.excludedReason) return citation(c.raw, "excluded", { reason: c.excludedReason });
  const norm = formatBates(c.prefix, c.start, c.width) + (c.end != null ? ` – ${formatBates(c.prefix, c.end, c.width)}` : "");
  if (!scope.matterIds.length) return citation(c.raw, "unresolved", { reason: "empty matter scope: no matter is authorized for this lookup", locationValid: false });
  const { candidates, prefixSeen } = batesCandidates(c.prefix, c.start, c.end, scope);
  if (candidates.length === 0) {
    const reason = prefixSeen ? `Bates ${norm} is outside every ${c.prefix} document range in matter(s) ${scopeLabel(scope)}` : `Bates ${norm} is not in the record for matter(s) ${scopeLabel(scope)}`;
    return citation(c.raw, "unresolved", { reason, locationValid: false });
  }
  if (candidates.length > 1) return review(c.raw, candidates.map((x) => `${x.doc.id} (${x.doc.bates}${x.doc.batesEnd ? ` – ${x.doc.batesEnd}` : ""}${x.via ? `, ${x.via}` : ""})`), "documents");
  const { doc, start, via } = candidates[0];
  const ref: EvidenceRef = { kind: "document", id: doc.id, matterId: doc.matterId, title: doc.subject, bates: formatBates(c.prefix, c.start, c.width), batesEnd: c.end != null ? formatBates(c.prefix, c.end, c.width) : undefined, page: c.start - start + 1, hash: doc.hash, citation: norm };
  return citation(c.raw, "resolved", { ref, locationValid: true, reason: via ? `resolved via ${via}` : undefined });
}

// ---------------------------------------------------------------------------
// Depositions
// ---------------------------------------------------------------------------

function pageValid(dep: Deposition, page: number): boolean {
  if (dep.pages > 0) return page >= 1 && page <= dep.pages;
  if (dep.transcript?.length) return dep.transcript.some((q) => q.page === page);
  return false;
}

function depositionsInScope(scope: MatterScope): Deposition[] {
  const inScope = new Set(scope.matterIds);
  return db().depositions.find((d) => inScope.has(d.matterId));
}

function witnessMatches(dep: Deposition, witness: string): boolean {
  const cited = witness.trim().toLowerCase();
  const full = dep.witnessName.trim().toLowerCase();
  if (!cited) return false;
  if (cited === full) return true;
  const surname = surnameOf(witness);
  return surname.length > 1 && surnameOf(dep.witnessName) === surname;
}

function depLabel(d: Deposition): string {
  return `${d.id} (${d.witnessName}${d.volume ? `, vol. ${d.volume}` : ""}, ${d.pages} pp., ${d.status})`;
}

function resolveDeposition(c: Extract<ParsedCitation, { type: "deposition" }>, scope: MatterScope, opts: ResolveOptions): Citation {
  const loc = `${c.page}:${c.line}${c.pageEnd != null || c.lineEnd != null ? `–${c.pageEnd != null ? `${c.pageEnd}:` : ""}${c.lineEnd}` : ""}`;
  if (!scope.matterIds.length) return citation(c.raw, "unresolved", { reason: "empty matter scope: no matter is authorized for this lookup", locationValid: false });
  if (c.line < 1 || c.line > MAX_LINE || (c.lineEnd != null && (c.lineEnd < 1 || c.lineEnd > MAX_LINE))) return citation(c.raw, "unresolved", { reason: `line numbers in ${loc} are outside 1–${MAX_LINE}`, locationValid: false });
  const deps = depositionsInScope(scope);
  let candidates: Deposition[];
  if (c.witness) {
    candidates = deps.filter((d) => witnessMatches(d, c.witness));
    if (!candidates.length) return citation(c.raw, "unresolved", { reason: `no deposition of "${c.witness}" in matter(s) ${scopeLabel(scope)}`, locationValid: false });
  } else if (opts.defaultDepositionId) {
    candidates = deps.filter((d) => d.id === opts.defaultDepositionId);
    if (!candidates.length) return citation(c.raw, "unresolved", { reason: `deposition ${opts.defaultDepositionId} is not in matter(s) ${scopeLabel(scope)}`, locationValid: false });
  } else {
    return citation(c.raw, "unresolved", { reason: `page:line ${loc} names no witness and no deposition context was supplied`, locationValid: false });
  }
  if (c.volume != null) {
    const byVolume = candidates.filter((d) => d.volume === c.volume);
    if (!byVolume.length) return citation(c.raw, "unresolved", { reason: `no volume ${c.volume} among ${candidates.map(depLabel).join("; ")}`, locationValid: false });
    candidates = byVolume;
  }
  const valid = candidates.filter((d) => pageValid(d, c.page) && (c.pageEnd == null || pageValid(d, c.pageEnd)));
  if (valid.length === 0) {
    return citation(c.raw, "unresolved", { reason: `page ${c.pageEnd != null ? `${c.page}–${c.pageEnd}` : c.page} is not within ${candidates.map(depLabel).join("; ")}`, locationValid: false });
  }
  if (valid.length > 1) return review(c.raw, valid.map(depLabel), "depositions");
  const dep = valid[0];
  const ref: EvidenceRef = { kind: "deposition", id: dep.id, matterId: dep.matterId, depositionId: dep.id, witness: dep.witnessName, page: c.page, line: c.line, lineEnd: c.pageEnd == null || c.pageEnd === c.page ? c.lineEnd : undefined, title: `${dep.witnessName} deposition${dep.volume ? ` vol. ${dep.volume}` : ""}`, citation: `${dep.witnessName} Dep. ${loc}` };
  return citation(c.raw, "resolved", { ref, locationValid: true });
}

// ---------------------------------------------------------------------------
// Exhibits
// ---------------------------------------------------------------------------

function resolveExhibit(c: Extract<ParsedCitation, { type: "exhibit" }>, scope: MatterScope, opts: ResolveOptions): Citation {
  if (!scope.matterIds.length) return citation(c.raw, "unresolved", { reason: "empty matter scope: no matter is authorized for this lookup", locationValid: false });
  let deps = depositionsInScope(scope);
  if (c.witness) deps = deps.filter((d) => witnessMatches(d, c.witness!));
  else if (opts.defaultDepositionId) deps = deps.filter((d) => d.id === opts.defaultDepositionId);
  const wanted = new Set<string>([c.exhibit.toLowerCase()]);
  if (c.witness && /^\d+[a-z]?$/i.test(c.exhibit)) wanted.add(`${surnameOf(c.witness)}-${c.exhibit.toLowerCase()}`);
  const matches: { dep: Deposition; ex: NonNullable<Deposition["exhibits"]>[number] }[] = [];
  for (const dep of deps) {
    for (const ex of dep.exhibits ?? []) {
      const id = ex.id.toLowerCase();
      const tail = id.includes("-") ? id.slice(id.lastIndexOf("-") + 1) : id;
      const matchesBare = !c.witness && !opts.defaultDepositionId ? wanted.has(id) || (/^\d+[a-z]?$/i.test(c.exhibit) && tail === c.exhibit.toLowerCase()) : wanted.has(id) || (/^\d+[a-z]?$/i.test(c.exhibit) && tail === c.exhibit.toLowerCase());
      if (matchesBare) matches.push({ dep, ex });
    }
  }
  if (!matches.length) return citation(c.raw, "unresolved", { reason: `exhibit ${c.exhibit}${c.witness ? ` (${c.witness})` : ""} is not in any deposition in matter(s) ${scopeLabel(scope)}`, locationValid: false });
  if (matches.length > 1) return review(c.raw, matches.map((m) => `${m.dep.id} exhibit ${m.ex.id}`), "exhibits");
  const { dep, ex } = matches[0];
  const ref: EvidenceRef = { kind: "deposition", id: dep.id, matterId: dep.matterId, depositionId: dep.id, witness: dep.witnessName, exhibit: ex.id, bates: ex.bates, title: ex.description, citation: `${dep.witnessName} Ex. ${ex.id}` };
  return citation(c.raw, "resolved", { ref, locationValid: true });
}

// ---------------------------------------------------------------------------
// Docket entries
// ---------------------------------------------------------------------------

function intelDocs(): IntelDocLite[] {
  return db().collection<IntelDocLite>(INTEL_DOCUMENTS).all();
}

function resolveDocket(c: Extract<ParsedCitation, { type: "docket" }>, scope: MatterScope): Citation {
  if (!scope.matterIds.length) return citation(c.raw, "unresolved", { reason: "empty matter scope: no matter is authorized for this lookup", locationValid: false });
  const inScope = new Set(scope.matterIds);
  const matches = intelDocs().filter((d) => d.kind === "docket_entry" && Number(d.meta?.entryNumber) === c.entry && (d.matterIds ?? []).some((m) => inScope.has(m)));
  if (!matches.length) return citation(c.raw, "unresolved", { reason: `docket entry ${c.entry} is not in the record for matter(s) ${scopeLabel(scope)}`, locationValid: false });
  if (matches.length > 1) return review(c.raw, matches.map((m) => `${m.id} (${m.title})`), "docket entries");
  const doc = matches[0];
  const ref: EvidenceRef = { kind: "docket_entry", id: doc.id, matterId: (doc.matterIds ?? []).find((m) => inScope.has(m)), title: doc.title, url: doc.url, hash: doc.hash, citation: `ECF No. ${c.entry}` };
  return citation(c.raw, "resolved", { ref, locationValid: true });
}

// ---------------------------------------------------------------------------
// Reporter citations (authorities)
// ---------------------------------------------------------------------------

function resolveReporter(c: Extract<ParsedCitation, { type: "reporter" }>, scope: MatterScope): Citation {
  const key = c.key.replace(/^rep:/, "").replace(/:\d+$/, "");
  const inScope = new Set(scope.matterIds);
  const norm = `${c.volume} ${c.reporter} ${c.page}`;
  // 1. Intel opinion records (the canonical authority store).
  const opinions = intelDocs().filter((d) => {
    if (d.kind !== "opinion") return false;
    if ((d.matterIds ?? []).length && !(d.matterIds ?? []).some((m) => inScope.has(m))) return false;
    const cites = [d.citation, ...((d.meta?.citations as string[] | undefined) ?? [])].filter((x): x is string => typeof x === "string");
    return cites.some((x) => reporterCiteKey(x) === key);
  });
  if (opinions.length > 1) return review(c.raw, opinions.map((o) => `${o.id} (${o.title})`), "opinion records");
  if (opinions.length === 1) {
    const o = opinions[0];
    return citation(c.raw, "resolved", { ref: { kind: "opinion", id: o.id, authorityId: o.id, title: o.caseName ?? o.title, url: o.url, hash: o.hash, citation: norm, page: c.pin }, locationValid: true });
  }
  // 2. Cached research hits (provider results the research engine already retrieved).
  const hits = new Map<string, { id: string; title: string; url?: string }>();
  for (const run of db().collection<SearchRunLite>(SEARCH_RUNS).all()) {
    if (run.matterId && !inScope.has(run.matterId)) continue;
    for (const h of run.topHits ?? []) {
      const cites = [h.cite, ...(h.citations ?? [])].filter((x): x is string => typeof x === "string");
      if (cites.some((x) => reporterCiteKey(x) === key)) hits.set(h.id, { id: h.id, title: h.title, url: h.url });
    }
  }
  if (hits.size > 1) return review(c.raw, Array.from(hits.values()).map((h) => `${h.id} (${h.title})`), "cached authorities");
  if (hits.size === 1) {
    const h = Array.from(hits.values())[0];
    return citation(c.raw, "resolved", { ref: { kind: "opinion", id: h.id, authorityId: h.id, title: h.title, url: h.url, citation: norm, page: c.pin }, locationValid: true });
  }
  // 3. Library items that carry the citation (saved research links, notes).
  const stripped = key;
  const items = db().library.find((it) => (!it.matterId || inScope.has(it.matterId)) && (it.type === "link" || it.type === "note") && [it.name, it.description, it.content].some((t) => typeof t === "string" && containsCite(t, stripped)));
  if (items.length > 1) return review(c.raw, items.map((i) => `${i.id} (${i.name})`), "library items");
  if (items.length === 1) {
    const it = items[0];
    return citation(c.raw, "resolved", { ref: { kind: "library", id: it.id, title: it.name, url: it.url, citation: norm, page: c.pin }, locationValid: true });
  }
  return citation(c.raw, "unresolved", { reason: `authority ${norm} is not in the local record (intel opinions, cached research, library); verify it against a primary source before relying on it`, locationValid: false });
}

function containsCite(text: string, key: string): boolean {
  const re = /\b(\d{1,4})\s+([A-Z][\w.'\s]*?\.)\s*(?:(?:2d|3d|4th|5th)\s+)?(\d{1,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const k = reporterCiteKey(m[0]);
    if (k === key) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function resolveParsed(c: ParsedCitation, scope: MatterScope, opts: ResolveOptions = {}): Citation {
  switch (c.type) {
    case "bates": return resolveBates(c, scope);
    case "deposition": return resolveDeposition(c, scope, opts);
    case "exhibit": return resolveExhibit(c, scope, opts);
    case "docket": return resolveDocket(c, scope);
    case "reporter": return resolveReporter(c, scope);
    default: return citation(c.raw, "unresolved", { reason: "unrecognized citation format", locationValid: false });
  }
}

/** Resolve one citation string against the record within `scope`. */
export function resolveCitation(raw: string, scope: MatterScope, opts: ResolveOptions = {}): Citation {
  return resolveParsed(parseCitation(raw), scope, opts);
}

/** Every citation in `text`, resolved. */
export function resolveCitationsIn(text: string, scope: MatterScope, opts: ResolveOptions = {}): Citation[] {
  return extractCitations(text).map((c) => resolveParsed(c, scope, opts));
}

/** Re-attempt an unresolved citation (after an index refresh, an import); still-missing cites become `retried`. */
export function retryCitation(c: Citation, scope: MatterScope, opts: ResolveOptions = {}): Citation {
  if (c.state === "resolved" || c.state === "excluded") return c;
  const again = resolveCitation(c.raw, scope, opts);
  if (again.state === "unresolved") return { ...again, state: "retried", reason: `retried: ${again.reason ?? "still unresolved"}` };
  return again;
}

/** The citation check for an artifact: counts by state, bound to the artifact hash it was computed against. */
export function checkCitations(text: string, scope: MatterScope, artifactHash: string, opts: ResolveOptions = {}): CitationCheck {
  const citations = resolveCitationsIn(text, scope, opts);
  const count = (s: CitationState) => citations.filter((c) => c.state === s).length;
  return {
    artifactHash,
    checkedAt: new Date().toISOString(),
    citations,
    resolved: count("resolved"),
    unresolved: count("unresolved") + count("retried"),
    excluded: count("excluded"),
    requiresReview: count("requires_review"),
  };
}
