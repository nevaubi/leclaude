/**
 * Query helpers for the CourtListener / Elasticsearch-style syntax used by the
 * case-law and docket providers. Also normalizes Westlaw/Lexis operators
 * (/s, /p, /n, &, %, !) that lawyers type by habit. Client-safe.
 */

export interface QueryBuilderInput {
  all?: string[]; // AND terms
  any?: string[]; // OR terms (grouped)
  none?: string[]; // NOT terms
  phrases?: string[]; // exact phrases
  proximity?: { a: string; b: string; within: number }[];
  fields?: { caseName?: string; judge?: string; docketNumber?: string; citation?: string };
}

const SENTENCE_WINDOW = 15; // Westlaw /s ≈ same sentence
const PARAGRAPH_WINDOW = 50; // Westlaw /p ≈ same paragraph

function quoteIfNeeded(term: string) {
  const t = term.trim();
  if (!t) return "";
  if (/^".*"$/.test(t)) return t;
  return /\s/.test(t) ? `"${t}"` : t;
}

/** Build a boolean query string from structured parts. */
export function buildQuery(input: QueryBuilderInput): string {
  const parts: string[] = [];
  for (const p of input.phrases ?? []) { const t = p.trim().replace(/^"|"$/g, ""); if (t) parts.push(`"${t}"`); }
  for (const t of input.all ?? []) { const q = quoteIfNeeded(t); if (q) parts.push(q); }
  const any = (input.any ?? []).map(quoteIfNeeded).filter(Boolean);
  if (any.length === 1) parts.push(any[0]);
  else if (any.length > 1) parts.push(`(${any.join(" OR ")})`);
  for (const p of input.proximity ?? []) {
    const a = p.a.trim().replace(/^"|"$/g, ""), b = p.b.trim().replace(/^"|"$/g, "");
    if (a && b) parts.push(`"${a} ${b}"~${Math.max(1, Math.round(p.within || SENTENCE_WINDOW))}`);
  }
  const f = input.fields ?? {};
  if (f.caseName?.trim()) parts.push(`caseName:(${f.caseName.trim()})`);
  if (f.judge?.trim()) parts.push(`judge:(${f.judge.trim()})`);
  if (f.docketNumber?.trim()) parts.push(`docketNumber:${quoteIfNeeded(f.docketNumber)}`);
  if (f.citation?.trim()) parts.push(`citation:(${quoteIfNeeded(f.citation)})`);
  let q = parts.join(" AND ");
  const none = (input.none ?? []).map(quoteIfNeeded).filter(Boolean);
  if (none.length) q = `${q}${q ? " " : ""}${none.map((n) => `NOT ${n}`).join(" ")}`;
  return q.trim();
}

/**
 * Normalize a hand-typed query to CourtListener syntax:
 *  - `a /s b`  → `"a b"~15`, `a /p b` → `"a b"~50`, `a /5 b` → `"a b"~5`
 *  - `a & b` → `a AND b`, `a % b` → `a NOT b`, `warn!` → `warn*`
 *  - lower-case `and/or/not` between terms are upper-cased
 */
export function toCourtListenerSyntax(raw: string): string {
  let q = raw.replace(/\s+/g, " ").trim();
  if (!q) return "";
  // proximity: X /s Y, X /p Y, X /n Y (X and Y are single terms or quoted phrases)
  const term = `("[^"]+"|[^\\s()]+)`;
  const prox = new RegExp(`${term}\\s+/(s|p|\\d+)\\s+${term}`, "gi");
  let guard = 0;
  while (prox.test(q) && guard++ < 20) {
    q = q.replace(prox, (_m, a: string, op: string, b: string) => {
      const n = op.toLowerCase() === "s" ? SENTENCE_WINDOW : op.toLowerCase() === "p" ? PARAGRAPH_WINDOW : Math.max(1, parseInt(op, 10));
      const clean = (s: string) => s.replace(/^"|"$/g, "");
      return `"${clean(a)} ${clean(b)}"~${n}`;
    });
  }
  q = q.replace(/\s&\s/g, " AND ").replace(/\s%\s/g, " NOT ");
  q = q.replace(/(\w)!(?=\s|$|\))/g, "$1*");
  // upper-case boolean words outside quotes
  q = q.replace(/("[^"]*")|\b(and|or|not)\b/g, (m, quoted: string | undefined, op: string | undefined) => (quoted ? quoted : op ? op.toUpperCase() : m));
  return q;
}

/** Terms and phrases for snippet highlighting (operators stripped). */
export function extractTerms(query: string): string[] {
  const out: string[] = [];
  const phraseRe = /"([^"]+)"(?:~\d+)?/g;
  let m: RegExpExecArray | null;
  let rest = query;
  while ((m = phraseRe.exec(query))) {
    out.push(m[1].trim());
    rest = rest.replace(m[0], " ");
  }
  for (const tok of rest.split(/\s+/)) {
    const t = tok.replace(/^[()\-+]+|[()*~]+$/g, "").replace(/^[a-zA-Z_]+:/, "").trim();
    if (!t || /^(AND|OR|NOT|and|or|not)$/.test(t) || /^\/(s|p|\d+)$/i.test(t) || t.length < 3) continue;
    out.push(t);
  }
  return Array.from(new Set(out.map((t) => t.toLowerCase()))).sort((a, b) => b.length - a.length);
}

/** Split a query into a light-weight structure for the builder UI. */
export function parseQuery(query: string): QueryBuilderInput {
  const phrases: string[] = [];
  const all: string[] = [];
  const none: string[] = [];
  const any: string[] = [];
  const proximity: { a: string; b: string; within: number }[] = [];
  const q = toCourtListenerSyntax(query);
  const tokenRe = /("[^"]+"~\d+)|("[^"]+")|(\([^)]*\))|(\S+)/g;
  let m: RegExpExecArray | null;
  let negateNext = false;
  while ((m = tokenRe.exec(q))) {
    const tok = m[0];
    if (/^(AND)$/i.test(tok)) continue;
    if (/^(NOT)$/i.test(tok)) { negateNext = true; continue; }
    if (/^(OR)$/i.test(tok)) continue;
    if (m[1]) {
      const mm = tok.match(/^"([^"]+)"~(\d+)$/);
      if (mm) { const words = mm[1].split(/\s+/); proximity.push({ a: words[0], b: words.slice(1).join(" "), within: parseInt(mm[2], 10) }); }
      continue;
    }
    if (m[2]) { (negateNext ? none : phrases).push(tok.replace(/^"|"$/g, "")); negateNext = false; continue; }
    if (m[3]) {
      const inner = tok.slice(1, -1);
      if (/\sOR\s/i.test(inner)) any.push(...inner.split(/\sOR\s/i).map((s) => s.trim().replace(/^"|"$/g, "")));
      else all.push(inner);
      continue;
    }
    const t = tok.startsWith("-") ? tok.slice(1) : tok;
    if (tok.startsWith("-") || negateNext) none.push(t); else all.push(t);
    negateNext = false;
  }
  return { all, any, none, phrases, proximity };
}

/** Highlight query terms in a snippet: returns segments so React can render marks without dangerouslySetInnerHTML. */
export function highlightSegments(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (!text) return [];
  const clean = terms.map((t) => t.trim()).filter((t) => t.length >= 3);
  if (!clean.length) return [{ text, hit: false }];
  const re = new RegExp(`(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

/** Date preset → ISO bounds. */
export function datePresetRange(preset: "any" | "1y" | "5y" | "10y" | "custom", custom: { from?: string; to?: string } = {}, now = new Date()): { from?: string; to?: string } {
  if (preset === "any") return {};
  if (preset === "custom") return { from: custom.from || undefined, to: custom.to || undefined };
  const years = preset === "1y" ? 1 : preset === "5y" ? 5 : 10;
  const from = new Date(now);
  from.setFullYear(from.getFullYear() - years);
  return { from: from.toISOString().slice(0, 10) };
}
