import type { DocSpec } from "./seed-helpers";
import { REVIEWERS } from "./seed-helpers";

/**
 * AFFF / PFAS MDL — Meridian Fluorochem custodial documents, block A.
 * Bates MFC-0041877 … MFC-0041999: the March 2001 Whitfield Laboratories
 * 90-day rat study and everything that followed inside the company that year.
 * Page breaks inside multi-page documents are marked with "\f".
 */

const R = REVIEWERS;
const T_WHITFIELD = "thr_afff_whitfield_final";
const T_TIMING = "thr_afff_timing";
const T_BIODEG = "thr_afff_biodeg";
const T_BIOASSAY = "thr_afff_bioassay_proposal";
const T_MSDS = "thr_afff_msds";

export const AFFF_DOCS_A: DocSpec[] = [
  // ------------------------------------------------------------------
  // MFC-0041877 — the Whitfield report summary (the pivotal document)
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0001",
    batesAt: 41877,
    pages: 3,
    date: "2001-03-14",
    custodian: "voss",
    type: "Report",
    subject: "Whitfield Toxicology — 90-day rat study (final report summary)",
    from: "Dr. Linda Whitfield",
    parentId: "ed_afff_0002",
    aiScore: 97,
    aiIssues: ["TOX-01", "REG-01"],
    aiSummary: "Final summary of a 90-day repeated-dose oral toxicity study in Sprague-Dawley rats of Meridian's PFOS-based fluorosurfactant (MF-3 concentrate). Reports dose-related hepatocellular hypertrophy and increased relative liver weight at 1 and 5 mg/kg-day, reduced serum cholesterol, and persistence of the test article in serum after the recovery period. Whitfield identifies a NOAEL of 0.1 mg/kg-day and recommends a chronic bioassay.",
    entities: { people: ["Linda Whitfield", "Yusuf Bello", "Helen Voss"], orgs: ["Whitfield Laboratories", "Meridian Fluorochem Corp."], places: ["Research Triangle Park, NC"], chemicals: ["PFOS", "perfluorooctane sulfonate", "MF-3 fluorosurfactant"] },
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["TOX-01", "REG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-08T14:22:00Z", notes: "Lead exhibit for the knowledge timeline. Serum persistence finding at p. 2 is the key passage; pair with Kaine timing email (MFC-0041921)." },
    tags: ["key-doc", "exhibit-candidate"],
    body: `WHITFIELD LABORATORIES, INC.
Toxicology and Pathology Services
4210 Cornwallis Road, Research Triangle Park, North Carolina 27709

FINAL REPORT — SUMMARY
Study No. WL-2000-0417
A 90-Day Repeated-Dose Oral (Gavage) Toxicity Study of MF-3 Fluorosurfactant Concentrate in Sprague-Dawley Rats

Sponsor: Meridian Fluorochem Corp., 1800 Industrial Parkway, Decatur, Illinois 62526
Sponsor Representative: Helen Voss, Senior Toxicologist
Study Director: Linda Whitfield, Ph.D., DABT
Pathologist: Yusuf Bello, DVM, Ph.D.
Study Initiation: 6 September 2000     In-life Completion: 8 December 2000     Report Date: 14 March 2001

1. OBJECTIVE
To characterise the subchronic toxicity of MF-3 Fluorosurfactant Concentrate (lot 0042-C, perfluorooctane sulfonate potassium salt, 96.4% purity) following daily oral administration to rats for 90 consecutive days, with a 28-day recovery phase in satellite groups.

2. DESIGN
Groups of 15 male and 15 female Crl:CD(SD) rats received 0, 0.1, 1.0 or 5.0 mg/kg-day of the test article in 0.5% carboxymethylcellulose by gavage. Satellite groups (5/sex) at 0 and 5.0 mg/kg-day were held for 28 days without treatment. Clinical observations, body weight, feed consumption, ophthalmology, haematology, clinical chemistry, urinalysis, organ weights, gross necropsy and histopathology were performed per OECD TG 408 and 40 CFR Part 798.2650. Serum test-article concentrations were measured at study days 30, 60, 90 and recovery day 28 by LC/MS/MS (LOQ 25 ng/mL).

\f3. PRINCIPAL FINDINGS
3.1 Mortality and clinical signs. One high-dose female was found dead on day 71 (cause undetermined; no treatment-related gross lesions). No treatment-related clinical signs were observed at 0.1 or 1.0 mg/kg-day. High-dose animals of both sexes showed reduced activity and hunched posture from week 8.

3.2 Body weight. Mean terminal body weight of high-dose males was 11.4% below control (p < 0.01). Females at 5.0 mg/kg-day were 6.8% below control (p < 0.05). No effect at lower doses.

3.3 Clinical chemistry. Serum total cholesterol was reduced in a dose-related manner in both sexes at 1.0 and 5.0 mg/kg-day (males: -21% and -44%; females: -18% and -39% relative to control). Alanine aminotransferase was elevated 1.9-fold in high-dose males. Serum thyroxine (T4) was reduced 27% in high-dose females at day 90.

3.4 Organ weights and histopathology. Relative liver weight was increased at 1.0 mg/kg-day (males +14%) and 5.0 mg/kg-day (males +38%, females +29%). Centrilobular hepatocellular hypertrophy, graded minimal to moderate, was present in 13/15 high-dose males, 11/15 high-dose females and 6/15 mid-dose males. Two high-dose males showed single-cell hepatocellular necrosis. No neoplastic lesions were observed, as expected for a 90-day study.

3.5 Recovery. After 28 days without treatment, relative liver weight in recovery males remained 19% above control and hepatocellular hypertrophy persisted in 3/5 animals. Serum test-article concentration in high-dose recovery animals declined from a mean of 148 µg/mL at day 90 to 121 µg/mL at recovery day 28, indicating an elimination half-life in the rat substantially longer than 28 days. This persistence is unusual for a surfactant and should be considered in any assessment of repeated human exposure.

\f4. CONCLUSIONS
Under the conditions of this study the no-observed-adverse-effect level (NOAEL) is 0.1 mg/kg-day, based on hepatocellular hypertrophy and reduced serum cholesterol at 1.0 mg/kg-day. The lowest-observed-adverse-effect level (LOAEL) is 1.0 mg/kg-day. The target organ is the liver. The incomplete reversal of hepatic effects and the slow elimination of the test article from serum during recovery indicate that the material is bioaccumulative in the rat.

5. RECOMMENDATIONS
Whitfield Laboratories recommends (a) a chronic (two-year) combined toxicity and carcinogenicity bioassay in the rat, (b) a one-generation reproductive screen, and (c) analysis of the elimination kinetics of the test article in a non-rodent species. We would be pleased to discuss study designs at the sponsor's convenience.

Signed: L. Whitfield, Ph.D., DABT, Study Director — 14 March 2001
Quality Assurance Statement: This report was audited by the Whitfield Laboratories QAU on 12 March 2001. Findings were reported to the Study Director and Sponsor. — M. Ortega, QAU Manager

Appendices (bound separately, WL-2000-0417 Vol. II–IV): individual animal data, histopathology tables, analytical chemistry, protocol and amendments.`,
  },
  {
    id: "ed_afff_0002",
    date: "2001-03-14",
    time: "16:42",
    custodian: "voss",
    type: "Email",
    subject: "Whitfield final — 90-day rat study",
    to: ["Gregory Hale", "Nadia Brooks"],
    cc: ["Alan Pryce"],
    threadId: T_WHITFIELD,
    attachmentIds: ["ed_afff_0001", "ed_afff_0007"],
    aiScore: 93,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "confidential", issues: ["TOX-01"], reviewerId: R.marsh, reviewedAt: "2026-09-08T14:30:00Z" },
    body: `Greg, Nadia —

The Whitfield final came in this afternoon. Summary attached along with the protocol and histopath tables (Vol. II). I am still working through the individual animal data but the headline is what I flagged in December: the liver effects are real, they are dose-related, and they did not fully reverse in the recovery animals.

The number that worries me is not the liver weight. It is the serum concentration in the recovery group. They lost less than 20% of the material in 28 days. Linda's language ("substantially longer than 28 days") is about as far as a CRO will go in a summary. Her verbal estimate to me was a half-life in the rat on the order of 100 days.

She is recommending a two-year bioassay. I think we should do it. Cost will be in the $1.4–1.8M range depending on whether we include the reproductive screen.

I would like to walk the three of you through this before it goes any further. Can we take 45 minutes Friday morning?

Helen

Helen Voss
Senior Toxicologist, Product Safety
Meridian Fluorochem Corp. | Decatur, IL | ext. 4417`,
  },
  {
    id: "ed_afff_0003",
    date: "2001-03-15",
    time: "08:05",
    custodian: "hale",
    type: "Email",
    subject: "RE: Whitfield final — 90-day rat study",
    to: ["Helen Voss", "Nadia Brooks"],
    cc: ["Alan Pryce"],
    threadId: T_WHITFIELD,
    aiScore: 84,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, hot: false, issues: ["TOX-01"], reviewerId: R.lopez, reviewedAt: "2026-09-09T10:02:00Z" },
    body: `Helen,

Thanks. Friday at 9 works for me. I have read the summary twice. Two questions for the meeting:

1. The 0.1 mg/kg-day NOAEL — how does that compare with what an operator at Decatur actually sees? My numbers from the 1999 industrial hygiene survey were in the single-digit micrograms per cubic metre range in the blending area. I want to be able to say what the margin is.

2. On the serum persistence — is that a rat-specific thing? We have always assumed the surfactant is excreted. If it is not, that changes the occupational story and probably the environmental story too.

I will pull the IH survey and the 1997 Decatur groundwater screen before Friday.

Greg

Gregory Hale
Director, Environmental Health & Safety
Meridian Fluorochem Corp.`,
  },
  {
    id: "ed_afff_0004",
    date: "2001-03-15",
    time: "11:31",
    custodian: "pryce",
    type: "Email",
    subject: "RE: Whitfield final — 90-day rat study",
    to: ["Helen Voss"],
    cc: ["Gregory Hale", "Nadia Brooks"],
    threadId: T_WHITFIELD,
    aiScore: 91,
    aiIssues: ["TOX-01", "LEG-01"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "confidential", issues: ["TOX-01"], reviewerId: R.marsh, reviewedAt: "2026-09-08T15:01:00Z", notes: "Instruction to limit circulation. Plaintiffs will characterise as suppression. Not privileged — no lawyer on the chain." },
    body: `Helen — I will be at the Friday meeting.

Until we have talked, please keep the report and the summary to the four of us. Do not forward it to the plant, to marketing, or to the Navy program office. I do not want a half-understood version of this circulating while we are still deciding what it means.

Also, before we commit to a $1.8M bioassay, I want to understand what the Whitfield findings actually tell us that the 1993 study did not. We sold 4.2 million gallons of Aqua-Guard last year on the strength of the existing data package. If the answer is "the liver does what the liver always does at high doses," then a two-year study is a lot of money to confirm it.

Alan

Alan Pryce
Vice President, Fire Suppression Products
Meridian Fluorochem Corp.`,
  },
  {
    id: "ed_afff_0005",
    date: "2001-03-16",
    time: "09:48",
    custodian: "brooks",
    type: "Email",
    subject: "RE: Whitfield final — product stewardship implications",
    to: ["Helen Voss", "Gregory Hale"],
    cc: ["Alan Pryce"],
    threadId: T_WHITFIELD,
    aiScore: 82,
    aiIssues: ["TOX-01", "PRD-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01", "PRD-01"], reviewerId: R.lopez, reviewedAt: "2026-09-09T10:10:00Z" },
    body: `All —

From a stewardship point of view, three things flow from the Whitfield summary if the findings hold up:

(a) The MSDS for Aqua-Guard 3 and Aqua-Guard 6 currently states in Section 11 that "no chronic toxicity data are available" and that the surfactant is "readily excreted." The second statement is now, at minimum, unsupported. I will draft revised language for review.

(b) The Navy MIL-F-24385 qualification file describes the concentrate as "low toxicity, biodegradable." I do not think we can leave "biodegradable" in a document we are going to re-submit in June.

(c) Customer questions. Macon County FPD has asked twice about runoff at their training ground. Right now the answer they get from the field is "it's a soap." That needs to change regardless of what we decide on the bioassay.

I am not saying we pull anything. I am saying we should stop saying things we cannot support.

Nadia

Nadia Brooks
Product Stewardship Manager
Meridian Fluorochem Corp.`,
  },
  {
    id: "ed_afff_0006",
    pages: 2,
    date: "2001-03-16",
    custodian: "voss",
    type: "Note",
    subject: "Lab notebook — Whitfield dose-response recalculation and margin-of-exposure estimate",
    aiScore: 78,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T09:12:00Z" },
    body: `Notebook HV-14, pp. 61–62. 16 Mar 2001. H. Voss.

Purpose: sanity-check Whitfield NOAEL and estimate margin of exposure for (i) Decatur blending operators, (ii) firefighter training use, (iii) hypothetical drinking-water exposure downgradient of a training site.

Inputs
- NOAEL 0.1 mg/kg-d (Whitfield WL-2000-0417, liver).
- Serum at 5.0 mg/kg-d day 90: 148 µg/mL (mean, HD males). Day 0.1 group: 3.1 µg/mL.
- Rat t½ estimate (Whitfield, verbal): ~100 d. Human t½: unknown. Literature for related PFAS (Ubel 1980, Olsen 1998 abstracts) suggests years, not days.

(i) Operators. 1999 IH survey: 8-h TWA in blending 2–7 µg/m³ total fluorosurfactant (Hale). Assume 10 m³ inhaled/shift, 100% absorption, 70 kg: 0.3–1.0 µg/kg-d. MOE vs NOAEL ≈ 100–330. Comfortable on paper. BUT with a human half-life of years, steady-state serum after 10 y would be far above what the rat reached in 90 d at the same daily dose. The NOAEL is a dose-per-day number; it does not capture accumulation. Need a body-burden comparison, not a dose comparison.

\f(ii) Firefighter training. Dermal + incidental ingestion during foam training exercises; no measurements. Skin-contact estimates from the 1996 Brandt memo (1 L of 3% solution on skin, 1% absorption): ~13 mg/event → 0.19 mg/kg for a single event. Twelve events/yr → 2.3 mg/kg/yr → 0.006 mg/kg-d averaged. MOE ≈ 16 on averaged basis. Not comfortable.

(iii) Drinking water. If groundwater under a training site reached 1 µg/L (Hale says Decatur MW-3 screen in 1997 was 0.4 µg/L for total organic fluorine — different analyte), 2 L/d, 70 kg → 0.03 µg/kg-d. MOE ≈ 3,300 on a daily-dose basis; but again accumulation.

Conclusion for Friday: The daily-dose margins look fine and Alan will want to stop there. The accumulation issue is the point. We need (1) human serum data — offer voluntary sampling of Decatur workers, (2) the chronic bioassay, (3) a proper environmental fate study, because if the rat does not excrete it, neither does the soil.

Also: Linda W. said the serum finding "belongs in an 8(e) conversation." Noted. Not my call. Raise with Martin.`,
  },
  {
    id: "ed_afff_0007",
    pages: 12,
    date: "2001-03-14",
    custodian: "voss",
    type: "Report",
    subject: "Whitfield WL-2000-0417 Vol. II — protocol, amendments and histopathology incidence tables",
    from: "Dr. Yusuf Bello",
    parentId: "ed_afff_0002",
    aiScore: 74,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01"], reviewerId: R.lopez, reviewedAt: "2026-09-09T11:40:00Z" },
    body: `WHITFIELD LABORATORIES, INC. — Study WL-2000-0417 — VOLUME II
Protocol, Protocol Amendments and Histopathology Incidence Tables

PROTOCOL (approved 28 August 2000)
Test article: MF-3 Fluorosurfactant Concentrate, lot 0042-C, supplied by Meridian Fluorochem Corp., Decatur IL. Characterised by the sponsor as potassium perfluorooctane sulfonate, 96.4% (w/w), balance shorter-chain homologues and water. Stability in vehicle confirmed for 14 days at room temperature (Whitfield Analytical, 22 Aug 2000).
Vehicle: 0.5% (w/v) carboxymethylcellulose sodium in deionised water.
Species/strain: Rat, Crl:CD(SD), Charles River Laboratories, Raleigh NC. Age at dosing 6–7 weeks.
Dose levels: 0, 0.1, 1.0, 5.0 mg/kg-day; dose volume 5 mL/kg. Selected from the 14-day range-finding study WL-2000-0388 (mortality at 20 mg/kg-day; hepatomegaly at 10 mg/kg-day).
Group size: 15/sex/group main study; 5/sex at control and high dose for 28-day recovery.
\fAMENDMENT 1 (14 September 2000): Add serum test-article concentration measurement at days 30, 60, 90 and recovery day 28 (sponsor request, H. Voss). Method: LC/MS/MS, Whitfield Analytical SOP AN-118.
AMENDMENT 2 (9 November 2000): Add thyroid hormone panel (T3, T4, TSH) at termination, following observations in the concurrent Whitfield study for another sponsor of thyroid effects for a structurally related material.
AMENDMENT 3 (1 December 2000): Extend recovery phase from 14 to 28 days (sponsor request).

\fTABLE H-1. Incidence of microscopic findings — LIVER (main study, day 91)
                                   Males                     Females
Dose (mg/kg-day)            0    0.1   1.0   5.0        0    0.1   1.0   5.0
Animals examined           15    15    15    15        15    15    15    14
Hepatocellular hypertrophy, centrilobular
   minimal                  0     0     4     2         0     0     2     3
   mild                     0     0     2     7         0     0     0     6
   moderate                 0     0     0     4         0     0     0     2
   TOTAL                    0     0     6    13         0     0     2    11
Single-cell necrosis        0     0     0     2         0     0     0     0
Vacuolation, periportal     1     0     2     5         0     1     1     4
Bile duct hyperplasia       0     0     0     1         0     0     0     0

\fTABLE H-2. Incidence of microscopic findings — LIVER (recovery, day 119)
                                   Males           Females
Dose (mg/kg-day)            0      5.0        0      5.0
Animals examined            5       5         5       5
Hepatocellular hypertrophy  0       3         0       2
Vacuolation, periportal     0       2         0       1

\fTABLE H-3. Incidence of microscopic findings — THYROID
Follicular cell hypertrophy: males 0/15, 0/15, 1/15, 4/15; females 0/15, 0/15, 0/15, 5/14.
Colloid depletion: males 0, 0, 0, 3; females 0, 0, 1, 4.

TABLE H-4. Incidence of microscopic findings — KIDNEY
Tubular basophilia (regenerative): males 2/15, 1/15, 3/15, 6/15; females 1/15, 0/15, 2/15, 3/14. Hyaline droplets (males only): 3, 2, 5, 9.

\fTABLE H-5. Organ weights (relative to body weight, % of control)
Liver: M 100 / 101 / 114** / 138**; F 100 / 99 / 106 / 129**
Kidney: M 100 / 100 / 104 / 112*; F 100 / 102 / 103 / 108
Thyroid: M 100 / 98 / 105 / 121*; F 100 / 100 / 104 / 118*
Spleen: M 100 / 99 / 97 / 91; F 100 / 101 / 99 / 95
* p<0.05 ** p<0.01 (Dunnett)

\fTABLE C-1. Serum test-article concentration (µg/mL, mean ± SD)
                    Day 30          Day 60          Day 90          Rec. day 28
0.1 mg/kg-d M     1.2 ± 0.3       2.4 ± 0.5       3.1 ± 0.6           —
1.0 mg/kg-d M    12.8 ± 2.1      24.6 ± 3.9      31.4 ± 4.4           —
5.0 mg/kg-d M    61.2 ± 9.8     112.7 ± 15.3    148.0 ± 19.6     121.3 ± 17.8
5.0 mg/kg-d F    58.9 ± 8.7     104.1 ± 13.0    139.4 ± 18.2     117.6 ± 14.9
Note: Serum concentrations had not reached steady state by day 90 at any dose level.

\fTABLE B-1. Body weight (g, mean) — males: control 512; 0.1: 508; 1.0: 497; 5.0: 454**. Females: 289; 291; 283; 269*.

\fTABLE CC-1. Clinical chemistry, day 90 (selected)
Total cholesterol (mg/dL): M 71 / 68 / 56* / 40**; F 79 / 77 / 65* / 48**
ALT (U/L): M 38 / 40 / 47 / 72**; F 34 / 33 / 39 / 51*
T4 (µg/dL): M 4.6 / 4.5 / 4.1 / 3.6*; F 3.9 / 3.8 / 3.4 / 2.8**
TSH (ng/mL): M 3.1 / 3.2 / 3.9 / 5.2**; F 2.8 / 2.9 / 3.3 / 4.4*

\fPATHOLOGIST'S NARRATIVE (Y. Bello, DVM, PhD, DACVP)
The principal treatment-related microscopic change was centrilobular hepatocellular hypertrophy, present at 1.0 and 5.0 mg/kg-day in both sexes with a clear dose-response in incidence and severity. The morphology is consistent with peroxisome proliferation and/or induction of hepatic microsomal enzymes; electron microscopy was not performed. Thyroid follicular cell hypertrophy with colloid depletion at the high dose is interpreted as secondary to hepatic enzyme induction and increased T4 clearance, a mechanism of limited relevance to humans in the case of some xenobiotics, though this cannot be assumed here without kinetic data. Incomplete recovery of hepatic changes after 28 days, together with the serum data in Table C-1, is consistent with continued exposure of the liver from the retained body burden rather than with irreversible injury.

\fQUALITY ASSURANCE — Inspections: protocol review 25 Aug 2000; dosing 12 Sep, 30 Oct, 21 Nov 2000; necropsy 8–9 Dec 2000; data audit 15 Jan–2 Mar 2001; final report audit 12 Mar 2001. All findings resolved. — M. Ortega`,
  },
  {
    id: "ed_afff_0008",
    pages: 6,
    date: "2001-03-14",
    custodian: "voss",
    type: "Letter",
    subject: "Whitfield Laboratories transmittal letter and invoice — Study WL-2000-0417",
    from: "Dr. Linda Whitfield",
    to: ["Helen Voss"],
    aiScore: 41,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01"], reviewerId: R.lopez, reviewedAt: "2026-09-09T11:45:00Z", notes: "Transmittal + invoice. Responsive as part of family; low substantive value except paragraph 3 of the letter." },
    body: `WHITFIELD LABORATORIES, INC.
4210 Cornwallis Road, Research Triangle Park, NC 27709

14 March 2001

Ms. Helen Voss
Senior Toxicologist
Meridian Fluorochem Corp.
1800 Industrial Parkway
Decatur, IL 62526

Re: Study WL-2000-0417 — Final Report

Dear Helen,

Enclosed please find two bound copies of the final report for the above study, Volumes I through IV, together with the electronic data on CD-ROM. The report has been audited by our Quality Assurance Unit and is signed by the Study Director and the Study Pathologist.

As we discussed on the telephone last week, I want to draw your attention in writing to two points. First, the serum concentration data show that the test article had not reached steady state at 90 days and was eliminated only slowly during the recovery period. Second, the hepatic findings were only partially reversible within the 28-day recovery window. In my experience, findings of this kind for a material with the intended use pattern of your product warrant careful consideration by the sponsor of its reporting obligations, and I would encourage you to discuss the report with your regulatory colleagues. I am of course available to speak with them.

We would be pleased to prepare a proposal for a chronic bioassay and a reproductive screen at your request. A preliminary cost estimate is enclosed with the invoice.

Yours sincerely,

Linda Whitfield, Ph.D., DABT
President and Study Director

Enclosures: Final Report (2 copies); CD-ROM; Invoice 2001-0311; Preliminary estimate, chronic bioassay.

\fWHITFIELD LABORATORIES, INC. — INVOICE
Invoice No. 2001-0311     Date: 14 March 2001     Terms: Net 30
Bill to: Meridian Fluorochem Corp., Accounts Payable, 1800 Industrial Parkway, Decatur, IL 62526
Attn: H. Voss, Cost centre 4417-PS

Study WL-2000-0417 — 90-day oral toxicity study, rat, per Proposal P-2000-088
  Final milestone (final report delivery) ...................... $ 96,500.00
  Protocol Amendment 1 — serum analysis (LC/MS/MS, 160 samples) .. $ 38,400.00
  Protocol Amendment 2 — thyroid hormone panel ................... $ 11,250.00
  Protocol Amendment 3 — recovery extension (14 d) .............. $  9,800.00
  Archive fee (10 years) ........................................ $  2,500.00
  TOTAL DUE ..................................................... $158,450.00
Previously invoiced and paid: $214,000.00 (milestones 1–3). Total study cost: $372,450.00.

\fPRELIMINARY COST ESTIMATE — Chronic toxicity/carcinogenicity bioassay in the rat (OECD TG 453)
Combined chronic/oncogenicity, 50/sex/group main + 20/sex/group 12-month interim sacrifice, 4 dose groups
  In-life (104 weeks) ......................................... $ 740,000
  Clinical pathology and serum kinetics ....................... $ 185,000
  Histopathology (full tissue list, peer review) .............. $ 310,000
  Reporting and QA ........................................... $  95,000
  Estimated total ............................................ $1,330,000
Optional: One-generation reproductive toxicity screen (OECD 415) ... $ 410,000
Timeline: protocol Q2 2001; in-life start Q3 2001; interim report Q3 2002; final report Q1 2004.

\f[Pages 4–6: Whitfield Laboratories standard terms and conditions; GLP compliance statement; CD-ROM contents listing.]

GLP COMPLIANCE STATEMENT. This study was conducted in compliance with the U.S. EPA Good Laboratory Practice Standards, 40 CFR Part 792, and the OECD Principles of Good Laboratory Practice, except that the characterisation of the test article was performed by the sponsor and was not audited by Whitfield Laboratories. — L. Whitfield, 14 March 2001.

\fCD-ROM CONTENTS: /individual_animal_data (xls), /histopath (pdf), /analytical (pdf, raw LC/MS/MS files), /protocol, /qa_statements.

\fTERMS AND CONDITIONS (standard form WL-T&C-99). Confidentiality: Whitfield Laboratories shall hold all sponsor information and study results in confidence and shall not disclose them to any third party without the sponsor's written consent, except as required by law. The sponsor acknowledges that Whitfield Laboratories may be required to make study records available to regulatory authorities upon lawful request.`,
  },
  {
    id: "ed_afff_0009",
    date: "2001-03-16",
    time: "17:20",
    custodian: "voss",
    type: "Email",
    subject: "Draft slides for Monday management briefing — Whitfield 90-day",
    to: ["Gregory Hale"],
    attachmentIds: ["ed_afff_0010"],
    aiScore: 79,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01"], reviewerId: R.lopez, reviewedAt: "2026-09-09T11:52:00Z" },
    body: `Greg — draft deck attached for Monday. Seven slides. I kept the science straight and left the "what do we do" slide blank for you and Alan.

Two things I would like your view on before I send it to Alan:

- Slide 4 has the serum table. Alan will ask me to take it out. I would rather not. If the material accumulates, that is the finding, and I do not want to be the person who left it out of the management summary.
- Slide 6 is Linda's recommendation for the bioassay with the cost. I put both numbers (with and without the repro screen).

Helen`,
  },
  {
    id: "ed_afff_0010",
    pages: 7,
    date: "2001-03-16",
    custodian: "voss",
    type: "Presentation",
    subject: "Whitfield 90-day study — management briefing (draft deck)",
    parentId: "ed_afff_0009",
    aiScore: 88,
    aiIssues: ["TOX-01", "PRD-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["TOX-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T09:30:00Z", notes: "Slide 4 serum table shown to management on 3/19/2001. Establishes knowledge at VP level." },
    body: `MERIDIAN FLUOROCHEM — PRODUCT SAFETY
Whitfield Laboratories 90-Day Rat Study (WL-2000-0417)
Management Briefing — 19 March 2001 — H. Voss — DRAFT — CONFIDENTIAL

Slide 1 — Why we ran the study
- Last subchronic data on MF-3 dates from 1993 (14-day, single dose level).
- Navy re-qualification (June 2001) and EU customers asking for a current data package.
- Study designed to OECD 408 / EPA GLP so it can be submitted anywhere.

\fSlide 2 — Design in one line
- Rats, 90 days, 0 / 0.1 / 1 / 5 mg/kg-day by gavage; 28-day recovery; serum levels measured.

\fSlide 3 — What we found
- Liver: bigger, with cellular changes, at 1 and 5 mg/kg-day. Dose-related.
- Cholesterol down, thyroid hormone down, at the same doses.
- NOAEL 0.1 mg/kg-day. Target organ: liver.
- No cancer finding (a 90-day study cannot see one).

\fSlide 4 — The finding that matters: the material stays in the body
Serum MF-3 (µg/mL), high dose, males:
  Day 30: 61 | Day 60: 113 | Day 90: 148 | 28 days after last dose: 121
- Not at steady state after 90 days.
- Only ~18% eliminated in 4 weeks.
- Liver changes only partly reversed.
- Whitfield's verbal estimate of rat half-life: ~100 days. Human: unknown; related compounds reported in years.

\fSlide 5 — What it means for us
- Occupational: daily-dose margins at Decatur look adequate (>100x) BUT accumulation over a career is not captured by that comparison.
- Firefighter training use: dermal exposure margins are thin (~16x on an averaged basis, single events much lower).
- Environmental: if it is not excreted by rats, we should not assume it degrades in soil or water. We have no fate data.
- MSDS: "readily excreted" and "biodegradable" statements are not supportable.

\fSlide 6 — Whitfield's recommendation
- Two-year chronic/carcinogenicity bioassay: ~$1.33M, final report Q1 2004.
- Reproductive screen: +$0.41M.
- Non-rodent kinetics (dog or primate): TBD, ~$0.2M.

\fSlide 7 — Decisions needed
- [ ] Bioassay: go / no-go
- [ ] MSDS revision
- [ ] Navy qualification file language
- [ ] Regulatory: does this need to go to EPA? (Martin / Rob)
- [ ] Worker serum monitoring program (voluntary)`,
  },
  {
    id: "ed_afff_0011",
    pages: 2,
    date: "2001-03-19",
    custodian: "hale",
    type: "Memo",
    subject: "EHS assessment — Whitfield 90-day study",
    from: "Gregory Hale",
    to: ["Alan Pryce", "Paul Merrick"],
    cc: ["Helen Voss", "Nadia Brooks"],
    nearDuplicateIds: ["ed_afff_0034"],
    aiScore: 92,
    aiIssues: ["TOX-01", "ENV-01"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["TOX-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-11T18:20:00Z", notes: "Hale Vol. II Ex. 22. The 'no adverse findings' sentence in ¶2 is inconsistent with Voss slide 5 and with Hale's own email of 3/15 (MFC-0041881). Compare draft MFC-0041965 which did not contain the sentence." },
    tags: ["key-doc", "exhibit-candidate", "hale-depo"],
    body: `MERIDIAN FLUOROCHEM CORP.
ENVIRONMENTAL HEALTH & SAFETY — MEMORANDUM

TO: Alan Pryce, VP Fire Suppression Products; Paul Merrick, SVP Operations
FROM: Gregory Hale, Director EHS
CC: Helen Voss; Nadia Brooks
DATE: 19 March 2001
RE: EHS assessment of Whitfield Laboratories 90-day rat study (WL-2000-0417)

1. Summary. Whitfield Laboratories has delivered the final report of a 90-day oral toxicity study of MF-3 fluorosurfactant concentrate in rats. The study identifies the liver as the target organ, with a no-observed-adverse-effect level of 0.1 mg/kg-day. Effects at higher doses (enlarged liver, altered cholesterol and thyroid hormone) are of a type commonly observed in rodents exposed to enzyme-inducing chemicals.

2. Occupational relevance. Measured exposures in the Decatur blending area (1999 industrial hygiene survey) correspond to an estimated absorbed dose of 0.3–1.0 µg/kg-day, i.e., 100 to 300 times below the NOAEL. On the basis of the daily-dose comparison there are no adverse findings at exposures relevant to occupational use of the product, and no change to current handling practices or personal protective equipment is required at this time.

3. Product use. Firefighting foam is applied as a 3% or 6% solution. Dermal contact during training exercises is the principal end-user exposure route. Margins are lower than for plant operators and should be evaluated further. EHS recommends that training-use guidance in the product literature be reviewed (Product Stewardship).

\f4. Persistence. The study reports slow elimination of the test article from rat serum. EHS does not consider this finding sufficient, on its own, to alter the conclusions in paragraph 2, but it does indicate that (a) the environmental fate of the material should be characterised, and (b) a voluntary serum monitoring program for Decatur employees would provide direct human data. EHS recommends both.

5. Regulatory. Whether any of the findings trigger a reporting obligation under TSCA section 8(e) is a legal question that has been referred to Regulatory Affairs and the Law Department.

6. Recommendations.
 (a) Approve the chronic bioassay proposed by Whitfield Laboratories.
 (b) Commission an environmental fate and groundwater study at Decatur (Beacon Environmental has quoted $84,000 for a four-well program).
 (c) Offer voluntary serum sampling to blending-area employees.
 (d) Revise MSDS Section 11 (Product Stewardship to draft).

G. Hale`,
  },

  // ------------------------------------------------------------------
  // The "timing of any submission" thread — MFC-0041914 … 0041921
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0012",
    date: "2001-03-19",
    time: "14:05",
    custodian: "suarez",
    type: "Email",
    subject: "Whitfield final — timing of any submission",
    to: ["Robert Kaine"],
    cc: ["Gregory Hale"],
    threadId: T_TIMING,
    attachmentIds: ["ed_afff_0013"],
    aiScore: 90,
    aiIssues: ["REG-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-08T16:10:00Z", notes: "Regulatory counsel seeking legal advice from AGC. Withhold; log." },
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

Rob —

Greg has briefed me on the Whitfield 90-day report and I attended Helen's briefing this morning. I need your legal judgment on the question I raised in the meeting: does the serum persistence finding, on its own or with the liver findings, "reasonably support the conclusion" that MF-3 presents a substantial risk within the meaning of TSCA section 8(e)? If it does, the 30-day clock in EPA's 1978 policy statement (43 Fed. Reg. 11110) arguably started when Helen received the report on the 14th.

I have attached a draft notice in the EPA format so we are not starting from zero if the answer is yes. My own preliminary view is that the liver findings by themselves are "corroborative of a known effect" and do not trigger 8(e), but I do not have a comfortable answer on the bioaccumulation point. Whitfield's own cover letter (which I have seen) points in the direction of reporting.

Please treat this as a request for legal advice. I have not copied Alan.

Martin

Martin Suarez
Regulatory Affairs Counsel
Meridian Fluorochem Corp.`,
  },
  {
    id: "ed_afff_0013",
    pages: 4,
    date: "2001-03-19",
    custodian: "suarez",
    type: "Memo",
    subject: "DRAFT — TSCA §8(e) Notice of Substantial Risk — MF-3 fluorosurfactant (privileged draft)",
    from: "Martin Suarez",
    parentId: "ed_afff_0012",
    aiScore: 88,
    aiIssues: ["REG-01", "TOX-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "work-product", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-08T16:14:00Z", notes: "Draft prepared by regulatory counsel for AGC review. Never sent to EPA. Work product / AC." },
    body: `PRIVILEGED AND CONFIDENTIAL — DRAFT — PREPARED AT THE REQUEST OF COUNSEL — NOT FOR SUBMISSION

Document Control Office (7407)
Office of Pollution Prevention and Toxics
U.S. Environmental Protection Agency
1200 Pennsylvania Avenue NW, Washington, DC 20460

Re: TSCA Section 8(e) Notice — Potassium perfluorooctane sulfonate (CAS 2795-39-3)

Dear Sir or Madam:

Meridian Fluorochem Corp. submits this notice pursuant to section 8(e) of the Toxic Substances Control Act, 15 U.S.C. § 2607(e), and EPA's Statement of Interpretation and Enforcement Policy, 43 Fed. Reg. 11110 (March 16, 1978). Submission of this notice does not constitute an admission that the information described herein reasonably supports the conclusion that the substance presents a substantial risk of injury to health or the environment.

1. Substance. Potassium perfluorooctane sulfonate, CAS 2795-39-3, marketed by Meridian as MF-3 Fluorosurfactant Concentrate, a component of aqueous film-forming foam concentrates.

\f2. Information. A 90-day repeated-dose oral study in Sprague-Dawley rats (Whitfield Laboratories Study WL-2000-0417, final report 14 March 2001) reported: (a) dose-related increases in relative liver weight and centrilobular hepatocellular hypertrophy at 1.0 and 5.0 mg/kg-day; (b) reductions in serum cholesterol and thyroxine at the same doses; (c) a NOAEL of 0.1 mg/kg-day; and (d) serum concentrations of the test substance that had not reached steady state by day 90 and declined by approximately 18% during a 28-day recovery period, from which an elimination half-life in the rat substantially exceeding 28 days is inferred. Hepatic findings were incompletely reversed at the end of the recovery period.

3. Basis for submission. [ALTERNATIVE A — submit:] Meridian is submitting this information because the combination of (i) target-organ toxicity at doses within one to two orders of magnitude of estimated occupational exposures and (ii) evidence of bioaccumulation may be considered to reasonably support a conclusion of substantial risk. [ALTERNATIVE B — do not submit; retain as file memo:] Meridian has concluded that the hepatic findings are corroborative of effects previously known for this class of substances and that the kinetic observation in a single rodent study does not, without further data, reasonably support a conclusion of substantial risk.

\f4. Exposure. Approximately 140 employees at Meridian's Decatur, Illinois facility may have occupational exposure. Downstream users include municipal and military fire departments and petrochemical facilities. Meridian estimates 2000 U.S. sales of AFFF concentrate containing MF-3 at 4.2 million gallons.

5. Actions. Meridian [has commissioned / is evaluating] a chronic bioassay and an environmental fate study, and [is revising / is evaluating revisions to] its material safety data sheets.

6. Confidentiality. Meridian claims the sales information in paragraph 4 as confidential business information under TSCA section 14.

\f[Page 4 — internal drafting notes, M. Suarez, not part of notice]
- Rob to decide between Alternative A and B. If B, this becomes a file memo documenting the decision not to submit.
- If A, Alan and Paul need to be told before it goes; Alan will object.
- 30-day window: 13 April 2001 if the trigger date is 14 March.
- Whitfield's cover letter recommending we "discuss reporting obligations" is discoverable if we do not act on it. Note for Rob.
- Consider whether the 1993 study and the 1997 Decatur groundwater screen (0.4 µg/L TOF at MW-3) are "previously known" information.`,
  },
  {
    id: "ed_afff_0014",
    date: "2001-03-19",
    time: "15:52",
    custodian: "hale",
    type: "Email",
    subject: "RE: Whitfield final — timing of any submission",
    to: ["Martin Suarez", "Robert Kaine"],
    threadId: T_TIMING,
    aiScore: 86,
    aiIssues: ["REG-01", "TOX-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-08T16:20:00Z", notes: "Non-lawyer providing facts to counsel for the purpose of legal advice. Privileged." },
    body: `PRIVILEGED & CONFIDENTIAL — PREPARED FOR COUNSEL

Martin, Rob —

Facts you asked for, for the 8(e) analysis:

1. Whitfield report received by Helen on 14 March (courier, signed 15:10).
2. The 1993 study (Hazelton, 14-day, one dose at 10 mg/kg-day) showed liver enlargement. So "liver effects" were known. What was not known before Whitfield: the NOAEL, the thyroid effect, and the serum persistence. Nobody measured serum in 1993.
3. Decatur groundwater: 1997 screen at MW-3 was total organic fluorine, 0.4 µg/L. Not specific to MF-3. We have never analysed groundwater for MF-3 specifically. Beacon can do it.
4. IH exposures: 2–7 µg/m³ 8-h TWA, blending area, 1999.
5. Employee health: no clinical findings attributed to MF-3 in the medical surveillance program (annual liver panel since 1994). I will ask Dr. Castellano to pull the trend data on liver enzymes and cholesterol for the blending crew. If cholesterol is running low in that group, that is a human finding.

I would like guidance on whether I should hold off on (5) until you have decided on the notice. If I ask for the data and it shows something, we have a second piece of information.

Greg`,
  },
  {
    id: "ed_afff_0015",
    date: "2001-03-19",
    time: "17:41",
    custodian: "pryce",
    type: "Email",
    subject: "RE: Whitfield final — timing of any submission",
    to: ["Robert Kaine"],
    cc: ["Martin Suarez"],
    threadId: T_TIMING,
    aiScore: 94,
    aiIssues: ["REG-01", "MKT-01", "LEG-01"],
    coding: { responsive: null, privileged: null, issues: [], notes: "" },
    body: `Rob —

Martin says you are looking at whether the Whitfield report has to go to EPA. I want to be on record with the commercial picture before that decision is made.

The Navy re-qualification package for MIL-F-24385 is due 15 June. Tidewater, Savannah, and the two Gulf refineries renew in Q3. If a substantial-risk notice on our surfactant shows up in the EPA docket in April, every one of those customers will see it, and 3M's people will make sure they do. We would be the only AFFF producer with an 8(e) on file. I do not need to tell you what that does to the second half.

I am not telling you what the law requires. I am telling you that "the liver gets bigger in rats fed the stuff every day for three months" is not news, and we have a business to run. If there is a defensible path that involves doing the bioassay first and reporting when we actually know something, that is the path I want.

Call me tonight. I am at home after 7.

Alan`,
  },
  {
    id: "ed_afff_0016",
    date: "2001-03-19",
    time: "21:16",
    custodian: "kaine",
    type: "Email",
    subject: "RE: Whitfield final — timing of any submission",
    to: ["Martin Suarez", "Gregory Hale", "Alan Pryce"],
    threadId: T_TIMING,
    aiScore: 96,
    aiIssues: ["REG-01", "LEG-01", "TOX-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", hot: true, confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-11T18:40:00Z", notes: "Core privileged document. AGC legal advice on 8(e). Withhold in full; log. Pryce's inclusion does not waive (client executive). Anticipate crime-fraud challenge given MFC-0041936; flag for partner review." },
    tags: ["key-doc", "privilege-review"],
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION — DO NOT FORWARD

All —

My advice, having read the Whitfield summary, Martin's draft, Greg's facts and Alan's note.

1. Legal standard. Section 8(e) requires immediate notice of information that "reasonably supports the conclusion" that a substance presents a substantial risk of injury to health or the environment. EPA's 1978 policy statement treats information as reportable if it shows serious or prolonged effects, and treats "corroborative" information about known effects as not reportable. EPA has also taken the position, in its guidance and in enforcement, that evidence of pronounced bioaccumulation together with toxicity can be reportable even where the toxicity alone is not.

2. Application. The hepatic findings, standing alone, I would characterise as corroborative of the 1993 Hazelton result and of what is generally known about this class of chemicals in rodents. I would not report on the liver alone. The serum persistence finding is the difficult point. It is a single observation in a single species from a study that was not designed to measure kinetics, and Whitfield's half-life figure is a verbal estimate. It is my judgment that a reasonable person in Meridian's position could conclude that this observation does not yet reasonably support a substantial-risk conclusion, and that the appropriate course is to obtain the kinetic and chronic data that would allow the question to be answered.

3. Timing. If we are going to take that position, we must actually take the steps that justify it. That means the chronic bioassay must be approved and a kinetics study commissioned now, not deferred to a budget cycle. A decision not to report that is not accompanied by an investigation is not defensible. I want the board minutes to reflect the approval.

4. Documentation. Martin's draft should be finalised as an internal legal memorandum recording the analysis and the decision (Alternative B), marked privileged, and retained by the Law Department. It should not be circulated to the product group.

5. Alan — I have read your message. I understand the commercial position and it is a legitimate consideration in how we sequence work, but it is not a factor in the legal analysis and I would ask you not to put it in writing again in connection with this question.

6. Greg — go ahead and pull the medical surveillance trend data. If it shows something, we will look at it then. Deliberately not looking is worse than looking.

I am available to discuss tomorrow.

Rob

Robert Kaine
Associate General Counsel
Meridian Fluorochem Corp.`,
  },

  // ------------------------------------------------------------------
  // QA review, the privileged 8(e) memo, the decision
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0017",
    pages: 8,
    date: "2001-03-20",
    custodian: "voss",
    type: "Report",
    subject: "Whitfield 90-day rat study — sponsor data QA review and re-analysis",
    from: "Helen Voss",
    aiScore: 72,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01"], reviewerId: R.lopez, reviewedAt: "2026-09-10T10:05:00Z" },
    body: `MERIDIAN FLUOROCHEM — PRODUCT SAFETY
Sponsor QA Review: Whitfield Laboratories Study WL-2000-0417
Prepared by H. Voss, 20 March 2001

1. Scope. I reviewed Volumes I–IV and the CD-ROM data against the protocol and amendments, re-ran the organ weight and clinical chemistry statistics from the individual animal data, and checked the serum analytical data for consistency with the reported means.

2. Findings on data integrity. No discrepancies between the individual animal data and the summary tables were identified. The Dunnett comparisons reproduce. One transcription error in Table CC-1 (female ALT at 1.0 mg/kg-day reported as 39; individual data give 38.6, rounds to 39 — not an error). The high-dose female found dead on day 71 (animal F-4-08) was correctly excluded from terminal statistics.

\f3. Re-analysis of serum kinetics. Using the four high-dose time points and assuming first-order elimination after the last dose, the apparent elimination half-life from day 90 to recovery day 28 is: ln(2) / [ln(148.0/121.3)/28] = 97.6 days (males); 102.9 days (females). The accumulation ratio at day 90 versus day 30 (2.4x) is consistent with a half-life of this magnitude. Whitfield's verbal estimate is confirmed.

4. Benchmark dose. A preliminary BMD analysis (US EPA BMDS 1.3, dichotomous, hepatocellular hypertrophy incidence, males) gives BMD10 = 0.68 mg/kg-day, BMDL10 = 0.39 mg/kg-day. The BMDL is approximately four times the NOAEL of 0.1 mg/kg-day; the NOAEL is therefore conservative but not unreasonably so.

\f5. Comparison with 1993 Hazelton study. The 1993 study used a single dose (10 mg/kg-day, 14 days). Relative liver weight was +42%. No serum measurements. No thyroid endpoints. The Whitfield findings are consistent with and extend the 1993 result. The new information from Whitfield is: dose-response and NOAEL; thyroid effects; serum persistence; incomplete recovery.

\f6. Human relevance. The hepatocellular hypertrophy is most likely PPARα-mediated. Rodents are more sensitive than humans to PPARα agonists. However, (a) the thyroid effect has a plausible human-relevant mechanism (displacement from transthyretin) that is independent of PPARα, and (b) the kinetic finding is not mechanism-dependent — if humans eliminate the compound as slowly as, or more slowly than, rats, the body-burden comparison is what matters. Human elimination data do not exist for MF-3. Published data for the related compound PFOA in retired workers (3M, 1998 abstract) suggested a serum half-life of several years.

\f7. Recommendations.
 (a) Chronic bioassay, as proposed. Include serum sampling at every interim.
 (b) A dedicated kinetics study in a second species (Cynomolgus monkey), 6-month dosing with 1-year follow-up. Whitfield can subcontract.
 (c) Voluntary serum sampling of Decatur blending employees; compare to unexposed office staff. Twenty per group would be sufficient for a first look.
 (d) Environmental: analyse Decatur monitoring wells specifically for MF-3 (LC/MS/MS). Beacon Environmental has the method.

\f8. Study report distribution. As of this date the final report has been provided to G. Hale, N. Brooks, A. Pryce (summary only), M. Suarez, R. Kaine. No copies have been sent outside the company.

\f9. Archive. Report and CD-ROM archived in Product Safety file PS-2000-017. Whitfield retains raw data for 10 years under the study contract.

\fAppendix A. BMDS output (Weibull model, hepatocellular hypertrophy, males). Goodness of fit p = 0.71. Scaled residuals < 1 at all doses. Appendix B. Serum kinetic calculations (spreadsheet SK-0417.xls).`,
  },
  {
    id: "ed_afff_0018",
    pages: 5,
    date: "2001-03-22",
    custodian: "suarez",
    type: "Memo",
    subject: "Privileged & Confidential — TSCA 8(e) analysis: Whitfield Laboratories 90-day study of MF-3",
    from: "Martin Suarez",
    to: ["Robert Kaine"],
    nearDuplicateIds: ["ed_afff_0013"],
    aiScore: 95,
    aiIssues: ["REG-01", "LEG-01", "TOX-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "work-product", hot: true, confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-11T18:52:00Z", notes: "The 8(e) decision memo. Withhold; log as AC + WP. This is the document plaintiffs will move to compel under crime-fraud; partner review required before log is served." },
    tags: ["key-doc", "privilege-review"],
    body: `PRIVILEGED AND CONFIDENTIAL
ATTORNEY-CLIENT COMMUNICATION / ATTORNEY WORK PRODUCT

MEMORANDUM

TO: Robert Kaine, Associate General Counsel
FROM: Martin Suarez, Regulatory Affairs Counsel
DATE: 22 March 2001
RE: TSCA Section 8(e) analysis — Whitfield Laboratories Study WL-2000-0417 (MF-3 fluorosurfactant)

I. QUESTION PRESENTED
Whether the results of the Whitfield Laboratories 90-day oral toxicity study of MF-3 in rats constitute information that "reasonably supports the conclusion" that MF-3 presents a substantial risk of injury to health or the environment, such that Meridian must notify EPA under TSCA § 8(e), 15 U.S.C. § 2607(e).

II. SHORT ANSWER
Not at this time, provided that Meridian promptly undertakes the further studies described in Part V. The hepatic findings are corroborative of previously known effects. The serum persistence observation is a preliminary kinetic finding from a study not designed to characterise kinetics; standing alone it does not, in my judgment, reasonably support a conclusion of substantial risk. The question should be revisited on receipt of (a) the kinetics study, (b) the 12-month interim of the chronic bioassay, and (c) any human serum data. This memorandum records the analysis so that the decision can be defended if it is later questioned.

\fIII. FACTS
[Summary of the Whitfield findings as set out in the Final Report Summary, MFC-0041877 through -0041879, and Volume II. Serum half-life recalculated by H. Voss at 98–103 days in the rat (QA review, 20 March 2001).]

Meridian's prior knowledge: 1993 Hazelton 14-day study (hepatomegaly at 10 mg/kg-day); Meridian 1997 Decatur groundwater screen (total organic fluorine 0.4 µg/L at MW-3); published literature on PFOA and PFOS (Ubel et al. 1980; Olsen et al. 1998, 1999) reporting persistence in human serum of related compounds manufactured by others.

IV. ANALYSIS
A. The statutory standard and EPA's 1978 policy. [Discussion of 43 Fed. Reg. 11110: "substantial risk" as a function of seriousness of effect and exposure; the "corroborative information" exclusion; EPA's treatment of "pronounced bioaccumulation" in Part V(c) of the policy statement.]

B. Hepatic and thyroid findings. These are effects of a type expected for the chemical class in rodents at the doses tested, and hepatomegaly in particular was already known from the 1993 study. Under Part VI of the policy statement, information that merely corroborates a known effect need not be reported. The thyroid finding is new but is mechanistically linked to the hepatic effect and is of the same character.

\fC. Bioaccumulation. This is the difficult issue. The 1978 policy statement lists "pronounced bioaccumulation" as reportable when combined with toxicity data suggesting hazard. Three considerations lead me to conclude that the threshold is not yet met: (1) the finding rests on two serum time points after cessation of dosing in a single species; (2) the sponsor has not measured elimination in humans or a second species; (3) the literature on related compounds, though suggestive, concerns different substances manufactured by others and is publicly available to EPA. A reasonable regulatory professional could conclude that the information is preliminary and that further study is the appropriate response. I note, however, that EPA has in enforcement matters taken the view that a company may not avoid 8(e) by declining to complete an obvious analysis, and that Dr. Whitfield's transmittal letter expressly raises reporting.

D. Risk of the "no report" position. If the chronic bioassay or kinetics study confirms accumulation and a later notice is filed, EPA may take the position that the obligation attached in March 2001. Penalties under § 16 accrue per day. Documentation that the decision was made in good faith, on advice of counsel, and accompanied by an active investigation, is the principal mitigation.

\fV. RECOMMENDATIONS
1. Do not submit an 8(e) notice at this time.
2. Approve and commence within 60 days: (a) chronic bioassay (Whitfield); (b) non-rodent kinetics study; (c) analysis of Decatur groundwater specifically for MF-3.
3. Revisit this analysis on receipt of each of the above, and in any event within 12 months.
4. Revise product literature to remove statements that the surfactant is "readily excreted" or "biodegradable."
5. Retain this memorandum in the Law Department file. Do not circulate to the product group.

VI. CAVEAT
This analysis is based on the science as presented by Product Safety and on EPA policy as of this date. It should not be read as a conclusion that MF-3 is safe, and the commercial considerations raised by the Fire Suppression business unit have not been taken into account.

\fAttachments: A — Draft notice (Alternative A and B), 19 March 2001. B — H. Voss QA review, 20 March 2001. C — G. Hale facts memo, 19 March 2001. D — Whitfield Final Report Summary.

M. Suarez`,
  },
  {
    id: "ed_afff_0019",
    date: "2001-03-23",
    time: "10:12",
    custodian: "kaine",
    type: "Email",
    subject: "RE: 8(e) analysis — comments",
    to: ["Martin Suarez"],
    aiScore: 85,
    aiIssues: ["REG-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-08T16:35:00Z" },
    body: `PRIVILEGED & CONFIDENTIAL

Martin — memo is good. Three comments:

1. Part V.2: change "within 60 days" to "immediately." I want the bioassay purchase order cut before the board meeting on 20 June so the minutes can reference it as done, not planned.

2. Part IV.C: add a sentence acknowledging that the Whitfield cover letter recommended discussion of reporting obligations and that we did discuss them. The letter will be produced if this ever gets litigated and the memo should show we read it.

3. Delete Part VI's reference to "commercial considerations." It is accurate and it is exactly the sentence a plaintiff's lawyer would put on a slide. The memo should say what we considered, not what we did not.

Finalise and put it in the file. One copy to me. Nothing to Alan beyond a verbal.

Rob`,
  },
  {
    id: "ed_afff_0020",
    date: "2001-03-26",
    time: "13:30",
    custodian: "suarez",
    type: "Email",
    subject: "8(e) — decision",
    to: ["Alan Pryce", "Gregory Hale", "Helen Voss"],
    cc: ["Robert Kaine"],
    aiScore: 94,
    aiIssues: ["REG-01", "TOX-01"],
    coding: { responsive: null, privileged: null, issues: [], notes: "" },
    body: `Alan, Greg, Helen —

Following legal review, the company will not be submitting a section 8(e) notice to EPA on the Whitfield 90-day study at this time. The basis, in short, is that the liver findings confirm what was already known and the kinetic observation is preliminary. The decision is conditioned on the company promptly starting the chronic bioassay, a kinetics study in a second species, and site-specific groundwater analysis at Decatur, and on revisiting the question when those results come in.

Helen — please get Whitfield's proposal for the chronic study and the monkey kinetics study finalised this week. Alan — I understand the PO needs your signature; Rob has asked that it be in place before the June board meeting.

Please do not discuss the reasoning in email. If you have questions, call me or Rob.

Martin`,
  },

  // ------------------------------------------------------------------
  // MSDS revision thread
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0021",
    date: "2001-03-28",
    time: "09:02",
    custodian: "brooks",
    type: "Email",
    subject: "MSDS revision — Aqua-Guard 3 and Aqua-Guard 6 (Section 11 and 12)",
    to: ["Helen Voss", "Gregory Hale"],
    cc: ["Alan Pryce", "Karen Liu"],
    threadId: T_MSDS,
    attachmentIds: ["ed_afff_0022"],
    aiScore: 80,
    aiIssues: ["PRD-01", "MKT-01"],
    coding: { responsive: true, privileged: false, issues: ["PRD-01", "MKT-01"], reviewerId: R.lopez, reviewedAt: "2026-09-10T11:20:00Z" },
    body: `All — attached is the MSDS revision memo with proposed Section 11 (Toxicological Information) and Section 12 (Ecological Information) language for Aqua-Guard 3% and 6% concentrates, and for MF-3 concentrate as sold to blenders.

Summary of changes:
- Delete "readily excreted" (Section 11).
- Delete "biodegradable" (Section 12); replace with "The fluorosurfactant component is not expected to biodegrade readily. Persistence in the environment has not been characterised."
- Add the 90-day rat NOAEL and the target-organ statement.
- Add: "Avoid release to the environment. Do not discharge foam solution to storm drains or surface water."

Karen — please hold the reprint of the customer binder until this is settled.

Nadia`,
  },
  {
    id: "ed_afff_0022",
    pages: 4,
    date: "2001-04-02",
    custodian: "brooks",
    type: "Memo",
    subject: "MSDS revision memo — Section 11 Toxicological Information and Section 12 Ecological Information, Aqua-Guard 3/6 and MF-3",
    from: "Nadia Brooks",
    parentId: "ed_afff_0021",
    aiScore: 83,
    aiIssues: ["PRD-01", "MKT-01", "TOX-01"],
    coding: { responsive: true, privileged: false, issues: ["PRD-01", "MKT-01"], reviewerId: R.lopez, reviewedAt: "2026-09-10T11:28:00Z" },
    body: `MERIDIAN FLUOROCHEM — PRODUCT STEWARDSHIP
MEMORANDUM — MSDS REVISION
Products: Aqua-Guard 3% AFFF Concentrate (MSDS 1102, rev. F, 1998); Aqua-Guard 6% AFFF Concentrate (MSDS 1103, rev. F, 1998); MF-3 Fluorosurfactant Concentrate (MSDS 0207, rev. D, 1996)
Prepared by: N. Brooks, 2 April 2001
Reviewers: H. Voss (toxicology), G. Hale (EHS), M. Suarez (regulatory)

1. Reason for revision. Receipt of Whitfield Laboratories 90-day oral toxicity study (WL-2000-0417) and internal review of ecological statements.

2. Current Section 11 text (MSDS 1102 rev. F):
"Acute oral LD50 (rat) > 5,000 mg/kg (concentrate). Not a skin sensitiser (guinea pig). The fluorosurfactant component is of low toxicity and is readily excreted. No chronic toxicity data are available."

\f3. Proposed Section 11 text:
"Acute oral LD50 (rat) > 5,000 mg/kg (concentrate). Mild eye irritant (rabbit). Not a skin sensitiser (guinea pig). Repeated-dose toxicity: In a 90-day oral study in rats, the fluorosurfactant component (potassium perfluorooctane sulfonate) produced increased liver weight and liver cell changes at 1 mg/kg/day and above; the no-observed-adverse-effect level was 0.1 mg/kg/day. The fluorosurfactant is eliminated slowly from the body and may accumulate with repeated exposure. Chronic and reproductive toxicity have not been evaluated."

Comment (H. Voss): Agree. I would add "and thyroid hormone changes" after "liver cell changes." Comment (G. Hale): Recommend "may accumulate" rather than "accumulates" until human data are available. Comment (M. Suarez): No objection to the science. Note that once this language is on the MSDS it is public; consistency with any future EPA submission must be maintained.

\f4. Current Section 12 text: "The product is biodegradable. Foam solution should be disposed of in accordance with local regulations."

Proposed Section 12 text: "The hydrocarbon surfactant and solvent components are biodegradable. The fluorosurfactant component is not expected to biodegrade and its persistence and mobility in soil and groundwater have not been characterised. Avoid release to the environment. Do not discharge foam solution to storm drains, surface water or ground. Collect and dispose of as industrial waste in accordance with local regulations."

Comment (A. Pryce, by telephone 3 April): Objects to "not expected to biodegrade" as speculative and commercially damaging; requests "biodegradability of the fluorosurfactant component has not been determined." Product Stewardship position: the proposed text is accurate and the alternative would be misleading in light of the Whitfield kinetics; escalate to R. Kaine if not resolved.

\f5. Section 8 (Exposure Controls) — add: nitrile gloves and eye protection when handling concentrate; wash skin after contact with foam solution.

6. Section 15 (Regulatory) — no change pending Law Department review.

7. Implementation. Revision G to issue on approval. Distribution: all customers of record (approx. 640 accounts), Navy program office, distributors. Customer binder reprint on hold (K. Liu).

\fAppendix — Redline of Sections 11 and 12 (attached to file copy).`,
  },
  {
    id: "ed_afff_0023",
    date: "2001-04-04",
    time: "18:55",
    custodian: "pryce",
    type: "Email",
    subject: "RE: MSDS revision — keep the language as is",
    to: ["Nadia Brooks"],
    cc: ["Gregory Hale", "Helen Voss"],
    threadId: T_MSDS,
    aiScore: 92,
    aiIssues: ["MKT-01", "PRD-01"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "confidential", issues: ["MKT-01", "PRD-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T11:40:00Z", notes: "VP directing that the MSDS retain 'biodegradable'. Hot. Compare final MSDS rev. G (issued Sept 2001) which used the compromise language." },
    tags: ["key-doc"],
    body: `Nadia —

I have read the memo. I am not going to approve an MSDS that tells 640 customers that the product "accumulates in the body" and "is not expected to biodegrade" on the strength of one rat study that our own toxicologist says is preliminary and that Legal has decided does not need to go to EPA. You cannot have it both ways: either it is preliminary, in which case the MSDS says "has not been determined," or it is not, in which case Martin needs to revisit his memo.

Keep Section 12 as "biodegradability of the fluorosurfactant component has not been determined." Section 11 can say "eliminated slowly" — fine — but "may accumulate" comes out. Delete "readily excreted," I agree that has to go.

We will revisit when the bioassay interim comes in next year.

Alan`,
  },

  // ------------------------------------------------------------------
  // Duplicates, the bioassay proposal thread, customers, marketing
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0024",
    date: "2001-03-14",
    time: "16:42",
    custodian: "hale",
    type: "Email",
    subject: "Whitfield final — 90-day rat study",
    from: "Helen Voss",
    to: ["Gregory Hale", "Nadia Brooks"],
    cc: ["Alan Pryce"],
    threadId: T_WHITFIELD,
    duplicateOf: "ed_afff_0002",
    aiScore: 93,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["TOX-01"], reviewerId: R.lopez, reviewedAt: "2026-09-09T10:00:00Z", notes: "Exact duplicate of MFC-0041880 from Hale mailbox. Coding propagated." },
    body: `Greg, Nadia —

The Whitfield final came in this afternoon. Summary attached along with the protocol and histopath tables (Vol. II). I am still working through the individual animal data but the headline is what I flagged in December: the liver effects are real, they are dose-related, and they did not fully reverse in the recovery animals.

The number that worries me is not the liver weight. It is the serum concentration in the recovery group. They lost less than 20% of the material in 28 days. Linda's language ("substantially longer than 28 days") is about as far as a CRO will go in a summary. Her verbal estimate to me was a half-life in the rat on the order of 100 days.

She is recommending a two-year bioassay. I think we should do it. Cost will be in the $1.4–1.8M range depending on whether we include the reproductive screen.

I would like to walk the three of you through this before it goes any further. Can we take 45 minutes Friday morning?

Helen

Helen Voss
Senior Toxicologist, Product Safety
Meridian Fluorochem Corp. | Decatur, IL | ext. 4417`,
  },
  {
    id: "ed_afff_0025",
    date: "2001-04-09",
    time: "08:40",
    custodian: "voss",
    type: "Email",
    subject: "Follow-up: two-year bioassay proposal",
    to: ["Gregory Hale", "Alan Pryce"],
    cc: ["Martin Suarez"],
    threadId: T_BIOASSAY,
    attachmentIds: ["ed_afff_0026"],
    aiScore: 81,
    aiIssues: ["TOX-01", "TOX-02"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01", "TOX-02"], reviewerId: R.lopez, reviewedAt: "2026-09-10T13:00:00Z" },
    body: `Greg, Alan —

Whitfield's formal proposal for the chronic bioassay and the monkey kinetics study is attached with my cover memo. Total is $1.62M over three years ($1.33M bioassay, $0.29M kinetics). Reproductive screen is optional at $0.41M; I recommend it but have listed it separately.

Martin has asked that the PO be in place by the June board meeting. I need Alan's signature on the capital request by 20 April to make Whitfield's Q3 in-life start.

Helen`,
  },
  {
    id: "ed_afff_0026",
    pages: 3,
    date: "2001-04-09",
    custodian: "voss",
    type: "Memo",
    subject: "Proposal — two-year chronic toxicity/carcinogenicity bioassay and non-rodent kinetics study (MF-3)",
    from: "Helen Voss",
    to: ["Alan Pryce"],
    parentId: "ed_afff_0025",
    aiScore: 77,
    aiIssues: ["TOX-01", "TOX-02"],
    coding: { responsive: true, privileged: false, issues: ["TOX-02"], reviewerId: R.lopez, reviewedAt: "2026-09-10T13:05:00Z" },
    body: `MERIDIAN FLUOROCHEM — PRODUCT SAFETY
CAPITAL / EXPENSE REQUEST — MEMORANDUM
To: A. Pryce, VP Fire Suppression Products
From: H. Voss, Senior Toxicologist
Date: 9 April 2001
Re: Chronic bioassay and kinetics studies for MF-3 fluorosurfactant

1. Request. Approval of $1,620,000 over FY2001–FY2004 for (a) a two-year combined chronic toxicity and carcinogenicity study of MF-3 in rats (Whitfield Laboratories, Proposal P-2001-021, OECD TG 453) and (b) a six-month oral kinetics and toxicity study in Cynomolgus monkeys with 12-month post-dose serum monitoring (Whitfield/Primate Research Associates, Proposal P-2001-022).

2. Justification. The 90-day study (WL-2000-0417) identified liver effects with a NOAEL of 0.1 mg/kg-day and slow elimination of the test article. The company's regulatory position, on advice of counsel, is conditioned on undertaking these studies promptly. Customers (Navy program office; EU distributors under the 1999 Marketing and Use Directive review) are requesting chronic data. Competitor 3M has announced (May 2000) the phase-out of its PFOS-based products citing persistence; our customers will ask what our data show.

\f3. Design summary — bioassay. 50 rats/sex/group at 0, 0.03, 0.3 and 1.5 mg/kg-day (dietary admixture), plus 20/sex/group for 12-month interim sacrifice. Serum test-article and clinical chemistry at 3, 6, 12, 18 and 24 months. Full histopathology. Interim report at 12 months (Q3 2002 if in-life starts Q3 2001); final Q1 2004.

Design summary — kinetics. 4 monkeys/sex/group at 0, 0.03, 0.15 and 0.75 mg/kg-day by capsule for 26 weeks; serum, liver biopsy at week 26; 52-week post-dose serum sampling for half-life.

4. Schedule and cash flow. FY2001: $410,000. FY2002: $560,000. FY2003: $470,000. FY2004: $180,000.

\f5. Alternatives considered. (a) Do nothing: not consistent with the regulatory position. (b) Rely on published studies of related compounds by other manufacturers: the compounds and purity differ; would not answer the question for our product. (c) Reduced design (one dose, no interim): would save ~$400,000 but would not support a NOAEL and would not allow the 8(e) question to be revisited at 12 months.

6. Recommendation. Approve (a) and (b). Reproductive screen ($410,000) deferred to FY2002 budget cycle, to be reconsidered on receipt of the 12-month interim.

Approved: ________________ A. Pryce   Date: ________
Approved: ________________ P. Merrick   Date: ________`,
  },
  {
    id: "ed_afff_0027",
    date: "2001-04-11",
    time: "07:58",
    custodian: "pryce",
    type: "Email",
    subject: "RE: Follow-up: two-year bioassay proposal — budget",
    to: ["Helen Voss"],
    cc: ["Gregory Hale", "Martin Suarez", "Paul Merrick"],
    threadId: T_BIOASSAY,
    aiScore: 89,
    aiIssues: ["TOX-02", "REG-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["TOX-02", "REG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T13:20:00Z", notes: "Pryce cutting the bioassay design that the 8(e) decision was conditioned on. Pair with Suarez memo Part V.2 and Kaine 3/19." },
    tags: ["key-doc"],
    body: `Helen —

I will sign the bioassay. I will not sign $1.62M. Here is what I can do in this fiscal year:

- Bioassay: yes, but the reduced design. Three groups, not four, and drop the 12-month interim sacrifice. Whitfield told Paul on the phone that takes it to about $920K. If we need an interim, we take serum at 12 months and that is the interim.
- Monkey study: no. $290K to find out how fast a monkey pees out a surfactant is not something I can put in front of the board this year. Revisit in FY2002.
- Repro screen: no.

Martin — I understand the legal position was conditioned on "prompt" studies. We are being prompt. We are doing the two-year study. The design is a scientific question and I am taking Whitfield's word that a three-group study still gives you a NOAEL.

Paul — please have Finance release $300K this FY against the reduced bioassay.

Alan`,
  },
  {
    id: "ed_afff_0028",
    date: "2001-04-17",
    time: "10:22",
    custodian: "hale",
    type: "Email",
    subject: "Customer inquiry — Macon County Fire Protection District — foam runoff at training facility",
    to: ["Nadia Brooks", "Alan Pryce"],
    cc: ["Helen Voss"],
    attachmentIds: ["ed_afff_0029"],
    aiScore: 76,
    aiIssues: ["CUS-01", "ENV-01"],
    coding: { responsive: true, privileged: false, issues: ["CUS-01", "ENV-01"], reviewerId: R.lopez, reviewedAt: "2026-09-10T14:00:00Z" },
    body: `Nadia, Alan —

Chief Duffy at Macon County FPD has now written (attached) after two phone calls. They train with Aqua-Guard 3 at the Harristown burn pit roughly monthly and the neighbouring farm has complained about foam in the drainage ditch. He is asking three questions: is the foam toxic, does it break down, and should they be containing runoff.

Until three weeks ago the answer from the field was "no, yes, no." I do not think we can give that answer now. I have drafted a reply that says the hydrocarbon components are biodegradable, that the fluorosurfactant is persistent and should not be released to surface water, and that we recommend containing training runoff and disposing of it as industrial wastewater. Nadia has seen it. I would like to send it this week; Alan, you asked to see anything going to customers on this subject.

Greg`,
  },
  {
    id: "ed_afff_0029",
    pages: 2,
    date: "2001-04-12",
    custodian: "hale",
    type: "Letter",
    subject: "Letter from Macon County Fire Protection District — request for information on foam runoff at Harristown training facility",
    from: "Chief Raymond Duffy",
    to: ["Gregory Hale"],
    parentId: "ed_afff_0028",
    aiScore: 68,
    aiIssues: ["CUS-01", "ENV-01"],
    coding: { responsive: true, privileged: false, issues: ["CUS-01", "ENV-01"], reviewerId: R.lopez, reviewedAt: "2026-09-10T14:02:00Z" },
    body: `MACON COUNTY FIRE PROTECTION DISTRICT
Office of the Chief
2455 North Water Street, Decatur, Illinois 62526

April 12, 2001

Mr. Gregory Hale
Director, Environmental Health and Safety
Meridian Fluorochem Corp.
1800 Industrial Parkway
Decatur, IL 62526

Dear Mr. Hale:

Thank you for taking my calls on March 29 and April 5. I am writing to put our questions in writing so that we can share your answers with the District board and with the Illinois EPA, which has asked us about our training practices.

The District has used Meridian Aqua-Guard 3% AFFF at the Harristown training facility since 1994. We conduct live-fire training with foam approximately once a month, using 30 to 50 gallons of concentrate per session. Foam and water run off the burn pad into a gravel swale and from there into the drainage ditch along County Road 20. In March, the owner of the adjoining farm reported foam in the ditch and dead fish in the pond it feeds.

Our questions are:
1. Is the foam solution toxic to fish or livestock, and at what concentration?
2. Does the foam break down in the environment, and over what period?
3. Should the District be collecting the runoff from training, and if so, how should it be disposed of?
\fWe would also appreciate any material safety information beyond the MSDS we have on file (revision F, 1998), which states that the product is biodegradable and of low toxicity.

We value our relationship with Meridian, which has supported the District's training program for many years. We are asking these questions because we have been asked them and because our firefighters are in the foam every month.

Sincerely,

Raymond Duffy
Chief, Macon County Fire Protection District

cc: District Board of Trustees; Janet Rourke, Illinois EPA Bureau of Water`,
  },
  {
    id: "ed_afff_0030",
    pages: 2,
    date: "2001-04-24",
    custodian: "hale",
    type: "Letter",
    subject: "Response to Macon County Fire Protection District re: foam runoff at Harristown training facility",
    from: "Gregory Hale",
    to: ["Chief Raymond Duffy"],
    cc: ["Nadia Brooks", "Alan Pryce"],
    aiScore: 82,
    aiIssues: ["CUS-01", "ENV-01", "MKT-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["CUS-01", "ENV-01", "MKT-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T14:15:00Z", notes: "Sent version. Compare Hale's draft description in MFC-0041949: the 'persistent' language was removed before sending. Pryce edit." },
    body: `MERIDIAN FLUOROCHEM CORP.
1800 Industrial Parkway, Decatur, Illinois 62526

April 24, 2001

Chief Raymond Duffy
Macon County Fire Protection District
2455 North Water Street
Decatur, IL 62526

Dear Chief Duffy:

Thank you for your letter of April 12 and for the District's continued use of Aqua-Guard 3% AFFF. I am pleased to respond to your questions.

1. Toxicity. Aqua-Guard 3% concentrate has low acute toxicity to mammals (oral LD50 in rats greater than 5,000 mg/kg). Like all foam concentrates and detergents, the diluted foam solution can be harmful to fish at the concentrations present in undiluted runoff, principally because surfactants affect fish gills and because foam blankets reduce dissolved oxygen. Foam solution should therefore be kept out of ponds and streams.

2. Environmental fate. The hydrocarbon surfactant and solvent components of Aqua-Guard are readily biodegradable. The fluorosurfactant component, which is present at low concentration, is more stable, and its behaviour in soil and water has not been fully determined. Meridian is currently conducting studies on this question and is revising its product literature to reflect current information.

\f3. Runoff management. Meridian recommends that fire training facilities collect foam runoff where practicable and dispose of it through a permitted industrial wastewater treatment facility, or, where a sanitary sewer connection is available, discharge it to the sanitary sewer with the approval of the treatment works. Runoff should not be discharged to storm drains, ditches, ponds or streams. We would be glad to assist the District in evaluating a containment berm and collection sump at the Harristown pad; our engineering group has assisted other departments with similar installations.

We will send the District a copy of our revised MSDS when it is issued. Please do not hesitate to contact me directly at (217) 555-0141.

Sincerely,

Gregory Hale
Director, Environmental Health & Safety

cc: N. Brooks; A. Pryce`,
  },
  {
    id: "ed_afff_0031",
    date: "2001-05-03",
    time: "11:15",
    custodian: "brooks",
    type: "Email",
    subject: "Marketing plan review — Aqua-Guard product line 2001–2002",
    to: ["Alan Pryce", "Karen Liu"],
    cc: ["Helen Voss", "Gregory Hale"],
    threadId: T_BIODEG,
    attachmentIds: ["ed_afff_0032"],
    aiScore: 79,
    aiIssues: ["MKT-01"],
    coding: { responsive: true, privileged: false, issues: ["MKT-01"], reviewerId: R.lopez, reviewedAt: "2026-09-10T15:00:00Z" },
    body: `Alan, Karen —

I have reviewed the 2001–2002 marketing plan deck for stewardship sign-off. I cannot sign off on slides 3, 5 and 8 as drafted.

- Slide 3 ("Environmentally responsible foam technology") and slide 5 ("Biodegradable — safe for training") repeat the claims we are removing from the MSDS.
- Slide 8 (competitive comparison vs. 3M Lightwater) says "3M is exiting PFOS because of persistence concerns — Aqua-Guard uses a different, biodegradable fluorosurfactant." That is not true. MF-3 is PFOS. Our surfactant is chemically the same class as the one 3M is exiting.

I understand the commercial pressure with 3M leaving the market. But if we put "biodegradable" on a slide that goes to the Navy and to 640 customers in May, and the bioassay interim says otherwise next year, we will have a very bad year in 2002.

Please see Helen's note on the thread.

Nadia`,
  },
  {
    id: "ed_afff_0032",
    pages: 9,
    date: "2001-05-01",
    custodian: "pryce",
    type: "Presentation",
    subject: "Aqua-Guard AFFF — 2001–2002 marketing plan (draft for sign-off)",
    from: "Karen Liu",
    parentId: "ed_afff_0031",
    aiScore: 87,
    aiIssues: ["MKT-01", "PRD-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["MKT-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T15:10:00Z", notes: "Slide 5 and 8 claims. Deck was presented at the May 22 distributor meeting with slide 8 modified (see Liu email, not in this set) — confirm final version from marketing custodial collection." },
    tags: ["key-doc"],
    body: `MERIDIAN FLUOROCHEM — FIRE SUPPRESSION PRODUCTS
Aqua-Guard AFFF Product Line — Marketing Plan 2001–2002
Prepared by K. Liu, Marketing Manager — 1 May 2001 — DRAFT FOR STEWARDSHIP SIGN-OFF

Slide 1 — Executive summary
- 2000 volume: 4.2M gal concentrate; revenue $61.4M; share of U.S. AFFF market 23%.
- 2001 plan: 5.1M gal (+21%), driven by 3M's exit from PFOS-based Lightwater.
- 2002 plan: 6.0M gal; enter EU via Brandt Feuerschutz distribution.

\fSlide 2 — Market context
- 3M announced May 2000 it will cease production of PFOS-based products by end 2002, citing "persistence" and EPA engagement.
- Navy MIL-F-24385 qualified products list: Meridian, 3M, Ansul, National Foam, Chemguard.
- Municipal fire departments: price-driven; training use is the largest volume segment.
- Petrochemical: specification-driven; Tidewater Refining and Gulf Coast Petroleum are top accounts.

\fSlide 3 — Positioning: "Environmentally responsible foam technology"
- Message: Aqua-Guard delivers MilSpec performance with an environmentally responsible formulation.
- Proof points: low acute toxicity (LD50 > 5,000 mg/kg); hydrocarbon surfactants biodegradable; no glycol ether solvents (since 1998 reformulation).

\fSlide 4 — Product line
- Aqua-Guard 3% and 6% (MF-3 fluorosurfactant, PFOS-based).
- Aqua-Guard AR (alcohol-resistant), 3x3 and 3x6.
- MF-3 concentrate sold to third-party blenders (14% of volume).

\fSlide 5 — Key claims for 2001 literature
- "Biodegradable — safe for training and fixed-system discharge testing."
- "Meets or exceeds MIL-F-24385F."
- "No PFOS phase-out risk: Meridian is committed to the AFFF market for the long term."
- Stewardship sign-off: PENDING (N. Brooks)

\fSlide 6 — Pricing
- Hold list price; 4% increase on municipal contracts renewing after Q3.
- Navy: bid at 3M's 2000 price less 5% to capture Lightwater volume.

\fSlide 7 — Channel
- Direct: Navy, top-20 industrial accounts.
- Distributors: 41 regional fire equipment distributors; new: Brandt Feuerschutz (DE, AT, CH).

\fSlide 8 — Competitive: Aqua-Guard vs. 3M Lightwater FC-203CF
- Performance: equivalent (MilSpec).
- Price: Aqua-Guard 8% lower.
- Environmental: "3M is exiting PFOS because of persistence concerns — Aqua-Guard uses a different, biodegradable fluorosurfactant."
- Supply: 3M exiting; Meridian committed.

\fSlide 9 — Actions and owners
- Literature refresh: K. Liu, June.
- Navy re-qualification package: A. Pryce / N. Brooks, 15 June.
- Distributor meeting, Indianapolis: 22 May.
- EU registration (Brandt): M. Suarez, Q4.`,
  },
  {
    id: "ed_afff_0033",
    date: "2001-05-04",
    time: "09:31",
    custodian: "voss",
    type: "Email",
    subject: "RE: Marketing plan — 'biodegradable' claim",
    to: ["Nadia Brooks", "Alan Pryce", "Karen Liu"],
    cc: ["Gregory Hale"],
    threadId: T_BIODEG,
    aiScore: 90,
    aiIssues: ["MKT-01", "TOX-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["MKT-01", "TOX-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T15:20:00Z" },
    tags: ["key-doc"],
    body: `I want to be very direct because this is going to matter.

Slide 8 is false. MF-3 is potassium perfluorooctane sulfonate. It is the same active substance that 3M is withdrawing. We buy the C8 precursor from the same electrochemical fluorination route. "Different, biodegradable fluorosurfactant" is not a marketing judgment; it is a statement of chemistry, and it is wrong.

Slide 5: "biodegradable" for the product as a whole is defensible only if you are talking about the hydrocarbon surfactant fraction, and nobody reading a fire-equipment brochure will understand it that way. The fluorosurfactant does not biodegrade. Our own study shows the rat does not get rid of it in a month. I have no data suggesting soil bacteria do better than a rat.

I have put this in writing to the whole thread deliberately. If the deck goes out with slides 5 and 8 as drafted, it does so over Product Safety's objection.

Helen`,
  },
  {
    id: "ed_afff_0034",
    pages: 2,
    date: "2001-03-18",
    custodian: "hale",
    type: "Memo",
    subject: "EHS assessment — Whitfield 90-day study (DRAFT v2)",
    from: "Gregory Hale",
    nearDuplicateIds: ["ed_afff_0011"],
    aiScore: 90,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, hot: false, issues: ["TOX-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-11T18:25:00Z", notes: "Draft of MFC-0041912. Paragraph 2 in this draft ends at '...100 to 300 times below the NOAEL.' The 'no adverse findings' sentence was added between 3/18 and 3/19. Paragraph 4 draft says 'EHS considers this finding significant' — final says 'not sufficient, on its own.'" },
    tags: ["hale-depo"],
    body: `MERIDIAN FLUOROCHEM CORP.
ENVIRONMENTAL HEALTH & SAFETY — MEMORANDUM — DRAFT v2 — 18 March 2001

TO: Alan Pryce, VP Fire Suppression Products; Paul Merrick, SVP Operations
FROM: Gregory Hale, Director EHS
CC: Helen Voss; Nadia Brooks
RE: EHS assessment of Whitfield Laboratories 90-day rat study (WL-2000-0417)

1. Summary. Whitfield Laboratories has delivered the final report of a 90-day oral toxicity study of MF-3 fluorosurfactant concentrate in rats. The study identifies the liver as the target organ, with a no-observed-adverse-effect level of 0.1 mg/kg-day. Effects at higher doses include enlarged liver with cellular changes, reduced cholesterol and reduced thyroid hormone, with only partial recovery after 28 days.

2. Occupational relevance. Measured exposures in the Decatur blending area (1999 industrial hygiene survey) correspond to an estimated absorbed dose of 0.3–1.0 µg/kg-day, i.e., 100 to 300 times below the NOAEL. However, because the material is eliminated slowly, the body burden of a long-service employee may be considerably higher than the daily-dose comparison suggests. EHS recommends voluntary serum monitoring to establish actual body burdens.

3. Product use. Firefighting foam is applied as a 3% or 6% solution. Dermal contact during training exercises is the principal end-user exposure route. Margins are lower than for plant operators (Voss estimate ~16x on an averaged basis) and should be evaluated further.

\f4. Persistence. The study reports slow elimination of the test article from rat serum (half-life ~100 days). EHS considers this finding significant. It indicates that (a) the environmental fate of the material should be characterised, since a compound the rat cannot eliminate is unlikely to degrade in soil or water, and (b) the company's product literature statements that the surfactant is "readily excreted" and "biodegradable" should be withdrawn.

5. Regulatory. Whether any of the findings trigger a reporting obligation under TSCA section 8(e) is a legal question that has been referred to Regulatory Affairs and the Law Department.

6. Recommendations.
 (a) Approve the chronic bioassay proposed by Whitfield Laboratories.
 (b) Commission an environmental fate and groundwater study at Decatur (Beacon Environmental, $84,000).
 (c) Offer voluntary serum sampling to blending-area employees.
 (d) Revise MSDS Sections 11 and 12.
 (e) Withdraw "biodegradable" from Navy qualification file and product literature.

G. Hale — DRAFT`,
  },
  {
    id: "ed_afff_0035",
    date: "2001-05-04",
    time: "13:47",
    custodian: "pryce",
    type: "Email",
    subject: "RE: Marketing plan — 'biodegradable' claim",
    to: ["Helen Voss", "Nadia Brooks", "Karen Liu"],
    cc: ["Gregory Hale", "Robert Kaine"],
    threadId: T_BIODEG,
    aiScore: 86,
    aiIssues: ["MKT-01", "LEG-01"],
    coding: { responsive: true, privileged: null, issues: ["MKT-01"], notes: "Kaine added to cc mid-thread. Is the request to Legal enough to privilege this? Probably not — primary purpose is business. Flag for second-level." },
    body: `Helen — noted, and I am not going to argue chemistry with you.

Karen — slide 8 comes out as written. Replace with "Meridian is committed to the AFFF market and to continued investment in product safety research." Slide 5: change "biodegradable" to "readily biodegradable hydrocarbon surfactants" and move it to the technical footnote.

Rob — I am copying you because I want Legal to look at the final deck before Indianapolis. Are we exposed if a distributor takes "environmentally responsible" the wrong way?

Alan`,
  },
  {
    id: "ed_afff_0036",
    date: "2001-05-07",
    time: "16:03",
    custodian: "kaine",
    type: "Email",
    subject: "RE: Marketing plan — 'biodegradable' claim",
    to: ["Alan Pryce"],
    cc: ["Karen Liu"],
    threadId: T_BIODEG,
    aiScore: 84,
    aiIssues: ["MKT-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["MKT-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-10T15:40:00Z", notes: "Legal advice on marketing claims. Withhold; log." },
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

Alan —

I reviewed the revised deck. My advice:

1. "Environmentally responsible" is puffery and is generally not actionable, but it becomes a problem if it sits next to a specific factual claim that is untrue. With slide 8 removed and "biodegradable" limited to the hydrocarbon surfactants, I am comfortable with slide 3.

2. Delete "No PFOS phase-out risk." That is a forward-looking statement about a regulatory outcome we do not control, and given what we know from Whitfield it is not one I would want to defend.

3. Do not say anything, anywhere, comparing our fluorosurfactant to 3M's. Not "different," not "same," nothing.

4. The Navy re-qualification package is a submission to the government. Nothing goes in it that is inconsistent with the revised MSDS. Nadia should review it, and I want to see it before it is sent.

Rob`,
  },

  // ------------------------------------------------------------------
  // Ops review, regulatory affairs, board, customers, misc 2001
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0037",
    date: "2001-05-14",
    time: "17:30",
    custodian: "hale",
    type: "Email",
    subject: "Ops review notes — Decatur plant — May 2001",
    to: ["Paul Merrick", "Alan Pryce"],
    cc: ["Frank Oduya"],
    attachmentIds: ["ed_afff_0038"],
    aiScore: 70,
    aiIssues: ["ENV-01", "ENV-02"],
    coding: { responsive: true, privileged: false, issues: ["ENV-01", "ENV-02"], reviewerId: R.lopez, reviewedAt: "2026-09-10T16:00:00Z" },
    body: `Paul, Alan — notes from the May operations review at Decatur attached. The items I want to highlight:

- The fluorosurfactant blending area floor drain still goes to the stormwater lagoon, not to the process sewer. Frank has had this on the capital list since 1998. After the Whitfield findings I am moving it to the top of the EHS list; estimate is $140K to re-route.
- The lagoon liner inspection was last done in 1996. Beacon's quote for a liner integrity survey plus MW-3 and MW-7 sampling for MF-3 specifically is $22K. I would like to approve it.
- Wash-down water from the tote cleaning station is going to the lagoon as well.

Greg`,
  },
  {
    id: "ed_afff_0038",
    pages: 3,
    date: "2001-05-11",
    custodian: "hale",
    type: "Note",
    subject: "Operations review — Decatur manufacturing site — EHS notes, 11 May 2001",
    from: "Gregory Hale",
    parentId: "ed_afff_0037",
    aiScore: 74,
    aiIssues: ["ENV-01", "ENV-02"],
    coding: { responsive: true, privileged: false, issues: ["ENV-01", "ENV-02"], reviewerId: R.lopez, reviewedAt: "2026-09-10T16:05:00Z" },
    body: `DECATUR SITE — OPERATIONS REVIEW — EHS NOTES
11 May 2001 — G. Hale, F. Oduya (Plant Manager), S. Halloran (Maintenance), D. Castellano (Occupational Health)

1. Production. Fluorosurfactant blending: 3 shifts, 24 operators. MF-3 concentrate received in 275-gal totes from Building 4 (sulfonation). AFFF blending in Building 7. 2001 YTD volume 1.9M gal.

2. Wastewater. Building 7 floor drains: to stormwater lagoon (Lagoon 2, unlined section south of the rail spur — liner installed 1989 covers north section only). Tote wash station: to Lagoon 2. Process sewer connection: capital item CAP-98-114, not funded. Lagoon 2 overflow: to Sangamon River tributary via outfall 002 (NPDES IL0021423). Outfall monitoring: pH, TSS, oil & grease, BOD. No fluorine parameter.

\f3. Groundwater. Six monitoring wells installed 1989 (MW-1 to MW-6) and 1997 (MW-7, downgradient of Lagoon 2, screened 18–28 ft). 1997 screen: TOF 0.4 µg/L at MW-3; MW-7 not sampled (installed after screen). No MF-3-specific analysis ever performed. Groundwater flow: SSE toward the Decatur municipal wellfield (Wells 9–12, approx. 1.4 mi).

4. Air. Blending area local exhaust: 1999 IH survey 2–7 µg/m³ 8-h TWA total fluorosurfactant. Respirators not required; nitrile gloves required since 1999.

5. Occupational health (D. Castellano). Annual liver panel on blending crew since 1994. Castellano to pull 1994–2000 trends for ALT, cholesterol (Hale request 20 March; in progress). No serum fluorosurfactant analysis performed to date; Whitfield can run it.

\f6. Actions.
 (a) CAP-98-114 (Building 7 drains to process sewer): resubmit as EHS priority 1, $140K. Owner: Halloran.
 (b) Beacon Environmental: Lagoon 2 liner integrity survey + MF-3-specific sampling of MW-3 and MW-7. $22K. Owner: Hale. Approval: Merrick.
 (c) Add total organic fluorine to outfall 002 quarterly self-monitoring (voluntary). Owner: Hale.
 (d) Castellano: liver panel trend analysis by 15 June.
 (e) Tote wash station: install sump and haul as industrial waste pending (a). Owner: Oduya.

7. Note. Oduya asked whether "any of this is going to end up with the state." Told him the groundwater sampling is voluntary and internal for now; if MW-7 shows MF-3 above whatever screening level Beacon recommends, that changes.`,
  },
  {
    id: "ed_afff_0039",
    pages: 3,
    date: "2001-06-06",
    custodian: "suarez",
    type: "Memo",
    subject: "Regulatory affairs memo — EPA OPPT inquiries regarding perfluorinated surfactants and Meridian's position",
    from: "Martin Suarez",
    to: ["Alan Pryce", "Paul Merrick", "Gregory Hale"],
    cc: ["Robert Kaine"],
    aiScore: 88,
    aiIssues: ["REG-01", "REG-02"],
    coding: { responsive: true, privileged: false, issues: ["REG-01", "REG-02"], reviewerId: R.marsh, reviewedAt: "2026-09-11T09:00:00Z", notes: "Business/regulatory update to management, not legal advice; Kaine cc'd does not make it privileged. Produce. Note ¶3 acknowledges EPA's PFOS concerns predate the Whitfield decision." },
    body: `MERIDIAN FLUOROCHEM — REGULATORY AFFAIRS
MEMORANDUM
To: A. Pryce; P. Merrick; G. Hale
Cc: R. Kaine
From: M. Suarez
Date: 6 June 2001
Re: EPA OPPT activity on perfluorinated surfactants — status and Meridian's position

1. Background. Since 3M's May 2000 announcement, EPA's Office of Pollution Prevention and Toxics has been actively engaged on perfluorooctane sulfonate (PFOS) and related chemistry. EPA published a proposed Significant New Use Rule for 88 PFOS-related substances on 18 October 2000 (65 Fed. Reg. 62319), which would require notice to EPA before manufacture or import for any use other than those specifically excluded. Aqueous film-forming foam is among the uses EPA proposed to exclude, in recognition of the lack of substitutes and the military's requirements.

2. Direct contact. On 30 May I spoke with Marcus Feld of OPPT's Risk Assessment Division at his request. He asked (a) whether Meridian manufactures PFOS-based surfactants (yes, MF-3, via electrochemical fluorination at Decatur), (b) annual production volume (I provided the 2000 TSCA Inventory Update figure, which is public), and (c) whether Meridian had "any toxicology or monitoring data it would be willing to share on a voluntary basis." I told him I would take the request back to the company.

\f3. EPA's stated concerns. Feld was candid that OPPT's concern is persistence and bioaccumulation, based on 3M's submissions (which include 8(e) notices filed by 3M in 1998–2000 on serum monitoring of its own workers and on monkey studies) and on published literature. He said EPA's working assumption is that all PFOS-based surfactants share these properties regardless of manufacturer.

4. Meridian's position (proposed). (a) Participate in the SNUR process to preserve the AFFF exclusion; comments due 18 December 2000 have passed but EPA has indicated it will accept late comments from manufacturers. (b) Respond to the voluntary data request by providing the 1993 study and the acute data package. The Whitfield 90-day study is the subject of a separate legal analysis and its disclosure should be decided by the Law Department. (c) Engage with the Fire Fighting Foam Coalition (Ansul, National Foam, Chemguard) on a joint industry position.

5. Risk. If EPA finalises the SNUR with the AFFF exclusion, the immediate regulatory effect on Meridian is limited. The longer-term issue is that the same persistence concern that drove 3M's exit applies to MF-3. Customers and the Navy will ask. A transition plan to shorter-chain (C6) chemistry should be evaluated by the product group; Nadia Brooks has begun a stewardship review.

\f6. Actions. (a) Late SNUR comments — Suarez, 30 June. (b) Voluntary data response — Suarez/Kaine decision by 22 June. (c) FFFC engagement — Pryce. (d) C6 evaluation — Brooks, Q3.

M. Suarez`,
  },
  {
    id: "ed_afff_0040",
    date: "2001-06-08",
    time: "12:20",
    custodian: "suarez",
    type: "Email",
    subject: "EPA — call with Marcus Feld (OPPT) — voluntary data request",
    to: ["Robert Kaine"],
    aiScore: 87,
    aiIssues: ["REG-02", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-02", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-11T09:10:00Z" },
    body: `PRIVILEGED & CONFIDENTIAL

Rob — Feld called again this morning. He now asks specifically whether Meridian "has conducted any subchronic or chronic studies on its PFOS surfactant since 1995." I said I would need to check and get back to him.

I need your advice on the answer. If we say no, that is false. If we say yes and decline to provide it, he will ask why, and our March analysis becomes a live issue. If we provide the Whitfield report voluntarily, we arguably moot the 8(e) question (EPA has the information) but we also put it in the public docket.

My recommendation is option three, with a cover letter framing it as a voluntary submission of preliminary data and noting the chronic study is under way. I would rather EPA get it from us than from Whitfield under a subpoena.

Martin`,
  },
  {
    id: "ed_afff_0041",
    date: "2001-06-15",
    time: "15:05",
    custodian: "pryce",
    type: "Email",
    subject: "Board pre-read — fluorosurfactant strategy and product safety research",
    to: ["Paul Merrick", "Walter Brandt"],
    cc: ["Robert Kaine"],
    aiScore: 80,
    aiIssues: ["PRD-01", "TOX-02"],
    coding: { responsive: true, privileged: false, issues: ["PRD-01", "TOX-02"], reviewerId: R.lopez, reviewedAt: "2026-09-11T09:30:00Z" },
    body: `Paul, Walter —

Pre-read for the 20 June board item on fluorosurfactant strategy. Three points:

1. Research. We have committed $920K to a two-year rat bioassay of MF-3 at Whitfield Laboratories, starting in-life in August. This follows a 90-day study completed in March that identified the liver as the target organ and gave us a no-effect level. Legal has reviewed the 90-day results and concluded no EPA notification is required at this time. The board should note the commitment.

2. Market. 3M's exit from PFOS gives us the largest share opportunity in the company's history — we are guiding 5.1M gal in 2001 against 4.2M in 2000. Navy re-qualification is on track for 15 June submission.

3. Long-term chemistry. EPA is moving on PFOS regardless of 3M. We should authorise a C6 (shorter-chain) development program at $2.1M over three years so that we have an answer when the market turns. Nadia Brooks will present.

Alan`,
  },
  {
    id: "ed_afff_0042",
    pages: 2,
    date: "2001-06-20",
    custodian: "kaine",
    type: "Memo",
    subject: "Board of Directors — minutes excerpt — 20 June 2001 — Item 6: Fire Suppression Products fluorosurfactant strategy",
    from: "Walter Brandt",
    aiScore: 91,
    aiIssues: ["TOX-02", "REG-01", "PRD-01"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["TOX-02", "REG-01", "PRD-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-11T19:00:00Z", notes: "Board knowledge. Not privileged — Kaine's report to the board is summarised in a factual way; consider redacting the sentence beginning 'Mr. Kaine advised' as reflecting legal advice. Partner call." },
    tags: ["key-doc", "privilege-review"],
    body: `MERIDIAN FLUOROCHEM CORP.
MINUTES OF A REGULAR MEETING OF THE BOARD OF DIRECTORS — 20 JUNE 2001 — EXCERPT
Present: W. Brandt (Chairman and CEO), P. Merrick, R. Kaine (Secretary), directors Ellison, Marchetti, Sato, Whitcombe. By invitation: A. Pryce, N. Brooks (Item 6).

ITEM 6 — FIRE SUPPRESSION PRODUCTS: FLUOROSURFACTANT STRATEGY

Mr. Pryce presented the pre-read circulated on 15 June. He reported that the Fire Suppression Products unit expected 2001 volume of 5.1 million gallons, an increase of 21%, principally as a result of 3M's withdrawal from the PFOS-based foam market, and that the Navy re-qualification package had been submitted on 15 June.

Mr. Pryce reported that a 90-day toxicology study of the company's MF-3 fluorosurfactant, completed in March, had identified effects on the liver in rats at doses above 0.1 mg/kg per day and had indicated that the substance was eliminated slowly from the body. He reported that the company had commissioned a two-year study at a cost of approximately $920,000, with in-life work to begin in August 2001.

\fMr. Kaine advised the Board that the Law Department had reviewed the 90-day study results against the company's reporting obligations under the Toxic Substances Control Act and had concluded that notification to the Environmental Protection Agency was not required at this time, and that the question would be revisited on receipt of further data. In response to a question from Mr. Sato, Mr. Kaine confirmed that the Environmental Protection Agency had made a voluntary request for toxicology data and that the Law Department was considering the response.

Ms. Brooks presented a proposal for a three-year, $2.1 million development program for a shorter-chain (C6) fluorosurfactant. In response to a question from Ms. Marchetti as to why the program was necessary if the current product was not subject to regulation, Mr. Pryce stated that the regulatory direction on PFOS was clear irrespective of the company's own data and that the company should have a replacement product available before customers demanded one.

RESOLVED, that the Board notes the commitment of $920,000 to the two-year toxicology study of MF-3 and authorises management to proceed; and

RESOLVED, that the Board approves the C6 fluorosurfactant development program in the amount of $2.1 million over fiscal years 2002 through 2004, subject to annual budget review.

Mr. Sato asked that the Board be informed of the results of the two-year study at its interim stage. The Chairman so directed.

[End of excerpt. Certified a true extract: R. Kaine, Secretary.]`,
  },
  {
    id: "ed_afff_0043",
    date: "2001-08-13",
    time: "10:40",
    custodian: "brooks",
    type: "Email",
    subject: "Customer complaint — Tidewater Refining — foam residue and fish kill at Pascagoula",
    to: ["Alan Pryce", "Gregory Hale"],
    cc: ["Martin Suarez"],
    attachmentIds: ["ed_afff_0044"],
    aiScore: 78,
    aiIssues: ["CUS-01", "ENV-01"],
    coding: { responsive: true, privileged: false, issues: ["CUS-01", "ENV-01"], reviewerId: R.lopez, reviewedAt: "2026-09-11T10:00:00Z" },
    body: `Alan, Greg —

Tidewater's letter attached. Their fixed-system discharge test on 30 July at the Pascagoula tank farm put about 2,000 gallons of Aqua-Guard 3 solution into the retention basin, which overflowed into the bayou. Mississippi DEQ has cited them for the fish kill and they are asking us (a) for toxicity data to give to DEQ, (b) whether the foam "breaks down," and (c) whether we will indemnify.

(c) is for Martin. On (a) and (b) I propose we send the revised MSDS (rev. G, issued last week) and the acute aquatic data. I will not send anything that says "biodegradable."

Nadia`,
  },
  {
    id: "ed_afff_0044",
    pages: 2,
    date: "2001-08-09",
    custodian: "brooks",
    type: "Letter",
    subject: "Letter from Tidewater Refining — complaint re: Aqua-Guard 3 discharge at Pascagoula tank farm and fish kill",
    from: "Owen Tsai",
    to: ["Nadia Brooks"],
    parentId: "ed_afff_0043",
    aiScore: 72,
    aiIssues: ["CUS-01", "ENV-01"],
    coding: { responsive: true, privileged: false, issues: ["CUS-01", "ENV-01"], reviewerId: R.lopez, reviewedAt: "2026-09-11T10:05:00Z" },
    body: `TIDEWATER REFINING COMPANY
Environmental Affairs — Pascagoula Complex
P.O. Box 1180, Pascagoula, Mississippi 39568

August 9, 2001

Ms. Nadia Brooks
Product Stewardship Manager
Meridian Fluorochem Corp.
1800 Industrial Parkway
Decatur, IL 62526

Re: Aqua-Guard 3% AFFF — Discharge event of July 30, 2001, Tank Farm 3

Dear Ms. Brooks:

On July 30, 2001, during an annual functional test of the fixed foam suppression system on Tank Farm 3, approximately 2,000 gallons of 3% foam solution (60 gallons of Aqua-Guard 3% concentrate) were discharged to the secondary containment and retention basin. Heavy rainfall on July 31 caused the basin to overflow to Bayou Casotte. On August 2 the Mississippi Department of Environmental Quality issued a Notice of Violation citing a fish kill of approximately 1,400 fish along 600 yards of the bayou.

Tidewater has used Aqua-Guard at this complex since 1996 in reliance on Meridian's representations that the product is biodegradable and of low toxicity. MDEQ has requested aquatic toxicity data and information on the environmental persistence of the product's components. Please provide, by August 24:
1. Acute and chronic aquatic toxicity data for Aqua-Guard 3% concentrate and its fluorosurfactant component;
2. Data on the biodegradation and persistence of the fluorosurfactant component in water and sediment;
\f3. Meridian's recommendations for remediation of the retention basin and bayou sediment, if any.

Tidewater further notifies Meridian that it reserves all rights under the Supply Agreement dated March 3, 1996, including under Section 9 (Product Warranty) and Section 12 (Indemnification), with respect to any penalties, remediation costs or third-party claims arising from this event.

Sincerely,

Owen Tsai
Manager, Environmental Affairs
Tidewater Refining Company

cc: T. Ashby, Ashby Lowe LLP; MDEQ Office of Pollution Control (File No. 01-0447)`,
  },
  {
    id: "ed_afff_0045",
    pages: 2,
    date: "2001-09-21",
    custodian: "hale",
    type: "Letter",
    subject: "Letter from Savannah Fire Department — request for foam disposal guidance and health information",
    from: "Gail Mortensen",
    to: ["Gregory Hale"],
    aiScore: 64,
    aiIssues: ["CUS-01"],
    coding: { responsive: true, privileged: false, issues: ["CUS-01"], reviewerId: R.lopez, reviewedAt: "2026-09-11T10:20:00Z" },
    body: `CITY OF SAVANNAH FIRE & EMERGENCY SERVICES
Training Division
121 East Oglethorpe Avenue, Savannah, Georgia 31401

September 21, 2001

Mr. Gregory Hale
Meridian Fluorochem Corp.

Dear Mr. Hale,

Our department received Meridian's revised MSDS (revision G) for Aqua-Guard 3% last month. We note that the environmental section now advises against discharging foam solution to storm drains or ground and that the toxicology section refers to a 90-day animal study and to slow elimination of the fluorosurfactant from the body.

These are significant changes from the previous sheet. Our Training Division uses Aqua-Guard at the Dean Forest Road training facility approximately twice monthly, and our firefighters have been in contact with foam solution during training for many years.

We request the following:
1. Guidance on the collection and disposal of training runoff at our facility, and any assistance Meridian can offer with containment design.
2. Any information Meridian has on health effects in firefighters or workers exposed to the fluorosurfactant, including whether any medical monitoring is recommended.
3. Confirmation of whether Meridian's product will remain available or is being reformulated, so that we can plan our procurement.
\fWe have also received an inquiry from the IAFF Local 574 safety committee on this subject and would appreciate a response we can share with them.

Sincerely,

Gail Mortensen
Battalion Chief, Training Division`,
  },
  {
    id: "ed_afff_0046",
    date: "2001-10-02",
    time: "09:15",
    custodian: "voss",
    type: "Email",
    subject: "Whitfield — request for raw serum data and half-life calculation worksheet",
    to: ["Dr. Linda Whitfield"],
    cc: ["Dr. Yusuf Bello"],
    aiScore: 62,
    aiIssues: ["TOX-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01"], reviewerId: R.lopez, reviewedAt: "2026-09-11T10:30:00Z" },
    body: `Linda —

For our internal file I need the individual-animal serum concentrations for the recovery group (day 90 and recovery day 28) in spreadsheet form, and the LC/MS/MS calibration data. I have re-derived the half-life from the means (98–103 days) and want to confirm from the individual values.

Also — the chronic study. Our PO covers the reduced design (three groups, no interim sacrifice). I would like the protocol to include serum sampling at 3, 6, 12 and 18 months in the main-study animals even without the interim necropsy. Please confirm that is within the PO or tell me what it adds.

Helen`,
  },
  {
    id: "ed_afff_0047",
    date: "2001-10-04",
    time: "14:48",
    custodian: "voss",
    type: "Email",
    subject: "RE: Whitfield — request for raw serum data and half-life calculation worksheet",
    from: "Dr. Linda Whitfield",
    to: ["Helen Voss"],
    cc: ["Dr. Yusuf Bello"],
    aiScore: 66,
    aiIssues: ["TOX-01", "TOX-02"],
    coding: { responsive: true, privileged: false, issues: ["TOX-01", "TOX-02"], reviewerId: R.lopez, reviewedAt: "2026-09-11T10:32:00Z" },
    body: `Helen,

Spreadsheet SK-0417-indiv.xls is on the FTP site with the calibration data. Individual half-lives in the five HD recovery males range 84–116 days (mean 99). Consistent with your figure.

Serum sampling in the chronic study at 3/6/12/18 months is within the PO; it was already in the protocol draft. In-life started 27 August (protocol WL-2001-0512). Dose groups 0, 0.03, 0.3 and 1.5 mg/kg-day dietary — note that Alan's "three groups" became four after Yusuf explained that a three-group design would not let us bracket the NOAEL. He agreed to it in the July call. Yusuf added the 0.03 group at cost.

One more thing, for your file. I raised the reporting question with you in March and I have not raised it since, because it is your company's decision. But I would ask you to keep in mind that if EPA asks Whitfield Laboratories for study records, we will provide them. We have had one such request in the last year on another sponsor's PFOS-related study.

Linda`,
  },
  {
    id: "ed_afff_0048",
    date: "2001-11-15",
    time: "16:10",
    custodian: "hale",
    type: "Email",
    subject: "Q3 2001 EHS quarterly report — distribution",
    to: ["Paul Merrick", "Alan Pryce", "Frank Oduya"],
    cc: ["Helen Voss", "Nadia Brooks", "Martin Suarez"],
    attachmentIds: ["ed_afff_0049"],
    aiScore: 73,
    aiIssues: ["ENV-01", "ENV-02"],
    coding: { responsive: true, privileged: false, issues: ["ENV-01"], reviewerId: R.lopez, reviewedAt: "2026-09-11T11:00:00Z" },
    body: `Q3 EHS report attached. Groundwater section (p. 4) is the one to read: Beacon's first MF-3-specific results from MW-3 and MW-7 are in. MW-7 came back at 12 µg/L. There is no regulatory standard for this compound in Illinois or federally, so the report describes it as a "detection" and recommends confirmation sampling. I have asked Beacon to resample both wells and add MW-5 in Q4.

I am briefing Paul and Alan separately on what this means for the lagoon and the drain re-route.

Greg`,
  },
  {
    id: "ed_afff_0049",
    pages: 6,
    date: "2001-11-15",
    custodian: "hale",
    type: "Report",
    subject: "EHS quarterly report — Q3 2001 — Decatur site",
    from: "Gregory Hale",
    parentId: "ed_afff_0048",
    aiScore: 85,
    aiIssues: ["ENV-01", "ENV-02"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["ENV-01", "ENV-02"], reviewerId: R.marsh, reviewedAt: "2026-09-11T11:10:00Z", notes: "First MF-3-specific groundwater detection at MW-7 (12 µg/L), Q3 2001. Establishes environmental knowledge eight months before the July 2002 MW-7 email." },
    tags: ["key-doc"],
    body: `MERIDIAN FLUOROCHEM — DECATUR SITE
ENVIRONMENTAL HEALTH & SAFETY QUARTERLY REPORT — THIRD QUARTER 2001
Prepared by G. Hale, Director EHS — 15 November 2001

1. SAFETY. Recordable injuries: 2 (Q2: 3). Lost-time: 0. TRIR YTD 1.9 (target 2.0). Forklift contact incident, Building 7, 22 Aug (no injury; procedural review complete).

2. AIR. Title V semi-annual monitoring submitted 30 Sept. No deviations. Sulfonation scrubber efficiency 98.7%.

3. WASTEWATER. Outfall 002 NPDES self-monitoring: all parameters within permit limits. Voluntary total organic fluorine (TOF) added to quarterly sampling from Q3: 41 µg/L (outfall 002), 3.2 µg/L (upstream reference). Building 7 floor drain re-route (CAP-98-114): approved 12 Sept, $140K; construction Q1 2002. Tote wash sump installed 4 Oct; wash water hauled by Heritage Environmental.

\f4. GROUNDWATER. Beacon Environmental (C. Nunez) sampled MW-3 and MW-7 on 18 Sept 2001 for MF-3 (potassium perfluorooctane sulfonate, as PFOS anion) by LC/MS/MS, reporting limit 0.05 µg/L, together with TOF.
   MW-3 (upgradient of Lagoon 2): PFOS 0.31 µg/L; TOF 0.6 µg/L.
   MW-7 (downgradient of Lagoon 2, 18–28 ft screen): PFOS 12.0 µg/L; TOF 19 µg/L.
   Field duplicate MW-7: PFOS 11.4 µg/L.
   Interpretation (Beacon): The MW-7 result indicates that fluorosurfactant has migrated from Lagoon 2 to the shallow aquifer. There is no state or federal groundwater standard for PFOS. Beacon recommends confirmation sampling of MW-3, MW-5 and MW-7 in Q4, and installation of one additional well between MW-7 and the property line to define the downgradient extent. Groundwater flow is toward the south-southeast; the Decatur municipal wellfield is approximately 1.4 miles in that direction and draws from a deeper aquifer separated by a clay unit of uncertain continuity.
   EHS action: confirmation sampling authorised (Q4). Liner integrity survey of Lagoon 2 scheduled 3–5 Dec. Recommendation to management: fund the property-line well ($18K) and evaluate Lagoon 2 closure.

\f5. OCCUPATIONAL HEALTH. Medical surveillance (D. Castellano): 1994–2000 trend analysis of blending-crew liver panels complete (memo 22 June). Mean serum cholesterol in the blending crew (n=31) is 9% lower than the site office reference group (n=44); ALT not different. Castellano characterises the finding as "of uncertain significance" and recommends serum fluorosurfactant analysis. Voluntary serum sampling program proposed to management 30 July; decision pending (Pryce/Merrick).

6. PRODUCT SAFETY (H. Voss). Chronic bioassay WL-2001-0512 in-life since 27 Aug; first serum sampling at 3 months (late Nov). No findings to report.

\f7. REGULATORY (M. Suarez). EPA SNUR on PFOS-related substances: final rule expected Q1 2002 with AFFF exclusion. Voluntary data submission to OPPT made 29 June (1993 study, acute package, and Whitfield 90-day summary with cover letter). No EPA response to date.

8. CUSTOMER / COMMUNITY. Macon County FPD: containment sump design provided 14 Aug. Tidewater Refining: NOV response support provided; indemnity claim referred to Law Department. Savannah Fire: response sent 5 Oct. No community complaints regarding the Decatur site this quarter.

\f9. CAPITAL. CAP-98-114 drains ($140K, approved). Property-line well ($18K, proposed). Lagoon 2 closure study ($35K, proposed).

\f10. ATTACHMENTS. A — Beacon Environmental letter report 4 Oct 2001. B — Castellano memo 22 June 2001. C — Outfall 002 DMRs Q3.`,
  },
  {
    id: "ed_afff_0050",
    date: "2001-12-03",
    time: "08:15",
    custodian: "voss",
    type: "Email",
    subject: "Holiday schedule and lab coverage — Product Safety",
    to: ["Gregory Hale", "Nadia Brooks", "Priya Natarajan"],
    aiScore: 3,
    aiIssues: [],
    coding: { responsive: false, privileged: false, issues: [], reviewerId: R.lopez, reviewedAt: "2026-09-11T11:20:00Z" },
    body: `All — I will be out 21 Dec through 2 Jan. Priya will cover the Product Safety mailbox and can reach me by phone for anything from Whitfield. The 3-month serum samples from the chronic study are due at the lab on the 17th; Priya has the chain-of-custody forms.

Happy holidays,
Helen`,
  },
  {
    id: "ed_afff_0051",
    date: "2001-12-10",
    time: "13:02",
    custodian: "brooks",
    type: "Email",
    subject: "Trade show booth — FDIC 2002 Indianapolis — space and graphics",
    to: ["Karen Liu"],
    aiScore: 6,
    aiIssues: [],
    coding: { responsive: false, privileged: false, issues: [], reviewerId: R.lopez, reviewedAt: "2026-09-11T11:22:00Z" },
    body: `Karen — confirming we have booth 2214 (20x30) for FDIC in April. Graphics need to go to the printer by 1 March. Please use the revised product literature (post-MSDS rev. G) for the panel copy; I will review the panel text before it goes. Also we need a new demo pump — the old one leaks.

Nadia`,
  },
  {
    id: "ed_afff_0052",
    date: "2002-01-08",
    time: "10:30",
    custodian: "pryce",
    type: "Email",
    subject: "Pricing — Aqua-Guard 3 — Navy NAVSUP contract renewal",
    to: ["Paul Merrick"],
    aiScore: 12,
    aiIssues: [],
    coding: { responsive: false, privileged: false, issues: [], reviewerId: R.lopez, reviewedAt: "2026-09-11T11:25:00Z", notes: "Pricing only. Non-responsive under RFP 14 definition; note it references the re-qualification." },
    body: `Paul — NAVSUP renewal bid is due 25 Jan. Proposed: $18.40/gal delivered, 5-year IDIQ, minimum 400K gal/yr. That is 6% under 3M's last price and 3% over our 2001 municipal average. Re-qualification was accepted 12 Nov so we are on the QPL for the term. Need your OK by Friday.

Alan`,
  },
  {
    id: "ed_afff_0053",
    date: "2002-01-22",
    time: "07:45",
    custodian: "hale",
    type: "Email",
    subject: "Site safety — forklift incident Building 7 — corrective actions closed",
    to: ["Frank Oduya", "Steve Halloran"],
    aiScore: 4,
    aiIssues: [],
    coding: { responsive: false, privileged: false, issues: [], reviewerId: R.lopez, reviewedAt: "2026-09-11T11:26:00Z" },
    body: `Frank, Steve — the corrective actions from the 22 Aug forklift contact (mirror at the Building 7 dock corner, pedestrian walkway striping, re-training for the two operators) are all closed as of yesterday's walk-through. I am closing the incident in the system. Thanks for getting it done before the insurance audit.

Greg`,
  },
  {
    id: "ed_afff_0054",
    date: "2002-02-05",
    custodian: "voss",
    type: "Chat",
    subject: "IM log — Voss / Brooks — 3-month bioassay serum results",
    raw: true,
    aiScore: 83,
    aiIssues: ["TOX-02", "PRD-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-02"], reviewerId: R.marsh, reviewedAt: "2026-09-11T11:40:00Z" },
    body: `Instant message log — Lotus Sametime — 5 Feb 2002 — participants: hvoss, nbrooks — exported by IT for litigation hold 2012-04-30

[14:02:11] hvoss: got the 3-month serum from the chronic study
[14:02:25] nbrooks: and?
[14:03:04] hvoss: 1.5 mg/kg group is at 38 ug/mL at 3 months. that's dietary, so lower daily intake than the gavage study, but it's tracking the same curve
[14:03:40] hvoss: 0.03 group is at 0.9. so even the low group is measurable and climbing
[14:04:12] nbrooks: so no steady state
[14:04:20] hvoss: not at 3 months no. wouldn't expect it with a 100 day half life. we'll know more at 6
[14:05:02] nbrooks: alan is going to ask if this changes anything
[14:05:33] hvoss: it doesn't change anything we didn't already know. it confirms it. which is sort of the point
[14:06:10] nbrooks: are you sending it to martin
[14:06:18] hvoss: yes. he asked to see every serum result as it comes in. the memo said revisit
[14:07:01] nbrooks: ok. separately - C6 program kickoff is thursday. can you come? need a tox plan for the candidates
[14:07:30] hvoss: yes. and nadia - the C6 stuff has to have kinetics in the first study. not an afterthought this time
[14:07:44] nbrooks: agreed. 100%`,
  },
  {
    id: "ed_afff_0055",
    date: "2002-02-19",
    time: "11:00",
    custodian: "voss",
    type: "Email",
    subject: "Two-year bioassay — 3-month serum results and protocol amendment (interim necropsy reinstated)",
    to: ["Martin Suarez", "Gregory Hale"],
    cc: ["Alan Pryce"],
    attachmentIds: ["ed_afff_0056"],
    aiScore: 80,
    aiIssues: ["TOX-02", "REG-01"],
    coding: { responsive: true, privileged: false, issues: ["TOX-02", "REG-01"], reviewerId: R.lopez, reviewedAt: "2026-09-11T11:50:00Z" },
    body: `Martin, Greg —

Per the March memo's "revisit" condition, the 3-month serum results from WL-2001-0512 are attached (dose group table). Summary: serum concentrations at 3 months are proportional to dose and still rising at every dose level. No clinical findings.

Alan has agreed to reinstate the 12-month interim necropsy (10/sex/group) at $118K so that we have histopathology, not only serum, for the 12-month revisit. Protocol amendment 2 signed 14 Feb. Interim report expected October 2002.

Helen`,
  },
  {
    id: "ed_afff_0056",
    date: "2002-02-19",
    custodian: "voss",
    type: "Spreadsheet",
    subject: "WL-2001-0512 — dose group assignments and 3-month serum concentrations (xls)",
    parentId: "ed_afff_0055",
    raw: true,
    aiScore: 58,
    aiIssues: ["TOX-02"],
    coding: { responsive: true, privileged: false, issues: ["TOX-02"], reviewerId: R.lopez, reviewedAt: "2026-09-11T11:52:00Z" },
    body: `Workbook: WL-2001-0512_serum_3mo.xls — Sheet 1: Dose groups

Group | Dose (mg/kg-day, dietary) | Target ppm in diet | n main (M/F) | n interim (M/F) | Start date
1 | 0 | 0 | 50/50 | 10/10 | 2001-08-27
2 | 0.03 | 0.5 | 50/50 | 10/10 | 2001-08-27
3 | 0.3 | 5 | 50/50 | 10/10 | 2001-08-27
4 | 1.5 | 25 | 50/50 | 10/10 | 2001-08-27

Sheet 2: Serum PFOS (µg/mL), 3-month sampling, 26 Nov 2001, n=10/sex/group, LC/MS/MS (Whitfield AN-118), LOQ 0.025

Group | Males mean | Males SD | Females mean | Females SD | Achieved dose M | Achieved dose F
1 | <0.025 | — | <0.025 | — | 0 | 0
2 | 0.92 | 0.18 | 1.04 | 0.21 | 0.029 | 0.031
3 | 8.7 | 1.4 | 9.6 | 1.9 | 0.30 | 0.31
4 | 38.1 | 5.9 | 41.7 | 6.3 | 1.47 | 1.52

Sheet 3: Notes
- Serum/dose ratio at 3 months ≈ 26 (µg/mL per mg/kg-day) across groups: linear kinetics in this range.
- Gavage study (WL-2000-0417) day 90 at 5.0 mg/kg-day: 148 µg/mL → ratio 30. Consistent.
- Next sampling: 6 months (26 Feb 2002).
- Prepared by H. Voss 2002-02-18. Reviewed: Y. Bello (Whitfield).`,
  },
];
