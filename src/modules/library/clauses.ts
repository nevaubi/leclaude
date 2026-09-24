import type { ClauseVariable } from "./types";

/**
 * Clause-bank helpers: variables are written as {{Party A}} / {{Governing Law}}.
 * Pure functions (used by the fill form on the client and the insert route on the server).
 */
const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractVariables(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1].trim();
    if (!seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

/** Merge declared variable metadata with the variables actually present in the text. */
export function variableSpecs(text: string, declared: ClauseVariable[] = []): ClauseVariable[] {
  const byName = new Map(declared.map((v) => [v.name, v]));
  const names = extractVariables(text);
  const specs = names.map((n) => byName.get(n) ?? { name: n });
  for (const d of declared) if (!names.includes(d.name)) specs.push(d);
  return specs;
}

export interface FillResult { text: string; filled: string[]; missing: string[] }

/**
 * Replace {{Variable}} placeholders with values. Missing values are left as
 * bracketed placeholders ("[Party A]") so the gap is visible in the draft.
 */
export function fillClause(text: string, values: Record<string, string | undefined>): FillResult {
  const filled: string[] = [];
  const missing: string[] = [];
  const out = text.replace(VAR_RE, (_m, raw: string) => {
    const name = raw.trim();
    const v = values[name]?.trim();
    if (v) { if (!filled.includes(name)) filled.push(name); return v; }
    if (!missing.includes(name)) missing.push(name);
    return `[${name}]`;
  });
  return { text: out, filled, missing };
}

/** Lightweight structural diff used by "Compare to standard" when AI is unavailable. */
export function clauseDiffSummary(standard: string, candidate: string) {
  const norm = (s: string) => s.replace(/\{\{[^}]+\}\}/g, "X").replace(/\s+/g, " ").trim();
  const a = norm(standard).split(/(?<=[.;])\s+/).filter(Boolean);
  const b = norm(candidate).split(/(?<=[.;])\s+/).filter(Boolean);
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  const onlyInStandard = a.filter((s) => !setB.has(s.toLowerCase()));
  const onlyInCandidate = b.filter((s) => !setA.has(s.toLowerCase()));
  const wordsA = norm(standard).split(" ").length, wordsB = norm(candidate).split(" ").length;
  return { onlyInStandard, onlyInCandidate, wordsStandard: wordsA, wordsCandidate: wordsB, sameSentenceCount: a.length - onlyInStandard.length };
}

/** Title-case a variable name for display ("governing law" → "Governing Law"). */
export function prettyVariable(name: string) {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}
