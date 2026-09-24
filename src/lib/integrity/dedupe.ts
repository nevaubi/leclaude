/**
 * Cross-context duplicate detection for AI-derived records (pure, client-safe).
 * Records are matched on normalized keys (date + title, Bates + claim, cite
 * pairs) so a second extraction over the same evidence merges into the first
 * record instead of creating a twin.
 */
import { contentHash } from "./hash";

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "at", "by", "with", "re", "from", "is", "that", "this", "as", "was", "were", "be", "or", "its", "it", "vs", "v"]);

/** Lower-case, strip punctuation and stop words, collapse whitespace. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/^(re|fw|fwd):\s*/i, "").replace(/[^a-z0-9µ ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).join(" ");
}

/** Token-set similarity in 0..1 (Jaccard) — cheap and robust for short titles/claims. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function normalizeCite(cite: string | undefined | null): string {
  return (cite ?? "").toUpperCase().replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
}

/** date + normalized title key (matches the chronology's own dedupe). */
export function eventDuplicateKey(e: { date: string; title: string }): string {
  return `${e.date.slice(0, 10)}|${normalizeTitle(e.title)}`;
}

/**
 * Find an existing event that is the same fact: identical key, or same date
 * with a very similar title, or same date + same Bates source + similar title.
 */
export function findNearDuplicateEvent<T extends { id: string; date: string; title: string; sources?: { bates?: string; cite?: string; id?: string }[] }>(existing: T[], incoming: { date: string; title: string; sources?: { bates?: string; cite?: string; id?: string }[] }, threshold = 0.7): T | null {
  const key = eventDuplicateKey(incoming);
  const bates = new Set((incoming.sources ?? []).map((s) => normalizeCite(s.bates ?? s.cite)).filter(Boolean));
  let best: { e: T; score: number } | null = null;
  for (const e of existing) {
    if (e.date.slice(0, 10) !== incoming.date.slice(0, 10)) continue;
    if (eventDuplicateKey(e) === key) return e;
    const sim = tokenSimilarity(e.title, incoming.title);
    const sharesBates = (e.sources ?? []).some((s) => bates.has(normalizeCite(s.bates ?? s.cite)));
    const score = sim + (sharesBates ? 0.2 : 0);
    if (score >= threshold && (!best || score > best.score)) best = { e, score };
  }
  return best?.e ?? null;
}

/** Conflicts are duplicates when both sides cite the same locations, or the titles nearly match. */
export function findNearDuplicateConflict<T extends { id: string; title: string; sides: { cite: string; sourceId?: string }[] }>(existing: T[], incoming: { title: string; sides: { cite: string; sourceId?: string }[] }, threshold = 0.75): T | null {
  const cites = incoming.sides.map((s) => normalizeCite(s.cite)).filter(Boolean).sort().join("|");
  for (const c of existing) {
    const theirs = c.sides.map((s) => normalizeCite(s.cite)).filter(Boolean).sort().join("|");
    if (cites && theirs && cites === theirs) return c;
    if (tokenSimilarity(c.title, incoming.title) >= threshold) return c;
  }
  return null;
}

/** Knowledge-map entries: same person + same first cite + similar claim. */
export function isDuplicateKnowledgeEntry(a: { personName: string; knew: string; cites: { cite: string }[] }, b: { personName: string; knew: string; cites: { cite: string }[] }): boolean {
  if (normalizeTitle(a.personName) !== normalizeTitle(b.personName)) return false;
  const ca = new Set(a.cites.map((c) => normalizeCite(c.cite)));
  const shared = b.cites.some((c) => ca.has(normalizeCite(c.cite)));
  return shared ? tokenSimilarity(a.knew, b.knew) >= 0.5 : tokenSimilarity(a.knew, b.knew) >= 0.85;
}

/** Tasks: same matter + similar title (open tasks only, caller filters). */
export function findNearDuplicateTask<T extends { id: string; title: string; matterId?: string }>(existing: T[], incoming: { title: string; matterId?: string }, threshold = 0.8): T | null {
  for (const t of existing) {
    if ((t.matterId ?? "") !== (incoming.matterId ?? "")) continue;
    if (normalizeTitle(t.title) === normalizeTitle(incoming.title) || tokenSimilarity(t.title, incoming.title) >= threshold) return t;
  }
  return null;
}

/** Stable content hash of an arbitrary item's key fields (for data.dedupe and ingest). */
export function itemHash(item: unknown, fields?: string[]): string {
  if (item == null) return contentHash("");
  if (typeof item !== "object") return contentHash(String(item));
  const o = item as Record<string, unknown>;
  const keys = fields?.length ? fields : Object.keys(o).filter((k) => !k.startsWith("_") && k !== "id").sort();
  return contentHash(keys.map((k) => `${k}=${typeof o[k] === "object" ? JSON.stringify(o[k]) : String(o[k] ?? "")}`).join("\n"));
}

/** Name collision helper: "Memo.docx" → "Memo (2).docx" (skips taken suffixes). */
export function suffixedName(name: string, taken: Set<string>): string {
  const lower = new Set(Array.from(taken).map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,6})?$/);
  const base = (m?.[1] ?? name).replace(/ \(\d+\)$/, "");
  const ext = m?.[2] ?? "";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}
