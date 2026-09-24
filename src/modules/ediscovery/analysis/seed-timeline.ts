import type { TimelineEvent } from "@/lib/types/domain";
import { MATTERS, PEOPLE } from "@/lib/seed/ids";
import { EXTRA_PEOPLE_IDS as X } from "./seed-people";

const M = MATTERS.afff;
const P = PEOPLE;

type Src = TimelineEvent["sources"][number];
const doc = (bates: string, id: string, excerpt?: string): Src => ({ kind: "document", bates, id, excerpt });
const depo = (id: string, cite: string, excerpt?: string): Src => ({ kind: "deposition", id, cite, excerpt });
const ext = (cite: string, excerpt?: string): Src => ({ kind: "external", cite, excerpt });

let n = 0;
function ev(date: string, title: string, category: TimelineEvent["category"], significance: TimelineEvent["significance"], sources: Src[], extra: Partial<TimelineEvent> = {}): TimelineEvent {
  n += 1;
  return { id: `tl_afff_${String(n).padStart(3, "0")}`, matterId: M, date, title, category, significance, sources, createdBy: "user", verified: true, ...extra };
}

/** AFFF chronology, 1998–2027, every entry sourced to seeded Bates numbers or transcript cites. */
export const AFFF_TIMELINE: TimelineEvent[] = [
  ev("1998-03-10", "Building 7 floor-drain routing to Lagoon 2 identified as CAP-98-114", "corporate", 2, [doc("MFC-0041988", "ed_afff_0049", "Building 7 floor drain re-route (CAP-98-114)")], { description: "Corrective-action item opened for the tote-wash floor drain that discharged to Lagoon 2; not funded until September 2001.", personIds: [P.gregoryHale], precision: "month" }),
  ev("1999-06-15", "Decatur industrial hygiene survey of the blending area", "scientific", 2, [doc("MFC-0041912", "ed_afff_0011", "1999 industrial hygiene survey")], { description: "Measured operator exposures later used by Hale to compute a 100–300× margin below the Whitfield NOAEL.", personIds: [P.gregoryHale], precision: "month" }),
  ev("2000-05-16", "3M announces phase-out of PFOS chemistry", "regulatory", 4, [ext("3M press release, 16 May 2000"), doc("MFC-0041964", "ed_afff_0033", "the same active substance that 3M is withdrawing")], { description: "Industry-wide inflection point; Voss later cites it in rejecting the 'different, biodegradable' marketing claim." }),
  ev("2000-06-05", "Whitfield Laboratories commissioned for 90-day rat study WL-2000-0417", "scientific", 3, [doc("MFC-0041898", "ed_afff_0008", "transmittal letter and invoice")], { personIds: [P.helenVoss, P.drLindaWhitfieldTox], precision: "month" }),
  ev("2000-12-08", "Voss flags early liver findings from the Whitfield in-life phase", "scientific", 3, [doc("MFC-0041880", "ed_afff_0002", "the headline is what I flagged in December")], { personIds: [P.helenVoss], precision: "month" }),
  ev("2001-03-14", "Whitfield final report: dose-related liver effects, NOAEL 0.1 mg/kg-day, ~100-day half-life", "scientific", 5, [doc("MFC-0041877", "ed_afff_0001", "FINAL REPORT SUMMARY"), doc("MFC-0041880", "ed_afff_0002", "the liver effects are real, they are dose-related, and they did not fully reverse"), depo("dep_afff_voss_v1", "Voss 24:5")], { personIds: [P.helenVoss, P.gregoryHale, P.nadiaBrooks, P.drLindaWhitfieldTox] }),
  ev("2001-03-15", "Pryce: 'keep the report and the summary to the four of us'", "communication", 4, [doc("MFC-0041882", "ed_afff_0004", "Do not forward it to the plant, to marketing, or to the Navy program office."), depo("dep_afff_pryce_v1", "Pryce 18:10")], { personIds: [P.alanPryce, P.helenVoss] }),
  ev("2001-03-16", "Friday working-group meeting: bioassay to be proposed; report held pending Legal", "corporate", 4, [depo("dep_afff_voss_v1", "Voss 43:2"), doc("MFC-0041904", "ed_afff_0009")], { personIds: [P.helenVoss, P.gregoryHale, P.nadiaBrooks, P.alanPryce, P.martinSuarez] }),
  ev("2001-03-16", "Voss recalculates dose-response and margin of exposure in lab notebook", "scientific", 2, [doc("MFC-0041884", "ed_afff_0006")], { personIds: [P.helenVoss] }),
  ev("2001-03-18", "Hale EHS assessment DRAFT v2: 'margins for end-users cannot be established'", "communication", 4, [doc("MFC-0041965", "ed_afff_0034"), depo("dep_afff_hale_v1", "Hale 25:1")], { personIds: [P.gregoryHale] }),
  ev("2001-03-19", "Hale EHS memo issued: 'no adverse findings at exposures relevant to occupational use'", "communication", 5, [doc("MFC-0041912", "ed_afff_0011", "no adverse findings at exposures relevant to occupational use of the product"), depo("dep_afff_hale_v1", "Hale 22:10"), depo("dep_afff_voss_v1", "Voss 39:15")], { personIds: [P.gregoryHale, P.alanPryce, X.merrick], disputed: true }),
  ev("2001-03-19", "Suarez drafts TSCA §8(e) Notice of Substantial Risk (never filed)", "regulatory", 5, [doc("MFC-0041915", "ed_afff_0013"), doc("MFC-0041914", "ed_afff_0012")], { personIds: [P.martinSuarez, P.robertKaine] }),
  ev("2001-03-19", "Pryce to Kaine: commercial consequences of an 8(e) filing; 'bioassay first' path", "communication", 5, [doc("MFC-0041920", "ed_afff_0015", "If there is a defensible path that involves doing the bioassay first and reporting when we actually know something, that is the path I want."), depo("dep_afff_pryce_v1", "Pryce 32:5")], { personIds: [P.alanPryce, P.robertKaine] }),
  ev("2001-03-22", "Suarez privileged 8(e) analysis memo", "regulatory", 4, [doc("MFC-0041930", "ed_afff_0018")], { personIds: [P.martinSuarez, P.robertKaine] }),
  ev("2001-03-26", "Decision not to submit an 8(e) notice on the 90-day study", "regulatory", 5, [doc("MFC-0041936", "ed_afff_0020"), depo("dep_afff_voss_v1", "Voss 102:15"), depo("dep_afff_pryce_v1", "Pryce 48:12")], { personIds: [P.martinSuarez, P.robertKaine, P.alanPryce] }),
  ev("2001-04-04", "Pryce keeps MSDS Section 12 'has not been determined'; strikes 'may accumulate'", "product", 4, [doc("MFC-0041942", "ed_afff_0023", "'may accumulate' comes out"), depo("dep_afff_voss_v1", "Voss 155:18"), depo("dep_afff_pryce_v1", "Pryce 49:1")], { personIds: [P.alanPryce, P.nadiaBrooks, P.helenVoss] }),
  ev("2001-04-09", "Voss proposes $1.62M two-year bioassay with monkey kinetics and repro screen", "scientific", 3, [doc("MFC-0041945", "ed_afff_0026"), doc("MFC-0041944", "ed_afff_0025")], { personIds: [P.helenVoss] }),
  ev("2001-04-11", "Pryce approves reduced bioassay design (3 groups, no interim sacrifice, ~$920K)", "corporate", 4, [doc("MFC-0041948", "ed_afff_0027", "I will sign the bioassay. I will not sign $1.62M."), depo("dep_afff_voss_v1", "Voss 48:1"), depo("dep_afff_pryce_v1", "Pryce 39:17")], { personIds: [P.alanPryce, P.helenVoss, X.merrick] }),
  ev("2001-04-12", "Macon County FPD asks about foam runoff at the Harristown training facility", "communication", 3, [doc("MFC-0041950", "ed_afff_0029")], { personIds: [X.duffy, P.gregoryHale] }),
  ev("2001-04-24", "Hale responds to Macon County: fluorosurfactant fate 'has not been fully determined'", "communication", 4, [doc("MFC-0041952", "ed_afff_0030", "its behaviour in soil and water has not been fully determined"), depo("dep_afff_hale_v1", "Hale 70:8")], { personIds: [P.gregoryHale, X.duffy] }),
  ev("2001-05-01", "Aqua-Guard 2001–2002 marketing plan drafted with 'biodegradable' claims (Slides 5, 8)", "product", 4, [doc("MFC-0041955", "ed_afff_0032")], { personIds: [P.alanPryce, X.liu] }),
  ev("2001-05-04", "Voss: 'Slide 8 is false' — MF-3 is the same PFOS chemistry 3M is withdrawing", "communication", 5, [doc("MFC-0041964", "ed_afff_0033", "Slide 8 is false."), depo("dep_afff_voss_v1", "Voss 56:3"), depo("dep_afff_pryce_v1", "Pryce 56:5")], { personIds: [P.helenVoss, P.nadiaBrooks, P.alanPryce, X.liu] }),
  ev("2001-05-07", "Kaine gives legal advice on marketing claims", "communication", 2, [doc("MFC-0041968", "ed_afff_0036")], { personIds: [P.robertKaine, P.alanPryce] }),
  ev("2001-05-11", "Decatur operations review notes: 'Lagoon 2 — south third never lined?'", "corporate", 3, [doc("MFC-0041970", "ed_afff_0038"), depo("dep_afff_hale_v1", "Hale 33:5")], { personIds: [P.gregoryHale] }),
  ev("2001-06-08", "EPA OPPT (Marcus Feld) asks whether Meridian has conducted subchronic or chronic studies since 1995", "regulatory", 4, [doc("MFC-0041976", "ed_afff_0040")], { personIds: [P.martinSuarez, P.robertKaine, X.feld] }),
  ev("2001-06-15", "Board pre-read: MF-3 toxicology 'well characterized and supports continued sale'", "corporate", 4, [doc("MFC-0041977", "ed_afff_0041"), depo("dep_afff_pryce_v1", "Pryce 64:7")], { personIds: [P.alanPryce] }),
  ev("2001-06-20", "Board told the rat study 'raised no issues requiring regulatory action'", "corporate", 4, [doc("MFC-0041978", "ed_afff_0042"), depo("dep_afff_pryce_v1", "Pryce 65:18")], { personIds: [P.alanPryce, P.robertKaine] }),
  ev("2001-08-09", "Tidewater Refining complains of a fish kill after foam discharge", "communication", 3, [doc("MFC-0041981", "ed_afff_0044")], { personIds: [P.nadiaBrooks] }),
  ev("2001-08-20", "MW-7 installed downgradient of Lagoon 2", "corporate", 3, [depo("dep_afff_hale_v1", "Hale 34:2")], { personIds: [P.gregoryHale, X.nunez], precision: "month" }),
  ev("2001-09-18", "First PFOS detection in Decatur groundwater: MW-7 at 12.0 µg/L", "scientific", 5, [doc("MFC-0041988", "ed_afff_0049", "MW-7 (downgradient of Lagoon 2, 18–28 ft screen): PFOS 12.0 µg/L"), depo("dep_afff_hale_v1", "Hale 38:9")], { personIds: [P.gregoryHale, X.nunez] }),
  ev("2001-10-04", "Whitfield confirms every high-dose recovery animal retained >70% of serum PFOS", "scientific", 4, [doc("MFC-0041986", "ed_afff_0047"), depo("dep_afff_voss_v1", "Voss 63:9")], { personIds: [P.helenVoss, P.drLindaWhitfieldTox] }),
  ev("2001-11-15", "Q3 2001 EHS quarterly report distributed with MW-7 result", "communication", 3, [doc("MFC-0041987", "ed_afff_0048"), doc("MFC-0041988", "ed_afff_0049")], { personIds: [P.gregoryHale, X.merrick, P.alanPryce, P.nadiaBrooks] }),
  ev("2002-02-19", "Two-year bioassay 3-month serum: not at steady state, rising in every dose group", "scientific", 3, [doc("MFC-0041999", "ed_afff_0055"), doc("MFC-0042000", "ed_afff_0056"), depo("dep_afff_voss_v1", "Voss 79:3")], { personIds: [P.helenVoss] }),
  ev("2002-07-03", "Beacon Q2 2002 groundwater report: MW-7 at 41 µg/L, MW-8 property line 6.8 µg/L", "scientific", 5, [doc("MFC-0052212", "ed_afff_0058"), depo("dep_afff_hale_v1", "Hale 48:3")], { personIds: [X.nunez, P.gregoryHale] }),
  ev("2002-07-08", "Hale recommends notifying Illinois EPA 'voluntarily, now' and sampling city wells", "communication", 5, [doc("MFC-0052210", "ed_afff_0057", "we have an off-site migration of a compound we know is persistent and bioaccumulative, toward a public water supply"), depo("dep_afff_hale_v1", "Hale 47:6")], { personIds: [P.gregoryHale, P.alanPryce, P.martinSuarez], disputed: true }),
  ev("2002-07-09", "Pryce: 'Do not put this in email … Nothing goes to the state or to the city until Legal has looked at it'", "communication", 5, [doc("MFC-0052217", "ed_afff_0059"), depo("dep_afff_pryce_v1", "Pryce 72:14"), depo("dep_afff_hale_v1", "Hale 52:1")], { personIds: [P.alanPryce, P.gregoryHale] }),
  ev("2002-07-09", "2 p.m. meeting: close Lagoon 2, add wells, hold notification pending another data round", "corporate", 4, [depo("dep_afff_hale_v1", "Hale 56:9"), doc("MFC-0052219", "ed_afff_0061"), doc("MFC-0052218", "ed_afff_0060")], { personIds: [P.alanPryce, P.martinSuarez, X.merrick, P.robertKaine, P.gregoryHale] }),
  ev("2002-07-15", "Illinois EPA (Janet Rourke) calls; Hale 'did not raise MW-7'", "regulatory", 4, [doc("MFC-0052220", "ed_afff_0062"), depo("dep_afff_hale_v1", "Hale 50:8")], { personIds: [P.gregoryHale, X.rourke] }),
  ev("2002-09-11", "12-month interim: hepatocellular adenomas in mid- and high-dose males", "scientific", 5, [doc("MFC-0052226", "ed_afff_0066"), doc("MFC-0052225", "ed_afff_0065"), depo("dep_afff_voss_v1", "Voss 91:18")], { personIds: [P.helenVoss, P.drLindaWhitfieldTox] }),
  ev("2002-09-16", "Kaine: decision to file an 8(e) notice on the interim results", "regulatory", 4, [doc("MFC-0052236", "ed_afff_0067")], { personIds: [P.robertKaine, P.martinSuarez, P.helenVoss] }),
  ev("2002-10-07", "Pryce responds to NAVSEA: no 8(e) 'to date'; tumours not mentioned", "communication", 5, [doc("MFC-0052238", "ed_afff_0069"), doc("MFC-0052237", "ed_afff_0068"), depo("dep_afff_pryce_v1", "Pryce 89:10")], { personIds: [P.alanPryce, X.whitcomb] }),
  ev("2002-10-24", "Hale letter notifies City of Decatur; offers wellfield sampling (108 days after 'now')", "regulatory", 5, [doc("MFC-0052221", "ed_afff_0063"), depo("dep_afff_hale_v1", "Hale 61:4")], { personIds: [P.gregoryHale, X.ferrante, P.martinSuarez] }),
  ev("2002-10-28", "TSCA §8(e) notice filed on two-year bioassay interim results", "regulatory", 5, [depo("dep_afff_voss_v1", "Voss 102:7"), depo("dep_afff_pryce_v1", "Pryce 210:16"), ext("EPA 8EHQ docket (to be confirmed)")], { personIds: [P.martinSuarez, P.robertKaine], verified: false }),
  ev("2003-02-11", "Product stewardship review of C8 alternatives; human half-life scaled to years", "product", 3, [doc("MFC-0052239", "ed_afff_0070"), depo("dep_afff_voss_v1", "Voss 72:6")], { personIds: [P.nadiaBrooks, P.helenVoss] }),
  ev("2003-05-20", "EPA §8(d) request response plan", "regulatory", 3, [doc("MFC-0052242", "ed_afff_0071")], { personIds: [P.martinSuarez] }),
  ev("2003-09-30", "Decatur worker serum biomonitoring: median PFOS ~1,900 ng/mL", "scientific", 4, [depo("dep_afff_voss_v1", "Voss 131:3")], { personIds: [P.helenVoss], precision: "month", verified: false }),
  ev("2004-06-30", "MW-7 peaks at 66 µg/L", "scientific", 3, [depo("dep_afff_hale_v1", "Hale 91:12"), doc("MFC-0052246", "ed_afff_0072")], { personIds: [P.gregoryHale], precision: "month", verified: false }),
  ev("2005-02-28", "Two-year bioassay final report: positive for liver carcinogenicity in the rat", "scientific", 5, [doc("MFC-0052248", "ed_afff_0074"), doc("MFC-0052247", "ed_afff_0073"), depo("dep_afff_voss_v1", "Voss 118:9")], { personIds: [P.helenVoss, P.drLindaWhitfieldTox] }),
  ev("2006-06-19", "Aqua-Guard C6 transition timeline adopted", "product", 4, [doc("MFC-0052251", "ed_afff_0075"), depo("dep_afff_pryce_v1", "Pryce 106:3")], { personIds: [P.alanPryce] }),
  ev("2008-09-30", "Meridian joins EPA 2010/2015 PFOA Stewardship Program; Aqua-Guard 3/6 discontinued", "regulatory", 3, [doc("MFC-0052252", "ed_afff_0076"), depo("dep_afff_pryce_v1", "Pryce 219:8")], { personIds: [P.martinSuarez, P.alanPryce] }),
  ev("2010-02-16", "Customer letter discloses PFOS content and persistence to customers of record", "communication", 4, [doc("MFC-0052254", "ed_afff_0078"), doc("MFC-0052253", "ed_afff_0077"), depo("dep_afff_pryce_v1", "Pryce 114:9")], { personIds: [P.nadiaBrooks] }),
  ev("2011-08-23", "Illinois EPA monitoring term ends; MW-7 at ~9 µg/L", "regulatory", 2, [doc("MFC-0052256", "ed_afff_0079"), depo("dep_afff_hale_v1", "Hale 91:12")], { personIds: [P.gregoryHale] }),
  ev("2012-04-11", "Litigation hold issued — AFFF / PFOS claims", "litigation", 4, [doc("MFC-0052257", "ed_afff_0080")], { personIds: [P.robertKaine] }),
  ev("2012-11-29", "Retrospective review of the March 2001 8(e) decision (work product)", "litigation", 3, [doc("MFC-0052258", "ed_afff_0081")], { personIds: [P.martinSuarez, P.robertKaine] }),
  ev("2016-08-19", "Kaine 8(e) recommendation for the Tuesday call", "regulatory", 3, [doc("MFC-0043877", "ed_afff_kaine_0001")], { personIds: [P.robertKaine] }),
  ev("2016-09-06", "Privileged 2016 TSCA §8(e) analysis (draft)", "regulatory", 3, [doc("MFC-0043902", "ed_afff_kaine_0003")], { personIds: [P.robertKaine] }),
  ev("2016-10-03", "Decision memo — final (2016 reporting review)", "regulatory", 3, [doc("MFC-0043951", "ed_afff_kaine_0006")], { personIds: [P.robertKaine] }),
  ev("2017-11-02", "Benchmark-dose analysis: BMDL10 0.03 mg/kg-day for hepatic endpoints", "scientific", 3, [doc("MFC-0043211", "ed_afff_43211"), depo("dep_afff_voss_v1", "Voss 139:4")], { personIds: [P.helenVoss] }),
  ev("2017-10-11", "Q3 2017 EHS report references July/August 2017 groundwater interims that cannot be located", "litigation", 4, [doc("MFC-0043105", "ed_afff_43105"), depo("dep_afff_hale_v1", "Hale 190:14")], { personIds: [P.gregoryHale], disputed: true }),
  ev("2018-12-07", "JPML creates MDL No. 2873 (D.S.C.)", "litigation", 4, [ext("In re Aqueous Film-Forming Foams Prods. Liab. Litig., MDL No. 2873 (J.P.M.L. Dec. 7, 2018)")], {}),
  ev("2023-02-14", "Calloway & Reyes engaged for Meridian Fluorochem", "litigation", 2, [ext("Engagement letter")], { personIds: [P.jordanWhitfield, P.priyaRaman] }),
  ev("2026-05-13", "Deposition of Gregory Hale, Vol. I", "testimony", 4, [depo("dep_afff_hale_v1", "Hale Vol. I")], { personIds: [P.gregoryHale, P.opposingCounselKlein, P.jordanWhitfield] }),
  ev("2026-06-17", "Deposition of Helen Voss, Vol. I", "testimony", 4, [depo("dep_afff_voss_v1", "Voss Vol. I")], { personIds: [P.helenVoss, P.opposingCounselKlein, P.jordanWhitfield] }),
  ev("2026-07-22", "Deposition of Alan Pryce", "testimony", 4, [depo("dep_afff_pryce_v1", "Pryce Vol. I")], { personIds: [P.alanPryce, P.opposingCounselKlein, P.jordanWhitfield, P.priyaRaman] }),
  ev("2026-09-10", "Deposition of Nadia Brooks (rough transcript)", "testimony", 3, [depo("dep_afff_brooks_v1", "Brooks Vol. I")], { personIds: [P.nadiaBrooks, P.priyaRaman] }),
  ev("2026-09-24", "Deposition of Gregory Hale, Vol. II (2015–2019 EHS reporting)", "testimony", 3, [depo("dep_afff_hale_v2", "Hale Vol. II")], { personIds: [P.gregoryHale, P.jordanWhitfield, P.opposingCounselKlein], verified: false }),
  ev("2026-10-14", "Tier 2 custodial production deadline", "litigation", 4, [ext("CMO 26 ¶ 14")], { verified: false }),
  ev("2026-10-21", "Deposition of Martin Suarez (scheduled)", "testimony", 3, [depo("dep_afff_suarez_v1", "Suarez")], { personIds: [P.martinSuarez], verified: false }),
  ev("2026-11-06", "Rebuttal expert reports due", "litigation", 3, [ext("CMO 26 ¶ 22")], { verified: false }),
  ev("2027-03-08", "Bellwether trial (Group C)", "litigation", 5, [ext("Scheduling order, Group C bellwethers")], { verified: false }),
];
