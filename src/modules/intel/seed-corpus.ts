/**
 * Offline sample corpus for the intelligence layer. Every record is marked
 * `meta.seeded = true`. Court opinions and regulations are synopses written
 * for this sample (not the official text); where a date or number could not
 * be confirmed the record carries an `unverified` flag. Sample FDA records are
 * modeled on the openFDA enforcement schema and flagged as samples.
 */
import { MATTERS } from "@/lib/seed/ids";
import type { IntelDates, IntelDocumentKind, IntelEntityMention, IntelEntityType, IntelFlag } from "./types";

export type SeedSourceKey = "clOpinions" | "clDockets" | "clJudges" | "ecfr" | "federalRegister" | "govinfo" | "openfda" | "jpml" | "courtRules" | "news" | "localCorpus" | "webList";

export interface SeedDoc {
  id: string;
  source: SeedSourceKey;
  kind: IntelDocumentKind;
  title: string;
  text: string;
  summary?: string;
  jurisdiction?: string;
  court?: string;
  courtId?: string;
  docketNumber?: string;
  caseName?: string;
  citation?: string;
  judgeIds?: string[];
  attorneyIds?: string[];
  firmIds?: string[];
  partyIds?: string[];
  mdlId?: string;
  productIds?: string[];
  agencies?: string[];
  dates: IntelDates;
  url?: string;
  externalId?: string;
  matterIds?: string[];
  tags?: string[];
  flags?: Omit<IntelFlag, "at">[];
  confidence?: number;
  entities?: IntelEntityMention[];
  meta?: Record<string, unknown>;
}

export interface SeedEntity {
  id: string;
  type: IntelEntityType;
  name: string;
  aliases?: string[];
  attributes: Record<string, unknown>;
  externalIds?: Record<string, string>;
}

export const E = {
  gergel: "ient_seed_judge_gergel",
  rodgers: "ient_seed_judge_rodgers",
  gonzalezRogers: "ient_seed_judge_gonzalez_rogers",
  cannon: "ient_seed_judge_cannon",
  london: "ient_seed_atty_london",
  napoli: "ient_seed_atty_napoli",
  summy: "ient_seed_atty_summy",
  thompson: "ient_seed_atty_thompson",
  klein: "ient_seed_atty_klein",
  douglasLondon: "ient_seed_firm_douglas_london",
  napoliShkolnik: "ient_seed_firm_napoli_shkolnik",
  baronBudd: "ient_seed_firm_baron_budd",
  motleyRice: "ient_seed_firm_motley_rice",
  kleinAssociates: "ient_seed_firm_klein_associates",
  mdl2873: "ient_seed_mdl_2873",
  mdl3140: "ient_seed_mdl_3140",
  mdl3047: "ient_seed_mdl_3047",
  mdl3081: "ient_seed_mdl_3081",
  afff: "ient_seed_product_afff",
  depoProvera: "ient_seed_product_depo_provera",
  epa: "ient_seed_agency_epa",
  fda: "ient_seed_agency_fda",
  dsc: "ient_seed_court_dsc",
  flnd: "ient_seed_court_flnd",
  threeM: "ient_seed_party_3m",
  dupont: "ient_seed_party_dupont",
  pfizer: "ient_seed_party_pfizer",
  meridian: "ient_seed_party_meridian",
} as const;

export const SEED_ENTITIES: SeedEntity[] = [
  { id: E.gergel, type: "judge", name: "Richard M. Gergel", aliases: ["Richard Mark Gergel", "Judge Gergel", "Hon. Richard M. Gergel"], attributes: { court: "U.S. District Court for the District of South Carolina", courtId: "dsc", title: "U.S. District Judge", appointedBy: "Barack Obama", commissioned: "2010", mdls: ["2873"] } },
  { id: E.rodgers, type: "judge", name: "M. Casey Rodgers", aliases: ["Margaret Catharine Rodgers", "Judge Rodgers", "Hon. M. Casey Rodgers"], attributes: { court: "U.S. District Court for the Northern District of Florida", courtId: "flnd", title: "U.S. District Judge", appointedBy: "George W. Bush", commissioned: "2003", mdls: ["2734", "2885", "3140"] } },
  { id: E.gonzalezRogers, type: "judge", name: "Yvonne Gonzalez Rogers", aliases: ["Judge Gonzalez Rogers"], attributes: { court: "U.S. District Court for the Northern District of California", courtId: "cand", title: "U.S. District Judge", appointedBy: "Barack Obama", commissioned: "2011", mdls: ["3047"] } },
  { id: E.cannon, type: "judge", name: "Hope T. Cannon", aliases: ["Hope Thai Cannon", "Magistrate Judge Cannon"], attributes: { court: "U.S. District Court for the Northern District of Florida", courtId: "flnd", title: "U.S. Magistrate Judge" } },
  { id: E.london, type: "attorney", name: "Michael A. London", aliases: ["Michael London"], attributes: { firmId: E.douglasLondon, role: "Plaintiffs' co-lead counsel", bar: "New York" } },
  { id: E.napoli, type: "attorney", name: "Paul J. Napoli", aliases: ["Paul Napoli"], attributes: { firmId: E.napoliShkolnik, role: "Plaintiffs' co-lead counsel", bar: "New York" } },
  { id: E.summy, type: "attorney", name: "Scott Summy", aliases: ["S. Scott Summy"], attributes: { firmId: E.baronBudd, role: "Plaintiffs' co-lead counsel", bar: "Texas" } },
  { id: E.thompson, type: "attorney", name: "Fred Thompson III", aliases: ["Fred Thompson"], attributes: { firmId: E.motleyRice, role: "Plaintiffs' liaison counsel", bar: "South Carolina" } },
  { id: E.klein, type: "attorney", name: "Rebecca Klein", attributes: { firmId: E.kleinAssociates, role: "Plaintiffs' Executive Committee (demo)", demo: true } },
  { id: E.douglasLondon, type: "firm", name: "Douglas & London, P.C.", aliases: ["Douglas & London"], attributes: { city: "New York, NY", side: "plaintiffs" } },
  { id: E.napoliShkolnik, type: "firm", name: "Napoli Shkolnik PLLC", aliases: ["Napoli Shkolnik"], attributes: { city: "New York, NY", side: "plaintiffs" } },
  { id: E.baronBudd, type: "firm", name: "Baron & Budd, P.C.", aliases: ["Baron & Budd"], attributes: { city: "Dallas, TX", side: "plaintiffs" } },
  { id: E.motleyRice, type: "firm", name: "Motley Rice LLC", aliases: ["Motley Rice"], attributes: { city: "Mount Pleasant, SC", side: "plaintiffs" } },
  { id: E.kleinAssociates, type: "firm", name: "Klein & Associates", attributes: { side: "plaintiffs", demo: true } },
  { id: E.mdl2873, type: "mdl", name: "MDL 2873", aliases: ["In re: Aqueous Film-Forming Foams Products Liability Litigation", "AFFF MDL"], attributes: { mdlNumber: "2873", transfereeCourt: "dsc", judgeId: E.gergel, docketNumber: "2:18-mn-02873" }, externalIds: { jpml: "2873" } },
  { id: E.mdl3140, type: "mdl", name: "MDL 3140", aliases: ["In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", "Depo-Provera MDL"], attributes: { mdlNumber: "3140", transfereeCourt: "flnd", judgeId: E.rodgers, docketNumber: "3:25-md-03140" }, externalIds: { jpml: "3140" } },
  { id: E.mdl3047, type: "mdl", name: "MDL 3047", aliases: ["In re: Social Media Adolescent Addiction/Personal Injury Products Liability Litigation"], attributes: { mdlNumber: "3047", transfereeCourt: "cand", judgeId: E.gonzalezRogers }, externalIds: { jpml: "3047" } },
  { id: E.mdl3081, type: "mdl", name: "MDL 3081", aliases: ["In re: Bard Implanted Port Catheter Products Liability Litigation"], attributes: { mdlNumber: "3081", transfereeCourt: "azd" }, externalIds: { jpml: "3081" } },
  { id: E.afff, type: "product", name: "Aqueous film-forming foam (AFFF)", aliases: ["AFFF", "PFAS firefighting foam", "PFOA/PFOS foam"], attributes: { category: "firefighting foam", chemicals: ["PFOA", "PFOS", "PFHxS", "fluorotelomers"] } },
  { id: E.depoProvera, type: "product", name: "Depo-Provera (medroxyprogesterone acetate)", aliases: ["Depo-Provera", "medroxyprogesterone acetate injectable suspension", "DMPA", "Depo-SubQ Provera 104"], attributes: { category: "prescription drug", manufacturer: "Pfizer Inc.", ndc: ["0009-0746"], applicationNumber: "NDA020246" } },
  { id: E.epa, type: "agency", name: "Environmental Protection Agency", aliases: ["EPA", "U.S. EPA"], attributes: { cfrTitles: [40] } },
  { id: E.fda, type: "agency", name: "Food and Drug Administration", aliases: ["FDA", "U.S. FDA"], attributes: { cfrTitles: [21] } },
  { id: E.dsc, type: "court", name: "U.S. District Court for the District of South Carolina", aliases: ["D.S.C.", "District of South Carolina"], attributes: { courtId: "dsc", circuit: "4th Cir." }, externalIds: { courtlistener: "dsc" } },
  { id: E.flnd, type: "court", name: "U.S. District Court for the Northern District of Florida", aliases: ["N.D. Fla.", "Northern District of Florida"], attributes: { courtId: "flnd", circuit: "11th Cir." }, externalIds: { courtlistener: "flnd" } },
  { id: E.threeM, type: "party", name: "3M Company", aliases: ["3M"], attributes: { role: "defendant", industry: "diversified manufacturing" } },
  { id: E.dupont, type: "party", name: "E. I. du Pont de Nemours and Company", aliases: ["DuPont", "EIDP, Inc.", "The Chemours Company", "Corteva, Inc."], attributes: { role: "defendant" } },
  { id: E.pfizer, type: "party", name: "Pfizer Inc.", aliases: ["Pfizer", "Pharmacia & Upjohn Company LLC"], attributes: { role: "defendant" } },
  { id: E.meridian, type: "party", name: "Meridian Fluorochem Corp.", aliases: ["Meridian Fluorochem", "Meridian"], attributes: { role: "defendant", demo: true, note: "Fictional demo client used across the platform seeds" } },
];

const AFFF = MATTERS.afff;
const DEPO = MATTERS.depo;
const DSC = "U.S. District Court for the District of South Carolina";
const FLND = "U.S. District Court for the Northern District of Florida";
const UNVERIFIED = (note: string): Omit<IntelFlag, "at"> => ({ kind: "unverified", note, by: "seed" });
const SYNOPSIS = "Synopsis prepared for the LeClaude sample corpus; consult the reported opinion before citing.";

export const SEED_DOCS: SeedDoc[] = [
  // ------------------------------------------------------------------ AFFF MDL 2873: docket and key entries
  {
    id: "idoc_seed_afff_docket",
    source: "clDockets",
    kind: "docket",
    title: "In re: Aqueous Film-Forming Foams Products Liability Litigation (2:18-mn-02873-RMG)",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation",
    docketNumber: "2:18-mn-02873-RMG",
    court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], attorneyIds: [E.london, E.napoli, E.summy, E.thompson], firmIds: [E.douglasLondon, E.napoliShkolnik, E.baronBudd, E.motleyRice], partyIds: [E.threeM, E.dupont, E.meridian], mdlId: E.mdl2873, productIds: [E.afff],
    dates: { filed: "2018-12-07", modified: "2026-09-01" },
    url: "https://www.courtlistener.com/?q=%22Aqueous+Film-Forming+Foams%22&type=r&court=dsc",
    externalId: "seed:docket:2:18-mn-02873",
    matterIds: [AFFF],
    tags: ["docket", "mdl", "pfas"],
    confidence: 0.9,
    entities: [
      { type: "judge", name: "Richard M. Gergel", role: "presiding" }, { type: "court", name: DSC, externalId: "cl:court:dsc" },
      { type: "party", name: "3M Company", role: "defendant" }, { type: "party", name: "E. I. du Pont de Nemours and Company", role: "defendant" }, { type: "party", name: "The Chemours Company", role: "defendant" }, { type: "party", name: "Corteva, Inc.", role: "defendant" }, { type: "party", name: "Tyco Fire Products LP", role: "defendant" }, { type: "party", name: "BASF Corporation", role: "defendant" }, { type: "party", name: "Meridian Fluorochem Corp.", role: "defendant" },
      { type: "attorney", name: "Michael A. London", role: "plaintiffs' co-lead counsel" }, { type: "attorney", name: "Paul J. Napoli", role: "plaintiffs' co-lead counsel" }, { type: "attorney", name: "Scott Summy", role: "plaintiffs' co-lead counsel" }, { type: "attorney", name: "Fred Thompson III", role: "plaintiffs' liaison counsel" },
      { type: "firm", name: "Douglas & London, P.C." }, { type: "firm", name: "Napoli Shkolnik PLLC" }, { type: "firm", name: "Baron & Budd, P.C." }, { type: "firm", name: "Motley Rice LLC" },
      { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }, { type: "product", name: "Aqueous film-forming foam (AFFF)" },
    ],
    meta: { docketId: null, mdlNumber: "2873", assignedTo: "Richard Mark Gergel", natureOfSuit: "365 Personal Injury: Product Liability", division: "Charleston", demoParty: "Meridian Fluorochem Corp. is the platform's fictional demo client" },
    summary: "Master docket for the AFFF multidistrict litigation before Judge Richard M. Gergel in Charleston: water-provider, personal-injury, property and sovereign claims arising from PFOA/PFOS in firefighting foam.",
    text: `In re: Aqueous Film-Forming Foams Products Liability Litigation
MDL No. 2873 — Master Docket No. 2:18-mn-02873-RMG
United States District Court for the District of South Carolina, Charleston Division
Presiding: Hon. Richard M. Gergel, United States District Judge

Nature of the litigation
The Judicial Panel on Multidistrict Litigation centralized the AFFF actions in the District of South Carolina on December 7, 2018. The cases concern aqueous film-forming foams used to suppress fuel fires at military bases, airports, refineries and fire-training facilities, and the per- and polyfluoroalkyl substances (PFAS) in those foams and their ingredients, principally perfluorooctanoic acid (PFOA) and perfluorooctane sulfonate (PFOS). Plaintiff groups include public water systems whose wells or intakes were contaminated, individuals alleging personal injury (kidney cancer, testicular cancer, thyroid disease and ulcerative colitis among the injuries designated for bellwether treatment), property owners, and state and sovereign plaintiffs.

Defendants
Foam manufacturers and fluorochemical suppliers including 3M Company; E. I. du Pont de Nemours and Company, The Chemours Company and Corteva, Inc.; Tyco Fire Products LP and Chemguard, Inc.; National Foam, Inc.; Kidde-Fenwal, Inc.; BASF Corporation; Dynax Corporation; Archroma; Clariant; AGC Chemicals Americas; Daikin America; Buckeye Fire Equipment Company; and Amerex Corporation. Meridian Fluorochem Corp. appears in this sample as the platform's demonstration client (a fictional fluorosurfactant supplier defended by the firm).

Leadership
Plaintiffs' co-lead counsel: Michael A. London (Douglas & London, P.C.), Paul J. Napoli (Napoli Shkolnik PLLC) and Scott Summy (Baron & Budd, P.C.). Plaintiffs' liaison counsel: Fred Thompson III (Motley Rice LLC). Defendants are coordinated through defense liaison counsel appointed under the Court's early case management orders.

Procedural posture (summary)
The Court denied 3M's motion for summary judgment on the government contractor defense in the City of Stuart bellwether (September 16, 2022). Class settlements with public water systems were reached in June 2023 with DuPont/Chemours/Corteva and with 3M, preliminarily approved in August 2023 and finally approved in February and March 2024; further settlements with Tyco Fire Products and BASF followed in 2024. Personal-injury bellwether proceedings were organized by case management order for the Tier 1 injuries, with the first personal-injury trial group drawn from kidney and testicular cancer claims.

Related docket numbers
Individual member cases carry their own civil action numbers (2:xx-cv-xxxxx-RMG) and are administered through the master docket.`,
  },
  {
    id: "idoc_seed_afff_entry_transfer",
    source: "clDockets", kind: "docket_entry",
    title: "Dkt. 1: Transfer Order of the Judicial Panel on Multidistrict Litigation creating MDL No. 2873",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873-RMG", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2018-12-07", event: "2018-12-07" }, externalId: "seed:entry:2873:1", matterIds: [AFFF], tags: ["docket-entry", "jpml", "transfer-order"], confidence: 0.92,
    entities: [{ type: "judge", name: "Richard M. Gergel", role: "transferee judge" }, { type: "court", name: "Judicial Panel on Multidistrict Litigation", externalId: "cl:court:jpml" }, { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }],
    meta: { entryNumber: 1, docketDocId: "idoc_seed_afff_docket" },
    text: `Docket entry 1 — December 7, 2018
TRANSFER ORDER of the United States Judicial Panel on Multidistrict Litigation (MDL No. 2873). The Panel found that the actions share factual questions arising from allegations that AFFF products used at airports, military bases and other locations to extinguish liquid-fuel fires caused the release of PFOA and PFOS into groundwater, and that centralization in the District of South Carolina before the Honorable Richard M. Gergel would serve the convenience of the parties and witnesses and promote the just and efficient conduct of the litigation. Actions pending outside the District of South Carolina were transferred under 28 U.S.C. § 1407 and, with the consent of that court, assigned to Judge Gergel for coordinated or consolidated pretrial proceedings. Reported at In re Aqueous Film-Forming Foams Prods. Liab. Litig., 357 F. Supp. 3d 1391 (J.P.M.L. 2018).`,
  },
  {
    id: "idoc_seed_afff_entry_gcd",
    source: "clDockets", kind: "docket_entry",
    title: "Order denying 3M's motion for summary judgment on the government contractor defense (City of Stuart bellwether)",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873-RMG", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], partyIds: [E.threeM], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2022-09-16", event: "2022-09-16" }, externalId: "seed:entry:2873:gcd-2022", matterIds: [AFFF], tags: ["docket-entry", "order", "government-contractor-defense", "summary-judgment"], confidence: 0.85,
    entities: [{ type: "judge", name: "Richard M. Gergel", role: "presiding" }, { type: "party", name: "3M Company", role: "movant" }, { type: "party", name: "City of Stuart", role: "bellwether plaintiff" }],
    meta: { docketDocId: "idoc_seed_afff_docket", motion: "summary judgment", defense: "government contractor (Boyle)" },
    text: `Docket entry — September 16, 2022
ORDER AND OPINION denying 3M Company's motion for summary judgment on the government contractor defense in the City of Stuart bellwether action. Applying Boyle v. United Technologies Corp., 487 U.S. 500 (1988), the Court considered whether the military specification for AFFF (MIL-F-24385) constituted reasonably precise specifications approved by the government, whether 3M's products conformed to them, and whether 3M warned the government of dangers in the use of the foam that were known to 3M but not to the United States. The Court concluded that genuine disputes of material fact remained on the defense's elements, including what 3M knew about the persistence, bioaccumulation and toxicity of PFOS and PFOA and what it disclosed to the government, and denied summary judgment so that the defense could be tried to a jury.`,
  },
  {
    id: "idoc_seed_afff_entry_stuart_continuance",
    source: "clDockets", kind: "docket_entry",
    title: "Order continuing the City of Stuart bellwether trial to permit settlement discussions",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873-RMG", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], partyIds: [E.threeM], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2023-06-04", event: "2023-06-04" }, externalId: "seed:entry:2873:stuart-continuance", matterIds: [AFFF], tags: ["docket-entry", "order", "bellwether"], confidence: 0.6,
    flags: [UNVERIFIED("Entry date is approximate (the first water-provider bellwether had been set for June 5, 2023); confirm the docket entry on PACER before citing.")],
    entities: [{ type: "judge", name: "Richard M. Gergel", role: "presiding" }, { type: "party", name: "3M Company", role: "defendant" }, { type: "party", name: "City of Stuart", role: "bellwether plaintiff" }],
    meta: { docketDocId: "idoc_seed_afff_docket" },
    text: `Docket entry — June 2023 (approximate)
TEXT ORDER continuing the City of Stuart v. 3M Company bellwether trial, which had been scheduled to begin on June 5, 2023, for a short period to allow the parties to pursue a resolution of the public water system claims. The continuance preceded the announcements in June 2023 of class settlements between the water-provider plaintiffs and DuPont/Chemours/Corteva and 3M.`,
  },
  {
    id: "idoc_seed_afff_entry_dupont_final",
    source: "clDockets", kind: "docket_entry",
    title: "Order granting final approval of the DuPont/Chemours/Corteva public water system class settlement",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873-RMG", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], partyIds: [E.dupont], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2024-02-08", event: "2024-02-08" }, externalId: "seed:entry:2873:dupont-final", matterIds: [AFFF], tags: ["docket-entry", "order", "settlement", "class-action"], confidence: 0.8,
    entities: [{ type: "judge", name: "Richard M. Gergel", role: "presiding" }, { type: "party", name: "The Chemours Company", role: "settling defendant" }, { type: "party", name: "E. I. du Pont de Nemours and Company", role: "settling defendant" }, { type: "party", name: "Corteva, Inc.", role: "settling defendant" }],
    meta: { docketDocId: "idoc_seed_afff_docket", settlementAmountUsd: 1185000000 },
    text: `Docket entry — February 8, 2024
ORDER granting final approval of the class settlement between the public water system class and E. I. du Pont de Nemours and Company (EIDP, Inc.), The Chemours Company and Corteva, Inc. Under the settlement the DuPont entities fund $1.185 billion to resolve the claims of public water systems that have detected PFAS in their water sources or are required to monitor for PFAS under EPA rules. The Court found the settlement fair, reasonable and adequate under Rule 23(e), certified the settlement class, overruled the objections and approved the plan of allocation, with fee determinations addressed separately.`,
  },
  {
    id: "idoc_seed_afff_entry_3m_final",
    source: "clDockets", kind: "docket_entry",
    title: "Order granting final approval of the 3M public water system class settlement",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873-RMG", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], partyIds: [E.threeM], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2024-03-29", event: "2024-03-29" }, externalId: "seed:entry:2873:3m-final", matterIds: [AFFF], tags: ["docket-entry", "order", "settlement", "class-action"], confidence: 0.8,
    entities: [{ type: "judge", name: "Richard M. Gergel", role: "presiding" }, { type: "party", name: "3M Company", role: "settling defendant" }],
    meta: { docketDocId: "idoc_seed_afff_docket", settlementAmountUsdMin: 10300000000, settlementAmountUsdMax: 12500000000 },
    text: `Docket entry — March 29, 2024
ORDER granting final approval of the class settlement between the public water system class and 3M Company. 3M agreed to pay between $10.3 billion and $12.5 billion over thirteen years, depending on the number of systems that detect PFAS through the phased testing required by the settlement, to fund treatment and remediation for public water systems nationwide. The Court certified the settlement class, found the settlement fair, reasonable and adequate, and overruled objections raised by certain states and water systems.`,
  },
  {
    id: "idoc_seed_afff_entry_pi_bellwether",
    source: "clDockets", kind: "docket_entry",
    title: "Case Management Order establishing the personal-injury bellwether program (Tier 1 injuries)",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873-RMG", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], mdlId: E.mdl2873, productIds: [E.afff], dates: { event: "2023-11-01" }, externalId: "seed:entry:2873:pi-bellwether-cmo", matterIds: [AFFF], tags: ["docket-entry", "case-management-order", "bellwether", "personal-injury"], confidence: 0.6,
    flags: [UNVERIFIED("CMO number and entry date not confirmed for this sample; the program is generally referred to as CMO 26 (late 2023). Verify on PACER.")],
    entities: [{ type: "judge", name: "Richard M. Gergel", role: "presiding" }],
    meta: { docketDocId: "idoc_seed_afff_docket", injuries: ["kidney cancer", "testicular cancer", "thyroid disease", "ulcerative colitis"] },
    text: `Docket entry — late 2023 (date not confirmed)
CASE MANAGEMENT ORDER establishing the personal-injury bellwether program. The Order designates Tier 1 injuries — kidney cancer, testicular cancer, thyroid disease and ulcerative colitis — for the first round of bellwether discovery, requires personal-injury plaintiffs to complete plaintiff fact sheets and product-identification disclosures, and sets a process for selecting a pool of cases from which the parties and the Court will pick the initial trial group. Subsequent orders narrowed the first trial group to kidney and testicular cancer claims with exposure through contaminated drinking water.`,
  },
  {
    id: "idoc_seed_afff_entry_meridian_demo",
    source: "clDockets", kind: "docket_entry",
    title: "Text order granting Meridian Fluorochem's consent motion to extend the Tier 2 custodial production deadline (demo)",
    caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873-RMG", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], partyIds: [E.meridian], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2026-08-21", event: "2026-08-21" }, externalId: "seed:entry:2873:meridian-demo-ext", matterIds: [AFFF], tags: ["docket-entry", "text-order", "demo"], confidence: 0.5,
    flags: [UNVERIFIED("Demonstration entry for the fictional Meridian Fluorochem matter; it does not exist on the real docket.")],
    entities: [{ type: "judge", name: "Richard M. Gergel", role: "presiding" }, { type: "party", name: "Meridian Fluorochem Corp.", role: "movant" }],
    meta: { docketDocId: "idoc_seed_afff_docket", demo: true },
    text: `Docket entry — August 21, 2026 (demonstration)
TEXT ORDER granting the consent motion of defendant Meridian Fluorochem Corp. for a thirty-day extension of the Tier 2 custodial document production deadline to October 14, 2026. The extension does not alter the rebuttal expert report deadline of November 6, 2026 or the Daubert motion deadline of December 18, 2026. (Seeded demonstration entry aligned with the matter calendar in this workspace.)`,
  },

  // ------------------------------------------------------------------ Depo-Provera MDL 3140
  {
    id: "idoc_seed_depo_docket",
    source: "clDockets", kind: "docket",
    title: "In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation (3:25-md-03140-MCR-HTC)",
    caseName: "In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", docketNumber: "3:25-md-03140-MCR-HTC", court: FLND, courtId: "flnd", jurisdiction: "Federal · 11th Cir.",
    judgeIds: [E.rodgers, E.cannon], partyIds: [E.pfizer], mdlId: E.mdl3140, productIds: [E.depoProvera], dates: { filed: "2025-02-07", modified: "2026-09-01" },
    url: "https://www.courtlistener.com/?q=%22Depo-Provera%22&type=r&court=flnd", externalId: "seed:docket:3:25-md-03140", matterIds: [DEPO], tags: ["docket", "mdl", "pharmaceutical"], confidence: 0.85,
    entities: [{ type: "judge", name: "M. Casey Rodgers", role: "presiding" }, { type: "judge", name: "Hope T. Cannon", role: "magistrate" }, { type: "court", name: FLND, externalId: "cl:court:flnd" }, { type: "party", name: "Pfizer Inc.", role: "defendant" }, { type: "party", name: "Pharmacia & Upjohn Company LLC", role: "defendant" }, { type: "party", name: "Greenstone LLC", role: "defendant" }, { type: "party", name: "Viatris Inc.", role: "defendant" }, { type: "mdl", name: "MDL 3140", externalId: "jpml:3140" }, { type: "product", name: "Depo-Provera (medroxyprogesterone acetate)" }],
    meta: { mdlNumber: "3140", assignedTo: "M. Casey Rodgers", referredTo: "Hope T. Cannon", natureOfSuit: "367 Personal Injury: Health Care/Pharmaceutical Personal Injury Product Liability", division: "Pensacola" },
    summary: "Master docket for the Depo-Provera meningioma litigation before Chief Judge M. Casey Rodgers in Pensacola: failure-to-warn claims that prolonged use of depot medroxyprogesterone acetate increases the risk of intracranial meningioma.",
    text: `In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation
MDL No. 3140 — Master Docket No. 3:25-md-03140-MCR-HTC
United States District Court for the Northern District of Florida, Pensacola Division
Presiding: Hon. M. Casey Rodgers, United States District Judge; referred to Hon. Hope T. Cannon, United States Magistrate Judge

Nature of the litigation
Plaintiffs allege that prolonged use of Depo-Provera (depot medroxyprogesterone acetate, DMPA), an injectable contraceptive, and its authorized generics increases the risk of developing intracranial meningioma, and that the manufacturers failed to warn prescribers and patients of that risk in the United States labeling even after the risk was described in the European labeling and in the epidemiological literature, including the 2024 BMJ study by Roland and colleagues. Claims sound in strict liability failure to warn, negligence, negligent misrepresentation and breach of warranty under the laws of the plaintiffs' home states.

Defendants
Pfizer Inc.; Pharmacia & Upjohn Company LLC; Pharmacia LLC; Greenstone LLC; Prasco Laboratories; and Viatris Inc. (authorized-generic distributors and their affiliates), as named in the master complaint.

Procedural posture (summary)
The Judicial Panel on Multidistrict Litigation centralized the actions in the Northern District of Florida on February 7, 2025 and assigned them to Judge Rodgers, who also presided over the 3M Combat Arms Earplug and Abilify MDLs. Early case management orders appointed plaintiffs' leadership, adopted a master complaint and short-form complaint procedure, and set a schedule for the defendants' preemption motion directed at the failure-to-warn claims and for a science day on the epidemiology of progestogens and meningioma.

Matter note
The firm represents a confidential pharmaceutical distributor defendant; the key dates in this workspace (master answer due October 2, 2026; Science Day November 20, 2026) are the demonstration matter's calendar.`,
  },
  {
    id: "idoc_seed_depo_entry_transfer",
    source: "clDockets", kind: "docket_entry",
    title: "Dkt. 1: Transfer Order of the Judicial Panel on Multidistrict Litigation creating MDL No. 3140",
    caseName: "In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", docketNumber: "3:25-md-03140-MCR-HTC", court: FLND, courtId: "flnd", jurisdiction: "Federal · 11th Cir.",
    judgeIds: [E.rodgers], mdlId: E.mdl3140, productIds: [E.depoProvera], dates: { filed: "2025-02-07", event: "2025-02-07" }, externalId: "seed:entry:3140:1", matterIds: [DEPO], tags: ["docket-entry", "jpml", "transfer-order"], confidence: 0.85,
    entities: [{ type: "judge", name: "M. Casey Rodgers", role: "transferee judge" }, { type: "court", name: "Judicial Panel on Multidistrict Litigation", externalId: "cl:court:jpml" }, { type: "mdl", name: "MDL 3140", externalId: "jpml:3140" }],
    meta: { entryNumber: 1, docketDocId: "idoc_seed_depo_docket" },
    text: `Docket entry 1 — February 7, 2025
TRANSFER ORDER of the United States Judicial Panel on Multidistrict Litigation (MDL No. 3140). The Panel found that the actions share factual questions arising from allegations that Depo-Provera and its authorized generics cause meningioma and that the defendants failed to warn of that risk, that centralization would eliminate duplicative discovery on general causation, regulatory history and labeling, prevent inconsistent pretrial rulings on preemption and Daubert issues, and conserve the resources of the parties, their counsel and the judiciary. The Panel selected the Northern District of Florida and assigned the litigation to the Honorable M. Casey Rodgers.`,
  },
  {
    id: "idoc_seed_depo_entry_cmo1",
    source: "clDockets", kind: "docket_entry",
    title: "Case Management Order No. 1 — initial conference, leadership applications and interim procedures",
    caseName: "In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", docketNumber: "3:25-md-03140-MCR-HTC", court: FLND, courtId: "flnd", jurisdiction: "Federal · 11th Cir.",
    judgeIds: [E.rodgers], mdlId: E.mdl3140, productIds: [E.depoProvera], dates: { event: "2025-02-14" }, externalId: "seed:entry:3140:cmo1", matterIds: [DEPO], tags: ["docket-entry", "case-management-order"], confidence: 0.55,
    flags: [UNVERIFIED("CMO 1 date is approximate for this sample; verify the entry on PACER.")],
    entities: [{ type: "judge", name: "M. Casey Rodgers", role: "presiding" }],
    meta: { docketDocId: "idoc_seed_depo_docket" },
    text: `Docket entry — February 2025 (date not confirmed)
CASE MANAGEMENT ORDER NO. 1. Sets the initial case management conference, invites applications for plaintiffs' leadership positions (lead counsel, executive committee, liaison counsel), stays responsive pleading deadlines in the transferred cases, directs the parties to confer on a master complaint and short-form complaint procedure, a plaintiff fact sheet, preservation of documents and electronically stored information, and a proposed schedule for the threshold preemption briefing, and requires a joint report before the conference.`,
  },
  {
    id: "idoc_seed_depo_entry_preemption",
    source: "clDockets", kind: "docket_entry",
    title: "Defendants' motion to dismiss the master complaint on federal preemption grounds (failure-to-warn claims)",
    caseName: "In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", docketNumber: "3:25-md-03140-MCR-HTC", court: FLND, courtId: "flnd", jurisdiction: "Federal · 11th Cir.",
    judgeIds: [E.rodgers], partyIds: [E.pfizer], mdlId: E.mdl3140, productIds: [E.depoProvera], dates: { event: "2025-06-01" }, externalId: "seed:entry:3140:preemption-mtd", matterIds: [DEPO], tags: ["docket-entry", "motion", "preemption"], confidence: 0.5,
    flags: [UNVERIFIED("Filing date and docket number of the preemption motion are not confirmed for this sample.")],
    entities: [{ type: "party", name: "Pfizer Inc.", role: "movant" }],
    meta: { docketDocId: "idoc_seed_depo_docket" },
    text: `Docket entry — 2025 (date not confirmed)
MOTION TO DISMISS the master personal injury complaint by the Pfizer defendants on the ground that plaintiffs' state-law failure-to-warn claims are preempted. Defendants argue that the FDA was fully informed of the meningioma data, that the agency would not have approved a meningioma warning, and that under Wyeth v. Levine, 555 U.S. 555 (2009) and Merck Sharp & Dohme Corp. v. Albrecht, 139 S. Ct. 1668 (2019) clear evidence of that position defeats the claims as a matter of law. Plaintiffs respond that the "changes being effected" regulation, 21 C.F.R. § 314.70(c)(6)(iii), permitted a unilateral label strengthening based on newly acquired information, including the 2024 BMJ cohort study, and that the record does not show the FDA rejected such a change.`,
  },

  // ------------------------------------------------------------------ Opinions (synopses)
  {
    id: "idoc_seed_op_afff_jpml", source: "clOpinions", kind: "opinion",
    title: "In re Aqueous Film-Forming Foams Products Liability Litigation, 357 F. Supp. 3d 1391 (J.P.M.L. 2018)",
    caseName: "In re Aqueous Film-Forming Foams Products Liability Litigation", citation: "357 F. Supp. 3d 1391", court: "Judicial Panel on Multidistrict Litigation", courtId: "jpml", jurisdiction: "Federal · U.S.",
    judgeIds: [E.gergel], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2018-12-07", decided: "2018-12-07" }, externalId: "seed:opinion:357-fsupp3d-1391", matterIds: [AFFF], tags: ["case-law", "mdl", "transfer-order"], confidence: 0.85,
    entities: [{ type: "court", name: "Judicial Panel on Multidistrict Litigation", externalId: "cl:court:jpml" }, { type: "judge", name: "Richard M. Gergel", role: "transferee judge" }, { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }],
    meta: { textKind: "synopsis" },
    text: `In re Aqueous Film-Forming Foams Products Liability Litigation, 357 F. Supp. 3d 1391 (J.P.M.L. 2018)
${SYNOPSIS}

Holding. The Panel centralized actions pending in multiple districts concerning aqueous film-forming foam products containing PFOA and PFOS in the District of South Carolina before Judge Richard M. Gergel under 28 U.S.C. § 1407.

Reasoning. The actions shared factual questions about the manufacture, marketing and use of AFFF, the fluorochemicals used to make it, and the contamination of groundwater near military bases, airports and industrial sites. Centralization would eliminate duplicative discovery, particularly on the defendants' knowledge of the health and environmental effects of PFAS, prevent inconsistent rulings on preemption, the government contractor defense and Daubert issues, and conserve resources. The District of South Carolina was an appropriate transferee forum: several actions were pending there, it offered a convenient and accessible location, and Judge Gergel had the experience and capacity to steer the litigation efficiently.

Significance. The Order created MDL No. 2873, which grew into one of the largest environmental mass torts, encompassing water-provider, personal-injury, property-damage and sovereign claims.`,
  },
  {
    id: "idoc_seed_op_boyle", source: "clOpinions", kind: "opinion",
    title: "Boyle v. United Technologies Corp., 487 U.S. 500 (1988)", caseName: "Boyle v. United Technologies Corp.", citation: "487 U.S. 500", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    dates: { decided: "1988-06-27" }, externalId: "seed:opinion:487-us-500", matterIds: [AFFF], tags: ["case-law", "government-contractor-defense"], confidence: 0.9,
    url: "https://www.courtlistener.com/?q=%22Boyle+v.+United+Technologies%22&type=o", entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }],
    meta: { textKind: "synopsis", author: "Scalia, J." },
    text: `Boyle v. United Technologies Corp., 487 U.S. 500 (1988)
${SYNOPSIS}

Holding. State-law design-defect liability for military equipment is displaced by federal law when (1) the United States approved reasonably precise specifications; (2) the equipment conformed to those specifications; and (3) the supplier warned the United States about the dangers in the use of the equipment that were known to the supplier but not to the United States.

Reasoning. The procurement of military equipment is an area of uniquely federal interest, and imposing state tort duties that conflict with the government's discretionary design decisions would frustrate the federal interest protected by the discretionary function exception to the Federal Tort Claims Act. The defense applies only where the government, not merely the contractor, exercised discretion over the design feature at issue; a rubber-stamp approval of the contractor's design does not suffice.

Application in the AFFF litigation. AFFF made to Military Specification MIL-F-24385 raises each Boyle element: whether the specification was reasonably precise as to the fluorosurfactant chemistry, whether the foams conformed, and whether manufacturers disclosed what they knew about PFOS and PFOA persistence and toxicity. The third element — the disparity between the contractor's and the government's knowledge — has been the central factual battleground.`,
  },
  {
    id: "idoc_seed_op_wyeth", source: "clOpinions", kind: "opinion",
    title: "Wyeth v. Levine, 555 U.S. 555 (2009)", caseName: "Wyeth v. Levine", citation: "555 U.S. 555", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    agencies: ["Food and Drug Administration"], dates: { decided: "2009-03-04" }, externalId: "seed:opinion:555-us-555", matterIds: [DEPO], tags: ["case-law", "preemption", "failure-to-warn"], confidence: 0.9,
    entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { textKind: "synopsis", author: "Stevens, J." },
    text: `Wyeth v. Levine, 555 U.S. 555 (2009)
${SYNOPSIS}

Holding. Federal law does not preempt a state-law failure-to-warn claim against a brand-name drug manufacturer merely because the FDA approved the label. The manufacturer bears responsibility for the content of its label at all times and may strengthen a warning through the "changes being effected" (CBE) supplement without prior FDA approval; only "clear evidence" that the FDA would not have approved the change makes compliance with both federal and state duties impossible.

Reasoning. Congress did not include an express preemption provision for prescription drugs, and the history of the FDCA shows that state tort suits were understood to complement federal regulation by uncovering unknown risks and motivating manufacturers to disclose them. The FDA's preamble asserting preemption was entitled to no deference because it reversed the agency's longstanding position without notice and comment.

Application. In pharmaceutical failure-to-warn litigation, including the Depo-Provera meningioma cases, defendants must show clear evidence that the FDA was informed of the justification for the proposed warning and would have rejected it — a showing Merck v. Albrecht later assigned to the judge as a question of law.`,
  },
  {
    id: "idoc_seed_op_mensing", source: "clOpinions", kind: "opinion",
    title: "PLIVA, Inc. v. Mensing, 564 U.S. 604 (2011)", caseName: "PLIVA, Inc. v. Mensing", citation: "564 U.S. 604", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    agencies: ["Food and Drug Administration"], dates: { decided: "2011-06-23" }, externalId: "seed:opinion:564-us-604", matterIds: [DEPO], tags: ["case-law", "preemption", "generic-drugs"], confidence: 0.9,
    entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { textKind: "synopsis", author: "Thomas, J." },
    text: `PLIVA, Inc. v. Mensing, 564 U.S. 604 (2011)
${SYNOPSIS}

Holding. State-law failure-to-warn claims against generic drug manufacturers are preempted because federal law requires a generic label to be the same as the brand-name label; a generic manufacturer cannot unilaterally strengthen its warning through the CBE process, so it is impossible to comply with both state and federal duties.

Reasoning. The duty of sameness under the Hatch-Waxman Amendments and FDA regulations leaves generic manufacturers without an independent means of changing the label. The possibility that the manufacturer could have asked the FDA to initiate a change does not defeat impossibility preemption, because a private party's ability to comply with state law cannot depend on obtaining discretionary federal action.

Application. Distinguishes the brand-name framework of Wyeth v. Levine. In the Depo-Provera litigation the distinction matters for authorized generics, which are marketed under the brand's NDA rather than an ANDA and therefore may fall outside the Mensing rule.`,
  },
  {
    id: "idoc_seed_op_bartlett", source: "clOpinions", kind: "opinion",
    title: "Mutual Pharmaceutical Co. v. Bartlett, 570 U.S. 472 (2013)", caseName: "Mutual Pharmaceutical Co. v. Bartlett", citation: "570 U.S. 472", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    agencies: ["Food and Drug Administration"], dates: { decided: "2013-06-24" }, externalId: "seed:opinion:570-us-472", matterIds: [DEPO], tags: ["case-law", "preemption", "design-defect"], confidence: 0.9,
    entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { textKind: "synopsis", author: "Alito, J." },
    text: `Mutual Pharmaceutical Co. v. Bartlett, 570 U.S. 472 (2013)
${SYNOPSIS}

Holding. State-law design-defect claims that turn on the adequacy of a drug's warnings are preempted as to generic manufacturers, which can neither change the drug's composition nor its label. The suggestion that the manufacturer could have complied with both state and federal law by ceasing to sell the drug — the "stop-selling" rationale — is incompatible with the Court's preemption jurisprudence.

Reasoning. New Hampshire's design-defect law required a risk-utility analysis in which the warning was a factor; because federal law prohibited the generic manufacturer from altering either the design or the warning, compliance with the state duty was impossible.

Application. Bartlett closes the door on recasting failure-to-warn theories as design claims against generics, and its rejection of the stop-selling argument is invoked by brand-name defendants as well.`,
  },
  {
    id: "idoc_seed_op_albrecht", source: "clOpinions", kind: "opinion",
    title: "Merck Sharp & Dohme Corp. v. Albrecht, 139 S. Ct. 1668 (2019)", caseName: "Merck Sharp & Dohme Corp. v. Albrecht", citation: "139 S. Ct. 1668", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    agencies: ["Food and Drug Administration"], dates: { decided: "2019-05-20" }, externalId: "seed:opinion:139-sct-1668", matterIds: [DEPO], tags: ["case-law", "preemption", "failure-to-warn"], confidence: 0.9,
    entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { textKind: "synopsis", author: "Breyer, J." },
    text: `Merck Sharp & Dohme Corp. v. Albrecht, 139 S. Ct. 1668 (2019)
${SYNOPSIS}

Holding. Whether state failure-to-warn claims are preempted under Wyeth v. Levine's "clear evidence" standard is a question of law for the judge, not the jury. Clear evidence means the manufacturer fully informed the FDA of the justifications for the warning required by state law and the FDA, in turn, informed the manufacturer that it would not approve a change to the label to include that warning.

Reasoning. Preemption turns on the meaning and effect of agency action, which judges are better positioned to evaluate; the relevant FDA action must carry the force of law (for example, a rejection of a proposed CBE change or a formal determination), not informal communications. The Court left open whether the Fosamax atypical femoral fracture warning had been rejected on that basis and remanded.

Application. Sets the framework for preemption motions in the Depo-Provera MDL: the defendants must point to an FDA decision with the force of law rejecting a meningioma warning after being fully informed of the supporting data.`,
  },
  {
    id: "idoc_seed_op_daubert", source: "clOpinions", kind: "opinion",
    title: "Daubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993)", caseName: "Daubert v. Merrell Dow Pharmaceuticals, Inc.", citation: "509 U.S. 579", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    dates: { decided: "1993-06-28" }, externalId: "seed:opinion:509-us-579", matterIds: [AFFF, DEPO], tags: ["case-law", "expert-evidence", "rule-702"], confidence: 0.9,
    entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }],
    meta: { textKind: "synopsis", author: "Blackmun, J." },
    text: `Daubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993)
${SYNOPSIS}

Holding. Federal Rule of Evidence 702 superseded the Frye "general acceptance" test. The trial judge must ensure that scientific testimony is both relevant and reliable, acting as a gatekeeper.

Factors. Whether the theory or technique can be and has been tested; whether it has been subjected to peer review and publication; the known or potential rate of error and the existence of standards controlling the technique's operation; and the degree of acceptance within the relevant scientific community. The inquiry is flexible and focuses on principles and methodology, not conclusions.

Application. Rule 702 as amended in 2023 makes explicit that the proponent must show by a preponderance that the expert's opinion reflects a reliable application of reliable methods to sufficient facts. In products litigation Daubert governs the admissibility of general and specific causation testimony — for AFFF, the epidemiology linking PFOA/PFOS exposure to kidney and testicular cancer; for Depo-Provera, the cohort and case-control studies on progestogens and meningioma.`,
  },
  {
    id: "idoc_seed_op_lexecon", source: "clOpinions", kind: "opinion",
    title: "Lexecon Inc. v. Milberg Weiss Bershad Hynes & Lerach, 523 U.S. 26 (1998)", caseName: "Lexecon Inc. v. Milberg Weiss Bershad Hynes & Lerach", citation: "523 U.S. 26", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    dates: { decided: "1998-03-03" }, externalId: "seed:opinion:523-us-26", matterIds: [AFFF, DEPO], tags: ["case-law", "mdl", "section-1407"], confidence: 0.9,
    entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }],
    meta: { textKind: "synopsis", author: "Souter, J." },
    text: `Lexecon Inc. v. Milberg Weiss Bershad Hynes & Lerach, 523 U.S. 26 (1998)
${SYNOPSIS}

Holding. A district court conducting pretrial proceedings under 28 U.S.C. § 1407 has no authority to invoke § 1404(a) to assign a transferred case to itself for trial. Section 1407(a) requires the Panel to remand each action to the transferor district at or before the conclusion of pretrial proceedings unless it has been terminated.

Reasoning. The statutory text is unambiguous: "shall be remanded" imposes a mandatory obligation, and the Panel's rule permitting self-transfer could not override it.

Application. Lexecon shapes bellwether practice in MDLs such as AFFF and Depo-Provera: transferee judges may try only cases filed directly in the transferee district or cases in which the parties waive Lexecon rights, which is why direct-filing orders and Lexecon waivers appear in case management orders.`,
  },
  {
    id: "idoc_seed_op_gelboim", source: "clOpinions", kind: "opinion",
    title: "Gelboim v. Bank of America Corp., 574 U.S. 405 (2015)", caseName: "Gelboim v. Bank of America Corp.", citation: "574 U.S. 405", court: "Supreme Court of the United States", courtId: "scotus", jurisdiction: "Federal · U.S.",
    dates: { decided: "2015-01-21" }, externalId: "seed:opinion:574-us-405", matterIds: [AFFF, DEPO], tags: ["case-law", "mdl", "appellate-jurisdiction"], confidence: 0.9,
    entities: [{ type: "court", name: "Supreme Court of the United States", externalId: "cl:court:scotus" }],
    meta: { textKind: "synopsis", author: "Ginsburg, J." },
    text: `Gelboim v. Bank of America Corp., 574 U.S. 405 (2015)
${SYNOPSIS}

Holding. When a case consolidated for pretrial proceedings in a multidistrict litigation is dismissed in its entirety, the dismissal is a final decision under 28 U.S.C. § 1291 and immediately appealable, even though other cases in the MDL remain pending.

Reasoning. Cases consolidated under § 1407 retain their separate identities; the dismissal of one action leaves nothing for the district court to do in that action, so the ordinary rule of finality applies without regard to Rule 54(b).

Application. Governs the timing of appeals from dispositive rulings in member cases of the AFFF and Depo-Provera MDLs.`,
  },
  {
    id: "idoc_seed_op_lipitor", source: "clOpinions", kind: "opinion",
    title: "In re Lipitor (Atorvastatin Calcium) Marketing, Sales Practices & Products Liability Litigation, 892 F.3d 624 (4th Cir. 2018)", caseName: "In re Lipitor (Atorvastatin Calcium) Marketing, Sales Practices and Products Liability Litigation", citation: "892 F.3d 624", court: "U.S. Court of Appeals for the Fourth Circuit", courtId: "ca4", jurisdiction: "Federal · 4th Cir.",
    dates: { decided: "2018-06-12" }, externalId: "seed:opinion:892-f3d-624", matterIds: [AFFF], tags: ["case-law", "expert-evidence", "mdl", "causation"], confidence: 0.85,
    entities: [{ type: "court", name: "U.S. Court of Appeals for the Fourth Circuit", externalId: "cl:court:ca4" }, { type: "judge", name: "Richard M. Gergel", role: "district judge (MDL 2502)" }],
    meta: { textKind: "synopsis" },
    text: `In re Lipitor (Atorvastatin Calcium) Marketing, Sales Practices and Products Liability Litigation, 892 F.3d 624 (4th Cir. 2018)
${SYNOPSIS}

Holding. The Fourth Circuit affirmed Judge Gergel's exclusion of the plaintiffs' general-causation experts in the Lipitor MDL and the resulting summary judgment for Pfizer, holding that the district court did not abuse its discretion in requiring dose-specific evidence of causation and in rejecting methodologies that relied on cherry-picked studies or unexplained departures from the experts' own prior positions.

Reasoning. Under Rule 702 and Daubert the district court properly scrutinized whether the epidemiological evidence supported causation at the doses the plaintiffs actually took, whether the experts applied the Bradford Hill criteria consistently, and whether specific-causation opinions rested on more than temporal association. The court also affirmed the case-management approach of resolving general causation across the MDL before proceeding to individual cases.

Application. A leading Fourth Circuit authority on Daubert practice in MDLs — including the same transferee judge who presides over AFFF MDL 2873 — and on the use of MDL-wide general-causation rulings to dispose of member cases.`,
  },
  {
    id: "idoc_seed_op_westberry", source: "clOpinions", kind: "opinion",
    title: "Westberry v. Gislaved Gummi AB, 178 F.3d 257 (4th Cir. 1999)", caseName: "Westberry v. Gislaved Gummi AB", citation: "178 F.3d 257", court: "U.S. Court of Appeals for the Fourth Circuit", courtId: "ca4", jurisdiction: "Federal · 4th Cir.",
    dates: { decided: "1999-05-13" }, externalId: "seed:opinion:178-f3d-257", matterIds: [AFFF], tags: ["case-law", "expert-evidence", "differential-diagnosis"], confidence: 0.85,
    entities: [{ type: "court", name: "U.S. Court of Appeals for the Fourth Circuit", externalId: "cl:court:ca4" }],
    meta: { textKind: "synopsis" },
    text: `Westberry v. Gislaved Gummi AB, 178 F.3d 257 (4th Cir. 1999)
${SYNOPSIS}

Holding. A physician's differential diagnosis — ruling in the plausible causes of a condition and systematically ruling out alternatives — is a reliable methodology under Daubert for proving specific causation, and the district court did not abuse its discretion in admitting a treating physician's opinion that the plaintiff's sinus condition was caused by airborne talc.

Reasoning. Differential diagnosis is a standard scientific technique used by physicians to identify the cause of a medical problem. The absence of precise exposure data does not render the opinion inadmissible where the expert relied on the temporal relationship between exposure and symptoms, the dechallenge and rechallenge pattern, and the exclusion of other causes; those objections go to weight.

Application. Frequently cited in the Fourth Circuit, including in the AFFF personal-injury cases, on the admissibility of specific-causation testimony and the limits of the requirement for quantified exposure.`,
  },
  {
    id: "idoc_seed_op_chapman", source: "clOpinions", kind: "opinion",
    title: "Chapman v. Procter & Gamble Distributing, LLC, 766 F.3d 1296 (11th Cir. 2014)", caseName: "Chapman v. Procter & Gamble Distributing, LLC", citation: "766 F.3d 1296", court: "U.S. Court of Appeals for the Eleventh Circuit", courtId: "ca11", jurisdiction: "Federal · 11th Cir.",
    dates: { decided: "2014-09-11" }, externalId: "seed:opinion:766-f3d-1296", matterIds: [DEPO], tags: ["case-law", "expert-evidence", "causation"], confidence: 0.85,
    entities: [{ type: "court", name: "U.S. Court of Appeals for the Eleventh Circuit", externalId: "cl:court:ca11" }],
    meta: { textKind: "synopsis" },
    text: `Chapman v. Procter & Gamble Distributing, LLC, 766 F.3d 1296 (11th Cir. 2014)
${SYNOPSIS}

Holding. The Eleventh Circuit affirmed the exclusion of the plaintiffs' general-causation experts and summary judgment for the defendant in a case alleging that zinc in Fixodent denture cream caused copper-deficiency myelopathy. Because the causal theory was not generally accepted, plaintiffs needed reliable primary evidence — epidemiology, dose-response data or background-risk information — and their experts' reliance on case reports, animal studies and analogies did not satisfy Rule 702.

Reasoning. Applying the Bradford Hill factors and the court's earlier guidance in McClain v. Metabolife, the court explained that when the medical community does not recognize the causal relationship, expert testimony must rest on the kind of evidence scientists use to establish causation; secondary evidence may supplement but cannot replace it.

Application. The controlling Eleventh Circuit framework for general causation in the Depo-Provera MDL, where the meningioma association rests on cohort and case-control studies whose strength and dose-response findings will be tested under Chapman.`,
  },

  // ------------------------------------------------------------------ Regulations (summaries)
  {
    id: "idoc_seed_reg_40cfr705", source: "ecfr", kind: "regulation",
    title: "40 C.F.R. Part 705 — Reporting and recordkeeping requirements for perfluoroalkyl or polyfluoroalkyl substances (TSCA § 8(a)(7))", citation: "40 C.F.R. Part 705", jurisdiction: "Federal",
    agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { effective: "2023-11-13", modified: "2026-09-01" }, url: "https://www.ecfr.gov/current/title-40/part-705", externalId: "ecfr:40 C.F.R. Part 705", matterIds: [AFFF], tags: ["cfr", "title-40", "pfas", "tsca"], confidence: 0.75,
    flags: [UNVERIFIED("Summary of the part; section numbering and the current submission period should be confirmed on eCFR (EPA has amended the period more than once).")],
    entities: [{ type: "regulation", name: "40 C.F.R. Part 705", externalId: "ecfr:40 C.F.R. Part 705" }, { type: "agency", name: "Environmental Protection Agency" }, { type: "statute", name: "15 U.S.C. § 2607(a)(7)" }],
    meta: { title: 40, part: "705", textKind: "summary" },
    text: `40 C.F.R. Part 705 — Reporting and recordkeeping requirements for perfluoroalkyl or polyfluoroalkyl substances
Summary prepared for the LeClaude sample corpus.

Scope and authority. Part 705 implements section 8(a)(7) of the Toxic Substances Control Act, added by the FY2020 National Defense Authorization Act, which directs EPA to require each person who has manufactured (including imported) a PFAS in any year since January 1, 2011 to report information on chemical identity, categories of use, volumes manufactured and processed, byproducts, environmental and health effects, worker exposure and disposal.

Who must report. Manufacturers and importers of PFAS, including PFAS contained in imported articles, with no de minimis exemption and no exemption for small manufacturers in the rule as promulgated in October 2023 (88 FR 70516). PFAS is defined structurally (fluorinated carbon atoms meeting the rule's criteria) rather than by a list.

What is reported. For each PFAS and each year: production volume, uses and functional categories, concentration ranges, physical form, byproduct information, existing information on environmental and health effects, number of workers exposed and duration of exposure, and disposal methods. Reporting is through EPA's Central Data Exchange with a streamlined form for article importers and for research and development quantities.

Submission period. The rule set a six-month submission period beginning twelve months after the effective date; EPA later moved the start of the period and, in 2025, proposed further changes to the window and to the scope for article importers. The current dates should be confirmed on eCFR and the Federal Register before relying on them.

Recordkeeping. Records supporting the submission must be kept for five years after the last day of the submission period.

Relevance. For AFFF manufacturers and fluorosurfactant suppliers the part creates a comprehensive historical record of PFAS production and known effects since 2011, which intersects with discovery on corporate knowledge in MDL 2873.`,
  },
  {
    id: "idoc_seed_reg_40cfr141_pfas", source: "ecfr", kind: "regulation",
    title: "40 C.F.R. Part 141, Subpart Z — PFAS national primary drinking water regulation (maximum contaminant levels)", citation: "40 C.F.R. § 141.61(c)", jurisdiction: "Federal",
    agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { effective: "2024-06-25", modified: "2026-09-01" }, url: "https://www.ecfr.gov/current/title-40/part-141", externalId: "ecfr:40 C.F.R. § 141.61", matterIds: [AFFF], tags: ["cfr", "title-40", "pfas", "drinking-water"], confidence: 0.7,
    flags: [UNVERIFIED("Section citation for the PFAS MCL table and the status of the 2025 reconsideration should be confirmed on eCFR.")],
    entities: [{ type: "regulation", name: "40 C.F.R. § 141.61", externalId: "ecfr:40 C.F.R. § 141.61" }, { type: "agency", name: "Environmental Protection Agency" }],
    meta: { title: 40, part: "141", textKind: "summary" },
    text: `40 C.F.R. Part 141 — PFAS national primary drinking water regulation
Summary prepared for the LeClaude sample corpus.

The April 2024 final rule (89 FR 32532) established the first enforceable national drinking water standards for PFAS. It set maximum contaminant levels (MCLs) of 4.0 nanograms per liter (parts per trillion) for PFOA and for PFOS, 10 ng/L each for PFHxS, PFNA and HFPO-DA (GenX chemicals), and a hazard index of 1 for mixtures containing two or more of PFHxS, PFNA, HFPO-DA and PFBS. Maximum contaminant level goals for PFOA and PFOS were set at zero.

Compliance. Public water systems must complete initial monitoring within three years of promulgation (by 2027), provide the results in consumer confidence reports, and, where levels exceed an MCL, implement treatment or an alternative source. The rule as promulgated gave systems until 2029 to comply with the MCLs.

Reconsideration. In May 2025 EPA announced that it would keep the PFOA and PFOS standards, extend the compliance deadline for them to 2031 through rulemaking, and rescind and reconsider the standards for PFHxS, PFNA, HFPO-DA and the hazard index. Litigation challenging the rule is pending in the D.C. Circuit. The current codified text should be checked on eCFR.

Relevance. The MCLs define the treatment obligations of the public water system plaintiffs in MDL 2873 and drive the phased testing under the 3M and DuPont class settlements.`,
  },
  {
    id: "idoc_seed_reg_21cfr314_70", source: "ecfr", kind: "regulation",
    title: "21 C.F.R. § 314.70 — Supplements and other changes to an approved NDA (including changes being effected)", citation: "21 C.F.R. § 314.70", jurisdiction: "Federal",
    agencies: ["Food and Drug Administration"], productIds: [E.depoProvera], dates: { modified: "2026-09-01" }, url: "https://www.ecfr.gov/current/title-21/section-314.70", externalId: "ecfr:21 C.F.R. § 314.70", matterIds: [DEPO], tags: ["cfr", "title-21", "labeling", "cbe"], confidence: 0.85,
    entities: [{ type: "regulation", name: "21 C.F.R. § 314.70", externalId: "ecfr:21 C.F.R. § 314.70" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { title: 21, part: "314", section: "314.70", textKind: "summary" },
    text: `21 C.F.R. § 314.70 — Supplements and other changes to an approved NDA
Summary prepared for the LeClaude sample corpus.

(a) General. The applicant must notify FDA about each change in each condition established in an approved NDA beyond the variations already provided for, and must assess the effect of the change on the identity, strength, quality, purity and potency of the drug.

(b) Major changes — prior approval supplements. Changes with substantial potential to adversely affect the drug, including most labeling changes, require a supplement approved by FDA before distribution.

(c) Moderate changes — supplement, changes being effected. Certain changes may be made before FDA approval if a supplement is submitted at or before the time the change is made. Under § 314.70(c)(6)(iii), the applicant may distribute a product with labeling changes that add or strengthen a contraindication, warning, precaution or adverse reaction for which the evidence of a causal association satisfies the standard for inclusion in the labeling under § 201.57(c); add or strengthen a statement about abuse, dependence, psychological effect or overdosage; add or strengthen an instruction about dosage and administration intended to increase safe use; or delete false, misleading or unsupported indications, claims or information. Such changes must reflect "newly acquired information" as defined in § 314.3 — data, analyses or other information not previously submitted to FDA, including new analyses of previously submitted data that reveal risks of a different type or greater severity or frequency than previously included.

(d) Minor changes — annual report. Editorial and other minor changes are described in the annual report.

Relevance. The CBE provision is the mechanism the Supreme Court relied on in Wyeth v. Levine to hold that a brand manufacturer can strengthen a warning without prior approval; in the Depo-Provera litigation the question is whether the meningioma data (including the 2024 BMJ cohort study) constituted newly acquired information permitting a CBE label change.`,
  },
  {
    id: "idoc_seed_reg_21cfr314_80", source: "ecfr", kind: "regulation",
    title: "21 C.F.R. § 314.80 — Postmarketing reporting of adverse drug experiences", citation: "21 C.F.R. § 314.80", jurisdiction: "Federal",
    agencies: ["Food and Drug Administration"], productIds: [E.depoProvera], dates: { modified: "2026-09-01" }, url: "https://www.ecfr.gov/current/title-21/section-314.80", externalId: "ecfr:21 C.F.R. § 314.80", matterIds: [DEPO], tags: ["cfr", "title-21", "pharmacovigilance"], confidence: 0.85,
    entities: [{ type: "regulation", name: "21 C.F.R. § 314.80", externalId: "ecfr:21 C.F.R. § 314.80" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { title: 21, part: "314", section: "314.80", textKind: "summary" },
    text: `21 C.F.R. § 314.80 — Postmarketing reporting of adverse drug experiences
Summary prepared for the LeClaude sample corpus.

Definitions. An adverse drug experience is any adverse event associated with the use of a drug in humans, whether or not considered drug related, including events occurring in professional practice, from overdose, abuse or withdrawal, and any failure of expected pharmacological action. "Serious" covers death, life-threatening events, hospitalization, persistent or significant disability, congenital anomaly, or events requiring intervention to prevent a permanent impairment. "Unexpected" means not listed in the current labeling, or listed but occurring with greater specificity or severity.

Duties. The applicant must promptly review all adverse drug experience information obtained from any source, foreign or domestic, including commercial marketing experience, postmarketing studies, reports in the scientific literature and unpublished papers. Serious and unexpected experiences must be reported within fifteen calendar days (15-day alert reports) and promptly investigated, with follow-up reports within fifteen days of receiving new information. Other experiences are reported periodically — quarterly for three years after approval and annually thereafter — with a narrative summary and analysis, including a history of actions taken because of adverse experiences such as labeling changes.

Records. Records of all adverse drug experiences known to the applicant, including raw data and correspondence, must be maintained for ten years.

Relevance. Foreign case reports and the published literature on meningioma in Depo-Provera users fall within the applicant's review and reporting duties; the periodic reports and any signal-evaluation documents are central to discovery on what the manufacturer knew and when.`,
  },
  {
    id: "idoc_seed_reg_21cfr201_57", source: "ecfr", kind: "regulation",
    title: "21 C.F.R. § 201.57 — Specific requirements on content and format of labeling for human prescription drug and biological products", citation: "21 C.F.R. § 201.57", jurisdiction: "Federal",
    agencies: ["Food and Drug Administration"], productIds: [E.depoProvera], dates: { modified: "2026-09-01" }, url: "https://www.ecfr.gov/current/title-21/section-201.57", externalId: "ecfr:21 C.F.R. § 201.57", matterIds: [DEPO], tags: ["cfr", "title-21", "labeling"], confidence: 0.85,
    entities: [{ type: "regulation", name: "21 C.F.R. § 201.57", externalId: "ecfr:21 C.F.R. § 201.57" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { title: 21, part: "201", section: "201.57", textKind: "summary" },
    text: `21 C.F.R. § 201.57 — Specific requirements on content and format of labeling
Summary prepared for the LeClaude sample corpus.

Structure. Prescription drug labeling in the physician labeling rule format consists of Highlights, a Table of Contents and Full Prescribing Information, with sections in a fixed order: Boxed Warning, Indications and Usage, Dosage and Administration, Dosage Forms and Strengths, Contraindications, Warnings and Precautions, Adverse Reactions, Drug Interactions, Use in Specific Populations, and others.

Boxed warning (§ 201.57(c)(1)). Certain contraindications or serious warnings, particularly those that may lead to death or serious injury, may be required by FDA to be presented in a box. The box must briefly explain the risk and refer to more detailed information elsewhere in the labeling.

Warnings and precautions (§ 201.57(c)(6)). The section must describe clinically significant adverse reactions, other potential safety hazards, limitations in use imposed by them, and steps to be taken if they occur. The labeling must be revised to include a warning about a clinically significant hazard as soon as there is reasonable evidence of a causal association with a drug; a causal relationship need not have been definitely established.

Adverse reactions (§ 201.57(c)(7)). Describes the overall adverse reaction profile based on the entire safety database, listing reactions from clinical trials with rates and reactions identified from postmarketing experience.

Relevance. The "reasonable evidence of a causal association" standard in § 201.57(c)(6) is the threshold both for the duty to warn under state law and for the CBE mechanism in § 314.70(c)(6)(iii); Depo-Provera plaintiffs contend that standard was met for meningioma well before the U.S. labeling changed.`,
  },

  // ------------------------------------------------------------------ Federal Register
  {
    id: "idoc_seed_fr_tsca_pfas", source: "federalRegister", kind: "register_notice",
    title: "Final rule: Toxic Substances Control Act (TSCA); Reporting and Recordkeeping Requirements for Perfluoroalkyl and Polyfluoroalkyl Substances", citation: "88 FR 70516", jurisdiction: "Federal",
    agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { published: "2023-10-11", effective: "2023-11-13" }, url: "https://www.federalregister.gov/documents/2023/10/11/2023-22094/toxic-substances-control-act-tsca-reporting-and-recordkeeping-requirements-for-perfluoroalkyl-and", externalId: "fr:2023-22094", matterIds: [AFFF], tags: ["federal-register", "rule", "pfas", "tsca"], confidence: 0.85,
    entities: [{ type: "agency", name: "Environmental Protection Agency" }, { type: "regulation", name: "40 C.F.R. Part 705" }],
    meta: { documentNumber: "2023-22094", type: "Rule", docketIds: ["EPA-HQ-OPPT-2020-0549"], textKind: "summary" },
    summary: "EPA's final TSCA section 8(a)(7) rule requiring manufacturers and importers of PFAS since 2011 to report uses, volumes, byproducts, exposure and existing health and environmental effects information.",
    text: `Federal Register — Vol. 88, No. 195, page 70516 (October 11, 2023)
Environmental Protection Agency, 40 CFR Part 705 [EPA-HQ-OPPT-2020-0549; FRL-7902-02-OCSPP], RIN 2070-AK67
Toxic Substances Control Act (TSCA); Reporting and Recordkeeping Requirements for Perfluoroalkyl and Polyfluoroalkyl Substances — Final rule

Summary. EPA finalized reporting and recordkeeping requirements for PFAS under TSCA section 8(a)(7). Any person who has manufactured (including imported) a PFAS or PFAS-containing article in any year since 2011 must electronically report information regarding PFAS uses, production volumes, byproducts, disposal, exposures, and existing information on environmental or health effects. The rule contains no exemption for small quantities, impurities, byproducts, articles, or research and development, although streamlined reporting forms are available for article importers and R&D substances.

Dates. Effective November 13, 2023. The rule established a submission period beginning twelve months after the effective date and lasting six months (later amended).

Regulatory analysis. EPA estimated total industry costs in the hundreds of millions of dollars over the reporting period, driven by the number of entities expected to report, and responded to comments requesting a de minimis threshold, an article exemption and a longer submission window by explaining the statutory direction to obtain information "to the extent known to or reasonably ascertainable by" the manufacturer.

Relevance. The rule requires the AFFF manufacturers and their fluorochemical suppliers to compile a retrospective record of PFAS production, uses and known effects, overlapping with discovery on corporate knowledge in MDL 2873.`,
  },
  {
    id: "idoc_seed_fr_pfas_npdwr", source: "federalRegister", kind: "register_notice",
    title: "Final rule: PFAS National Primary Drinking Water Regulation", citation: "89 FR 32532", jurisdiction: "Federal",
    agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { published: "2024-04-26", effective: "2024-06-25" }, url: "https://www.federalregister.gov/documents/2024/04/26/2024-07773/pfas-national-primary-drinking-water-regulation", externalId: "fr:2024-07773", matterIds: [AFFF], tags: ["federal-register", "rule", "pfas", "drinking-water"], confidence: 0.85,
    entities: [{ type: "agency", name: "Environmental Protection Agency" }, { type: "regulation", name: "40 C.F.R. Part 141" }],
    meta: { documentNumber: "2024-07773", type: "Rule", docketIds: ["EPA-HQ-OW-2022-0114"], textKind: "summary" },
    summary: "EPA's first enforceable national drinking water standards for six PFAS, including 4.0 ppt MCLs for PFOA and PFOS.",
    text: `Federal Register — Vol. 89, No. 82, page 32532 (April 26, 2024)
Environmental Protection Agency, 40 CFR Parts 141 and 142 [EPA-HQ-OW-2022-0114; FRL-8543-02-OW], RIN 2040-AG18
PFAS National Primary Drinking Water Regulation — Final rule

Summary. EPA established a national primary drinking water regulation for six per- and polyfluoroalkyl substances: individual maximum contaminant levels for PFOA (4.0 ng/L), PFOS (4.0 ng/L), PFHxS (10 ng/L), PFNA (10 ng/L) and HFPO-DA (10 ng/L), and a hazard index MCL of 1 (unitless) for mixtures of two or more of PFHxS, PFNA, HFPO-DA and PFBS. EPA set maximum contaminant level goals of zero for PFOA and PFOS based on their likely carcinogenicity to humans. Public water systems must monitor for these PFAS, notify the public of results, and reduce levels that exceed the MCLs, with initial monitoring required within three years and compliance with the MCLs within five years of promulgation.

Health basis. EPA relied on epidemiological and toxicological evidence associating PFOA and PFOS exposure with kidney and testicular cancer, decreased immune response, developmental effects and elevated cholesterol, and on the Science Advisory Board's review of the health effects assessments.

Costs and benefits. EPA estimated annualized costs of roughly $1.5 billion and quantified benefits of a similar magnitude from avoided cancers, cardiovascular disease and birth-weight effects, with additional unquantified benefits.

Relevance. Defines the treatment obligations of public water system plaintiffs in MDL 2873 and the phased testing and compensation tiers in the 3M and DuPont class settlements; the standards were partially reconsidered in 2025.`,
  },
  {
    id: "idoc_seed_fr_cercla_pfoa", source: "federalRegister", kind: "register_notice",
    title: "Final rule: Designation of Perfluorooctanoic Acid (PFOA) and Perfluorooctanesulfonic Acid (PFOS) as CERCLA Hazardous Substances", citation: "89 FR 39124", jurisdiction: "Federal",
    agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { published: "2024-05-08", effective: "2024-07-08" }, url: "https://www.federalregister.gov/documents/2024/05/08/2024-08547/designation-of-perfluorooctanoic-acid-pfoa-and-perfluorooctanesulfonic-acid-pfos-as-cercla-hazardous", externalId: "fr:2024-08547", matterIds: [AFFF], tags: ["federal-register", "rule", "pfas", "cercla"], confidence: 0.85,
    entities: [{ type: "agency", name: "Environmental Protection Agency" }, { type: "regulation", name: "40 C.F.R. Part 302" }],
    meta: { documentNumber: "2024-08547", type: "Rule", docketIds: ["EPA-HQ-OLEM-2019-0341"], textKind: "summary" },
    summary: "EPA designated PFOA and PFOS, including their salts and structural isomers, as hazardous substances under CERCLA section 102(a).",
    text: `Federal Register — Vol. 89, No. 90, page 39124 (May 8, 2024)
Environmental Protection Agency, 40 CFR Part 302 [EPA-HQ-OLEM-2019-0341; FRL-8393-02-OLEM], RIN 2050-AH09
Designation of Perfluorooctanoic Acid (PFOA) and Perfluorooctanesulfonic Acid (PFOS) as CERCLA Hazardous Substances — Final rule

Summary. Under section 102(a) of the Comprehensive Environmental Response, Compensation, and Liability Act, EPA designated PFOA and PFOS, including their salts and structural isomers, as hazardous substances. The designation requires reporting of releases at or above the one-pound reportable quantity, authorizes EPA to respond to releases and to recover response costs from potentially responsible parties, and requires federal agencies transferring property to give notice of PFOA/PFOS storage, release or disposal.

Findings. EPA found that PFOA and PFOS may present substantial danger to public health or welfare or the environment when released, citing their persistence, mobility, bioaccumulation and associations with cancer, immune, developmental, hepatic and cardiovascular effects.

Enforcement discretion. Concurrently EPA issued a policy stating that it does not intend to pursue certain parties — including community water systems, publicly owned treatment works, municipal airports, local fire departments and farms applying biosolids — for CERCLA response costs, focusing instead on manufacturers and industrial users.

Relevance. Exposes AFFF manufacturers and users to CERCLA cost-recovery and contribution claims for sites contaminated by firefighting foam, and interacts with the settlement releases negotiated in MDL 2873.`,
  },
  {
    id: "idoc_seed_fr_plr", source: "federalRegister", kind: "register_notice",
    title: "Final rule: Requirements on Content and Format of Labeling for Human Prescription Drug and Biological Products (physician labeling rule)", citation: "71 FR 3922", jurisdiction: "Federal",
    agencies: ["Food and Drug Administration"], productIds: [E.depoProvera], dates: { published: "2006-01-24", effective: "2006-06-30" }, url: "https://www.federalregister.gov/documents/2006/01/24/06-545/requirements-on-content-and-format-of-labeling-for-human-prescription-drug-and-biological-products", externalId: "fr:06-545", matterIds: [DEPO], tags: ["federal-register", "rule", "labeling", "preemption"], confidence: 0.85,
    entities: [{ type: "agency", name: "Food and Drug Administration" }, { type: "regulation", name: "21 C.F.R. § 201.57" }],
    meta: { documentNumber: "06-545", type: "Rule", textKind: "summary" },
    summary: "FDA's physician labeling rule reorganizing prescription drug labeling (Highlights, Warnings and Precautions) and including the preemption preamble later rejected in Wyeth v. Levine.",
    text: `Federal Register — Vol. 71, No. 15, page 3922 (January 24, 2006)
Food and Drug Administration, 21 CFR Parts 201, 314 and 601 [Docket No. 2000N-1269], RIN 0910-AA94
Requirements on Content and Format of Labeling for Human Prescription Drug and Biological Products — Final rule

Summary. FDA revised the content and format of prescription drug labeling to make it easier for health care practitioners to access, read and use: labeling now begins with Highlights of prescribing information and a table of contents, followed by the full prescribing information in a prescribed order. The rule created the Warnings and Precautions section (replacing separate Warnings and Precautions sections), required that clinically significant hazards be included as soon as there is reasonable evidence of a causal association, reorganized the adverse reactions section around the entire safety database, and set minimum type sizes and graphic standards.

Preamble on preemption. The preamble asserted that FDA approval of labeling preempts conflicting or contrary state law, listing situations in which state failure-to-warn claims would be preempted. The Supreme Court in Wyeth v. Levine (2009) gave the preamble no deference, noting that it reversed the agency's longstanding position without notice and comment and that Congress did not intend FDA oversight to be the exclusive means of ensuring drug safety.

Implementation. Applied to new applications immediately and phased in for previously approved products over several years.

Relevance. The physician labeling rule format and the "reasonable evidence of a causal association" standard govern the Depo-Provera labeling at issue in MDL 3140.`,
  },

  // ------------------------------------------------------------------ Statutes
  {
    id: "idoc_seed_statute_tsca_8e", source: "govinfo", kind: "statute",
    title: "15 U.S.C. § 2607(e) — Notice to Administrator of substantial risks (TSCA § 8(e))", citation: "15 U.S.C. § 2607(e)", jurisdiction: "Federal",
    agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { modified: "2026-09-01" }, url: "https://www.govinfo.gov/app/collection/uscode", externalId: "seed:govinfo:15-usc-2607", matterIds: [AFFF], tags: ["statute", "uscode", "tsca"], confidence: 0.85,
    entities: [{ type: "statute", name: "15 U.S.C. § 2607(e)" }, { type: "agency", name: "Environmental Protection Agency" }],
    meta: { collection: "USCODE", textKind: "summary" },
    text: `15 U.S.C. § 2607 — Reporting and retention of information (Toxic Substances Control Act § 8)
Summary prepared for the LeClaude sample corpus.

Subsection (e) — Notice to Administrator of substantial risks. Any person who manufactures, processes or distributes in commerce a chemical substance or mixture and who obtains information which reasonably supports the conclusion that such substance or mixture presents a substantial risk of injury to health or the environment shall immediately inform the Administrator of such information unless such person has actual knowledge that the Administrator has been adequately informed of such information.

EPA's guidance (the 1978 Statement of Interpretation and Enforcement Policy and later reporting guidance) treats "immediately" as within thirty calendar days, defines substantial risk by the seriousness of the effect and the probability of its occurrence, and identifies reportable information as including human health effects data, animal studies showing serious effects, and evidence of widespread and previously unsuspected environmental contamination.

Subsection (a)(7), added in 2019, directs the PFAS reporting rule codified at 40 C.F.R. Part 705. Subsection (d) requires health and safety studies to be submitted on request.

Relevance. The TSCA § 8(e) knowledge timeline — what the AFFF manufacturers and fluorosurfactant suppliers learned about PFOS/PFOA toxicity and environmental persistence, and when they reported it — is a central theme of discovery in MDL 2873 and of the firm's work for its demonstration client.`,
  },
  {
    id: "idoc_seed_statute_1407", source: "govinfo", kind: "statute",
    title: "28 U.S.C. § 1407 — Multidistrict litigation", citation: "28 U.S.C. § 1407", jurisdiction: "Federal",
    dates: { modified: "2026-09-01" }, url: "https://www.govinfo.gov/app/collection/uscode", externalId: "seed:govinfo:28-usc-1407", matterIds: [AFFF, DEPO], tags: ["statute", "uscode", "mdl"], confidence: 0.9,
    entities: [{ type: "statute", name: "28 U.S.C. § 1407" }, { type: "court", name: "Judicial Panel on Multidistrict Litigation", externalId: "cl:court:jpml" }],
    meta: { collection: "USCODE", textKind: "summary" },
    text: `28 U.S.C. § 1407 — Multidistrict litigation
Summary prepared for the LeClaude sample corpus.

(a) When civil actions involving one or more common questions of fact are pending in different districts, they may be transferred to any district for coordinated or consolidated pretrial proceedings. Transfers are made by the Judicial Panel on Multidistrict Litigation upon its determination that transfer will be for the convenience of parties and witnesses and will promote the just and efficient conduct of the actions. Each action so transferred shall be remanded by the Panel at or before the conclusion of pretrial proceedings to the district from which it was transferred unless it has been previously terminated.

(b) Pretrial proceedings are conducted by a judge or judges to whom the actions are assigned by the Panel; the Panel may separate claims and remand them.

(c) Proceedings for transfer may be initiated by the Panel on its own initiative or by motion of a party; notice and an opportunity to be heard are required, and the Panel's order is filed in the transferee court.

(d) The Panel consists of seven circuit and district judges designated by the Chief Justice, no two from the same circuit; concurrence of four is necessary to act.

(e) No proceedings for review of any order of the Panel may be permitted except by extraordinary writ; petitions for review of transfer orders are filed in the court of appeals for the circuit of the transferee district.

Relevance. The statutory basis for MDL 2873 (AFFF) and MDL 3140 (Depo-Provera) and the source of the Lexecon remand rule.`,
  },

  // ------------------------------------------------------------------ FDA sample records
  {
    id: "idoc_seed_recall_mpa", source: "openfda", kind: "recall",
    title: "Class II: Medroxyprogesterone Acetate Injectable Suspension, USP 150 mg/mL, 1 mL vials (sample record)", jurisdiction: "Federal",
    agencies: ["Food and Drug Administration"], productIds: [E.depoProvera], dates: { event: "2025-03-18", published: "2025-04-02" }, externalId: "seed:fda:recall:D-0418-2025", matterIds: [DEPO], tags: ["fda", "recall", "drug", "class-ii", "sample"], confidence: 0.5,
    flags: [UNVERIFIED("Sample enforcement record modeled on the openFDA schema to demonstrate the recall pipeline; not an actual FDA enforcement report.")],
    entities: [{ type: "product", name: "Medroxyprogesterone acetate injectable suspension" }, { type: "party", name: "Harborview Pharmaceuticals LLC", role: "recalling_firm" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { sample: true, recallNumber: "D-0418-2025", classification: "Class II", status: "Ongoing", endpoint: "drug", voluntaryMandated: "Voluntary: Firm initiated" },
    summary: "Presence of particulate matter observed in retained samples; lots distributed nationwide to wholesalers and clinics.",
    text: `Class II — Medroxyprogesterone Acetate Injectable Suspension, USP 150 mg/mL, 1 mL single-dose vial, Rx only
Recall number: D-0418-2025 (sample record)
Status: Ongoing
Recalling firm: Harborview Pharmaceuticals LLC (Piscataway, NJ, United States)
Recall initiated: 2025-03-18
Report date: 2025-04-02
Type: Voluntary: Firm initiated

Reason for recall
Presence of particulate matter: visible particulates identified in retained samples during stability testing.

Code information
Lots 24H117, 24H118, 24J022; expiration 08/2026 – 10/2026.

Quantity: 46,800 vials
Distribution: Nationwide in the United States to wholesalers, retail pharmacies and clinics.
Generic name: medroxyprogesterone acetate
Product type: Drugs

Note. This record is a seeded sample that mirrors the fields returned by the openFDA drug enforcement endpoint (recall_number, classification, status, recalling_firm, reason_for_recall, code_info, product_quantity, distribution_pattern, openfda.generic_name). Live records replace it when the FDA source runs.`,
  },
  {
    id: "idoc_seed_recall_port", source: "openfda", kind: "recall",
    title: "Class I: Implantable venous access port with polyurethane catheter (sample record)", jurisdiction: "Federal",
    agencies: ["Food and Drug Administration"], dates: { event: "2025-01-27", published: "2025-02-19" }, externalId: "seed:fda:recall:Z-1140-2025", tags: ["fda", "recall", "device", "class-i", "sample"], confidence: 0.5,
    flags: [UNVERIFIED("Sample device enforcement record modeled on the openFDA schema; not an actual FDA enforcement report.")],
    entities: [{ type: "product", name: "Implantable venous access port" }, { type: "party", name: "Crestline Medical Devices, Inc.", role: "recalling_firm" }, { type: "agency", name: "Food and Drug Administration" }, { type: "mdl", name: "MDL 3081", externalId: "jpml:3081" }],
    meta: { sample: true, recallNumber: "Z-1140-2025", classification: "Class I", status: "Ongoing", endpoint: "device", voluntaryMandated: "Voluntary: Firm initiated" },
    summary: "Catheter fracture and fragmentation reported after implantation; potential for embolization of catheter fragments.",
    text: `Class I — Implantable venous access port with 8 Fr polyurethane catheter, single-lumen, titanium body
Recall number: Z-1140-2025 (sample record)
Status: Ongoing
Recalling firm: Crestline Medical Devices, Inc. (Tempe, AZ, United States)
Recall initiated: 2025-01-27
Report date: 2025-02-19
Type: Voluntary: Firm initiated

Reason for recall
Reports of catheter fracture and fragmentation following implantation, with the potential for catheter fragments to embolize to the heart or pulmonary vasculature, requiring surgical or endovascular retrieval.

Code information
Catalog numbers CP-8100, CP-8110; lot numbers beginning with 23K through 24C.

Quantity: 12,300 units
Distribution: Nationwide (US) to hospitals and outpatient infusion centers.
Product type: Devices

Note. Seeded sample mirroring the openFDA device enforcement schema. Related litigation: In re: Bard Implanted Port Catheter Products Liability Litigation, MDL 3081 (D. Ariz.).`,
  },
  {
    id: "idoc_seed_recall_ranitidine", source: "openfda", kind: "recall",
    title: "Class II: Ranitidine Tablets, USP 150 mg — N-nitrosodimethylamine (NDMA) impurity (sample record)", jurisdiction: "Federal",
    agencies: ["Food and Drug Administration"], dates: { event: "2019-10-23", published: "2019-11-13" }, externalId: "seed:fda:recall:D-0086-2020", tags: ["fda", "recall", "drug", "class-ii", "ndma", "sample"], confidence: 0.5,
    flags: [UNVERIFIED("Sample record modeled on the 2019–2020 ranitidine NDMA recalls; the recall number and firm are illustrative.")],
    entities: [{ type: "product", name: "Ranitidine" }, { type: "party", name: "Northgate Generics Inc.", role: "recalling_firm" }, { type: "agency", name: "Food and Drug Administration" }, { type: "mdl", name: "MDL 2924", externalId: "jpml:2924" }],
    meta: { sample: true, recallNumber: "D-0086-2020", classification: "Class II", status: "Terminated", endpoint: "drug", voluntaryMandated: "Voluntary: Firm initiated" },
    summary: "CGMP deviations: presence of the probable human carcinogen NDMA above the acceptable daily intake limit.",
    text: `Class II — Ranitidine Tablets, USP 150 mg, 60-count bottles, Rx only
Recall number: D-0086-2020 (sample record)
Status: Terminated
Recalling firm: Northgate Generics Inc. (Parsippany, NJ, United States)
Recall initiated: 2019-10-23
Report date: 2019-11-13
Type: Voluntary: Firm initiated

Reason for recall
CGMP deviations: confirmed presence of N-nitrosodimethylamine (NDMA), a probable human carcinogen, above FDA's acceptable daily intake limit of 96 nanograms.

Code information
All lots within expiry.

Distribution: Nationwide (US).
Generic name: ranitidine hydrochloride
Product type: Drugs

Note. Seeded sample illustrating the recall class that led FDA in April 2020 to request the withdrawal of all ranitidine products from the U.S. market and that underlies In re: Zantac (Ranitidine) Products Liability Litigation, MDL 2924 (S.D. Fla.).`,
  },

  // ------------------------------------------------------------------ Court rules
  {
    id: "idoc_seed_rule_cand", source: "courtRules", kind: "court_rule",
    title: "N.D. Cal. Civil Local Rules 7-1 to 7-11 — Motion practice (notice, opposition, reply, page limits)", court: "U.S. District Court for the Northern District of California", courtId: "cand", jurisdiction: "Federal · 9th Cir.",
    dates: { modified: "2026-09-01" }, url: "https://www.cand.uscourts.gov/rules/civil-local-rules/", externalId: "rule:https://www.cand.uscourts.gov/rules/civil-local-rules/", tags: ["court-rule", "cand", "motions"], confidence: 0.85,
    entities: [{ type: "court", name: "U.S. District Court for the Northern District of California", externalId: "cl:court:cand" }],
    meta: { textKind: "summary", rules: ["7-1", "7-2", "7-3", "7-4", "7-9", "7-11"] },
    text: `Civil Local Rules of the United States District Court for the Northern District of California — Rule 7 (Motion Practice)
Summary prepared for the LeClaude sample corpus; confirm against the current rules on the court's website.

7-1 Motions and other requests. Any written request for a court order must be presented by motion, stipulation with proposed order, or (for administrative matters) an administrative motion under Rule 7-11.

7-2 Notice and supporting papers. A motion must be filed, served and noticed for hearing not less than 35 days after filing. The notice of motion and points and authorities are combined in one document not exceeding 25 pages, which must state the relief sought, the grounds and the hearing date.

7-3 Opposition; reply. Any opposition must be filed and served not more than 14 days after the motion is filed and may not exceed 25 pages; a statement of nonopposition may be filed instead. Any reply must be filed not more than 7 days after the opposition is due and may not exceed 15 pages. Objections to evidence must be contained within the brief.

7-4 Brief or memorandum of points and authorities. Must contain a statement of the issues to be decided, a succinct statement of the relevant facts, and argument; text must be in 12-point type with no more than 28 lines per page unless the court permits otherwise.

7-9 Motion for leave to file a motion for reconsideration. Requires a showing of a material difference in fact or law, new material facts or a change of law, or a manifest failure by the court to consider material facts or dispositive legal arguments; no repetition of prior argument.

7-11 Administrative motions. For miscellaneous administrative matters (filing under seal, exceeding page limits, scheduling), decided on papers; opposition due within 4 days.

Related. Rule 3-12 (related cases), Rule 16 (case management), Rule 37-1 (discovery disputes require meet and confer), Rule 79-5 (sealing standards: narrowly tailored; compelling reasons for dispositive motions).

Relevance. Governs motion practice in the Social Media Adolescent Addiction MDL 3047 and in the Northgate v. Apex matter tracked in this workspace.`,
  },
  {
    id: "idoc_seed_rule_dsc", source: "courtRules", kind: "court_rule",
    title: "D.S.C. Local Civil Rules — Motions (7.01–7.08), Rule 26(f) reports (26.03) and deposition conduct (30.04)", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], dates: { modified: "2026-09-01" }, url: "https://www.scd.uscourts.gov/rules/localrules.asp", externalId: "rule:https://www.scd.uscourts.gov/rules/localrules.asp", matterIds: [AFFF], tags: ["court-rule", "dsc", "motions", "discovery"], confidence: 0.65,
    flags: [UNVERIFIED("Rule numbering summarized from memory for this sample; verify against the current D.S.C. Local Civil Rules before relying on a citation.")],
    entities: [{ type: "court", name: DSC, externalId: "cl:court:dsc" }],
    meta: { textKind: "summary" },
    text: `Local Civil Rules of the United States District Court for the District of South Carolina — selected rules
Summary prepared for the LeClaude sample corpus; confirm against the current rules on the court's website.

Local Civ. Rule 7.04 — Memoranda in support. Motions (other than routine motions) must be accompanied by a supporting memorandum; memoranda are limited in length and must cite the specific record materials relied on.

Local Civ. Rule 7.06 — Responses. Responses to motions are due within fourteen (14) days after service of the motion unless the court orders otherwise; failure to respond may be treated as a waiver of opposition.

Local Civ. Rule 7.07 — Replies. Reply memoranda are due within seven (7) days after service of the response and are limited to matters raised in the response.

Local Civ. Rule 7.08 — Hearings. Motions are decided without a hearing unless the court orders one.

Local Civ. Rule 26.03 — Rule 26(f) report and answers to the court's interrogatories. Within the time set by the court's order, each party must file answers to the court's standard interrogatories (short statement of the facts, likely witnesses, expert testimony, proposed dates, damages) and the parties must file a joint Rule 26(f) report.

Local Civ. Rule 30.04 — Conduct during depositions. Objections must be concise and non-argumentative; counsel may instruct a witness not to answer only to preserve a privilege, enforce a court-ordered limitation or present a motion under Rule 30(d); private conferences during the deposition are limited to privilege decisions.

MDL 2873 practice. Judge Gergel's case management orders in the AFFF MDL supplement these rules with bellwether-specific schedules, page limits for Daubert and summary judgment briefing, and a protocol for text orders resolving routine scheduling requests.`,
  },
  {
    id: "idoc_seed_rule_frcp", source: "courtRules", kind: "court_rule",
    title: "Federal Rules of Civil Procedure 26 and 30 — Discovery scope, disclosures, expert reports and depositions", court: "United States federal courts", jurisdiction: "Federal",
    dates: { effective: "2023-12-01", modified: "2026-09-01" }, url: "https://www.law.cornell.edu/rules/frcp", externalId: "rule:https://www.law.cornell.edu/rules/frcp", matterIds: [AFFF, DEPO], tags: ["court-rule", "frcp", "discovery"], confidence: 0.9,
    entities: [],
    meta: { textKind: "summary" },
    text: `Federal Rules of Civil Procedure — Rules 26 and 30 (selected provisions)
Summary prepared for the LeClaude sample corpus.

Rule 26(a)(1) Initial disclosures. Without awaiting a discovery request, each party must disclose the individuals likely to have discoverable information, the documents and ESI it may use to support its claims or defenses, a computation of damages, and applicable insurance agreements, within 14 days after the Rule 26(f) conference unless otherwise stipulated or ordered.

Rule 26(a)(2) Expert disclosures. Retained experts must provide a written report containing a complete statement of all opinions and their basis, the facts or data considered, exhibits, qualifications, a list of prior testimony and the compensation for the study and testimony; disclosures are due at least 90 days before trial (30 days for rebuttal) absent a scheduling order.

Rule 26(b)(1) Scope. Parties may obtain discovery of any nonprivileged matter relevant to any party's claim or defense and proportional to the needs of the case, considering the importance of the issues, the amount in controversy, the parties' relative access to information and resources, the importance of the discovery, and whether the burden outweighs its likely benefit.

Rule 26(b)(4) Trial-preparation protection for experts. Draft reports and most attorney-expert communications are protected.

Rule 26(b)(5)(B) Clawback. A party that produces privileged information may notify the receiving party, which must return, sequester or destroy it pending resolution.

Rule 26(f) Conference. Parties must confer as soon as practicable and at least 21 days before the scheduling conference to discuss preservation, ESI and a discovery plan.

Rule 30(d)(1) Duration. A deposition is limited to one day of 7 hours unless otherwise stipulated or ordered. Rule 30(b)(6) requires an organization to designate witnesses on noticed topics after conferring in good faith. Rule 30(c)(2) limits instructions not to answer to privilege, court-ordered limitations and Rule 30(d)(3) motions.

Relevance. Baseline for the discovery schedules and deposition protocols in MDL 2873 and MDL 3140 and for the e-discovery review tracked in this workspace.`,
  },

  // ------------------------------------------------------------------ Judges, counsel, firms
  {
    id: "idoc_seed_judge_gergel", source: "clJudges", kind: "judge",
    title: "Richard M. Gergel", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.", judgeIds: [E.gergel], dates: { event: "2010-08-09", modified: "2026-09-01" }, url: "https://www.courtlistener.com/?q=%22Richard+Gergel%22&type=p", externalId: "seed:judge:gergel", matterIds: [AFFF], tags: ["judge"], confidence: 0.85,
    entities: [{ type: "judge", name: "Richard M. Gergel" }, { type: "court", name: DSC, externalId: "cl:court:dsc" }],
    meta: { positions: [{ title: "U.S. District Judge", court: DSC, appointer: "Barack Obama", dateStart: "2010-08-09" }] },
    text: `Richard Mark Gergel
United States District Judge, District of South Carolina (Charleston)

Appointment. Nominated by President Barack Obama in 2010 and confirmed by the Senate in August 2010 to the seat vacated by Judge Patrick Michael Duffy.

Background. Born in 1954 in Columbia, South Carolina. Duke University (A.B. 1975; J.D. 1979). Private practice in Columbia for three decades (Gergel, Nickles & Solomon), concentrating on civil litigation. Author of works on South Carolina legal history, including a study of Judge J. Waties Waring and the school desegregation cases.

Notable assignments. Transferee judge for In re: Aqueous Film-Forming Foams Products Liability Litigation, MDL No. 2873, since December 2018; transferee judge for the Lipitor MDL (No. 2502), whose general-causation rulings the Fourth Circuit affirmed in 892 F.3d 624 (2018); presided over the federal capital trial of Dylann Roof (2016–2017).

Practice notes for this workspace. Active case management with frequent text orders and status conferences; expects bellwether-ready cases, strict adherence to expert disclosure deadlines and concise Daubert briefing; has repeatedly emphasized the government contractor defense as a jury question on the AFFF record.`,
  },
  {
    id: "idoc_seed_judge_rodgers", source: "clJudges", kind: "judge",
    title: "M. Casey Rodgers", court: FLND, courtId: "flnd", jurisdiction: "Federal · 11th Cir.", judgeIds: [E.rodgers], dates: { event: "2003-11-14", modified: "2026-09-01" }, url: "https://www.courtlistener.com/?q=%22Casey+Rodgers%22&type=p", externalId: "seed:judge:rodgers", matterIds: [DEPO], tags: ["judge"], confidence: 0.85,
    entities: [{ type: "judge", name: "M. Casey Rodgers" }, { type: "court", name: FLND, externalId: "cl:court:flnd" }],
    meta: { positions: [{ title: "U.S. District Judge", court: FLND, appointer: "George W. Bush", dateStart: "2003-11-14" }, { title: "Chief Judge", court: FLND, dateStart: "2011", dateTermination: "2018" }] },
    text: `Margaret Catharine "Casey" Rodgers
United States District Judge, Northern District of Florida (Pensacola)

Appointment. Nominated by President George W. Bush and confirmed in 2003; served as Chief Judge of the Northern District of Florida from 2011 to 2018.

Background. University of West Florida (B.A.) and Cumberland School of Law, Samford University (J.D.). Private practice and service as a United States Magistrate Judge in the Northern District of Florida before her appointment as a district judge.

Notable assignments. Transferee judge for In re: Abilify (Aripiprazole) Products Liability Litigation, MDL No. 2734; In re: 3M Combat Arms Earplug Products Liability Litigation, MDL No. 2885, one of the largest MDLs in history, resolved through a global settlement announced in 2023; and In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation, MDL No. 3140, centralized in February 2025.

Practice notes for this workspace. Sets aggressive, detailed case management schedules; uses early science days and staged bellwether selection; strict about plaintiff fact sheet compliance and Rule 26 expert disclosures; has ruled on preemption and Daubert issues early to shape settlement dynamics.`,
  },
  {
    id: "idoc_seed_judge_ygr", source: "clJudges", kind: "judge",
    title: "Yvonne Gonzalez Rogers", court: "U.S. District Court for the Northern District of California", courtId: "cand", jurisdiction: "Federal · 9th Cir.", judgeIds: [E.gonzalezRogers], dates: { event: "2011-11-15", modified: "2026-09-01" }, url: "https://www.courtlistener.com/?q=%22Yvonne+Gonzalez+Rogers%22&type=p", externalId: "seed:judge:gonzalez-rogers", tags: ["judge"], confidence: 0.85,
    entities: [{ type: "judge", name: "Yvonne Gonzalez Rogers" }, { type: "court", name: "U.S. District Court for the Northern District of California", externalId: "cl:court:cand" }],
    meta: { positions: [{ title: "U.S. District Judge", court: "U.S. District Court for the Northern District of California", appointer: "Barack Obama", dateStart: "2011-11-15" }] },
    text: `Yvonne Gonzalez Rogers
United States District Judge, Northern District of California (Oakland)

Appointment. Nominated by President Barack Obama and confirmed in 2011. Previously a judge of the Alameda County Superior Court and a partner in private practice in San Francisco.

Background. Princeton University (A.B.) and the University of Texas School of Law (J.D.).

Notable assignments. Transferee judge for In re: Social Media Adolescent Addiction/Personal Injury Products Liability Litigation, MDL No. 3047 (centralized October 2022); presided over Epic Games v. Apple; oversaw the Pacific Gas & Electric probation matters and the Herbalife securities litigation.

Practice notes for this workspace. Detailed standing orders on civil pretrial practice and courtroom conduct; expects short, focused briefs and meet-and-confer discipline; has used master complaint and consolidated motion-to-dismiss procedures in MDL 3047.`,
  },
  {
    id: "idoc_seed_atty_london", source: "clDockets", kind: "attorney",
    title: "Michael A. London — Douglas & London, P.C. (plaintiffs' co-lead counsel, MDL 2873)", court: DSC, courtId: "dsc", attorneyIds: [E.london], firmIds: [E.douglasLondon], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:attorney:london", matterIds: [AFFF], tags: ["counsel", "plaintiffs"], confidence: 0.75,
    entities: [{ type: "attorney", name: "Michael A. London", role: "plaintiffs' co-lead counsel" }, { type: "firm", name: "Douglas & London, P.C." }, { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }],
    meta: { role: "co-lead counsel", side: "plaintiffs", bar: "New York" },
    text: `Michael A. London
Douglas & London, P.C., New York, NY — plaintiffs' co-lead counsel, In re: Aqueous Film-Forming Foams Products Liability Litigation, MDL No. 2873 (D.S.C.)

Profile. Mass-tort and environmental litigator; appointed by Judge Gergel to the plaintiffs' leadership in the AFFF MDL alongside Paul J. Napoli and Scott Summy. Lead negotiator for the water-provider class in the 2023 settlements with DuPont/Chemours/Corteva ($1.185 billion) and 3M ($10.3–12.5 billion) and the 2024 settlements with Tyco Fire Products and BASF.

Other leadership roles (public sources). Leadership positions in pharmaceutical and medical device MDLs and in PFAS litigation on behalf of water utilities.

Workspace note. Adverse counsel for the firm's demonstration client; coordinate all communications through the defense liaison structure established by the Court.`,
  },
  {
    id: "idoc_seed_atty_napoli", source: "clDockets", kind: "attorney",
    title: "Paul J. Napoli — Napoli Shkolnik PLLC (plaintiffs' co-lead counsel, MDL 2873)", court: DSC, courtId: "dsc", attorneyIds: [E.napoli], firmIds: [E.napoliShkolnik], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:attorney:napoli", matterIds: [AFFF], tags: ["counsel", "plaintiffs"], confidence: 0.75,
    entities: [{ type: "attorney", name: "Paul J. Napoli", role: "plaintiffs' co-lead counsel" }, { type: "firm", name: "Napoli Shkolnik PLLC" }, { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }],
    meta: { role: "co-lead counsel", side: "plaintiffs", bar: "New York" },
    text: `Paul J. Napoli
Napoli Shkolnik PLLC, New York, NY — plaintiffs' co-lead counsel, In re: Aqueous Film-Forming Foams Products Liability Litigation, MDL No. 2873 (D.S.C.)

Profile. Mass-tort and environmental litigator with a long record in PFAS water-contamination cases for municipalities and water districts, including early suits over PFOA in Hoosick Falls, New York. Co-lead of the AFFF plaintiffs' executive committee since 2019; active in the public water system class settlements and in the personal-injury bellwether program.

Workspace note. Adverse counsel for the firm's demonstration client.`,
  },
  {
    id: "idoc_seed_atty_summy", source: "clDockets", kind: "attorney",
    title: "Scott Summy — Baron & Budd, P.C. (plaintiffs' co-lead counsel, MDL 2873)", court: DSC, courtId: "dsc", attorneyIds: [E.summy], firmIds: [E.baronBudd], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:attorney:summy", matterIds: [AFFF], tags: ["counsel", "plaintiffs"], confidence: 0.75,
    entities: [{ type: "attorney", name: "Scott Summy", role: "plaintiffs' co-lead counsel" }, { type: "firm", name: "Baron & Budd, P.C." }, { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }],
    meta: { role: "co-lead counsel", side: "plaintiffs", bar: "Texas" },
    text: `Scott Summy
Baron & Budd, P.C., Dallas, TX — plaintiffs' co-lead counsel, In re: Aqueous Film-Forming Foams Products Liability Litigation, MDL No. 2873 (D.S.C.)

Profile. Head of Baron & Budd's environmental litigation group; represents public water providers in contamination cases (MTBE, TCP, PFAS) and led the water-provider negotiations in the AFFF MDL that produced the 2023 class settlements with DuPont/Chemours/Corteva and 3M and the 2024 settlements with Tyco Fire Products and BASF.

Workspace note. Adverse counsel for the firm's demonstration client.`,
  },
  {
    id: "idoc_seed_atty_klein", source: "clDockets", kind: "attorney",
    title: "Rebecca Klein — Klein & Associates (Plaintiffs' Executive Committee, demo persona)", court: DSC, courtId: "dsc", attorneyIds: [E.klein], firmIds: [E.kleinAssociates], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:attorney:klein", matterIds: [AFFF], tags: ["counsel", "plaintiffs", "demo"], confidence: 0.5,
    flags: [UNVERIFIED("Fictional opposing counsel used throughout the platform's demonstration data.")],
    entities: [{ type: "attorney", name: "Rebecca Klein", role: "plaintiffs' executive committee" }, { type: "firm", name: "Klein & Associates" }],
    meta: { demo: true, personId: "o_klein" },
    text: `Rebecca Klein
Klein & Associates — Plaintiffs' Executive Committee (demonstration persona)

Profile. Fictional opposing counsel who appears in the e-discovery, deposition and timeline demonstration data for the Meridian Fluorochem matter. Noticed the depositions of Meridian custodians Gregory Hale and Helen Voss and served the Tier 2 custodial document requests at issue in the workspace's task list.

Workspace note. Linked to person record o_klein.`,
  },
  {
    id: "idoc_seed_firm_douglas_london", source: "clDockets", kind: "firm",
    title: "Douglas & London, P.C.", firmIds: [E.douglasLondon], attorneyIds: [E.london], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:firm:douglas-london", matterIds: [AFFF], tags: ["counsel", "plaintiffs"], confidence: 0.75,
    entities: [{ type: "firm", name: "Douglas & London, P.C." }, { type: "attorney", name: "Michael A. London" }],
    meta: { city: "New York, NY", side: "plaintiffs" },
    text: `Douglas & London, P.C.
New York, NY — plaintiffs' mass-tort and environmental litigation firm.

Role in tracked matters. Co-lead counsel (Michael A. London) for the plaintiffs in the AFFF MDL 2873; lead role in the public water system class settlements and in personal-injury bellwether selection. Frequently appointed to leadership in pharmaceutical and device MDLs.`,
  },
  {
    id: "idoc_seed_firm_napoli", source: "clDockets", kind: "firm",
    title: "Napoli Shkolnik PLLC", firmIds: [E.napoliShkolnik], attorneyIds: [E.napoli], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:firm:napoli-shkolnik", matterIds: [AFFF], tags: ["counsel", "plaintiffs"], confidence: 0.75,
    entities: [{ type: "firm", name: "Napoli Shkolnik PLLC" }, { type: "attorney", name: "Paul J. Napoli" }],
    meta: { city: "New York, NY", side: "plaintiffs" },
    text: `Napoli Shkolnik PLLC
New York, NY (offices nationwide) — plaintiffs' mass-tort, environmental and municipal litigation firm.

Role in tracked matters. Co-lead counsel (Paul J. Napoli) for the plaintiffs in the AFFF MDL 2873; represents water districts and municipalities in PFAS contamination actions and individual plaintiffs in the personal-injury track.`,
  },
  {
    id: "idoc_seed_firm_baron_budd", source: "clDockets", kind: "firm",
    title: "Baron & Budd, P.C.", firmIds: [E.baronBudd], attorneyIds: [E.summy], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:firm:baron-budd", matterIds: [AFFF], tags: ["counsel", "plaintiffs"], confidence: 0.75,
    entities: [{ type: "firm", name: "Baron & Budd, P.C." }, { type: "attorney", name: "Scott Summy" }],
    meta: { city: "Dallas, TX", side: "plaintiffs" },
    text: `Baron & Budd, P.C.
Dallas, TX (offices nationwide) — plaintiffs' firm with practice groups in environmental, pharmaceutical, consumer and asbestos litigation.

Role in tracked matters. Co-lead counsel (Scott Summy) for the plaintiffs in the AFFF MDL 2873, representing public water providers; the environmental group has litigated MTBE, TCP and PFAS water-contamination cases for utilities for two decades.`,
  },
  {
    id: "idoc_seed_firm_motley_rice", source: "clDockets", kind: "firm",
    title: "Motley Rice LLC", firmIds: [E.motleyRice], attorneyIds: [E.thompson], mdlId: E.mdl2873, dates: { modified: "2026-09-01" }, externalId: "seed:firm:motley-rice", matterIds: [AFFF], tags: ["counsel", "plaintiffs"], confidence: 0.7,
    entities: [{ type: "firm", name: "Motley Rice LLC" }, { type: "attorney", name: "Fred Thompson III", role: "plaintiffs' liaison counsel" }],
    meta: { city: "Mount Pleasant, SC", side: "plaintiffs" },
    text: `Motley Rice LLC
Mount Pleasant, SC — plaintiffs' firm founded from the Ness Motley asbestos and tobacco litigation practice.

Role in tracked matters. Plaintiffs' liaison counsel (Fred Thompson III) in the AFFF MDL 2873 before Judge Gergel, coordinating filings and communications between the plaintiffs' leadership and the Court in the District of South Carolina.`,
  },

  // ------------------------------------------------------------------ MDL records (JPML)
  {
    id: "idoc_seed_mdl_2873", source: "jpml", kind: "mdl",
    title: "MDL 2873: Aqueous Film-Forming Foams Products Liability Litigation", caseName: "In re: Aqueous Film-Forming Foams Products Liability Litigation", docketNumber: "2:18-mn-02873", court: DSC, courtId: "dsc", jurisdiction: "Federal · 4th Cir.",
    judgeIds: [E.gergel], mdlId: E.mdl2873, productIds: [E.afff], dates: { filed: "2018-12-07", modified: "2026-09-01" }, url: "https://www.jpml.uscourts.gov/pending-mdls-0", externalId: "jpml:2873", matterIds: [AFFF], tags: ["mdl", "watched"], confidence: 0.8,
    entities: [{ type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }, { type: "judge", name: "Richard M. Gergel" }, { type: "court", name: DSC, externalId: "cl:court:dsc" }],
    meta: { mdlNumber: "2873", judge: "Richard M. Gergel", transferDate: "2018-12-07", listSource: "seed" },
    text: `MDL No. 2873 — In re: Aqueous Film-Forming Foams Products Liability Litigation
Transferee court: U.S. District Court for the District of South Carolina
Transferee judge: Richard M. Gergel
Lead docket: 2:18-mn-02873
Centralized: December 7, 2018
Pending actions: several thousand (water-provider, personal-injury, property and sovereign claims); the number changes with each JPML pending-docket report.
Subject: PFAS (PFOA/PFOS) contamination from aqueous film-forming foam used at military installations, airports and industrial sites.`,
  },
  {
    id: "idoc_seed_mdl_3140", source: "jpml", kind: "mdl",
    title: "MDL 3140: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", caseName: "In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", docketNumber: "3:25-md-03140", court: FLND, courtId: "flnd", jurisdiction: "Federal · 11th Cir.",
    judgeIds: [E.rodgers], mdlId: E.mdl3140, productIds: [E.depoProvera], dates: { filed: "2025-02-07", modified: "2026-09-01" }, url: "https://www.jpml.uscourts.gov/pending-mdls-0", externalId: "jpml:3140", matterIds: [DEPO], tags: ["mdl", "watched"], confidence: 0.8,
    entities: [{ type: "mdl", name: "MDL 3140", externalId: "jpml:3140" }, { type: "judge", name: "M. Casey Rodgers" }, { type: "court", name: FLND, externalId: "cl:court:flnd" }],
    meta: { mdlNumber: "3140", judge: "M. Casey Rodgers", transferDate: "2025-02-07", listSource: "seed" },
    text: `MDL No. 3140 — In re: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation
Transferee court: U.S. District Court for the Northern District of Florida (Pensacola)
Transferee judge: M. Casey Rodgers
Lead docket: 3:25-md-03140
Centralized: February 7, 2025
Subject: Alleged failure to warn that prolonged use of Depo-Provera and authorized generics increases the risk of intracranial meningioma; defendants include Pfizer Inc., Pharmacia & Upjohn Company LLC, Greenstone LLC, Prasco Laboratories and Viatris Inc.`,
  },
  {
    id: "idoc_seed_mdl_3047", source: "jpml", kind: "mdl",
    title: "MDL 3047: Social Media Adolescent Addiction/Personal Injury Products Liability Litigation", caseName: "In re: Social Media Adolescent Addiction/Personal Injury Products Liability Litigation", docketNumber: "4:22-md-03047", court: "U.S. District Court for the Northern District of California", courtId: "cand", jurisdiction: "Federal · 9th Cir.",
    judgeIds: [E.gonzalezRogers], mdlId: E.mdl3047, dates: { filed: "2022-10-06", modified: "2026-09-01" }, url: "https://www.jpml.uscourts.gov/pending-mdls-0", externalId: "jpml:3047", tags: ["mdl"], confidence: 0.8,
    entities: [{ type: "mdl", name: "MDL 3047", externalId: "jpml:3047" }, { type: "judge", name: "Yvonne Gonzalez Rogers" }, { type: "court", name: "U.S. District Court for the Northern District of California", externalId: "cl:court:cand" }],
    meta: { mdlNumber: "3047", judge: "Yvonne Gonzalez Rogers", transferDate: "2022-10-06", listSource: "seed" },
    text: `MDL No. 3047 — In re: Social Media Adolescent Addiction/Personal Injury Products Liability Litigation
Transferee court: U.S. District Court for the Northern District of California (Oakland)
Transferee judge: Yvonne Gonzalez Rogers
Lead docket: 4:22-md-03047
Centralized: October 6, 2022
Subject: Personal-injury and school-district claims that the design of Meta, TikTok, Snap and YouTube platforms fosters compulsive use and harms adolescent mental health.`,
  },
  {
    id: "idoc_seed_mdl_3081", source: "jpml", kind: "mdl",
    title: "MDL 3081: Bard Implanted Port Catheter Products Liability Litigation", caseName: "In re: Bard Implanted Port Catheter Products Liability Litigation", docketNumber: "2:23-md-03081", court: "U.S. District Court for the District of Arizona", courtId: "azd", jurisdiction: "Federal · 9th Cir.",
    mdlId: E.mdl3081, dates: { filed: "2023-08-08", modified: "2026-09-01" }, url: "https://www.jpml.uscourts.gov/pending-mdls-0", externalId: "jpml:3081", tags: ["mdl"], confidence: 0.8,
    entities: [{ type: "mdl", name: "MDL 3081", externalId: "jpml:3081" }, { type: "judge", name: "David G. Campbell" }, { type: "court", name: "U.S. District Court for the District of Arizona", externalId: "cl:court:azd" }],
    meta: { mdlNumber: "3081", judge: "David G. Campbell", transferDate: "2023-08-08", listSource: "seed" },
    text: `MDL No. 3081 — In re: Bard Implanted Port Catheter Products Liability Litigation
Transferee court: U.S. District Court for the District of Arizona
Transferee judge: David G. Campbell
Lead docket: 2:23-md-03081
Centralized: August 8, 2023
Subject: Alleged design defects in Bard PowerPort implantable port catheters (catheter fracture, migration, infection and thrombosis).`,
  },

  // ------------------------------------------------------------------ News
  {
    id: "idoc_seed_news_3m_settlement", source: "news", kind: "news",
    title: "3M reaches $10.3 billion settlement with U.S. public water systems over PFAS", productIds: [E.afff], partyIds: [E.threeM], mdlId: E.mdl2873, dates: { published: "2023-06-22", event: "2023-06-22" }, externalId: "seed:news:3m-2023-06-22", matterIds: [AFFF], tags: ["news", "settlement", "pfas"], confidence: 0.8,
    entities: [{ type: "party", name: "3M Company", role: "defendant" }, { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }],
    meta: { host: "press release / wire coverage", sample: true },
    summary: "3M announced an agreement to pay up to $12.5 billion over 13 years to public water systems that detect PFAS, resolving the water-provider claims in MDL 2873.",
    text: `3M reaches $10.3 billion settlement with U.S. public water systems over PFAS — June 22, 2023
3M Company announced a class settlement with public water systems in the AFFF multidistrict litigation in the District of South Carolina under which it will pay $10.3 billion, and up to $12.5 billion depending on testing results, over thirteen years to fund PFAS treatment for systems that have detected the chemicals or will detect them under EPA's new monitoring requirements. The announcement came weeks after the first water-provider bellwether trial, City of Stuart v. 3M, was postponed to permit negotiations, and shortly after DuPont, Chemours and Corteva announced their own $1.185 billion settlement with the same class. 3M said the agreement is not an admission of liability and reiterated its plan to exit PFAS manufacturing by the end of 2025. Judge Richard M. Gergel granted final approval of the 3M settlement on March 29, 2024.`,
  },
  {
    id: "idoc_seed_news_dupont_settlement", source: "news", kind: "news",
    title: "DuPont, Chemours and Corteva agree to $1.185 billion PFAS settlement with water providers", productIds: [E.afff], partyIds: [E.dupont], mdlId: E.mdl2873, dates: { published: "2023-06-02", event: "2023-06-02" }, externalId: "seed:news:dupont-2023-06-02", matterIds: [AFFF], tags: ["news", "settlement", "pfas"], confidence: 0.8,
    entities: [{ type: "party", name: "The Chemours Company", role: "defendant" }, { type: "party", name: "E. I. du Pont de Nemours and Company", role: "defendant" }, { type: "party", name: "Corteva, Inc.", role: "defendant" }, { type: "mdl", name: "MDL 2873", externalId: "jpml:2873" }],
    meta: { sample: true },
    summary: "The three companies agreed to fund a $1.185 billion settlement resolving public water system PFAS claims in MDL 2873.",
    text: `DuPont, Chemours and Corteva agree to $1.185 billion PFAS settlement with water providers — June 2, 2023
The Chemours Company, DuPont de Nemours and Corteva announced an agreement in principle to resolve the claims of a nationwide class of U.S. public water systems in the AFFF MDL for $1.185 billion, split among the companies under their 2021 cost-sharing memorandum of understanding (Chemours 50 percent, DuPont and Corteva 25 percent each). The settlement covers systems with a current PFAS detection and systems required to monitor under EPA rules, and excludes personal-injury and state claims. Judge Gergel granted preliminary approval in August 2023 and final approval on February 8, 2024.`,
  },
  {
    id: "idoc_seed_news_epa_mcl", source: "news", kind: "news",
    title: "EPA finalizes first national drinking water standards for PFAS", agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { published: "2024-04-10", event: "2024-04-10" }, url: "https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas", externalId: "seed:news:epa-mcl-2024-04-10", matterIds: [AFFF], tags: ["news", "regulation", "pfas"], confidence: 0.8,
    entities: [{ type: "agency", name: "Environmental Protection Agency" }],
    meta: { sample: true },
    summary: "EPA announced enforceable limits of 4 parts per trillion for PFOA and PFOS in drinking water, with $1 billion in funding for testing and treatment.",
    text: `EPA finalizes first national drinking water standards for PFAS — April 10, 2024
The Environmental Protection Agency announced the first legally enforceable national drinking water standards for per- and polyfluoroalkyl substances, setting maximum contaminant levels of 4.0 parts per trillion for PFOA and PFOS, 10 parts per trillion for PFHxS, PFNA and HFPO-DA, and a hazard index for mixtures. EPA estimated the rule would reduce PFAS exposure for about 100 million people, prevent thousands of deaths and reduce tens of thousands of serious illnesses, and announced nearly $1 billion in Bipartisan Infrastructure Law funding for initial testing and treatment. Public water systems have three years to complete initial monitoring and five years to comply with the limits. The rule was published in the Federal Register on April 26, 2024 (89 FR 32532).`,
  },
  {
    id: "idoc_seed_news_epa_reconsider", source: "news", kind: "news",
    title: "EPA to keep PFOA and PFOS drinking water limits, extend compliance to 2031 and reconsider standards for four other PFAS", agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { published: "2025-05-14", event: "2025-05-14" }, url: "https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas", externalId: "seed:news:epa-reconsider-2025-05-14", matterIds: [AFFF], tags: ["news", "regulation", "pfas"], confidence: 0.7,
    entities: [{ type: "agency", name: "Environmental Protection Agency" }],
    meta: { sample: true },
    summary: "EPA announced it would retain the PFOA and PFOS MCLs, propose extending the compliance deadline from 2029 to 2031, and rescind and reconsider the limits for PFHxS, PFNA, HFPO-DA and the hazard index.",
    text: `EPA to keep PFOA and PFOS drinking water limits, extend compliance to 2031 and reconsider standards for four other PFAS — May 14, 2025
The Environmental Protection Agency announced that it will keep the 4 parts per trillion maximum contaminant levels for PFOA and PFOS adopted in April 2024, initiate a rulemaking to extend the compliance deadline for those two chemicals from 2029 to 2031, and rescind and reconsider the standards for PFHxS, PFNA, HFPO-DA (GenX) and the hazard index for mixtures. The agency also said it would establish a federal exemption framework and provide technical assistance to small and rural water systems. Water-industry petitioners had challenged the 2024 rule in the D.C. Circuit; the announcement reshaped the litigation and the treatment obligations that drive the public water system settlements in the AFFF MDL.`,
  },
  {
    id: "idoc_seed_news_bmj_meningioma", source: "news", kind: "news",
    title: "BMJ study links prolonged use of certain progestogens, including medroxyprogesterone acetate, to higher risk of intracranial meningioma", productIds: [E.depoProvera], dates: { published: "2024-03-27", event: "2024-03-27" }, url: "https://doi.org/10.1136/bmj-2023-078078", externalId: "seed:news:bmj-2024-03-27", matterIds: [DEPO], tags: ["news", "science", "epidemiology"], confidence: 0.8,
    entities: [{ type: "product", name: "Depo-Provera (medroxyprogesterone acetate)" }],
    meta: { sample: true, citation: "Roland N, et al. BMJ 2024;384:e078078" },
    summary: "A French nationwide case-control study (Roland et al., BMJ 2024) reported an increased risk of intracranial meningioma requiring surgery with prolonged use of medroxyprogesterone acetate, medrogestone and promegestone.",
    text: `BMJ study links prolonged use of certain progestogens to intracranial meningioma — March 27, 2024
A nationwide case-control study using the French national health data system (Roland N, Neumann A, Hoisnard L, et al., "Use of progestogens and the risk of intracranial meningioma: national case-control study," BMJ 2024;384:e078078) compared 18,061 women who underwent surgery for intracranial meningioma between 2009 and 2018 with 90,305 matched controls. Prolonged use (more than one year) of medroxyprogesterone acetate was associated with an increased risk of meningioma (odds ratio about 5.6), as were medrogestone and promegestone, extending earlier findings for cyproterone acetate, nomegestrol acetate and chlormadinone acetate. No excess risk was found for progesterone, dydrogesterone or levonorgestrel intrauterine systems. The authors called for clinicians to consider meningioma risk when prescribing these progestogens. The study is the central epidemiological evidence in the Depo-Provera meningioma litigation and prompted labeling changes outside the United States.`,
  },
  {
    id: "idoc_seed_news_jpml_depo", source: "news", kind: "news",
    title: "JPML centralizes Depo-Provera meningioma lawsuits in the Northern District of Florida", productIds: [E.depoProvera], partyIds: [E.pfizer], mdlId: E.mdl3140, dates: { published: "2025-02-07", event: "2025-02-07" }, externalId: "seed:news:jpml-depo-2025-02-07", matterIds: [DEPO], tags: ["news", "mdl"], confidence: 0.75,
    entities: [{ type: "mdl", name: "MDL 3140", externalId: "jpml:3140" }, { type: "judge", name: "M. Casey Rodgers" }, { type: "party", name: "Pfizer Inc.", role: "defendant" }],
    meta: { sample: true },
    summary: "The Judicial Panel on Multidistrict Litigation created MDL 3140 before Judge M. Casey Rodgers in Pensacola.",
    text: `JPML centralizes Depo-Provera meningioma lawsuits in the Northern District of Florida — February 7, 2025
The Judicial Panel on Multidistrict Litigation ordered the consolidation of lawsuits alleging that Pfizer's contraceptive injection Depo-Provera causes meningioma into a new multidistrict litigation, MDL No. 3140, in the Northern District of Florida before Chief Judge M. Casey Rodgers. Plaintiffs had sought centralization after a wave of filings following the March 2024 BMJ study; the Panel rejected Pfizer's preference for a different forum and pointed to Judge Rodgers's experience managing the 3M Combat Arms Earplug and Abilify MDLs. Early proceedings are expected to address the defendants' preemption defense and general causation.`,
  },

  // ------------------------------------------------------------------ Local files (demo) and watched web page
  {
    id: "idoc_seed_local_tsca_memo", source: "localCorpus", kind: "local_file",
    title: "Meridian_TSCA_8e_knowledge_timeline_memo.docx", partyIds: [E.meridian], productIds: [E.afff], dates: { modified: "2026-08-14", event: "2026-08-14" }, url: "file:///corpus/AFFF-PFAS/Meridian_TSCA_8e_knowledge_timeline_memo.docx", externalId: "file:/corpus/AFFF-PFAS/Meridian_TSCA_8e_knowledge_timeline_memo.docx", matterIds: [AFFF], tags: ["local", "docx", "memo", "demo"], confidence: 0.8,
    entities: [{ type: "party", name: "Meridian Fluorochem Corp.", role: "client" }, { type: "statute", name: "15 U.S.C. § 2607(e)" }],
    meta: { demo: true, path: "/corpus/AFFF-PFAS/Meridian_TSCA_8e_knowledge_timeline_memo.docx", ext: "docx", method: "mammoth", size: 48211 },
    text: `PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT
Memorandum
To: AFFF defense team (Meridian Fluorochem Corp.)
From: E. Marsh
Date: August 14, 2026
Re: TSCA § 8(e) knowledge timeline — status of the custodial record and open questions

1. Purpose. This memorandum summarizes what the Tier 1 and Tier 2 custodial productions show about when Meridian personnel obtained information reasonably supporting the conclusion that its C8 fluorosurfactant intermediates presented a substantial risk, and whether and when that information was reported to EPA under 15 U.S.C. § 2607(e).

2. Key documents. (a) The 2001 toxicology summary circulated by G. Hale (MFC-0041877) reporting serum half-life data in workers; (b) the 2003 Voss e-mail chain on groundwater sampling at the Pryce Road facility; (c) the 2006 product stewardship review recommending a transition to C6 chemistry; (d) the 2010 EPA correspondence on the PFOA stewardship program.

3. Preliminary assessment. The record supports the position that Meridian's information was cumulative of what EPA had received from the primary fluorochemical manufacturers by 2000–2002, which bears on the "adequately informed" exception in § 8(e). Two gaps remain: the 2003 sampling results were not located in any EPA submission, and the 2006 stewardship review was not produced to the agency.

4. Next steps. Complete the custodial review of the Suarez and Kaine files before the October 14 production deadline; prepare the rebuttal expert (Dr. Patel, hydrogeology) with the sampling chronology; confirm with regulatory counsel whether the 2010 correspondence covered the intermediates at issue.

(Seeded demonstration document for the Meridian Fluorochem matter; the custodians and Bates numbers correspond to the e-discovery demonstration set.)`,
  },
  {
    id: "idoc_seed_local_depo_outline", source: "localCorpus", kind: "local_file",
    title: "Depo-Provera_preemption_argument_outline.md", productIds: [E.depoProvera], dates: { modified: "2026-09-02", event: "2026-09-02" }, url: "file:///corpus/Depo-Provera/Depo-Provera_preemption_argument_outline.md", externalId: "file:/corpus/Depo-Provera/Depo-Provera_preemption_argument_outline.md", matterIds: [DEPO], tags: ["local", "md", "outline", "demo"], confidence: 0.85,
    entities: [{ type: "product", name: "Depo-Provera (medroxyprogesterone acetate)" }, { type: "agency", name: "Food and Drug Administration" }],
    meta: { demo: true, path: "/corpus/Depo-Provera/Depo-Provera_preemption_argument_outline.md", ext: "md", method: "text", size: 6120 },
    text: `# Depo-Provera MDL 3140 — preemption argument outline (distributor defendant)

## Framework
- Wyeth v. Levine, 555 U.S. 555 (2009): brand manufacturer may strengthen warnings by CBE; preemption only on clear evidence FDA would have rejected the change.
- Merck v. Albrecht, 139 S. Ct. 1668 (2019): clear evidence is a question of law; requires FDA action with the force of law after the manufacturer fully informed the agency.
- PLIVA v. Mensing, 564 U.S. 604 (2011) / Bartlett, 570 U.S. 472 (2013): generics cannot change labels — relevance to authorized generics marketed under the NDA is contested.

## Distributor-specific position
1. The distributor neither held the NDA nor controlled the labeling; state-law duty to warn, if any, runs through the manufacturer's label (innocent-seller statutes in TX, GA, NC, WA; learned-intermediary doctrine everywhere).
2. Even for the manufacturer, the record must show a CBE-eligible change: newly acquired information under 21 C.F.R. § 314.3 and reasonable evidence of a causal association under § 201.57(c)(6) before the plaintiff's last injection.
3. Timeline questions for the science day: European label change (2024–2025), FDA's review of the BMJ 2024 study, and the U.S. labeling supplement.

## Open items
- Collect the FDA correspondence file from the manufacturer co-defendants under the coordination agreement.
- Chapman v. Procter & Gamble, 766 F.3d 1296 (11th Cir. 2014): general causation standard for the Daubert phase.
- Master answer due October 2, 2026; Science Day November 20, 2026.

(Seeded demonstration outline for the confidential distributor matter.)`,
  },
  {
    id: "idoc_seed_web_epa_pfas", source: "webList", kind: "web_page",
    title: "EPA — Per- and Polyfluoroalkyl Substances (PFAS)", agencies: ["Environmental Protection Agency"], productIds: [E.afff], dates: { modified: "2026-09-01" }, url: "https://www.epa.gov/pfas", externalId: "web:https://www.epa.gov/pfas", matterIds: [AFFF], tags: ["web", "pfas"], confidence: 0.6,
    flags: [UNVERIFIED("Seeded description of the EPA PFAS hub page; the live source replaces it when the watched-pages source runs.")],
    entities: [{ type: "agency", name: "Environmental Protection Agency" }],
    meta: { via: "seed", requestedUrl: "https://www.epa.gov/pfas" },
    text: `EPA — Per- and Polyfluoroalkyl Substances (PFAS)
Hub page for EPA's PFAS work. Sections cover: what PFAS are and where they are found (firefighting foam, nonstick and stain-resistant products, industrial processes); health effects associated with PFOA and PFOS exposure; the PFAS Strategic Roadmap; drinking water actions (the 2024 national primary drinking water regulation and its 2025 reconsideration, UCMR 5 monitoring data); CERCLA hazardous substance designation of PFOA and PFOS; TSCA actions including the section 8(a)(7) reporting rule; effluent limitations guidelines for PFAS manufacturers; destruction and disposal guidance; and funding for water systems under the Bipartisan Infrastructure Law. Links lead to the PFAS Analytic Tools, the National PFAS Testing Strategy and technical fact sheets for state and tribal programs.`,
  },
];
