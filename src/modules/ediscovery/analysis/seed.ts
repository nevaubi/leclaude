import "server-only";
import type { Database } from "@/lib/db";
import type { Deposition, EDocument, Person, Relationship } from "@/lib/types/domain";
import { MATTERS, PEOPLE } from "@/lib/seed/ids";
import { VOSS_DEPOSITION } from "./seed-depo-voss";
import { HALE_DEPOSITION } from "./seed-depo-hale";
import { PRYCE_DEPOSITION } from "./seed-depo-pryce";
import { AFFF_TIMELINE } from "./seed-timeline";
import { AFFF_CONFLICTS } from "./seed-conflicts";
import { EXTRA_PEOPLE, EXTRA_PEOPLE_IDS as X } from "./seed-people";
import { KLEIN, RAMAN, obj, qa } from "./seed-helpers";
import { resolvePersonName } from "./graph";

const M = MATTERS.afff;
const P = PEOPLE;

// ---------------------------------------------------------------------------
// Additional depositions: Brooks (rough transcript) and two scheduled.
// ---------------------------------------------------------------------------

export const BROOKS_DEPOSITION: Deposition = {
  id: "dep_afff_brooks_v1",
  matterId: M,
  witnessId: P.nadiaBrooks,
  witnessName: "Nadia Brooks",
  witnessTitle: "Product Stewardship Manager, Meridian Fluorochem Corp.",
  date: "2026-09-10",
  takenBy: "Rebecca Klein (Plaintiffs' Executive Committee)",
  defendingBy: "Priya Raman (Calloway & Reyes LLP)",
  location: "Meridian Fluorochem Corp., Decatur, IL",
  volume: 1,
  pages: 188,
  status: "transcribed",
  exhibits: [
    { id: "Brooks-1", description: "MSDS revision memo — Sections 11 and 12 (2 Apr 2001)", bates: "MFC-0041938" },
    { id: "Brooks-2", description: "Product stewardship review — C8 alternatives (11 Feb 2003)", bates: "MFC-0052239" },
    { id: "Brooks-3", description: "Letter to Aqua-Guard customers of record (16 Feb 2010)", bates: "MFC-0052254" },
    { id: "Brooks-4", description: "Tidewater Refining complaint letter (9 Aug 2001)", bates: "MFC-0041981" },
  ],
  transcript: [
    qa(7, 2, "Please state your name.", "Nadia Brooks."),
    qa(7, 8, "What was your role in 2001?", "Product Stewardship Manager for the fire suppression line. I reported to Alan Pryce."),
    qa(14, 11, "Exhibit 1 is your April 2, 2001 MSDS revision memo. What did you propose?", "Revising Section 11 to say the fluorosurfactant may accumulate in the body and is eliminated slowly, and Section 12 to say it is not expected to biodegrade.", { exhibit: "Brooks-1" }),
    qa(15, 3, "Where did that language come from?", "Helen Voss drafted Section 11. Section 12 was mine, based on what Helen told me."),
    qa(15, 14, "Was it adopted?", "Partly. 'May accumulate' was struck and Section 12 stayed 'not determined.' Alan made that decision on April 4.", { flags: ["key"] }),
    qa(16, 6, "Did Mr. Hale have a role in the MSDS decision?", "He was copied. I do not remember him weighing in.", { flags: ["key"], note: "Corroborates Voss 156:20 against Hale 142:6." }),
    qa(23, 9, "Did you agree with Ms. Voss that Slide 8 of the marketing plan was false?", "Yes. I said so in my reply the same day.", { flags: ["admission"] }),
    qa(31, 1, "Exhibit 4, the Tidewater complaint. What did you do with it?", "I sent it to Greg Hale for the environmental question and drafted the customer response with runoff guidance.", { exhibit: "Brooks-4" }),
    qa(44, 15, "Exhibit 2, your February 2003 C8 alternatives review. Page 3 refers to a human half-life 'on the order of years.' Where did that come from?", "Helen's allometric scaling and the 3M occupational data that had been published.", { exhibit: "Brooks-2" }),
    qa(45, 8, "Was that information shared with customers in 2003?", "No. It went into the product development plan.", { flags: ["admission", "key"] }),
    qa(58, 4, "Exhibit 3, the February 2010 customer letter. Why 2010?", "The 2009 Stockholm Convention listing and the EPA stewardship commitments. Legal advised that customers of record be told the discontinued product contained PFOS.", { exhibit: "Brooks-3", objection: obj(RAMAN, "privilege", "Instruct not to disclose the content of legal advice; the witness may describe the business event."), flags: ["privilege"] }),
    qa(72, 12, "Were you removed from the MW-7 email thread in July 2002?", "Yes. Alan took me off. I learned about the 41 microgram result from Greg in the hallway.", { flags: ["key"] }),
    qa(90, 6, "Did you ever recommend that Meridian tell customers the fluorosurfactant was persistent?", "In 2001, in the MSDS memo. Again in 2003. It happened in 2010.", { flags: ["admission", "key"] }),
    qa(151, 3, "Ms. Brooks, Priya Raman. Between 2001 and 2010, did Meridian's MSDS and product literature contain runoff-collection guidance?", "Yes. From August 2001.", { objection: obj(KLEIN, "form", "Leading.") }),
    qa(163, 9, "Nothing further.", "(Rough transcript — certified copy pending.)"),
  ],
};

export const SCHEDULED_DEPOSITIONS: Deposition[] = [
  { id: "dep_afff_hale_v2", matterId: M, witnessId: P.gregoryHale, witnessName: "Gregory Hale", witnessTitle: "Director, Environmental Health & Safety, Meridian Fluorochem Corp.", date: "2026-09-24", takenBy: "Rebecca Klein (Plaintiffs' Executive Committee)", defendingBy: "Jordan Whitfield (Calloway & Reyes LLP)", location: "Calloway & Reyes LLP, Charleston — Conference Room 4B", volume: 2, pages: 0, transcript: [], exhibits: [], status: "scheduled" },
  { id: "dep_afff_suarez_v1", matterId: M, witnessId: P.martinSuarez, witnessName: "Martin Suarez", witnessTitle: "Regulatory Affairs Counsel, Meridian Fluorochem Corp.", date: "2026-10-21", takenBy: "Rebecca Klein (Plaintiffs' Executive Committee)", defendingBy: "Jordan Whitfield (Calloway & Reyes LLP)", location: "Calloway & Reyes LLP, Charleston — Conference Room 4B", volume: 1, pages: 0, transcript: [], exhibits: [], status: "scheduled" },
];

export const AFFF_DEPOSITIONS: Deposition[] = [HALE_DEPOSITION, VOSS_DEPOSITION, PRYCE_DEPOSITION, BROOKS_DEPOSITION, ...SCHEDULED_DEPOSITIONS];

// ---------------------------------------------------------------------------
// Relationships: explicit org chart / engagement edges plus edges derived
// from the seeded email headers (from → to = emailed, from → cc = cc).
// ---------------------------------------------------------------------------

const rel = (id: string, fromId: string, toId: string, kind: Relationship["kind"], weight: number, label?: string, evidence?: Relationship["evidence"]): Relationship => ({ id, matterId: M, fromId, toId, kind, weight, label, evidence });

export const EXPLICIT_RELATIONSHIPS: Relationship[] = [
  // Meridian org chart (2001)
  rel("rel_afff_org_01", P.gregoryHale, X.merrick, "reports_to", 3, "Director EHS → SVP Operations", [{ bates: "MFC-0041912", docId: "ed_afff_0011", excerpt: "TO: … Paul Merrick, SVP Operations" }]),
  rel("rel_afff_org_02", P.helenVoss, P.gregoryHale, "reports_to", 3, "Administrative reporting line", [{ excerpt: "Voss 11:14: Administratively I reported to Gregory Hale" }]),
  rel("rel_afff_org_03", P.nadiaBrooks, P.alanPryce, "reports_to", 3, "Product Stewardship → VP Fire Suppression", [{ excerpt: "Brooks 7:8: I reported to Alan Pryce" }]),
  rel("rel_afff_org_04", P.alanPryce, X.ferris, "reports_to", 3, "VP → CEO", [{ excerpt: "Pryce 6:5: The CEO, Douglas Ferris." }]),
  rel("rel_afff_org_05", P.martinSuarez, P.robertKaine, "reports_to", 3, "Regulatory Affairs Counsel → Associate General Counsel", [{ bates: "MFC-0041914", docId: "ed_afff_0012" }]),
  rel("rel_afff_org_06", X.liu, P.alanPryce, "reports_to", 2, "Marketing → VP Fire Suppression", [{ excerpt: "Pryce 6:12: marketing under Karen Liu" }]),
  rel("rel_afff_org_07", X.merrick, P.gregoryHale, "supervises", 3, undefined, [{ bates: "MFC-0041912", docId: "ed_afff_0011" }]),
  rel("rel_afff_org_08", P.gregoryHale, P.helenVoss, "supervises", 3, "Product Safety group", [{ excerpt: "Hale 10:7" }]),
  rel("rel_afff_org_09", P.alanPryce, P.nadiaBrooks, "supervises", 3, undefined, [{ excerpt: "Pryce 6:12" }]),
  rel("rel_afff_org_10", P.robertKaine, P.martinSuarez, "supervises", 3, undefined),
  rel("rel_afff_org_11", P.alanPryce, X.liu, "supervises", 2, undefined),
  rel("rel_afff_org_12", X.ferris, P.alanPryce, "supervises", 2, undefined),
  // Engagements
  rel("rel_afff_ret_01", P.helenVoss, P.drLindaWhitfieldTox, "retained", 4, "Whitfield Laboratories — WL-2000-0417 and WL-2001-0512", [{ bates: "MFC-0041898", docId: "ed_afff_0008" }, { excerpt: "Voss 16:21: I recommended them." }]),
  rel("rel_afff_ret_02", P.gregoryHale, X.nunez, "retained", 3, "Beacon Environmental — Decatur groundwater monitoring", [{ bates: "MFC-0052212", docId: "ed_afff_0058" }, { bates: "MFC-0041988", docId: "ed_afff_0049" }]),
  rel("rel_afff_ret_03", P.drLindaWhitfieldTox, X.bello, "supervises", 2, "Study director → study pathologist", [{ bates: "MFC-0052248", docId: "ed_afff_0074" }]),
  // Counsel
  rel("rel_afff_rep_01", P.jordanWhitfield, P.gregoryHale, "represents", 3, "Defending deposition (Vol. I, Vol. II)", [{ excerpt: "Hale Vol. I, 13 May 2026" }]),
  rel("rel_afff_rep_02", P.jordanWhitfield, P.helenVoss, "represents", 3, "Defending deposition", [{ excerpt: "Voss Vol. I, 17 Jun 2026" }]),
  rel("rel_afff_rep_03", P.jordanWhitfield, P.alanPryce, "represents", 3, "Defending deposition", [{ excerpt: "Pryce Vol. I, 22 Jul 2026" }]),
  rel("rel_afff_rep_04", P.priyaRaman, P.nadiaBrooks, "represents", 2, "Defending deposition", [{ excerpt: "Brooks Vol. I, 10 Sep 2026" }]),
  rel("rel_afff_rep_05", P.jordanWhitfield, P.martinSuarez, "represents", 2, "Defending deposition (scheduled 21 Oct 2026)"),
  rel("rel_afff_rep_06", P.robertKaine, P.alanPryce, "represents", 3, "In-house counsel advice on 8(e) and marketing claims", [{ bates: "MFC-0041921", docId: "ed_afff_0016" }, { bates: "MFC-0041968", docId: "ed_afff_0036" }]),
  rel("rel_afff_rep_07", P.martinSuarez, P.gregoryHale, "represents", 2, "Regulatory advice on MW-7 notification", [{ bates: "MFC-0052218", docId: "ed_afff_0060" }]),
  // Meetings
  rel("rel_afff_mtg_01", P.alanPryce, P.gregoryHale, "meeting", 2, "9 Jul 2002, 2 p.m. — MW-7 notification", [{ bates: "MFC-0052217", docId: "ed_afff_0059", excerpt: "I want a meeting with you, Martin, Paul and Rob in my office at 2 today." }]),
  rel("rel_afff_mtg_02", P.alanPryce, P.martinSuarez, "meeting", 2, "9 Jul 2002, 2 p.m.", [{ bates: "MFC-0052217", docId: "ed_afff_0059" }]),
  rel("rel_afff_mtg_03", P.alanPryce, X.merrick, "meeting", 2, "9 Jul 2002, 2 p.m.", [{ bates: "MFC-0052217", docId: "ed_afff_0059" }]),
  rel("rel_afff_mtg_04", P.alanPryce, P.robertKaine, "meeting", 2, "9 Jul 2002, 2 p.m.", [{ bates: "MFC-0052217", docId: "ed_afff_0059" }]),
  rel("rel_afff_mtg_05", P.helenVoss, P.alanPryce, "meeting", 2, "16 Mar 2001 Friday working group", [{ excerpt: "Voss 43:2" }]),
  rel("rel_afff_mtg_06", P.helenVoss, P.nadiaBrooks, "meeting", 2, "16 Mar 2001 Friday working group", [{ excerpt: "Voss 43:2" }]),
  rel("rel_afff_mtg_07", P.helenVoss, P.martinSuarez, "meeting", 1, "16 Mar 2001 (joined late)", [{ excerpt: "Voss 43:2" }]),
  // Testimony about
  rel("rel_afff_test_01", P.helenVoss, P.alanPryce, "testified_about", 4, "Bioassay budget decision, distribution restriction, MSDS", [{ excerpt: "Voss 44:13, 49:8, 156:9" }]),
  rel("rel_afff_test_02", P.helenVoss, P.gregoryHale, "testified_about", 3, "'No adverse findings' memo", [{ excerpt: "Voss 39:15" }]),
  rel("rel_afff_test_03", P.gregoryHale, P.alanPryce, "testified_about", 4, "'Do not put this in email'; hold on notification", [{ excerpt: "Hale 51:4, 52:1" }]),
  rel("rel_afff_test_04", P.gregoryHale, P.helenVoss, "testified_about", 2, "Memo review", [{ excerpt: "Hale 22:19" }]),
  rel("rel_afff_test_05", P.alanPryce, P.helenVoss, "testified_about", 3, "'Preliminary' characterisation", [{ excerpt: "Pryce 47:2" }]),
  rel("rel_afff_test_06", P.alanPryce, P.martinSuarez, "testified_about", 2, "Reporting decision; EPA summary", [{ excerpt: "Pryce 48:12, 88:12" }]),
  rel("rel_afff_test_07", P.nadiaBrooks, P.alanPryce, "testified_about", 2, "MSDS decision; removal from thread", [{ excerpt: "Brooks 15:14, 72:12" }]),
  rel("rel_afff_test_08", P.gregoryHale, X.rourke, "testified_about", 2, "15 Jul 2002 call", [{ excerpt: "Hale 49:17" }]),
  rel("rel_afff_test_09", P.alanPryce, X.whitcomb, "testified_about", 2, "NAVSEA response", [{ excerpt: "Pryce 88:12" }]),
  // Opposing counsel
  rel("rel_afff_opp_01", P.opposingCounselKlein, P.gregoryHale, "other", 2, "Examined at deposition"),
  rel("rel_afff_opp_02", P.opposingCounselKlein, P.helenVoss, "other", 2, "Examined at deposition"),
  rel("rel_afff_opp_03", P.opposingCounselKlein, P.alanPryce, "other", 2, "Examined at deposition"),
  rel("rel_afff_opp_04", P.opposingCounselKlein, P.nadiaBrooks, "other", 2, "Examined at deposition"),
  rel("rel_afff_exp_01", P.drRajPatelHydro, X.nunez, "other", 1, "Relies on Beacon monitoring data", [{ bates: "MFC-0052212", docId: "ed_afff_0058" }]),
];

/** Derive emailed / cc edges from the seeded email headers, aggregated per pair. */
export function deriveEmailRelationships(docs: EDocument[], people: Person[]): Relationship[] {
  const agg = new Map<string, Relationship>();
  for (const d of docs) {
    if (d.matterId !== M || !d.from) continue;
    const from = resolvePersonName(d.from, people);
    if (!from) continue;
    const add = (name: string, kind: "emailed" | "cc") => {
      const to = resolvePersonName(name, people);
      if (!to || to.id === from.id) return;
      const key = `${from.id}|${to.id}|${kind}`;
      let r = agg.get(key);
      if (!r) { r = { id: `rel_afff_mail_${kind}_${from.id}_${to.id}`, matterId: M, fromId: from.id, toId: to.id, kind, weight: 0, evidence: [] }; agg.set(key, r); }
      r.weight += 1;
      if ((r.evidence?.length ?? 0) < 6) r.evidence!.push({ bates: d.bates, docId: d.id, excerpt: d.subject });
    };
    for (const t of d.to ?? []) add(t, "emailed");
    for (const c of d.cc ?? []) add(c, "cc");
  }
  return Array.from(agg.values());
}

// ---------------------------------------------------------------------------

/** Analysis seed: depositions, chronology, relationships, conflicts, external people. Idempotent. */
export function seedAnalysis(db: Database) {
  db.people.putMany(EXTRA_PEOPLE);
  db.depositions.putMany(AFFF_DEPOSITIONS);
  db.timeline.putMany(AFFF_TIMELINE);
  const people = db.people.all();
  const docs = db.edocs.find((d) => d.matterId === M);
  db.relationships.putMany([...EXPLICIT_RELATIONSHIPS, ...deriveEmailRelationships(docs, people)]);
  db.conflicts.putMany(AFFF_CONFLICTS);
}

export const ANALYSIS_SEED_IDS = {
  depositions: { voss: VOSS_DEPOSITION.id, hale: HALE_DEPOSITION.id, pryce: PRYCE_DEPOSITION.id, brooks: BROOKS_DEPOSITION.id, haleVol2: "dep_afff_hale_v2", suarez: "dep_afff_suarez_v1" },
  conflicts: AFFF_CONFLICTS.map((c) => c.id),
  timelineCount: AFFF_TIMELINE.length,
  extraPeople: EXTRA_PEOPLE.map((p) => p.id),
} as const;
