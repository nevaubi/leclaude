import { MATTERS, PEOPLE } from "@/lib/seed/ids";
import type { Story, StoryFact } from "./types";

const M = MATTERS.afff;
const P = PEOPLE;
let n = 0;
function fact(date: string, text: string, evidence: StoryFact["evidence"], extra: Partial<StoryFact> = {}): StoryFact {
  n += 1;
  return { id: `sf_afff_${String(n).padStart(2, "0")}`, order: n, date, precision: "day", text, evidence, confidence: 0.9, verified: true, origin: "timeline", ...extra };
}

/**
 * Seeded story for the AFFF matter: the defence chronology of what Meridian
 * knew about MF-3 persistence and when it told regulators, customers and the
 * Navy. Every fact cites documents by Bates, testimony by page:line, chronology
 * events by id, and the intelligence corpus by record id.
 */
export const AFFF_STORY: Story = {
  id: "story_afff_knowledge",
  matterId: M,
  title: "What Meridian knew about MF-3 persistence, and when it disclosed it",
  theme: "Knowledge, reporting decisions and disclosure — 2001 to the MDL",
  createdAt: "2026-09-12T15:20:00.000Z",
  updatedAt: "2026-09-18T09:40:00.000Z",
  createdBy: P.jordanWhitfield,
  meta: { seeded: true },
  facts: [
    fact("2001-03-14", "Whitfield Laboratories delivered the final 90-day rat study: dose-related liver effects, a NOAEL of 0.1 mg/kg-day and a serum half-life of about 100 days.", [
      { kind: "document", docId: "ed_afff_0001", bates: "MFC-0041877", excerpt: "FINAL REPORT SUMMARY" },
      { kind: "document", docId: "ed_afff_0002", bates: "MFC-0041880", excerpt: "the liver effects are real, they are dose-related, and they did not fully reverse" },
      { kind: "testimony", depositionId: "dep_afff_voss_v1", witness: "Helen Voss", page: 24, line: 5 },
      { kind: "event", eventId: "tl_afff_006", title: "Whitfield final report" },
    ], { personIds: [P.helenVoss, P.gregoryHale, P.drLindaWhitfieldTox], confidence: 0.98 }),
    fact("2001-03-19", "Hale's EHS memo went out stating 'no adverse findings at exposures relevant to occupational use'; his own draft two days earlier said end-user margins could not be established.", [
      { kind: "document", docId: "ed_afff_0011", bates: "MFC-0041912", excerpt: "no adverse findings at exposures relevant to occupational use of the product" },
      { kind: "document", docId: "ed_afff_0034", bates: "MFC-0041965", excerpt: "margins for end-users cannot be established" },
      { kind: "testimony", depositionId: "dep_afff_hale_v1", witness: "Gregory Hale", page: 22, line: 10 },
      { kind: "testimony", depositionId: "dep_afff_voss_v1", witness: "Helen Voss", page: 39, line: 15 },
      { kind: "event", eventId: "tl_afff_011" },
    ], { disputed: true, personIds: [P.gregoryHale, P.alanPryce], confidence: 0.85 }),
    fact("2001-03-26", "Meridian decided not to submit a TSCA §8(e) notice on the 90-day study and to run a two-year bioassay first.", [
      { kind: "document", docId: "ed_afff_0020", bates: "MFC-0041936" },
      { kind: "document", docId: "ed_afff_0015", bates: "MFC-0041920", excerpt: "If there is a defensible path that involves doing the bioassay first and reporting when we actually know something, that is the path I want." },
      { kind: "testimony", depositionId: "dep_afff_pryce_v1", witness: "Alan Pryce", page: 48, line: 12 },
      { kind: "testimony", depositionId: "dep_afff_voss_v1", witness: "Helen Voss", page: 102, line: 15 },
      { kind: "event", eventId: "tl_afff_015" },
    ], { personIds: [P.martinSuarez, P.robertKaine, P.alanPryce], confidence: 0.95 }),
    fact("2001-04-04", "Pryce struck 'may accumulate' from the MSDS revision and kept Section 12 at 'has not been determined'.", [
      { kind: "document", docId: "ed_afff_0023", bates: "MFC-0041942", excerpt: "'may accumulate' comes out" },
      { kind: "testimony", depositionId: "dep_afff_voss_v1", witness: "Helen Voss", page: 155, line: 18 },
      { kind: "testimony", depositionId: "dep_afff_brooks_v1", witness: "Nadia Brooks", page: 15, line: 14 },
      { kind: "event", eventId: "tl_afff_016" },
    ], { personIds: [P.alanPryce, P.nadiaBrooks, P.helenVoss] }),
    fact("2001-05-04", "Voss told marketing that Slide 8 of the Aqua-Guard plan was false: MF-3 was the same PFOS chemistry 3M was withdrawing. The brochure kept 'biodegradable' until 2003.", [
      { kind: "document", docId: "ed_afff_0033", bates: "MFC-0041964", excerpt: "Slide 8 is false." },
      { kind: "testimony", depositionId: "dep_afff_voss_v1", witness: "Helen Voss", page: 56, line: 3 },
      { kind: "testimony", depositionId: "dep_afff_liu_v1", witness: "Karen Liu", page: 12, line: 1, excerpt: "The word \"readily\" was removed. \"Biodegradable\" stayed in the customer brochure through 2003." },
      { kind: "event", eventId: "tl_afff_022" },
    ], { personIds: [P.helenVoss, P.alanPryce], confidence: 0.95 }),
    fact("2001-09-18", "First PFOS detection in Decatur groundwater: MW-7, downgradient of Lagoon 2, at 12.0 µg/L.", [
      { kind: "document", docId: "ed_afff_0049", bates: "MFC-0041988", excerpt: "MW-7 (downgradient of Lagoon 2, 18–28 ft screen): PFOS 12.0 µg/L" },
      { kind: "testimony", depositionId: "dep_afff_hale_v1", witness: "Gregory Hale", page: 38, line: 9 },
      { kind: "event", eventId: "tl_afff_030" },
    ], { personIds: [P.gregoryHale] }),
    fact("2002-07-08", "After Beacon reported MW-7 at 41 µg/L and 6.8 µg/L at the property line, Hale recommended notifying Illinois EPA 'voluntarily, now' and sampling the city wells.", [
      { kind: "document", docId: "ed_afff_0058", bates: "MFC-0052212" },
      { kind: "document", docId: "ed_afff_0057", bates: "MFC-0052210", excerpt: "we have an off-site migration of a compound we know is persistent and bioaccumulative, toward a public water supply" },
      { kind: "testimony", depositionId: "dep_afff_hale_v1", witness: "Gregory Hale", page: 47, line: 6 },
      { kind: "event", eventId: "tl_afff_035" },
    ], { disputed: true, personIds: [P.gregoryHale, P.alanPryce], confidence: 0.88 }),
    fact("2002-07-09", "Pryce replied 'Do not put this in email' and held notification pending Legal; the 2 p.m. meeting closed Lagoon 2 and deferred notice to another data round.", [
      { kind: "document", docId: "ed_afff_0059", bates: "MFC-0052217", excerpt: "Nothing goes to the state or to the city until Legal has looked at it" },
      { kind: "testimony", depositionId: "dep_afff_pryce_v1", witness: "Alan Pryce", page: 72, line: 14 },
      { kind: "testimony", depositionId: "dep_afff_hale_v1", witness: "Gregory Hale", page: 52, line: 1 },
      { kind: "event", eventId: "tl_afff_036" },
    ], { personIds: [P.alanPryce, P.gregoryHale, P.martinSuarez] }),
    fact("2002-10-24", "Hale's letter notified the City of Decatur and offered wellfield sampling, 108 days after his 'now' recommendation.", [
      { kind: "document", docId: "ed_afff_0063", bates: "MFC-0052221" },
      { kind: "testimony", depositionId: "dep_afff_hale_v1", witness: "Gregory Hale", page: 61, line: 4 },
      { kind: "event", eventId: "tl_afff_042" },
    ], { personIds: [P.gregoryHale, P.martinSuarez] }),
    fact("2002-10-28", "Meridian filed a TSCA §8(e) notice on the two-year bioassay interim results (hepatocellular adenomas at 12 months).", [
      { kind: "document", docId: "ed_afff_0066", bates: "MFC-0052226" },
      { kind: "testimony", depositionId: "dep_afff_voss_v1", witness: "Helen Voss", page: 102, line: 7 },
      { kind: "testimony", depositionId: "dep_afff_pryce_v1", witness: "Alan Pryce", page: 210, line: 16 },
      { kind: "event", eventId: "tl_afff_043" },
    ], { confidence: 0.7, verified: false, personIds: [P.martinSuarez, P.robertKaine] }),
    fact("2010-02-16", "Meridian wrote to customers of record disclosing that the discontinued product contained PFOS and that the fluorosurfactant persists.", [
      { kind: "document", docId: "ed_afff_0078", bates: "MFC-0052254" },
      { kind: "testimony", depositionId: "dep_afff_pryce_v1", witness: "Alan Pryce", page: 114, line: 9 },
      { kind: "testimony", depositionId: "dep_afff_brooks_v1", witness: "Nadia Brooks", page: 58, line: 4 },
      { kind: "event", eventId: "tl_afff_051" },
    ], { personIds: [P.nadiaBrooks] }),
    fact("2018-12-07", "The Judicial Panel on Multidistrict Litigation transferred the AFFF cases to the District of South Carolina as MDL No. 2873 before Judge Gergel.", [
      { kind: "intel", docId: "idoc_seed_afff_entry_transfer", title: "Dkt. 1: Transfer Order creating MDL No. 2873", url: "https://www.jpml.uscourts.gov/pending-mdls-0" },
      { kind: "intel", docId: "idoc_seed_op_afff_jpml", title: "In re Aqueous Film-Forming Foams Prods. Liab. Litig. (J.P.M.L. 2018)" },
    ], { origin: "intel", confidence: 0.92, verified: false }),
    fact("2024-04-26", "EPA published the PFAS National Primary Drinking Water Regulation, setting enforceable MCLs of 4.0 ppt for PFOA and PFOS.", [
      { kind: "intel", docId: "idoc_seed_fr_pfas_npdwr", title: "89 FR 32532 — PFAS National Primary Drinking Water Regulation", url: "https://www.federalregister.gov/documents/2024/04/26/2024-07773/pfas-national-primary-drinking-water-regulation" },
    ], { origin: "intel", confidence: 0.85, verified: false }),
  ],
};
