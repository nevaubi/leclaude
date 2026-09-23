/**
 * Safe template expressions for workflow configs.
 *
 *   {{inputs.document_text}}
 *   {{steps.extract.output.parties | join:", "}}
 *   {{steps.search.output.results | pluck:bates | join:"; "}}
 *   {{matter.name}} · {{loop.item.subject}} · {{now | date:long}}
 *
 * Only plain path lookups against a data object plus a fixed set of filters.
 * No code evaluation, no prototype access. A string that consists of one
 * expression resolves to the raw value (objects/arrays survive); mixed strings
 * are interpolated as text.
 */

export interface TemplateContext {
  inputs?: Record<string, unknown>;
  steps?: Record<string, { output?: unknown; status?: string; [k: string]: unknown }>;
  matter?: Record<string, unknown> | null;
  loop?: { item: unknown; index: number; count: number; [k: string]: unknown } | null;
  run?: Record<string, unknown>;
  user?: Record<string, unknown>;
  now?: string;
  [k: string]: unknown;
}

export interface ResolveReport { missing: string[]; errors: string[] }

const EXPR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** True when the whole string is exactly one expression. */
export function isSingleExpression(s: string) {
  const t = s.trim();
  if (!t.startsWith("{{") || !t.endsWith("}}")) return false;
  const inner = t.slice(2, -2);
  return !inner.includes("{{") && !inner.includes("}}");
}

/** Split a dotted/bracketed path into segments: "a.b[0].c" → ["a","b","0","c"]. */
export function splitPath(path: string): string[] {
  const out: string[] = [];
  for (const raw of path.split(".")) {
    const seg = raw.trim();
    if (!seg) continue;
    const m = seg.match(/^([^[\]]*)((?:\[[^\]]*\])*)$/);
    if (!m) { out.push(seg); continue; }
    if (m[1]) out.push(m[1]);
    const idx = m[2].match(/\[([^\]]*)\]/g) ?? [];
    for (const i of idx) out.push(i.slice(1, -1).replace(/^['"]|['"]$/g, ""));
  }
  return out;
}

/** Read a path from an object without touching prototypes. */
export function getPath(root: unknown, path: string | string[]): unknown {
  const segs = Array.isArray(path) ? path : splitPath(path);
  let cur: unknown = root;
  for (const s of segs) {
    if (cur == null) return undefined;
    if (FORBIDDEN.has(s)) return undefined;
    if (Array.isArray(cur)) {
      const n = Number(s);
      if (Number.isInteger(n)) { cur = cur[n < 0 ? cur.length + n : n]; continue; }
      if (s === "length") { cur = cur.length; continue; }
      return undefined;
    }
    if (typeof cur === "object") {
      if (!Object.prototype.hasOwnProperty.call(cur, s)) return undefined;
      cur = (cur as Record<string, unknown>)[s];
      continue;
    }
    if (typeof cur === "string" && s === "length") { cur = cur.length; continue; }
    return undefined;
  }
  return cur;
}

function parseFilterArgs(raw: string | undefined): string[] {
  if (raw == null || raw === "") return [];
  const args: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === "\\" && i + 1 < raw.length) { cur += raw[++i]; continue; }
      if (ch === quote) { quote = null; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ",") { args.push(cur); cur = ""; continue; }
    cur += ch;
  }
  args.push(cur);
  return args.map((a) => a.replace(/\\n/g, "\n").replace(/\\t/g, "\t"));
}

/** Parse "path | f1 | f2:arg" honouring quotes. */
export function parseExpression(expr: string): { path: string; filters: { name: string; args: string[] }[] } {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of expr) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "|") { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  const path = parts[0].trim();
  const filters = parts.slice(1).map((p) => {
    const t = p.trim();
    const i = t.indexOf(":");
    if (i < 0) return { name: t, args: [] };
    return { name: t.slice(0, i).trim(), args: parseFilterArgs(t.slice(i + 1)) };
  }).filter((f) => f.name);
  return { path, filters };
}

export function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null || v === "") return [];
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("[")) { try { const p = JSON.parse(t); if (Array.isArray(p)) return p; } catch { /* fallthrough */ } }
    return t.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof v === "object") return Object.values(v as Record<string, unknown>);
  return [v];
}

function fmtDate(v: unknown, style: string): string {
  const d = v == null || v === "" ? new Date() : new Date(v as string);
  if (Number.isNaN(d.getTime())) return stringify(v);
  switch (style) {
    case "iso": return d.toISOString();
    case "date": return d.toISOString().slice(0, 10);
    case "long": return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    case "time": return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    case "datetime": return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    case "short":
    default: return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
}

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").slice(0, 400);
}

/** Markdown table from an array of objects (up to 10 columns). */
export function markdownTable(v: unknown, columns?: string[]): string {
  const rows = toArray(v).filter((r) => r != null);
  if (!rows.length) return "";
  const objs = rows.map((r) => (typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : { value: r }));
  const cols = columns?.length ? columns : Array.from(objs.reduce((set, o) => { Object.keys(o).forEach((k) => set.add(k)); return set; }, new Set<string>())).slice(0, 10);
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = objs.map((o) => `| ${cols.map((c) => cell(o[c])).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

export const FILTERS: Record<string, (v: unknown, args: string[]) => unknown> = {
  json: (v, a) => (a[0] === "compact" ? JSON.stringify(v ?? null) : JSON.stringify(v ?? null, null, 2)),
  upper: (v) => stringify(v).toUpperCase(),
  lower: (v) => stringify(v).toLowerCase(),
  title: (v) => stringify(v).replace(/\b\w/g, (c) => c.toUpperCase()),
  trim: (v) => stringify(v).trim(),
  length: (v) => (Array.isArray(v) ? v.length : typeof v === "string" ? v.length : v && typeof v === "object" ? Object.keys(v).length : v == null ? 0 : 1),
  count: (v) => (Array.isArray(v) ? v.length : typeof v === "string" ? v.length : v && typeof v === "object" ? Object.keys(v).length : v == null ? 0 : 1),
  join: (v, a) => toArray(v).map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(a[0] ?? ", "),
  truncate: (v, a) => { const s = stringify(v); const n = Math.max(0, Number(a[0] ?? 500) || 500); return s.length > n ? s.slice(0, n).trimEnd() + "…" : s; },
  date: (v, a) => fmtDate(v, a[0] ?? "short"),
  default: (v, a) => (v == null || v === "" || (Array.isArray(v) && !v.length) ? (a[0] ?? "") : v),
  first: (v) => toArray(v)[0],
  last: (v) => { const arr = toArray(v); return arr[arr.length - 1]; },
  pluck: (v, a) => toArray(v).map((x) => getPath(x, a[0] ?? "")).filter((x) => x !== undefined),
  lines: (v) => toArray(v).map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("\n"),
  bullets: (v) => toArray(v).map((x) => `- ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join("\n"),
  numbered: (v) => toArray(v).map((x, i) => `${i + 1}. ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join("\n"),
  table: (v, a) => markdownTable(v, a.length ? a : undefined),
  number: (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; },
  slice: (v, a) => { const arr = Array.isArray(v) ? v : stringify(v); const s = Number(a[0] ?? 0) || 0; const e = a[1] != null && a[1] !== "" ? Number(a[1]) : undefined; return arr.slice(s, e); },
  keys: (v) => (v && typeof v === "object" ? Object.keys(v as object) : []),
  values: (v) => (v && typeof v === "object" ? Object.values(v as object) : []),
  where: (v, a) => toArray(v).filter((x) => { const val = getPath(x, a[0] ?? ""); return a.length > 1 ? String(val) === a[1] : Boolean(val); }),
  unique: (v) => Array.from(new Set(toArray(v).map((x) => (typeof x === "object" ? JSON.stringify(x) : x)))).map((x) => (typeof x === "string" && /^[[{]/.test(x) ? safeParse(x) : x)),
  sum: (v, a) => toArray(v).reduce<number>((acc, x) => acc + (Number(a[0] ? getPath(x, a[0]) : x) || 0), 0),
  replace: (v, a) => stringify(v).split(a[0] ?? "").join(a[1] ?? ""),
  markdown_quote: (v) => stringify(v).split("\n").map((l) => `> ${l}`).join("\n"),
  bool: (v) => (typeof v === "string" ? ["true", "yes", "1", "on"].includes(v.trim().toLowerCase()) : Boolean(v)),
  add_days: (v, a) => { const d = v == null || v === "" ? new Date() : new Date(v as string); if (Number.isNaN(d.getTime())) return stringify(v); d.setDate(d.getDate() + (Number(a[0]) || 0)); return d.toISOString().slice(0, 10); },
  add_bd: (v, a) => { const d = v == null || v === "" ? new Date() : new Date(v as string); if (Number.isNaN(d.getTime())) return stringify(v); let left = Math.abs(Number(a[0]) || 0); const dir = Math.sign(Number(a[0]) || 1) || 1; while (left > 0) { d.setDate(d.getDate() + dir); const wd = d.getDay(); if (wd !== 0 && wd !== 6) left--; } return d.toISOString().slice(0, 10); },
};

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }

/** Evaluate one expression (without braces) against the context. */
export function evaluateExpression(expr: string, ctx: TemplateContext, report?: ResolveReport): unknown {
  const { path, filters } = parseExpression(expr);
  let value: unknown;
  if (/^(['"]).*\1$/.test(path)) value = path.slice(1, -1);
  else if (/^-?\d+(\.\d+)?$/.test(path)) value = Number(path);
  else if (path === "true" || path === "false") value = path === "true";
  else if (path === "now") value = ctx.now ?? new Date().toISOString();
  else {
    value = getPath(ctx, path);
    if (value === undefined && report && !filters.some((f) => f.name === "default")) report.missing.push(path);
  }
  for (const f of filters) {
    const fn = FILTERS[f.name];
    if (!fn) { report?.errors.push(`Unknown filter "${f.name}"`); continue; }
    try { value = fn(value, f.args); } catch (e) { report?.errors.push(`Filter ${f.name}: ${(e as Error).message}`); }
  }
  return value;
}

/** Resolve a template string. Single expressions return raw values. */
export function resolveTemplate(template: string, ctx: TemplateContext, report?: ResolveReport): unknown {
  if (typeof template !== "string") return template;
  if (!template.includes("{{")) return template;
  if (isSingleExpression(template)) {
    const inner = template.trim().slice(2, -2).trim();
    return evaluateExpression(inner, ctx, report);
  }
  return template.replace(EXPR_RE, (_m, inner: string) => stringify(evaluateExpression(inner, ctx, report)));
}

/** Resolve a template string and coerce to text. */
export function resolveText(template: string, ctx: TemplateContext, report?: ResolveReport): string {
  return stringify(resolveTemplate(template, ctx, report));
}

/** Recursively resolve every string inside a config object. */
export function resolveDeep<T>(value: T, ctx: TemplateContext, report?: ResolveReport): T {
  if (typeof value === "string") return resolveTemplate(value, ctx, report) as T;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx, report)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveDeep(v, ctx, report);
    return out as T;
  }
  return value;
}

/** All expression paths referenced in a template/config (for dependency hints and validation). */
export function referencedPaths(value: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(EXPR_RE)) { const { path } = parseExpression(m[1]); if (path && !/^(['"]).*\1$/.test(path)) out.add(path); }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return Array.from(out);
}

/** Node ids referenced through steps.<id> in a config. */
export function referencedStepIds(value: unknown): string[] {
  return Array.from(new Set(referencedPaths(value).filter((p) => p.startsWith("steps.")).map((p) => splitPath(p)[1]).filter(Boolean)));
}

/** Parse a due/start rule: "+3d", "+2w", "+5bd", "next-friday", "2026-10-14", "2026-10-14 09:00", "+14d 09:00", or an ISO string. */
export function resolveDateRule(rule: unknown, now = new Date()): Date | null {
  if (rule instanceof Date) return rule;
  const s = String(rule ?? "").trim();
  if (!s) return null;
  const m = s.match(/^([+-]\d+)\s*(d|w|m|bd|h)\b\s*(\d{1,2}:\d{2})?$/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const d = new Date(now);
    if (unit === "d") d.setDate(d.getDate() + n);
    else if (unit === "w") d.setDate(d.getDate() + n * 7);
    else if (unit === "m") d.setMonth(d.getMonth() + n);
    else if (unit === "h") d.setHours(d.getHours() + n);
    else if (unit === "bd") {
      let left = Math.abs(n);
      const dir = Math.sign(n) || 1;
      while (left > 0) { d.setDate(d.getDate() + dir); const wd = d.getDay(); if (wd !== 0 && wd !== 6) left--; }
    }
    if (m[3]) { const [hh, mm] = m[3].split(":").map(Number); d.setHours(hh, mm, 0, 0); }
    return d;
  }
  const next = s.match(/^next-(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(\d{1,2}:\d{2})?$/i);
  if (next) {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = days.indexOf(next[1].toLowerCase());
    const d = new Date(now);
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    if (next[2]) { const [hh, mm] = next[2].split(":").map(Number); d.setHours(hh, mm, 0, 0); } else d.setHours(17, 0, 0, 0);
    return d;
  }
  const d = new Date(s.includes("T") || /\d{2}:\d{2}/.test(s) ? s.replace(" ", "T") : `${s}T17:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
