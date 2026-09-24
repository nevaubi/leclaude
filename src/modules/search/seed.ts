import "server-only";
import type { Database } from "@/lib/db";
import { MATTERS, PEOPLE } from "@/lib/seed/ids";
import { makeProvenance } from "@/lib/integrity/provenance";
import { jurisdictionByKey } from "./jurisdictions";
import { sourceFromHit, toProvenanceSources } from "./engine/sources";
import type { ResearchMessage, ResearchSource, ResearchThread } from "./engine/types";
import type { SavedSearch, SearchHit, SearchRun, SearchSettings } from "./types";

const OWNER = PEOPLE.jordanWhitfield;

const base = (over: Partial<SearchSettings> = {}): SearchSettings => ({
  sources: ["caselaw", "statutes", "regulations", "library"],
  jurisdiction: "all-federal",
  courts: "",
  datePreset: "any",
  limit: 15,
  order: "score",
  matterId: null,
  fast: false,
  ...over,
});

const savedSearches: SavedSearch[] = [
  {
    id: "ss_pfas_ftw_ca4",
    name: "PFAS failure to warn — 4th Cir.",
    query: '"failure to warn" AND (PFAS OR PFOA OR PFOS OR "firefighting foam")',
    settings: base({ sources: ["caselaw", "regulations", "federal_register", "library", "ediscovery"], jurisdiction: "4th-circuit", matterId: MATTERS.afff, datePreset: "10y" }),
    ownerId: OWNER, createdAt: "2026-06-11T14:02:00.000Z", updatedAt: "2026-09-18T09:41:00.000Z", lastRunAt: "2026-09-18T09:41:00.000Z", runCount: 14, pinned: true,
    tags: ["AFFF", "products"], matterId: MATTERS.afff,
    notes: "Bellwether Group C prep. Track Judge Gergel's summary-judgment orders on the government contractor defense alongside warning-adequacy cases.",
  },
  {
    id: "ss_conseq_damages_ca7",
    name: "Consequential damages waiver enforceability — 7th Cir.",
    query: '"consequential damages" AND (waiver OR exclusion OR "limitation of liability") AND (enforceab* OR unconscionab* OR "fails of its essential purpose")',
    settings: base({ sources: ["caselaw", "statutes", "library"], jurisdiction: "7th-circuit", matterId: MATTERS.northgate, datePreset: "any", order: "score" }),
    ownerId: OWNER, createdAt: "2026-02-03T16:20:00.000Z", updatedAt: "2026-09-15T18:05:00.000Z", lastRunAt: "2026-09-15T18:05:00.000Z", runCount: 9, pinned: true,
    tags: ["Northgate", "UCC 2-719"], matterId: MATTERS.northgate,
    notes: "MSJ opposition due Oct 9. Focus on Illinois law (810 ILCS 5/2-719) and whether the indemnity carve-out survives the waiver.",
  },
  {
    id: "ss_tsca_8e",
    name: "TSCA 8(e) substantial risk",
    query: '"substantial risk" AND (TSCA OR "2607(e)" OR "section 8(e)")',
    settings: base({ sources: ["statutes", "regulations", "federal_register", "caselaw", "ediscovery"], jurisdiction: "all-federal", matterId: MATTERS.afff }),
    ownerId: OWNER, createdAt: "2026-04-22T11:12:00.000Z", updatedAt: "2026-09-12T13:30:00.000Z", lastRunAt: "2026-09-12T13:30:00.000Z", runCount: 7, pinned: true,
    tags: ["AFFF", "regulatory"], matterId: MATTERS.afff,
    notes: "Knowledge-timeline work: what did Meridian know and when did 8(e) reporting obligations attach? Compare EPA's 2003 8(e) policy statement, 68 Fed. Reg. 33129.",
  },
  {
    id: "ss_paga_manageability",
    name: "PAGA manageability",
    query: 'PAGA AND (manageab* OR unmanageab* OR "trial plan") AND (Estrada OR Wesson)',
    settings: base({ sources: ["caselaw", "statutes", "library"], jurisdiction: "california-state", matterId: MATTERS.sterling, datePreset: "5y" }),
    ownerId: OWNER, createdAt: "2026-08-20T15:44:00.000Z", updatedAt: "2026-09-19T20:12:00.000Z", lastRunAt: "2026-09-19T20:12:00.000Z", runCount: 5, pinned: false,
    tags: ["Sterling", "PAGA"], matterId: MATTERS.sterling,
    notes: "Post-Estrada (Cal. 2024) the manageability strike is gone; look for due-process based limits and the 2024 PAGA reform (AB 2288 / SB 92) standing and cure provisions.",
  },
  {
    id: "ss_meningioma_dmpa",
    name: "Meningioma DMPA",
    query: '(meningioma OR "intracranial tumor") AND (medroxyprogesterone OR DMPA OR "Depo-Provera")',
    settings: base({ sources: ["caselaw", "federal_register", "regulations", "web", "library"], jurisdiction: "11th-circuit", matterId: MATTERS.depo, datePreset: "5y" }),
    ownerId: OWNER, createdAt: "2026-03-14T10:05:00.000Z", updatedAt: "2026-09-16T08:22:00.000Z", lastRunAt: "2026-09-16T08:22:00.000Z", runCount: 11, pinned: true,
    tags: ["Depo-Provera", "science"], matterId: MATTERS.depo,
    notes: "Science Day Nov 20. Watch for FDA labeling actions after Roland et al. (BMJ 2024) and any EMA/PRAC signal assessments.",
  },
  {
    id: "ss_preemption_cbe",
    name: "Impossibility preemption — CBE labeling changes (Albrecht)",
    query: '("clear evidence" OR "impossibility preemption") AND (Albrecht OR "Wyeth v. Levine") AND ("changes being effected" OR CBE OR "314.70")',
    settings: base({ sources: ["caselaw", "regulations", "library"], jurisdiction: "11th-circuit", matterId: MATTERS.depo, datePreset: "10y" }),
    ownerId: OWNER, createdAt: "2026-05-02T09:18:00.000Z", updatedAt: "2026-09-10T17:01:00.000Z", lastRunAt: "2026-09-10T17:01:00.000Z", runCount: 6, pinned: false,
    tags: ["Depo-Provera", "preemption"], matterId: MATTERS.depo,
  },
  {
    id: "ss_govt_contractor_afff",
    name: "Government contractor defense — MilSpec AFFF (Boyle)",
    query: '"government contractor defense" AND (Boyle OR "reasonably precise specifications") AND (AFFF OR "firefighting foam" OR MilSpec)',
    settings: base({ sources: ["caselaw", "dockets", "library", "ediscovery"], jurisdiction: "4th-circuit", matterId: MATTERS.afff }),
    ownerId: OWNER, createdAt: "2026-01-27T13:50:00.000Z", updatedAt: "2026-09-08T11:15:00.000Z", lastRunAt: "2026-09-08T11:15:00.000Z", runCount: 12, pinned: false,
    tags: ["AFFF", "defenses"], matterId: MATTERS.afff,
    notes: "Judge Gergel denied the defense at summary judgment for the City of Stuart bellwether (Sept. 2022). Re-check for any interlocutory treatment.",
  },
  {
    id: "ss_pfas_mcl_rule",
    name: "PFAS drinking water MCL rule (40 C.F.R. 141.61)",
    query: '(PFOA OR PFOS OR "hazard index") AND ("maximum contaminant level" OR MCL) AND "drinking water"',
    settings: base({ sources: ["regulations", "federal_register", "statutes", "web"], jurisdiction: "all-federal", matterId: MATTERS.afff, datePreset: "5y", order: "date" }),
    ownerId: OWNER, createdAt: "2026-04-30T08:40:00.000Z", updatedAt: "2026-09-05T15:27:00.000Z", lastRunAt: "2026-09-05T15:27:00.000Z", runCount: 8, pinned: false,
    tags: ["AFFF", "regulatory", "water providers"], matterId: MATTERS.afff,
  },
  {
    id: "ss_coc_consents_harbor",
    name: "Change-of-control consent / anti-assignment clauses (Delaware)",
    query: '("change of control" OR "anti-assignment") AND (consent OR assignment) AND (merger OR "reverse triangular")',
    settings: base({ sources: ["caselaw", "library"], jurisdiction: "delaware", matterId: MATTERS.harbor, datePreset: "any" }),
    ownerId: OWNER, createdAt: "2026-07-15T12:00:00.000Z", updatedAt: "2026-09-02T10:10:00.000Z", lastRunAt: "2026-09-02T10:10:00.000Z", runCount: 4, pinned: false,
    tags: ["Project Harbor", "M&A"], matterId: MATTERS.harbor,
    notes: "Top-20 customer contracts: does a reverse triangular merger trigger anti-assignment clauses? Meso Scale Diagnostics v. Roche (Del. Ch. 2013).",
  },
  {
    id: "ss_meal_period_rounding",
    name: "Meal-period rounding after Donohue (Cal.)",
    query: '("meal period" OR "meal break") AND rounding AND (Donohue OR "Camp v. Home Depot" OR "See\'s Candy")',
    settings: base({ sources: ["caselaw", "statutes", "library"], jurisdiction: "california-state", matterId: MATTERS.sterling, datePreset: "10y" }),
    ownerId: OWNER, createdAt: "2026-08-24T09:30:00.000Z", updatedAt: "2026-09-17T16:48:00.000Z", lastRunAt: "2026-09-17T16:48:00.000Z", runCount: 3, pinned: false,
    tags: ["Sterling", "wage and hour"], matterId: MATTERS.sterling,
  },
];

// ---- cached example runs (real, verifiable authorities only; anything else carries [VERIFY]) ----

const hit = (h: SearchHit): SearchHit => h;

const twombly = hit({ id: "caselaw:105527", source: "caselaw", title: "Bell Atlantic Corp. v. Twombly", cite: "550 U.S. 544", citations: ["550 U.S. 544", "127 S. Ct. 1955"], court: "Supreme Court of the United States", courtId: "scotus", date: "2007-05-21", status: "Published", citeCount: 158000, snippet: "Factual allegations must be enough to raise a right to relief above the speculative level … a complaint must contain enough facts to state a claim to relief that is plausible on its face.", url: "https://www.courtlistener.com/opinion/145730/bell-atlantic-corp-v-twombly/", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/opinion/145730/bell-atlantic-corp-v-twombly/" } });
const boyle = hit({ id: "caselaw:112120", source: "caselaw", title: "Boyle v. United Technologies Corp.", cite: "487 U.S. 500", citations: ["487 U.S. 500", "108 S. Ct. 2510"], court: "Supreme Court of the United States", courtId: "scotus", date: "1988-06-27", status: "Published", citeCount: 2100, snippet: "Liability for design defects in military equipment cannot be imposed, pursuant to state law, when (1) the United States approved reasonably precise specifications; (2) the equipment conformed to those specifications; and (3) the supplier warned the United States about the dangers in the use of the equipment that were known to the supplier but not to the United States.", url: "https://www.courtlistener.com/opinion/112120/boyle-v-united-technologies-corp/", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/opinion/112120/boyle-v-united-technologies-corp/" } });
const sawyer = hit({ id: "caselaw:sawyer-foster-wheeler", source: "caselaw", title: "Sawyer v. Foster Wheeler LLC", cite: "860 F.3d 249", citations: ["860 F.3d 249"], court: "Court of Appeals for the Fourth Circuit", courtId: "ca4", date: "2017-06-16", status: "Published", citeCount: 190, snippet: "A government contractor need only show a colorable federal defense for purposes of removal under 28 U.S.C. § 1442(a)(1); the merits of the Boyle defense are for the district court.", url: "https://www.courtlistener.com/?q=%22Sawyer+v.+Foster+Wheeler%22", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/?q=%22Sawyer+v.+Foster+Wheeler%22" } });
const wyeth = hit({ id: "caselaw:wyeth-levine", source: "caselaw", title: "Wyeth v. Levine", cite: "555 U.S. 555", citations: ["555 U.S. 555", "129 S. Ct. 1187"], court: "Supreme Court of the United States", courtId: "scotus", date: "2009-03-04", status: "Published", citeCount: 3900, snippet: "Absent clear evidence that the FDA would not have approved a change to Phenergan's label, we will not conclude that it was impossible for Wyeth to comply with both federal and state requirements.", url: "https://www.courtlistener.com/opinion/145906/wyeth-v-levine/", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/opinion/145906/wyeth-v-levine/" } });
const albrecht = hit({ id: "caselaw:merck-albrecht", source: "caselaw", title: "Merck Sharp & Dohme Corp. v. Albrecht", cite: "587 U.S. 299", citations: ["587 U.S. 299", "139 S. Ct. 1668"], court: "Supreme Court of the United States", courtId: "scotus", date: "2019-05-20", status: "Published", citeCount: 900, snippet: "The question of agency disapproval is primarily one of law for a judge to decide … 'clear evidence' is evidence that shows the court that the drug manufacturer fully informed the FDA of the justifications for the warning required by state law and that the FDA, in turn, informed the drug manufacturer that the FDA would not approve a change.", url: "https://www.courtlistener.com/?q=%22Merck+Sharp+%26+Dohme+Corp.+v.+Albrecht%22", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/?q=%22Merck+Sharp+%26+Dohme+Corp.+v.+Albrecht%22" } });
const estrada = hit({ id: "caselaw:estrada-royalty", source: "caselaw", title: "Estrada v. Royalty Carpet Mills, Inc.", cite: "15 Cal. 5th 582", citations: ["15 Cal. 5th 582", "541 P.3d 1082"], court: "Supreme Court of California", courtId: "cal", date: "2024-01-18", status: "Published", citeCount: 260, snippet: "Trial courts lack inherent authority to strike PAGA claims on manageability grounds … courts may, where appropriate and within their discretion, use tools such as limiting witness testimony and other evidence, to manage PAGA claims.", url: "https://www.courtlistener.com/?q=%22Estrada+v.+Royalty+Carpet+Mills%22", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/?q=%22Estrada+v.+Royalty+Carpet+Mills%22" } });
const wesson = hit({ id: "caselaw:wesson-staples", source: "caselaw", title: "Wesson v. Staples the Office Superstore, LLC", cite: "68 Cal. App. 5th 746", citations: ["68 Cal. App. 5th 746"], court: "California Court of Appeal", courtId: "calctapp", date: "2021-09-09", status: "Published", citeCount: 140, snippet: "Trial courts have inherent authority to ensure that PAGA claims can be fairly and efficiently tried and, if necessary, may strike claims that cannot be rendered manageable. [Disapproved by Estrada, 15 Cal. 5th 582 (2024).]", url: "https://www.courtlistener.com/?q=%22Wesson+v.+Staples%22", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/?q=%22Wesson+v.+Staples%22" } });
const hamilton = hit({ id: "caselaw:hamilton-walmart", source: "caselaw", title: "Hamilton v. Wal-Mart Stores, Inc.", cite: "39 F.4th 575", citations: ["39 F.4th 575"], court: "Court of Appeals for the Ninth Circuit", courtId: "ca9", date: "2022-06-24", status: "Published", citeCount: 60, snippet: "Federal courts may not dismiss PAGA claims for lack of manageability under Rule 23 standards; the district court erred in striking the PAGA claim as unmanageable.", url: "https://www.courtlistener.com/?q=%22Hamilton+v.+Wal-Mart%22+39+F.4th+575", authority: "persuasive", readRef: { kind: "url", url: "https://www.courtlistener.com/?q=%22Hamilton+v.+Wal-Mart%22+39+F.4th+575" } });
const samsHotel = hit({ id: "caselaw:sams-environs", source: "caselaw", title: "SAMS Hotel Group, LLC v. Environs, Inc.", cite: "716 F.3d 432", citations: ["716 F.3d 432"], court: "Court of Appeals for the Seventh Circuit", courtId: "ca7", date: "2013-05-30", status: "Published", citeCount: 45, snippet: "Sophisticated commercial parties may allocate risk through a limitation-of-liability clause capping damages at the contract fee; the clause is enforceable even where the architect's negligence caused the building's demolition.", url: "https://www.courtlistener.com/?q=%22SAMS+Hotel+Group%22+716+F.3d+432", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/?q=%22SAMS+Hotel+Group%22+716+F.3d+432" } });
const daubert = hit({ id: "caselaw:daubert", source: "caselaw", title: "Daubert v. Merrell Dow Pharmaceuticals, Inc.", cite: "509 U.S. 579", citations: ["509 U.S. 579", "113 S. Ct. 2786"], court: "Supreme Court of the United States", courtId: "scotus", date: "1993-06-28", status: "Published", citeCount: 52000, snippet: "The trial judge must ensure that any and all scientific testimony or evidence admitted is not only relevant, but reliable.", url: "https://www.courtlistener.com/opinion/112903/daubert-v-merrell-dow-pharmaceuticals-inc/", authority: "binding", readRef: { kind: "url", url: "https://www.courtlistener.com/opinion/112903/daubert-v-merrell-dow-pharmaceuticals-inc/" } });

const cfr14161 = hit({ id: "regulations:40-141.61", source: "regulations", title: "40 C.F.R. § 141.61 — Maximum contaminant levels for organic contaminants", subtitle: "Part 141 · National Primary Drinking Water Regulations", cite: "40 C.F.R. § 141.61", date: "2024-06-25", snippet: "(c) … PFOA 4.0 ng/L (ppt); PFOS 4.0 ng/L (ppt); PFHxS 10 ng/L; PFNA 10 ng/L; HFPO-DA 10 ng/L; Hazard Index of 1 (unitless) for mixtures of two or more of PFHxS, PFNA, HFPO-DA and PFBS.", url: "https://www.ecfr.gov/current/title-40/section-141.61", cfr: { title: "40", part: "141", section: "141.61", heading: "Maximum contaminant levels for organic contaminants", effective: "2024-06-25" }, authority: "n/a", readRef: { kind: "cfr", title: 40, section: "141.61" } });
const cfr3024 = hit({ id: "regulations:40-302.4", source: "regulations", title: "40 C.F.R. § 302.4 — Designation of hazardous substances", subtitle: "Part 302 · Designation, Reportable Quantities, and Notification", cite: "40 C.F.R. § 302.4", date: "2024-07-08", snippet: "The elements and compounds and hazardous wastes appearing in table 302.4 are designated as hazardous substances under section 102(a) of the Act … Perfluorooctanoic acid (PFOA) … Perfluorooctanesulfonic acid (PFOS) … reportable quantity 1 pound.", url: "https://www.ecfr.gov/current/title-40/section-302.4", cfr: { title: "40", part: "302", section: "302.4", heading: "Designation of hazardous substances", effective: "2024-07-08" }, authority: "n/a", readRef: { kind: "cfr", title: 40, section: "302.4" } });
const cfr31470 = hit({ id: "regulations:21-314.70", source: "regulations", title: "21 C.F.R. § 314.70 — Supplements and other changes to an approved NDA", subtitle: "Part 314 · Applications for FDA Approval to Market a New Drug", cite: "21 C.F.R. § 314.70", date: "2024-04-01", snippet: "(c)(6)(iii)(A) Changes in the labeling to reflect newly acquired information … to add or strengthen a contraindication, warning, precaution, or adverse reaction for which the evidence of a causal association satisfies the standard for inclusion in the labeling under § 201.57(c).", url: "https://www.ecfr.gov/current/title-40/section-314.70".replace("title-40", "title-21"), cfr: { title: "21", part: "314", section: "314.70", heading: "Supplements and other changes to an approved NDA", effective: "2024-04-01" }, authority: "n/a", readRef: { kind: "cfr", title: 21, section: "314.70" } });
const cfr20157 = hit({ id: "regulations:21-201.57", source: "regulations", title: "21 C.F.R. § 201.57 — Specific requirements on content and format of labeling for human prescription drug and biological products", subtitle: "Part 201 · Labeling", cite: "21 C.F.R. § 201.57", date: "2024-04-01", snippet: "(c)(6)(i) Warnings and precautions … must describe clinically significant adverse reactions … and other potential safety hazards … the labeling must be revised to include a warning about a clinically significant hazard as soon as there is reasonable evidence of a causal association with a drug; a causal relationship need not have been definitely established.", url: "https://www.ecfr.gov/current/title-21/section-201.57", cfr: { title: "21", part: "201", section: "201.57", heading: "Specific requirements on content and format of labeling", effective: "2024-04-01" }, authority: "n/a", readRef: { kind: "cfr", title: 21, section: "201.57" } });

const frMcl = hit({ id: "federal_register:2024-07773", source: "federal_register", title: "PFAS National Primary Drinking Water Regulation", subtitle: "Rule · Environmental Protection Agency", cite: "89 FR 32532", date: "2024-04-26", status: "Rule", snippet: "EPA is finalizing a National Primary Drinking Water Regulation establishing legally enforceable maximum contaminant levels for six PFAS in drinking water: PFOA, PFOS, PFHxS, PFNA, HFPO-DA, and mixtures containing two or more of PFHxS, PFNA, HFPO-DA, and PFBS.", url: "https://www.federalregister.gov/documents/2024/04/26/2024-07773/pfas-national-primary-drinking-water-regulation", fr: { documentNumber: "2024-07773", type: "Rule", agencies: ["Environmental Protection Agency"], effectiveOn: "2024-06-25", docketIds: ["EPA-HQ-OW-2022-0114"] }, authority: "n/a", readRef: { kind: "fr", id: "2024-07773" } });
const frCercla = hit({ id: "federal_register:2024-08547", source: "federal_register", title: "Designation of Perfluorooctanoic Acid (PFOA) and Perfluorooctanesulfonic Acid (PFOS) as CERCLA Hazardous Substances", subtitle: "Rule · Environmental Protection Agency", cite: "89 FR 39124", date: "2024-05-08", status: "Rule", snippet: "EPA is designating PFOA and PFOS, including their salts and structural isomers, as hazardous substances under section 102(a) of CERCLA … releases of one pound or more within a 24-hour period must be reported.", url: "https://www.federalregister.gov/documents/2024/05/08/2024-08547/designation-of-perfluorooctanoic-acid-pfoa-and-perfluorooctanesulfonic-acid-pfos-as-cercla-hazardous", fr: { documentNumber: "2024-08547", type: "Rule", agencies: ["Environmental Protection Agency"], effectiveOn: "2024-07-08", docketIds: ["EPA-HQ-OLEM-2019-0341"] }, authority: "n/a", readRef: { kind: "fr", id: "2024-08547" } });
const frTsca8e = hit({ id: "federal_register:03-13703", source: "federal_register", title: "TSCA Section 8(e); Notification of Substantial Risk; Policy Clarification and Reporting Guidance", subtitle: "Notice · Environmental Protection Agency", cite: "68 FR 33129", date: "2003-06-03", status: "Notice", snippet: "This notice sets forth EPA's policy on the reporting of substantial risk information under section 8(e) of the Toxic Substances Control Act, including the types of information that should be reported, the time frame for reporting, and the persons who must report.", url: "https://www.federalregister.gov/citation/68-FR-33129", fr: { documentNumber: "03-13703", type: "Notice", agencies: ["Environmental Protection Agency"] }, authority: "n/a", readRef: { kind: "url", url: "https://www.federalregister.gov/citation/68-FR-33129" } });

const usc2607 = hit({ id: "statutes:USCODE-2023-title15-chap53-subchapI-sec2607", source: "statutes", title: "15 U.S.C. 2607 - Reporting and retention of information", subtitle: "USCODE · USCODE-2023-title15", cite: "15 U.S.C. § 2607", date: "2023-01-03", snippet: "(e) Notice to Administrator of substantial risks. Any person who manufactures, processes, or distributes in commerce a chemical substance or mixture and who obtains information which reasonably supports the conclusion that such substance or mixture presents a substantial risk of injury to health or the environment shall immediately inform the Administrator of such information unless such person has actual knowledge that the Administrator has been adequately informed of such information.", url: "https://www.govinfo.gov/app/details/USCODE-2023-title15/USCODE-2023-title15-chap53-subchapI-sec2607", statute: { packageId: "USCODE-2023-title15", granuleId: "USCODE-2023-title15-chap53-subchapI-sec2607", collection: "USCODE", textUrl: "https://www.govinfo.gov/content/pkg/USCODE-2023-title15/html/USCODE-2023-title15-chap53-subchapI-sec2607.htm" }, authority: "n/a", readRef: { kind: "statute", url: "https://www.govinfo.gov/content/pkg/USCODE-2023-title15/html/USCODE-2023-title15-chap53-subchapI-sec2607.htm" } });
const usc1442 = hit({ id: "statutes:USCODE-2023-title28-partIV-chap89-sec1442", source: "statutes", title: "28 U.S.C. 1442 - Federal officers or agencies sued or prosecuted", subtitle: "USCODE · USCODE-2023-title28", cite: "28 U.S.C. § 1442", date: "2023-01-03", snippet: "(a) A civil action … that is commenced in a State court and that is against or directed to any of the following may be removed … (1) The United States or any agency thereof or any officer (or any person acting under that officer) of the United States …", url: "https://www.govinfo.gov/app/details/USCODE-2023-title28/USCODE-2023-title28-partIV-chap89-sec1442", statute: { packageId: "USCODE-2023-title28", granuleId: "USCODE-2023-title28-partIV-chap89-sec1442", collection: "USCODE" }, authority: "n/a", readRef: { kind: "url", url: "https://www.govinfo.gov/app/details/USCODE-2023-title28/USCODE-2023-title28-partIV-chap89-sec1442" } });

const docketAfff = hit({ id: "dockets:afff-mdl-2873", source: "dockets", title: "In re: Aqueous Film-Forming Foams Products Liability Litigation", subtitle: "District Court, D. South Carolina · No. 2:18-mn-02873-RMG", court: "District Court, D. South Carolina", courtId: "dsc", date: "2018-12-07", status: "Open", snippet: "NOS: 365 Personal Injury: Product Liability · Cause: 28:1332 Diversity-Product Liability", url: "https://www.courtlistener.com/?type=r&q=%222%3A18-mn-02873%22", docketNumber: "2:18-mn-02873-RMG", assignedTo: "Richard Mark Gergel", natureOfSuit: "365 Personal Injury: Product Liability", cause: "28:1332 Diversity-Product Liability", parties: ["3M Company", "E.I. du Pont de Nemours and Company", "The Chemours Company", "Tyco Fire Products LP", "National Foam, Inc.", "Kidde-Fenwal, Inc.", "Meridian Fluorochem Corp."], authority: "persuasive", readRef: { kind: "url", url: "https://www.courtlistener.com/?type=r&q=%222%3A18-mn-02873%22" } });
const docketDepo = hit({ id: "dockets:depo-mdl-3140", source: "dockets", title: "In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", subtitle: "District Court, N.D. Florida · No. 3:25-md-03140-MCR-HTC", court: "District Court, N.D. Florida", courtId: "flnd", date: "2025-02-07", status: "Open", snippet: "NOS: 365 Personal Injury: Product Liability · Cause: 28:1332 Diversity-Product Liability", url: "https://www.courtlistener.com/?type=r&q=%223%3A25-md-03140%22", docketNumber: "3:25-md-03140-MCR-HTC", assignedTo: "M. Casey Rodgers", natureOfSuit: "365 Personal Injury: Product Liability", cause: "28:1332 Diversity-Product Liability", parties: ["Pfizer Inc.", "Pharmacia & Upjohn Company LLC", "Greenstone LLC", "Prasco Laboratories"], authority: "persuasive", readRef: { kind: "url", url: "https://www.courtlistener.com/?type=r&q=%223%3A25-md-03140%22" } });

const runs: SearchRun[] = [
  {
    id: "run_seed_pfas_ftw_01",
    query: '"failure to warn" AND (PFAS OR PFOA OR PFOS OR "firefighting foam")',
    settings: base({ sources: ["caselaw", "regulations", "federal_register", "library", "ediscovery"], jurisdiction: "4th-circuit", matterId: MATTERS.afff, datePreset: "10y" }),
    createdAt: "2026-09-18T09:41:12.000Z", durationMs: 7412,
    counts: { caselaw: 15, regulations: 6, federal_register: 9, library: 4, ediscovery: 8 }, totals: { caselaw: 412, regulations: 31, federal_register: 168, library: 4, ediscovery: 8 },
    synthesis: `## Answer
In the Fourth Circuit a failure-to-warn claim against an AFFF manufacturer turns on state law (South Carolina for the D.S.C. bellwethers), which requires a warning that is adequate in light of what the manufacturer knew or should have known about PFOA/PFOS hazards at the time of sale. Federal preemption is not a complete defense; the MilSpec government contractor defense under *Boyle* is the principal federal shield, and Judge Gergel has denied it at summary judgment where the record showed the manufacturers withheld PFAS toxicity knowledge from the Navy [3][4] [VERIFY].

## Analysis
The adequacy of a warning is ordinarily a jury question, and knowledge is measured at the time the product left the manufacturer's control. *Boyle* supplies the three-part government contractor test (reasonably precise specifications, conformance, and disclosure of dangers known to the supplier but not the government) [2]; the third prong is where the AFFF record is weakest for defendants because internal toxicology memoranda (e.g., MFC-0041877 through MFC-0041902) predate the relevant Navy MilSpec revisions [5]. The 2024 EPA rules — the PFAS drinking water MCLs at 40 C.F.R. § 141.61 [6] and the CERCLA designation of PFOA/PFOS [7] — are not retroactive standards of care but plaintiffs cite them as evidence of hazard and to support water-provider damages.

## Jurisdictional caveats
Bellwether trials apply the transferor forum's substantive law; South Carolina, unlike some states, has not adopted a bright-line "sophisticated purchaser" exception to the duty to warn. *Sawyer* addresses removal, not the merits of the defense [3].

## Contrary authority
Plaintiffs will rely on Judge Gergel's September 2022 order denying summary judgment on the government contractor defense in the City of Stuart bellwether [VERIFY — pull the order from the MDL docket, ECF No. 2600 range].

## Next steps
- Pull the Stuart summary-judgment order and any Rule 54(b) or § 1292(b) treatment.
- Build the knowledge timeline from the Hale/Voss custodial files against the MilSpec revision dates.
- Search South Carolina appellate authority on the sophisticated-user defense.

## Sources
[1] Bell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007) — pleading standard only.
[2] Boyle v. United Technologies Corp., 487 U.S. 500 (1988).
[3] Sawyer v. Foster Wheeler LLC, 860 F.3d 249 (4th Cir. 2017).
[4] In re Aqueous Film-Forming Foams Prods. Liab. Litig., No. 2:18-mn-2873-RMG (D.S.C.) — Sept. 2022 order [VERIFY].
[5] MFC-0041877, Voss toxicology memorandum (matter documents).
[6] 40 C.F.R. § 141.61 (2024).
[7] 89 Fed. Reg. 39124 (May 8, 2024).`,
    topHits: [boyle, sawyer, twombly, cfr14161, cfr3024, frMcl, frCercla],
    ownerId: OWNER, matterId: MATTERS.afff, savedSearchId: "ss_pfas_ftw_ca4", aiStatus: "ok",
  },
  {
    id: "run_seed_conseq_02",
    query: '"consequential damages" AND (waiver OR exclusion OR "limitation of liability") AND (enforceab* OR unconscionab* OR "fails of its essential purpose")',
    settings: base({ sources: ["caselaw", "statutes", "library"], jurisdiction: "7th-circuit", matterId: MATTERS.northgate }),
    createdAt: "2026-09-15T18:05:40.000Z", durationMs: 5980,
    counts: { caselaw: 15, statutes: 3, library: 2 }, totals: { caselaw: 1287, statutes: 3, library: 2 },
    synthesis: `## Answer
Under Illinois law as applied by the Seventh Circuit, a negotiated consequential-damages waiver between sophisticated commercial parties is presumptively enforceable; it fails only if unconscionable or if a related exclusive remedy "fails of its essential purpose" and the waiver is not independent of that remedy (810 ILCS 5/2-719(2)-(3)) [1][2]. Northgate's best path is not to attack the waiver head-on but to show that the cargo-loss indemnity carve-out in § 9.3 of the MTSA sits outside the waiver.

## Analysis
*SAMS Hotel Group* enforced a limitation-of-liability clause capping damages at the contract fee even though the architect's negligence required demolition of the building; the court emphasized the parties' sophistication and the clause's clarity [1]. Section 2-719(3) makes exclusions of consequential damages enforceable unless unconscionable, and commercial-loss exclusions are prima facie conscionable [2]. Illinois intermediate courts treat the "essential purpose" and "consequential damages" provisions as independent, so a failed repair remedy does not automatically revive consequential damages [VERIFY — Intrastate Piping & Controls, 315 Ill. App. 3d 248 (2000)].

## Jurisdictional caveats
The MTSA's choice-of-law clause selects Illinois; if Apex argues Indiana law (Joliet cross-dock but Indiana-based carrier), the *SAMS* analysis under Indiana law is directly on point and equally unfavorable to a frontal attack.

## Contrary authority
Courts refuse enforcement where the waiver would leave the non-breaching party with no meaningful remedy for willful misconduct or fraud; develop the record on Apex's knowledge of the cross-dock security lapses.

## Next steps
- Chart every damages category in the MSJ against the § 9.3 indemnity language.
- Pull Illinois appellate decisions on the independence of 2-719(2) and (3).
- Confirm whether the cargo-loss claim sounds in bailment, which some courts treat outside UCC Article 2.

## Sources
[1] SAMS Hotel Group, LLC v. Environs, Inc., 716 F.3d 432 (7th Cir. 2013).
[2] 810 ILCS 5/2-719; U.C.C. § 2-719 (statutes).
[3] Intrastate Piping & Controls, Inc. v. Robert-James Sales, Inc., 315 Ill. App. 3d 248 (2000) [VERIFY].`,
    topHits: [samsHotel],
    ownerId: OWNER, matterId: MATTERS.northgate, savedSearchId: "ss_conseq_damages_ca7", aiStatus: "ok",
  },
  {
    id: "run_seed_tsca_03",
    query: '"substantial risk" AND (TSCA OR "2607(e)" OR "section 8(e)")',
    settings: base({ sources: ["statutes", "regulations", "federal_register", "caselaw", "ediscovery"], jurisdiction: "all-federal", matterId: MATTERS.afff }),
    createdAt: "2026-09-12T13:30:05.000Z", durationMs: 6230,
    counts: { statutes: 4, regulations: 5, federal_register: 12, caselaw: 6, ediscovery: 5 }, totals: { statutes: 4, regulations: 22, federal_register: 97, caselaw: 84, ediscovery: 5 },
    synthesis: `## Answer
TSCA § 8(e), 15 U.S.C. § 2607(e), requires any manufacturer, processor or distributor who obtains information that "reasonably supports the conclusion" that a substance presents a substantial risk of injury to health or the environment to inform EPA "immediately" — EPA's policy statement reads that as within 30 calendar days [1][2]. The duty attaches to corporate knowledge, so the Voss 2011 rat-liver study summary (MFC-0041877) is the pivotal document for when Meridian's obligation arose [3].

## Analysis
EPA's 2003 policy clarification explains that "substantial risk" information includes human epidemiological data and animal studies showing serious effects, and that the reporting obligation is not excused by uncertainty about causation [2]. There is no private right of action under § 8(e), but plaintiffs use non-reporting as evidence of concealment and to support punitive damages. Section 8(e) case law is sparse; enforcement is mostly by consent agreement.

## Jurisdictional caveats
None: § 8(e) is a uniform federal obligation, though state-law fraud and concealment theories vary.

## Contrary authority
Defendants argue that internal, unpublished animal studies with equivocal results do not "reasonably support" a substantial-risk conclusion; the 2003 guidance's examples cut against that reading for serious organ toxicity findings.

## Next steps
- Date-stamp every toxicology study in the custodial set against the 30-day window.
- Search the EPA 8(e) TRIAGE database for Meridian submissions (8EHQ numbers).
- Consider whether any 8(e) submission is privileged or a business-confidential claim under 40 C.F.R. Part 2.

## Sources
[1] 15 U.S.C. § 2607(e).
[2] TSCA Section 8(e); Notification of Substantial Risk; Policy Clarification and Reporting Guidance, 68 Fed. Reg. 33129 (June 3, 2003).
[3] MFC-0041877, H. Voss, "Interim summary — 90-day oral toxicity study" (matter documents).`,
    topHits: [usc2607, frTsca8e],
    ownerId: OWNER, matterId: MATTERS.afff, savedSearchId: "ss_tsca_8e", aiStatus: "ok",
  },
  {
    id: "run_seed_paga_04",
    query: 'PAGA AND (manageab* OR unmanageab* OR "trial plan") AND (Estrada OR Wesson)',
    settings: base({ sources: ["caselaw", "statutes", "library"], jurisdiction: "california-state", matterId: MATTERS.sterling, datePreset: "5y" }),
    createdAt: "2026-09-19T20:12:33.000Z", durationMs: 4870,
    counts: { caselaw: 12, statutes: 2, library: 3 }, totals: { caselaw: 233, statutes: 2, library: 3 },
    synthesis: `## Answer
California trial courts cannot strike or dismiss a PAGA claim as unmanageable; *Estrada* (Cal. 2024) rejected the inherent-authority rule of *Wesson* [1][2]. Sterling's leverage instead comes from (a) due-process limits on representative proof that *Estrada* expressly preserved, (b) the 2024 PAGA amendments' cure and standing provisions, and (c) the court's power to limit the scope of evidence and witnesses under a trial plan.

## Analysis
*Estrada* holds that manageability is not a ground for striking PAGA claims, but confirms that courts may use case-management tools and that a defendant's due-process rights limit the use of representative testimony [1]. *Wesson* is disapproved to the extent inconsistent [2]. In federal court, *Hamilton* reached the same result under Rule 23 principles, so removal does not change the answer [3]. For the LWDA notice, the 2024 amendments (Labor Code §§ 2699, 2699.3 as amended) create a cure mechanism and cap penalties for employers who take "all reasonable steps" — the immediate priority before the October 21 cure deadline.

## Jurisdictional caveats
Superior Court of California, County of Los Angeles applies *Estrada* directly; complex-court judges commonly require an early trial plan.

## Contrary authority
Pre-*Estrada* decisions striking PAGA claims for unmanageability (*Wesson*) remain citable only for the proposition that trial courts may manage proof.

## Next steps
- Draft the cure notice and "reasonable steps" record (rounding audit, meal-period policy attestations).
- Prepare a trial-plan proposal limiting representative testimony by clinic.
- Model penalty exposure under the amended §§ 2699(f), (g).

## Sources
[1] Estrada v. Royalty Carpet Mills, Inc., 15 Cal. 5th 582 (2024).
[2] Wesson v. Staples the Office Superstore, LLC, 68 Cal. App. 5th 746 (2021), disapproved in part.
[3] Hamilton v. Wal-Mart Stores, Inc., 39 F.4th 575 (9th Cir. 2022).`,
    topHits: [estrada, wesson, hamilton],
    ownerId: OWNER, matterId: MATTERS.sterling, savedSearchId: "ss_paga_manageability", aiStatus: "ok",
  },
  {
    id: "run_seed_dmpa_05",
    query: '(meningioma OR "intracranial tumor") AND (medroxyprogesterone OR DMPA OR "Depo-Provera")',
    settings: base({ sources: ["caselaw", "federal_register", "regulations", "web", "library"], jurisdiction: "11th-circuit", matterId: MATTERS.depo, datePreset: "5y" }),
    createdAt: "2026-09-16T08:22:19.000Z", durationMs: 8110,
    counts: { caselaw: 4, federal_register: 3, regulations: 4, web: 6, library: 2 }, totals: { caselaw: 4, federal_register: 3, regulations: 18, web: 6, library: 2 },
    errors: [{ source: "federal_register", message: "Provider rate limit reached. Retry in a minute or add an API token in Settings.", durationMs: 1204 }],
    synthesis: `## Answer
The MDL's failure-to-warn theory rests on the Roland et al. (BMJ 2024) case-control study reporting a roughly 5.6-fold increased meningioma risk with prolonged medroxyprogesterone acetate use, and on the absence of a U.S. label warning while European labels were updated [4]. Preemption is the leading defense: under *Wyeth* and *Albrecht* the manufacturer must show "clear evidence" that FDA would have rejected a CBE warning, a question of law for the court [1][2].

## Analysis
The CBE regulation lets a sponsor add or strengthen a warning without prior approval when there is "reasonable evidence of a causal association" [3]. Plaintiffs will argue the pre-2024 literature (progestogen receptor expression in meningiomas; French ANSM data on cyproterone and nomegestrol) already met that threshold; defendants will emphasize that DMPA-specific data did not exist before Roland. Whether FDA communicated a labeling position after 2024 is the key document request.

## Jurisdictional caveats
N.D. Fla. sits in the Eleventh Circuit, which applies *Albrecht* strictly and treats the preemption question as one for the judge. Bellwether plaintiffs' home-state law will govern the warning standard and learned-intermediary rules.

## Contrary authority
Plaintiffs rely on *Wyeth*'s statement that FDA approval of a label is not conclusive evidence that a stronger warning could not have been added [1].

## Next steps
- Request FDA correspondence on any post-Roland labeling supplement.
- Retain a neuro-oncology epidemiologist to address confounding in the BMJ study before Science Day.
- Track the master complaint's learned-intermediary allegations by plaintiff state.

## Sources
[1] Wyeth v. Levine, 555 U.S. 555 (2009).
[2] Merck Sharp & Dohme Corp. v. Albrecht, 587 U.S. 299 (2019).
[3] 21 C.F.R. § 314.70(c)(6)(iii)(A); 21 C.F.R. § 201.57(c)(6).
[4] Roland N. et al., Use of progestogens and the risk of intracranial meningioma: national case-control study, BMJ 2024;384:e078078 — https://www.bmj.com/content/384/bmj-2023-078078`,
    topHits: [wyeth, albrecht, cfr31470, cfr20157, docketDepo],
    ownerId: OWNER, matterId: MATTERS.depo, savedSearchId: "ss_meningioma_dmpa", aiStatus: "ok",
  },
  {
    id: "run_seed_govk_06",
    query: '"government contractor defense" AND (Boyle OR "reasonably precise specifications") AND (AFFF OR "firefighting foam" OR MilSpec)',
    settings: base({ sources: ["caselaw", "dockets", "library", "ediscovery"], jurisdiction: "4th-circuit", matterId: MATTERS.afff }),
    createdAt: "2026-09-08T11:15:48.000Z", durationMs: 6640,
    counts: { caselaw: 9, dockets: 5, library: 3, ediscovery: 6 }, totals: { caselaw: 141, dockets: 27, library: 3, ediscovery: 6 },
    synthesis: `## Answer
The *Boyle* defense is available in principle to MilSpec AFFF manufacturers — MIL-F-24385 is a reasonably precise specification — but it fails at the third prong if the manufacturer knew of PFAS hazards the Navy did not, which is exactly what the MDL record suggests [1][2]. The defense also supports federal-officer removal under 28 U.S.C. § 1442(a)(1), which requires only a colorable defense [3][4].

## Analysis
Boyle's three elements are conjunctive [1]. The Fourth Circuit in *Sawyer* confirmed the low "colorable" bar for removal but left the merits to the district court [3]. The MDL court's 2022 summary-judgment order found genuine disputes on whether the Navy was warned [VERIFY]. Internal documents from the Hale and Pryce custodial files discussing "known bioaccumulation" (MFC-0038102) will be central to the disclosure prong.

## Jurisdictional caveats
Removal is federal; the merits of the defense are applied uniformly as federal common law but the underlying tort is state law.

## Contrary authority
Plaintiffs argue AFFF sold to municipal fire departments outside the MilSpec channel is not covered at all, and that commercial-formulation choices (fluorosurfactant chemistry) were not dictated by the specification.

## Next steps
- Separate MilSpec vs. commercial sales by lot in the production database.
- Depose the former NAVSEA specification manager on what the Navy knew.
- Review the ECF filings in the 2022 bellwether SJ briefing for the evidence relied on.

## Sources
[1] Boyle v. United Technologies Corp., 487 U.S. 500 (1988).
[2] In re Aqueous Film-Forming Foams Prods. Liab. Litig., MDL No. 2873 (D.S.C.) — docket 2:18-mn-02873-RMG.
[3] Sawyer v. Foster Wheeler LLC, 860 F.3d 249 (4th Cir. 2017).
[4] 28 U.S.C. § 1442(a)(1).`,
    topHits: [boyle, sawyer, docketAfff, usc1442],
    ownerId: OWNER, matterId: MATTERS.afff, savedSearchId: "ss_govt_contractor_afff", aiStatus: "ok",
  },
  {
    id: "run_seed_daubert_07",
    query: '"Rule 702" AND (epidemiolog* OR "general causation") AND (PFAS OR PFOA) AND Daubert',
    settings: base({ sources: ["caselaw", "library"], jurisdiction: "4th-circuit", matterId: MATTERS.afff, datePreset: "10y", fast: true }),
    createdAt: "2026-09-03T15:02:11.000Z", durationMs: 2210,
    counts: { caselaw: 10, library: 1 }, totals: { caselaw: 96, library: 1 },
    synthesis: `## Answer
After the December 2023 amendment to Rule 702, the proponent must show by a preponderance that the expert's opinion reflects a reliable application of reliable methods to sufficient facts; general-causation experts relying on PFAS epidemiology must address dose, study quality and the Bradford Hill factors explicitly [1].

## Analysis
*Daubert* remains the framework [1]; the 2023 amendment clarifies that the reliability inquiry is a threshold question the court must actually decide rather than defer to the jury. The rebuttal reports due November 6 should target the C8 Science Panel "probable link" findings' applicability to non-Ohio Valley exposure levels.

## Jurisdictional caveats
Fourth Circuit review is for abuse of discretion; the MDL court has already ruled on several PFAS experts in the water-provider bellwethers [VERIFY].

## Next steps
- Collect Judge Gergel's prior Rule 702 rulings in MDL 2873.
- Map each plaintiff expert's opinions to the amended Rule 702 elements.
- Commission a dose-response critique from Dr. Whitfield.

## Sources
[1] Daubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993).`,
    topHits: [daubert],
    ownerId: OWNER, matterId: MATTERS.afff, aiStatus: "ok",
  },
  {
    id: "run_seed_mcl_08",
    query: '(PFOA OR PFOS OR "hazard index") AND ("maximum contaminant level" OR MCL) AND "drinking water"',
    settings: base({ sources: ["regulations", "federal_register", "statutes", "web"], jurisdiction: "all-federal", matterId: MATTERS.afff, datePreset: "5y", order: "date" }),
    createdAt: "2026-09-05T15:27:52.000Z", durationMs: 5320,
    counts: { regulations: 8, federal_register: 14, statutes: 2, web: 0 }, totals: { regulations: 40, federal_register: 221, statutes: 2, web: 0 },
    errors: [{ source: "web", message: "OpenAI web search requires OPENAI_API_KEY.", durationMs: 12 }],
    synthesis: undefined,
    topHits: [cfr14161, frMcl, frCercla],
    ownerId: OWNER, matterId: MATTERS.afff, savedSearchId: "ss_pfas_mcl_rule", aiStatus: "no_api_key",
  },
];

// ---- threads derived from the cached runs (one turn each) --------------------

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\.\s*/g, ".").trim().toLowerCase();

/** Map "[n]" numbers in a seeded synthesis' Sources section onto the run's hits (by cite, then by title prefix). */
export function citeMapFromSynthesis(synthesis: string | undefined, hits: SearchHit[]): Record<number, string> {
  const out: Record<number, string> = {};
  if (!synthesis) return out;
  const tail = synthesis.split(/^## Sources\s*$/m)[1] ?? "";
  for (const m of tail.matchAll(/^\[(\d{1,2})\]\s+(.+)$/gm)) {
    const n = Number(m[1]);
    const line = norm(m[2]);
    const hit = hits.find((h) => (h.cite && line.includes(norm(h.cite))) || (h.edoc?.bates && line.includes(norm(h.edoc.bates)))) ?? hits.find((h) => line.includes(norm(h.title).slice(0, 24)));
    if (hit && !Object.values(out).includes(hit.id)) out[n] = hit.id;
  }
  return out;
}

const SEED_LANE = "lane_seed";

function threadFromRun(r: SearchRun, index: number): { thread: ResearchThread; run: SearchRun } {
  const hits = r.topHits ?? [];
  const citeMap = citeMapFromSynthesis(r.synthesis, hits);
  const nOf = new Map(Object.entries(citeMap).map(([n, id]) => [id, Number(n)] as const));
  const sources: ResearchSource[] = hits.map((h, i): ResearchSource => ({ ...sourceFromHit(h, SEED_LANE, new Date(r.createdAt).getTime() + i * 400), read: true, chars: 18_000 + i * 2_300, readMs: 900 + i * 210, cached: i % 2 === 0, excerpt: h.snippet, n: nOf.get(h.id) }));
  const verifyMarks = (r.synthesis?.match(/\[VERIFY/g) ?? []).length;
  const cited = Object.keys(citeMap).length;
  const hasAnswer = Boolean(r.synthesis);
  const verification = hasAnswer ? { status: (verifyMarks ? "partially-verified" : "verified") as "verified" | "partially-verified", supported: cited + 2, unsupported: verifyMarks, contradicted: 0, score: Number(((cited + 2) / (cited + 2 + verifyMarks)).toFixed(2)), checkedAt: r.createdAt } : undefined;
  const stats = { sources: sources.length, read: sources.length, rounds: 1, agents: hasAnswer ? 4 : 2, durationMs: r.durationMs };
  const provenance = hasAnswer ? { ...makeProvenance({ surface: "research", sources: toProvenanceSources(sources.filter((s) => s.n != null)), confidence: verification?.score }), generatedAt: r.createdAt, verification: verification ? { ...verification, method: "claims" as const } : undefined } : undefined;
  const j = jurisdictionByKey(r.settings.jurisdiction).label.split(" (")[0];
  const followUps = hasAnswer ? [`What is the strongest contrary authority in the ${j} on this question?`, r.matterId ? "How does the record in this matter (documents and depositions) bear on the analysis?" : "Which statutes or regulations change the analysis?", "What standard applies at the motion-to-dismiss versus summary-judgment stage?"] : [];
  const answer: ResearchMessage = { id: `msg_seed_${index}_a`, role: "assistant", content: r.synthesis ?? "", createdAt: r.createdAt, runId: r.id, stats, verification: verification ? { ...verification, verdicts: [] } : undefined, provenance, banner: r.aiStatus === "no_api_key" ? "no-api-key" : null, followUps, citeMap, lanes: [{ id: SEED_LANE, name: "Controlling authority", kind: "controlling", status: "done", sources: sources.length, durationMs: r.durationMs, round: 1 }] };
  const threadId = `thr_seed_${r.id.replace(/^run_seed_/, "")}`;
  const thread: ResearchThread = {
    id: threadId,
    title: r.query.length > 72 ? r.query.slice(0, 71).trimEnd() + "…" : r.query,
    matterId: r.matterId ?? null,
    settings: r.settings,
    ownerId: r.ownerId,
    createdAt: r.createdAt,
    updatedAt: r.createdAt,
    messages: [{ id: `msg_seed_${index}_u`, role: "user", content: r.query, createdAt: r.createdAt }, answer],
    sources,
    pins: [],
    runIds: [r.id],
  };
  const run: SearchRun = { ...r, threadId, mode: "deep", stats, verification, provenance, banner: r.aiStatus === "no_api_key" ? undefined : undefined, followUps, sources };
  return { thread, run };
}

/** search module seed: saved searches, cached example runs and their threads (idempotent, stable ids). */
export function seedSearch(db: Database) {
  const derived = runs.map((r, i) => threadFromRun(r, i));
  db.collection<SavedSearch>("search_saved").putMany(savedSearches);
  db.collection<SearchRun>("search_runs").putMany(derived.map((d) => d.run));
  db.collection<ResearchThread>("search_threads").putMany(derived.map((d) => d.thread));
}

export const SEARCH_SEED_IDS = { savedSearches: savedSearches.map((s) => s.id), runs: runs.map((r) => r.id), threads: runs.map((r) => `thr_seed_${r.id.replace(/^run_seed_/, "")}`) };
