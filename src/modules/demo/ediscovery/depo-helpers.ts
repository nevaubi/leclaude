import type { Deposition, DepositionQA, EDocument } from "@/lib/types/domain";
import { qa, obj } from "@/modules/ediscovery/analysis/seed-helpers";

export { qa, obj };

/** Resolves document references for testimony: `{B:slug}` → Bates of `demo_apl_ed_<slug>`. */
export interface DocIndex {
  byId: Map<string, EDocument>;
  bates(slug: string): string;
  range(slug: string): string;
  doc(slug: string): EDocument;
}

export function docIndex(docs: EDocument[]): DocIndex {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const doc = (slug: string) => {
    const d = byId.get(`demo_apl_ed_${slug}`);
    if (!d) throw new Error(`demo testimony cites unknown document ${slug}`);
    return d;
  };
  return {
    byId,
    doc,
    bates: (slug) => doc(slug).bates,
    range: (slug) => { const d = doc(slug); return d.batesEnd ? `${d.bates} through ${d.batesEnd}` : d.bates; },
  };
}

/** Replace `{B:slug}` / `{R:slug}` tokens with a Bates number / Bates range. */
export function fill(text: string, ix: DocIndex): string {
  return text.replace(/\{([BR]):([a-z0-9]+)\}/g, (_, k: string, slug: string) => (k === "B" ? ix.bates(slug) : ix.range(slug)));
}

export interface ExhibitSpec {
  /** Exhibit label, e.g. "Marsh-3". */
  id: string;
  slug: string;
  page: number;
  description: string;
  /** Witness's answer to "Do you recognize it?" */
  recognize: string;
  /** Witness's answer to "Who prepared it?" (defaults to the document's author). */
  author?: string;
  /** Witness's answer to "Who received it?" (defaults to the header recipients). */
  recipients?: string;
}

/** Three document-grounded Q/A pairs that introduce an exhibit (lines 3, 8, 13 of its page). */
export function exhibitQAs(ex: ExhibitSpec, ix: DocIndex): DepositionQA[] {
  const d = ix.doc(ex.slug);
  const to = [...(d.to ?? []), ...(d.cc ?? []).map((c) => `${c} (copied)`)];
  const author = ex.author ?? (d.from ? `${d.from}.` : `It's a ${d.type.toLowerCase()} from ${d.custodianName}'s files; I don't know who prepared it.`);
  const recipients = ex.recipients ?? (to.length ? `${to.join(", ")}.` : "It doesn't show recipients. I don't know how widely it went.");
  return [
    qa(ex.page, 3, `(Exhibit ${ex.id} marked for identification.) I'm handing you Exhibit ${ex.id}, Bates ${ix.range(ex.slug)}, ${ex.description}. Do you recognize it?`, ex.recognize, { exhibit: ex.id }),
    qa(ex.page, 8, "Who prepared it?", author, { exhibit: ex.id }),
    qa(ex.page, 13, "Who received it?", recipients, { exhibit: ex.id }),
  ];
}

export type RawQA = [page: number, line: number, question: string, answer: string, extra?: Parameters<typeof qa>[4]];

/** Assemble a transcript: fill Bates tokens, add exhibit introductions, sort by page:line and reject collisions. */
export function assemble(raw: RawQA[], exhibits: ExhibitSpec[], ix: DocIndex): { transcript: DepositionQA[]; exhibits: NonNullable<Deposition["exhibits"]> } {
  const rows: DepositionQA[] = [
    ...raw.map(([p, l, q, a, extra]) => qa(p, l, fill(q, ix), fill(a, ix), extra ? { ...extra, ...(extra.note ? { note: fill(extra.note, ix) } : {}) } : {})),
    ...exhibits.flatMap((e) => exhibitQAs(e, ix)),
  ].sort((a, b) => a.page - b.page || a.line - b.line);
  for (let i = 1; i < rows.length; i++) if (rows[i].page === rows[i - 1].page && rows[i].line === rows[i - 1].line) throw new Error(`demo transcript: two Q/A at ${rows[i].page}:${rows[i].line}`);
  for (const r of rows) if (r.line < 1 || r.line > 25) throw new Error(`demo transcript: line ${r.line} out of range at page ${r.page}`);
  return { transcript: rows, exhibits: exhibits.map((e) => ({ id: e.id, description: e.description.charAt(0).toUpperCase() + e.description.slice(1), bates: ix.bates(e.slug) })) };
}

/** Names used in objection records. */
export const DEFENSE_ATTORNEY = "Colin Mercer";
export const EXAMINING_ATTORNEY = "Nina Castell";
