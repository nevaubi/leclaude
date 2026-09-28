/**
 * Authority comparison (compare_authorities tool) and the table of authorities for exports.
 * Deterministic over the sources a run actually read. Pure and client-safe.
 */
import { courtAbbreviation } from "../jurisdictions";
import { formatBluebook, yearOf } from "../normalize";
import { parseCiteMarkers } from "./markers";
import { splitParagraphs } from "./paragraphs";
import { TREATMENT_LABEL } from "./treatment";
import type { ResearchSource } from "./types";

const HOLDING_RE = /\b(we hold|we conclude|we therefore hold|we affirm|we reverse|we agree|held that|the court held|holding that|accordingly,? we|it is ordered|we decline)\b/i;

/** Up to `max` holding-like sentences with their paragraph numbers (reader numbering). */
export function holdingSentences(text: string, max = 2): { paragraph: number; sentence: string }[] {
  const out: { paragraph: number; sentence: string }[] = [];
  const paras = splitParagraphs(text);
  for (let i = 0; i < paras.length && out.length < max; i++) {
    if (!HOLDING_RE.test(paras[i])) continue;
    for (const sentence of paras[i].split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      if (HOLDING_RE.test(sentence)) { out.push({ paragraph: i + 1, sentence: sentence.length > 400 ? sentence.slice(0, 397) + "…" : sentence }); break; }
    }
  }
  return out;
}

export interface AuthorityRow {
  n?: number;
  id: string;
  cite: string;
  court: string;
  year: string;
  weight: string;
  read: boolean;
  treatment: string;
  currentness?: string;
  /** Holding-like sentences with pinpoint paragraphs, only for sources read in full. */
  holdings: { paragraph: number; sentence: string }[];
  note?: string;
}

/** Side-by-side rows for the requested sources. Unread sources get no holding (read before characterizing). */
export function compareAuthorities(sources: ResearchSource[], textOf: (s: ResearchSource) => string | undefined): AuthorityRow[] {
  return sources.map((s) => {
    const text = s.read ? textOf(s) ?? "" : "";
    const holdings = text ? holdingSentences(text) : [];
    return {
      n: s.n,
      id: s.id,
      cite: formatBluebook(s.hit),
      court: courtAbbreviation(s.hit.courtId ?? s.court, s.hit.court),
      year: yearOf(s.date),
      weight: s.authority && s.authority !== "n/a" ? s.authority : s.scope === "record" ? "record" : "n/a",
      read: s.read,
      treatment: s.treatment ? TREATMENT_LABEL[s.treatment.signal] : "not checked",
      currentness: s.currentness?.label,
      holdings,
      note: !s.read ? "Not read in full — no holding stated" : holdings.length ? undefined : "No holding sentence detected; read the opinion",
    };
  });
}

export function authoritiesMarkdownTable(rows: AuthorityRow[]): string {
  const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";
  const head = "| # | Authority | Court | Year | Weight | Read | Treatment | Holding (¶) |\n|---|---|---|---|---|---|---|---|";
  const body = rows.map((r) => `| ${r.n ?? "—"} | ${cell(r.cite)} | ${cell(r.court)} | ${cell(r.year)} | ${cell(r.weight)} | ${r.read ? "Read" : "Snippet"} | ${cell(r.treatment)} | ${cell(r.holdings.map((h) => `¶${h.paragraph}: ${h.sentence}`).join(" / ") || r.note)} |`);
  return [head, ...body].join("\n");
}

export type ToaGroup = "Cases" | "Statutes" | "Regulations" | "Federal Register" | "Record" | "Other authorities";

export interface ToaEntry {
  group: ToaGroup;
  citation: string;
  /** Source numbers citing it and the pinpoint paragraphs used in the answer. */
  refs: { n: number; paragraphs: number[] }[];
  read: boolean;
  treatment?: string;
}

const GROUP_OF: Record<ResearchSource["kind"], ToaGroup> = { caselaw: "Cases", dockets: "Record", statutes: "Statutes", regulations: "Regulations", federal_register: "Federal Register", ediscovery: "Record", library: "Other authorities", web: "Other authorities" };
const ORDER: ToaGroup[] = ["Cases", "Statutes", "Regulations", "Federal Register", "Record", "Other authorities"];

/** Table of authorities for the sources the answer actually cites, grouped and alphabetised, with pinpoints used. */
export function tableOfAuthorities(answer: string, sources: ResearchSource[]): ToaEntry[] {
  const markers = parseCiteMarkers(answer);
  const byN = new Map(sources.filter((s) => s.n != null).map((s) => [s.n!, s] as const));
  const entries = new Map<string, ToaEntry>();
  for (const m of markers) {
    const s = byN.get(m.n);
    if (!s) continue;
    const e = entries.get(s.id) ?? { group: GROUP_OF[s.kind], citation: formatBluebook(s.hit), refs: [], read: s.read, treatment: s.treatment?.signal === "possibly_negative" ? TREATMENT_LABEL.possibly_negative : undefined };
    let ref = e.refs.find((r) => r.n === m.n);
    if (!ref) { ref = { n: m.n, paragraphs: [] }; e.refs.push(ref); }
    if (m.paragraph != null && !ref.paragraphs.includes(m.paragraph)) ref.paragraphs.push(m.paragraph);
    entries.set(s.id, e);
  }
  return Array.from(entries.values()).sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.citation.localeCompare(b.citation));
}

export function tableOfAuthoritiesMarkdown(entries: ToaEntry[], title = "Table of Authorities"): string {
  const lines = [`## ${title}`, ""];
  if (!entries.length) return [...lines, "_The answer cites no numbered source._", ""].join("\n");
  for (const g of ORDER) {
    const list = entries.filter((e) => e.group === g);
    if (!list.length) continue;
    lines.push(`### ${g}`, "");
    for (const e of list) {
      const pins = e.refs.map((r) => `[${r.n}]${r.paragraphs.length ? ` ¶${r.paragraphs.sort((a, b) => a - b).join(", ¶")}` : ""}`).join("; ");
      lines.push(`- ${e.citation} — ${pins}${e.read ? "" : " — search excerpt only (not read)"}${e.treatment ? ` — ${e.treatment}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
