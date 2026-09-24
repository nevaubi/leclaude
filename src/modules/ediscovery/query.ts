/**
 * Review search query language (pure, client-safe, unit-tested).
 *
 *   toxicology AND (rat OR bioassay) NOT marketing
 *   "monitoring well" custodian:hale type:email date:2002-07
 *   MFC-0041877–MFC-0041999            (Bates range, en dash, hyphen or "to")
 *   from:kaine date:2001-03-01..2001-03-31   -draft
 *
 * Adjacent terms are implicitly AND-ed. `-term` is NOT. Field prefixes:
 * custodian:, type:, from:, to:, cc:, subject:, date:, bates:, issue:, tag:, hash:.
 */

export type QueryNode =
  | { kind: "term"; value: string; phrase: boolean }
  | { kind: "and"; children: QueryNode[] }
  | { kind: "or"; children: QueryNode[] }
  | { kind: "not"; child: QueryNode }
  | { kind: "field"; field: QueryField; value: string }
  | { kind: "bates"; start: BatesNumber; end: BatesNumber }
  | { kind: "date"; from?: string; to?: string }
  | { kind: "empty" };

export type QueryField = "custodian" | "type" | "from" | "to" | "cc" | "subject" | "date" | "bates" | "issue" | "tag" | "hash" | "id";
const FIELDS: QueryField[] = ["custodian", "type", "from", "to", "cc", "subject", "date", "bates", "issue", "tag", "hash", "id"];

export interface BatesNumber { prefix: string; number: number; width: number; raw: string }

export interface ParsedQuery {
  ast: QueryNode;
  terms: string[]; // positive terms/phrases for highlighting
  fields: { field: QueryField; value: string }[];
  bates: { start: BatesNumber; end: BatesNumber }[];
  warnings: string[];
  raw: string;
}

// ---------------------------------------------------------------------------
// Bates numbers
// ---------------------------------------------------------------------------

const BATES_RE = /^([A-Za-z]{2,8})[-_ ]?(\d{4,10})$/;

export function parseBates(raw: string): BatesNumber | null {
  const m = raw.trim().match(BATES_RE);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: Number(m[2]), width: m[2].length, raw: raw.trim() };
}

export function formatBates(prefix: string, number: number, width = 7) {
  return `${prefix}-${String(number).padStart(width, "0")}`;
}

/** Compare two Bates numbers of the same prefix; different prefixes sort by prefix. */
export function compareBates(a: string, b: string): number {
  const pa = parseBates(a);
  const pb = parseBates(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  return pa.number - pb.number;
}

/**
 * Parse "MFC-0041877–MFC-0041999", "MFC-0041877 - MFC-0041999", "MFC-0041877 to 0041999",
 * "MFC-0041877-0041999" or a single Bates number (start == end).
 */
export function parseBatesRange(raw: string): { start: BatesNumber; end: BatesNumber } | null {
  const s = raw.trim().replace(/\s+/g, " ");
  const single = parseBates(s);
  if (single) return { start: single, end: single };
  const m = s.match(/^([A-Za-z]{2,8}[-_ ]?\d{4,10})\s*(?:–|—|-|to|\.\.)\s*((?:[A-Za-z]{2,8}[-_ ]?)?\d{4,10})$/i);
  if (!m) return null;
  const start = parseBates(m[1]);
  if (!start) return null;
  const end = parseBates(m[2]) ?? { prefix: start.prefix, number: Number(m[2]), width: m[2].length, raw: m[2] };
  if (end.prefix !== start.prefix) return null;
  if (end.number < start.number) return { start: end, end: start };
  return { start, end };
}

export function batesInRange(bates: string, range: { start: BatesNumber; end: BatesNumber }, batesEnd?: string) {
  const b = parseBates(bates);
  if (!b || b.prefix !== range.start.prefix) return false;
  const lo = b.number;
  const hi = batesEnd ? (parseBates(batesEnd)?.number ?? lo) : lo;
  return hi >= range.start.number && lo <= range.end.number;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "and" }
  | { t: "or" }
  | { t: "not" }
  | { t: "phrase"; v: string }
  | { t: "word"; v: string }
  | { t: "field"; f: QueryField; v: string }
  | { t: "bates"; start: BatesNumber; end: BatesNumber };

const RANGE_RE = /^([A-Za-z]{2,8}[-_]?\d{4,10})\s*(?:–|—|-|to)\s*((?:[A-Za-z]{2,8}[-_]?)?\d{4,10})/i;

function tokenize(input: string, warnings: string[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input;
  const isSpace = (c: string) => /\s/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) { i++; continue; }
    if (c === "(") { tokens.push({ t: "lparen" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rparen" }); i++; continue; }
    if (c === '"' || c === "“") {
      const close = c === '"' ? '"' : "”";
      let j = i + 1;
      while (j < s.length && s[j] !== close && s[j] !== '"') j++;
      if (j >= s.length) warnings.push("Unclosed quote");
      const v = s.slice(i + 1, j).trim();
      if (v) tokens.push({ t: "phrase", v });
      i = j + 1;
      continue;
    }
    // Bates range starting here? (bare, or after a `bates:` prefix — the range may contain spaces: "bates:MFC-0041877 to 0041880")
    const rest = s.slice(i);
    const prefixed = rest.match(/^bates:\s*/i);
    const rm = rest.slice(prefixed?.[0].length ?? 0).match(RANGE_RE);
    if (rm && parseBates(rm[1])) {
      const range = parseBatesRange(rm[0]);
      if (range) { tokens.push({ t: "bates", ...range }); i += (prefixed?.[0].length ?? 0) + rm[0].length; continue; }
    }
    // word / field
    let j = i;
    while (j < s.length && !isSpace(s[j]) && s[j] !== "(" && s[j] !== ")") {
      if (s[j] === ":" && j + 1 < s.length && (s[j + 1] === '"' || s[j + 1] === "“")) {
        // field:"quoted value"
        const close = s[j + 1] === '"' ? '"' : "”";
        let k = j + 2;
        while (k < s.length && s[k] !== close && s[k] !== '"') k++;
        j = Math.min(k + 1, s.length);
        break;
      }
      j++;
    }
    const word = s.slice(i, j);
    i = j;
    if (!word) continue;
    const up = word.toUpperCase();
    if (up === "AND" || up === "&&") { tokens.push({ t: "and" }); continue; }
    if (up === "OR" || up === "||") { tokens.push({ t: "or" }); continue; }
    if (up === "NOT" || up === "!") { tokens.push({ t: "not" }); continue; }
    if (word.startsWith("-") && word.length > 1) { tokens.push({ t: "not" }); tokens.push(...tokenize(word.slice(1), warnings)); continue; }
    const colon = word.indexOf(":");
    if (colon > 0) {
      const f = word.slice(0, colon).toLowerCase() as QueryField;
      let v = word.slice(colon + 1).replace(/^["“]|["”]$/g, "").trim();
      if (FIELDS.includes(f)) {
        if (v) {
          if (f === "bates") {
            const range = parseBatesRange(v);
            if (range) { tokens.push({ t: "bates", ...range }); continue; }
            warnings.push(`Unrecognised Bates value "${v}"`);
            continue;
          }
          v = v.toLowerCase();
          tokens.push({ t: "field", f, v });
        } else warnings.push(`Empty value for ${f}:`);
        continue;
      }
    }
    const single = parseBates(word);
    if (single && /^[A-Za-z]{2,8}[-_]\d{4,10}$/.test(word)) { tokens.push({ t: "bates", start: single, end: single }); continue; }
    tokens.push({ t: "word", v: word.toLowerCase() });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (precedence: NOT > AND (implicit) > OR)
// ---------------------------------------------------------------------------

class Parser {
  pos = 0;
  constructor(private tokens: Token[], private warnings: string[]) {}
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }

  parseOr(): QueryNode {
    const children = [this.parseAnd()];
    while (this.peek()?.t === "or") { this.next(); children.push(this.parseAnd()); }
    const real = children.filter((c) => c.kind !== "empty");
    if (!real.length) return { kind: "empty" };
    return real.length === 1 ? real[0] : { kind: "or", children: real };
  }

  parseAnd(): QueryNode {
    const children: QueryNode[] = [];
    while (true) {
      const tk = this.peek();
      if (!tk || tk.t === "or" || tk.t === "rparen") break;
      if (tk.t === "and") { this.next(); continue; }
      children.push(this.parseNot());
    }
    const real = children.filter((c) => c.kind !== "empty");
    if (!real.length) return { kind: "empty" };
    return real.length === 1 ? real[0] : { kind: "and", children: real };
  }

  parseNot(): QueryNode {
    if (this.peek()?.t === "not") {
      this.next();
      const child = this.parseNot();
      return child.kind === "empty" ? child : { kind: "not", child };
    }
    return this.parseAtom();
  }

  parseAtom(): QueryNode {
    const tk = this.next();
    if (!tk) return { kind: "empty" };
    switch (tk.t) {
      case "lparen": {
        const inner = this.parseOr();
        if (this.peek()?.t === "rparen") this.next();
        else this.warnings.push("Missing closing parenthesis");
        return inner;
      }
      case "rparen":
        this.warnings.push("Unexpected closing parenthesis");
        return { kind: "empty" };
      case "phrase":
        return { kind: "term", value: tk.v.toLowerCase(), phrase: true };
      case "word":
        return { kind: "term", value: tk.v, phrase: false };
      case "field":
        if (tk.f === "date") return parseDateExpr(tk.v, this.warnings);
        return { kind: "field", field: tk.f, value: tk.v };
      case "bates":
        return { kind: "bates", start: tk.start, end: tk.end };
      case "and":
      case "or":
      case "not":
        return { kind: "empty" };
    }
  }
}

function parseDateExpr(v: string, warnings: string[]): QueryNode {
  // 2001 | 2001-03 | 2001-03-14 | 2001-03-01..2001-03-31 | >2001-03-01 | <2002 | >=… | <=…
  const norm = v.replace(/\//g, "-");
  const range = norm.match(/^(\d{4}(?:-\d{2}(?:-\d{2})?)?)\.\.(\d{4}(?:-\d{2}(?:-\d{2})?)?)$/);
  if (range) return { kind: "date", from: expandDate(range[1], "start"), to: expandDate(range[2], "end") };
  const cmp = norm.match(/^(>=|<=|>|<)(\d{4}(?:-\d{2}(?:-\d{2})?)?)$/);
  if (cmp) {
    const d = cmp[2];
    if (cmp[1] === ">=") return { kind: "date", from: expandDate(d, "start") };
    if (cmp[1] === ">") return { kind: "date", from: nextDay(expandDate(d, "end")) };
    if (cmp[1] === "<=") return { kind: "date", to: expandDate(d, "end") };
    return { kind: "date", to: prevDay(expandDate(d, "start")) };
  }
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(norm)) return { kind: "date", from: expandDate(norm, "start"), to: expandDate(norm, "end") };
  warnings.push(`Unrecognised date "${v}" (use YYYY, YYYY-MM, YYYY-MM-DD, a..b, >a, <b)`);
  return { kind: "empty" };
}

function expandDate(d: string, edge: "start" | "end") {
  if (d.length === 4) return edge === "start" ? `${d}-01-01` : `${d}-12-31`;
  if (d.length === 7) {
    if (edge === "start") return `${d}-01`;
    const [y, m] = d.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${d}-${String(last).padStart(2, "0")}`;
  }
  return d;
}
function shiftDay(d: string, delta: number) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}
const nextDay = (d: string) => shiftDay(d, 1);
const prevDay = (d: string) => shiftDay(d, -1);

export function parseQuery(input: string): ParsedQuery {
  const warnings: string[] = [];
  const raw = input ?? "";
  const tokens = tokenize(raw, warnings);
  const parser = new Parser(tokens, warnings);
  let ast = parser.parseOr();
  if (parser.pos < tokens.length) {
    // stray tokens (e.g. unmatched ")") — parse remainder and AND it in
    const rest = parser.parseOr();
    if (rest.kind !== "empty") ast = ast.kind === "empty" ? rest : { kind: "and", children: [ast, rest] };
  }
  const terms: string[] = [];
  const fields: ParsedQuery["fields"] = [];
  const bates: ParsedQuery["bates"] = [];
  collect(ast, false, terms, fields, bates);
  return { ast, terms: Array.from(new Set(terms)), fields, bates, warnings, raw };
}

function collect(node: QueryNode, negated: boolean, terms: string[], fields: ParsedQuery["fields"], bates: ParsedQuery["bates"]) {
  switch (node.kind) {
    case "term": if (!negated) terms.push(node.value); break;
    case "and": case "or": node.children.forEach((c) => collect(c, negated, terms, fields, bates)); break;
    case "not": collect(node.child, !negated, terms, fields, bates); break;
    case "field": fields.push({ field: node.field, value: node.value }); break;
    case "bates": bates.push({ start: node.start, end: node.end }); break;
    case "date": fields.push({ field: "date", value: `${node.from ?? ""}..${node.to ?? ""}` }); break;
    default: break;
  }
}

export function isEmptyQuery(q: ParsedQuery) { return q.ast.kind === "empty"; }

// ---------------------------------------------------------------------------
// Evaluation against a searchable document projection
// ---------------------------------------------------------------------------

export interface Searchable {
  id: string;
  bates: string;
  batesEnd?: string;
  date: string;
  custodian: string; // lowercased name + id
  type: string; // lowercased
  from: string; // lowercased
  to: string; // lowercased, joined
  cc: string;
  subject: string; // lowercased
  haystack: string; // lowercased: subject + text + from/to + custodian + bates
  issues: string; // lowercased codes joined
  tags: string;
  hash: string;
}

export function matchesQuery(doc: Searchable, node: QueryNode): boolean {
  switch (node.kind) {
    case "empty": return true;
    case "term": return doc.haystack.includes(node.value);
    case "and": return node.children.every((c) => matchesQuery(doc, c));
    case "or": return node.children.some((c) => matchesQuery(doc, c));
    case "not": return !matchesQuery(doc, node.child);
    case "bates": return batesInRange(doc.bates, node, doc.batesEnd);
    case "date": return (!node.from || doc.date >= node.from) && (!node.to || doc.date <= node.to);
    case "field": {
      const v = node.value;
      switch (node.field) {
        case "custodian": return doc.custodian.includes(v);
        case "type": return doc.type.startsWith(v) || (v === "email" && doc.type === "email") || (v === "deck" && doc.type === "presentation");
        case "from": return doc.from.includes(v);
        case "to": return doc.to.includes(v);
        case "cc": return doc.cc.includes(v);
        case "subject": return doc.subject.includes(v);
        case "issue": return doc.issues.includes(v);
        case "tag": return doc.tags.includes(v);
        case "hash": return doc.hash.startsWith(v);
        case "id": return doc.id.toLowerCase() === v;
        default: return true;
      }
    }
  }
}

/** Build a regex that highlights the query's positive terms (phrases first). */
export function highlightRegex(terms: string[]): RegExp | null {
  const parts = terms.filter((t) => t.length > 1).sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  if (!parts.length) return null;
  return new RegExp(`(${parts.join("|")})`, "gi");
}

/** Short excerpt around the first matching term. */
export function makeSnippet(text: string, terms: string[], radius = 110): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  if (idx < 0) return clean(text.slice(0, radius * 2)) + (text.length > radius * 2 ? "…" : "");
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return (start > 0 ? "…" : "") + clean(text.slice(start, end)) + (end < text.length ? "…" : "");
}
