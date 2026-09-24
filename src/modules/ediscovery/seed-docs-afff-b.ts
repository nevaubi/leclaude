import type { DocSpec } from "./seed-helpers";
import { REVIEWERS } from "./seed-helpers";

/**
 * AFFF / PFAS MDL — Meridian Fluorochem custodial documents, block B.
 * MFC-0052210 …: the Decatur MW-7 groundwater series (2002), the two-year
 * bioassay interim, Navy correspondence, and later-dated documents through
 * 2012. MFC-0043105 … 0043951: the 2016–2017 documents relied on by the
 * chronology and privilege-log workflows.
 */

const R = REVIEWERS;
const T_MW7 = "thr_afff_mw7";
const T_MIL = "thr_afff_milspec";
const T_8E_2016 = "thr_afff_8e_2016";

export const AFFF_DOCS_B: DocSpec[] = [
  // ------------------------------------------------------------------
  // MFC-0052210 — Decatur MW-7 results (July 2002)
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0057",
    batesAt: 52210,
    pages: 2,
    date: "2002-07-08",
    time: "15:22",
    custodian: "hale",
    type: "Email",
    subject: "Decatur site — monitoring well MW-7 results",
    to: ["Alan Pryce", "Martin Suarez"],
    cc: ["Nadia Brooks", "Paul Merrick"],
    threadId: T_MW7,
    attachmentIds: ["ed_afff_0058"],
    aiScore: 95,
    aiIssues: ["ENV-01", "REG-02"],
    aiSummary: "Hale reports Beacon Environmental's Q2 2002 results: PFOS at MW-7 has risen to 41 µg/L, the new property-line well MW-8 shows 6.8 µg/L, and Lagoon 2's unlined section is the likely source. He recommends notifying Illinois EPA, sampling the Decatur municipal wellfield, and closing Lagoon 2, and warns that the migration will reach the property line within two to three years.",
    entities: { people: ["Gregory Hale", "Alan Pryce", "Martin Suarez", "Carla Nunez", "Lisa Ferrante"], orgs: ["Beacon Environmental", "Illinois EPA", "Decatur Water"], places: ["Decatur, IL", "Lagoon 2", "MW-7", "MW-8", "Sangamon River"], chemicals: ["PFOS", "MF-3"] },
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["ENV-01", "REG-02"], reviewerId: R.whitfield, reviewedAt: "2026-09-12T08:10:00Z", notes: "Central groundwater document. Hale recommends state notification; Pryce reply (MFC-0052217) says 'not in email'. Brooks Dep. Ex. 14." },
    tags: ["key-doc", "exhibit-candidate"],
    body: `Alan, Martin —

Beacon's Q2 results for the Decatur wells are attached. I need decisions this week.

MW-7 (downgradient of Lagoon 2): PFOS 41 µg/L. That is up from 12 in September and 19 in December. MW-8, the new well at the south property line: 6.8 µg/L. MW-5: 2.1. MW-3 (upgradient): 0.3, unchanged. The liner survey in December found the 1989 liner intact but confirmed the south third of Lagoon 2 was never lined. Beacon's interpretation is that fluorosurfactant from the Building 7 drains has been infiltrating from the unlined section for a decade and the plume is moving south-southeast at roughly 150 feet a year. At that rate it is at the property line now (it is — MW-8) and under the Kessler farm within two years.

The Decatur municipal wellfield (Wells 9–12) is 1.4 miles in that direction. Beacon thinks the clay unit protects the deep aquifer but says "uncertain continuity" and will not put a number on it.

My recommendations:
1. Notify Illinois EPA (Janet Rourke, Bureau of Water) voluntarily, now. There is no PFOS standard, so this is not a reportable exceedance, but we have an off-site migration of a compound we know is persistent and bioaccumulative, toward a public water supply.
2. Ask Decatur Water (Lisa Ferrante) to let us sample Wells 9–12. Offer to pay.
\f3. Close Lagoon 2 and complete the Building 7 drain re-route (construction started in March, 60% done).
4. Install two more wells between MW-8 and the wellfield.

I know Alan will want Legal to look at (1) and (2) first. Fine, but I want it on the record that EHS recommended both today.

Greg

Gregory Hale
Director, Environmental Health & Safety
Meridian Fluorochem Corp.`,
  },
  {
    id: "ed_afff_0058",
    pages: 5,
    date: "2002-07-03",
    custodian: "hale",
    type: "Report",
    subject: "Beacon Environmental — Q2 2002 groundwater monitoring results — Meridian Fluorochem Decatur facility",
    from: "Carla Nunez",
    to: ["Gregory Hale"],
    parentId: "ed_afff_0057",
    aiScore: 89,
    aiIssues: ["ENV-01"],
    coding: { responsive: true, privileged: false, hot: false, issues: ["ENV-01"], reviewerId: R.marsh, reviewedAt: "2026-09-12T08:20:00Z" },
    body: `BEACON ENVIRONMENTAL CONSULTANTS, INC.
1420 South Neil Street, Champaign, Illinois 61820

LETTER REPORT — Second Quarter 2002 Groundwater Monitoring
Meridian Fluorochem Corp., Decatur Facility — Beacon Project 99-1187
3 July 2002

Prepared for: Gregory Hale, Director EHS
Prepared by: Carla Nunez, P.G., Senior Hydrogeologist

1. SCOPE. Beacon sampled monitoring wells MW-3, MW-5, MW-7 and the newly installed MW-8 on 17–18 June 2002 for perfluorooctane sulfonate (PFOS, as anion) and total organic fluorine (TOF), per the scope approved 14 Jan 2002. Samples were collected by low-flow purging and analysed by Beacon's subcontract laboratory (Pace Analytical, Minneapolis) by LC/MS/MS, reporting limit 0.05 µg/L PFOS.

2. RESULTS (PFOS, µg/L):
   Well  | Location                          | Sep 2001 | Dec 2001 | Jun 2002
   MW-3  | Upgradient, NW of Lagoon 2        |  0.31    |  0.28    |  0.30
   MW-5  | Cross-gradient, E of Bldg 7       |   —      |  1.4     |  2.1
   MW-7  | 90 ft S of Lagoon 2 (unlined sec.)|  12.0    |  19.3    |  41.2
   MW-8  | South property line (new, 5/02)   |   —      |   —      |  6.8
   Field duplicate MW-7: 39.7. Trip blank: <0.05. TOF results tabulated in Attachment A and are consistent.

\f3. LINER INTEGRITY. Beacon's electrical leak-location survey of Lagoon 2 (3–5 Dec 2001) found the 1989 HDPE liner intact over the northern two-thirds of the impoundment. The southern approximately 0.8 acre, added in 1991 when the lagoon was enlarged, has no synthetic liner; construction records indicate compacted clay only. Lagoon 2 receives Building 7 floor-drain and tote-wash flows (until the drain re-route is complete) and stormwater.

4. HYDROGEOLOGY. Shallow aquifer: silty sand, water table 14–17 ft bgs, flow S-SE, gradient 0.004, estimated velocity 120–180 ft/yr. A clay unit (Wisconsinan till) at 32–40 ft bgs separates the shallow aquifer from the deeper sand-and-gravel aquifer from which the City of Decatur draws Wells 9–12 (approx. 1.4 miles SSE). Boring logs from the 1989 and 1997 well installations show the clay unit present at all locations on the property, but its continuity between the property line and the wellfield has not been investigated.

\f5. INTERPRETATION. The rising PFOS concentrations at MW-7 and the detection at MW-8 indicate a plume of PFOS in the shallow aquifer originating at the unlined southern section of Lagoon 2 and extending beyond the southern property boundary. Given the persistence of PFOS and the absence of attenuation mechanisms other than dilution and sorption, the plume will continue to migrate. Concentrations at the property line will likely increase. Off-site receptors in the shallow aquifer (domestic wells on the Kessler property, approx. 1,800 ft SSE, if any are screened in the shallow zone) should be identified.

6. REGULATORY. There is no Illinois Class I groundwater standard (35 IAC 620) for PFOS. Illinois EPA may nonetheless assert that the release is subject to notification under the Illinois Environmental Protection Act, section 12(a) and (d), on a case-specific basis. Beacon recommends that Meridian obtain legal advice on notification.

\f7. RECOMMENDATIONS.
 (a) Confirmation sampling of MW-8 in Q3 2002.
 (b) Install MW-9 and MW-10 between MW-8 and the Kessler property line; survey for shallow domestic wells within 0.5 mile.
 (c) Cease discharge of process flows to Lagoon 2 immediately (drain re-route) and evaluate closure of the unlined section.
 (d) Request access to sample City of Decatur Wells 9–12 for PFOS as a precaution.
 (e) Prepare a conceptual site model and evaluate remedial options (source removal; hydraulic containment).

Attachments: A — Laboratory reports and QA/QC. B — Potentiometric surface map, June 2002. C — Liner survey summary.

C. Nunez, P.G. — Illinois Licence 196-000842`,
  },
  {
    id: "ed_afff_0059",
    date: "2002-07-09",
    time: "07:52",
    custodian: "pryce",
    type: "Email",
    subject: "RE: Decatur site — monitoring well MW-7 results",
    to: ["Gregory Hale"],
    cc: ["Martin Suarez", "Paul Merrick"],
    threadId: T_MW7,
    aiScore: 93,
    aiIssues: ["ENV-01", "REG-02"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["ENV-01", "REG-02"], reviewerId: R.whitfield, reviewedAt: "2026-09-12T08:25:00Z", notes: "'Do not put this in email.' Not privileged: no request for legal advice; Suarez cc'd as a recipient of a business instruction. Hot." },
    tags: ["key-doc"],
    body: `Greg —

Do not put this in email. Not the recommendations, not the numbers, not the farm. I want a meeting with you, Martin, Paul and Rob in my office at 2 today.

Nothing goes to the state or to the city until Legal has looked at it. That is not a "no," it is a "not yet."

Nadia — you are off this thread.

Alan`,
  },
  {
    id: "ed_afff_0060",
    date: "2002-07-09",
    time: "11:38",
    custodian: "suarez",
    type: "Email",
    subject: "RE: Decatur site — monitoring well MW-7 results — notification obligations",
    to: ["Alan Pryce", "Gregory Hale", "Robert Kaine"],
    cc: ["Paul Merrick"],
    threadId: T_MW7,
    aiScore: 90,
    aiIssues: ["ENV-01", "REG-02", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["ENV-01", "REG-02", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-12T08:40:00Z", notes: "Preliminary legal analysis by regulatory counsel to client executives. Withhold; log." },
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

For the 2 pm meeting — my preliminary legal view on notification, so we are not starting cold.

1. Illinois. No numeric groundwater standard for PFOS, so no automatic reporting trigger under 35 IAC 620. Section 12(a) of the Act (causing water pollution) and 12(d) (creating a water pollution hazard) are the exposure; Illinois EPA can pursue either without a standard if it can show the release "renders waters harmful." We would argue no standard, no harm shown. That argument gets weaker every quarter the numbers go up and gets very weak if the city's wells ever show a detection.

2. Federal. CERCLA 103 reporting applies only to hazardous substances with a reportable quantity; PFOS is not listed. No federal trigger.

3. TSCA 8(e). This is the one I want Rob's view on. We have now, in one company, (a) a 90-day rat study showing toxicity and slow elimination, (b) a two-year study in progress with serum still rising at 6 months, (c) lower cholesterol in our own blending crew, and (d) an off-site groundwater plume of the same compound heading toward a public water supply. The March 2001 memo said revisit. Each piece may be defensible alone. I am not comfortable that the set is.

4. Voluntary notification (Greg's recommendation). Legally it is the safer course on the state side and it makes the 8(e) question easier, because we would be acting rather than waiting. The cost is that it starts a public process. My advice will be to do it, in a controlled way, with a remediation plan in hand.

Martin`,
  },
  {
    id: "ed_afff_0061",
    date: "2002-07-10",
    time: "16:20",
    custodian: "hale",
    type: "Email",
    subject: "RE: Decatur site — monitoring well MW-7 results — actions from 7/9 meeting",
    to: ["Alan Pryce", "Martin Suarez", "Paul Merrick", "Robert Kaine"],
    threadId: T_MW7,
    aiScore: 88,
    aiIssues: ["ENV-01", "REG-02"],
    coding: { responsive: null, privileged: null, issues: [], notes: "Meeting notes summarising decisions including counsel's advice. Mixed. Redact ¶3 (Kaine advice) and produce remainder? Second-level review." },
    body: `Actions from yesterday's meeting, as I understood them:

1. Drain re-route: accelerate; complete by 15 August. Halloran to add a second crew. (Merrick)
2. Lagoon 2: stop all process flows now; pump down the unlined section and haul; closure plan from Beacon by 30 Sept. (Hale)
3. Rob's view was that a voluntary notification to Illinois EPA is appropriate but should be made after we have a closure plan and the additional wells in hand, so that we go in with a plan and not a problem. Target: October. (Suarez/Kaine)
4. City wells: do not approach the city until (3). (Pryce)
5. Kessler property: Beacon to do a well survey from public records only; no site visit. (Hale)
6. Communications: no written communication about MW-7 outside this group. Beacon reports go to Hale only. (Pryce)

I want to note for the record that I disagree with the sequencing on items 3 and 4 and said so in the meeting. If the city's wells are clean, sampling them costs us nothing. If they are not, every month matters.

Greg`,
  },
  {
    id: "ed_afff_0062",
    date: "2002-07-15",
    time: "13:05",
    custodian: "hale",
    type: "Email",
    subject: "Illinois EPA — call from Janet Rourke re: Macon County FPD and Decatur",
    to: ["Martin Suarez"],
    cc: ["Alan Pryce"],
    aiScore: 84,
    aiIssues: ["REG-02", "ENV-01"],
    coding: { responsive: null, privileged: null, issues: [] },
    body: `Martin —

Janet Rourke (IEPA Bureau of Water, Springfield) called me this morning. Ostensibly about Macon County FPD — she wanted to know whether Meridian had provided the District with disposal guidance (yes, and the sump). Then she asked, in passing, whether Meridian "does any groundwater monitoring at the Decatur plant for the foam chemicals." I said we have a monitoring well network and that we sample it. She asked whether we would share the data. I said I would need to check with our regulatory group and would get back to her.

She did not say why she was asking. My guess is Chief Duffy's letter (which was cc'd to her in April 2001) plus 3M's publicity.

I did not lie to her and I am not going to. Please advise what I can tell her, by when.

Greg`,
  },
  {
    id: "ed_afff_0063",
    pages: 2,
    date: "2002-10-24",
    custodian: "hale",
    type: "Letter",
    subject: "Letter to City of Decatur Water Management — notification of shallow groundwater monitoring results and offer of wellfield sampling",
    from: "Gregory Hale",
    to: ["Lisa Ferrante"],
    cc: ["Janet Rourke", "Martin Suarez"],
    aiScore: 86,
    aiIssues: ["ENV-01", "REG-02", "CUS-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["ENV-01", "REG-02"], reviewerId: R.marsh, reviewedAt: "2026-09-12T09:15:00Z", notes: "First disclosure to the city, 3.5 months after MW-7 results. The letter does not state the MW-7 concentration." },
    body: `MERIDIAN FLUOROCHEM CORP.
1800 Industrial Parkway, Decatur, Illinois 62526

October 24, 2002

Ms. Lisa Ferrante
Director, Water Management Services
City of Decatur
1 Gary K. Anderson Plaza
Decatur, IL 62523

Re: Groundwater monitoring at the Meridian Fluorochem Decatur facility

Dear Ms. Ferrante:

Meridian Fluorochem Corp. operates a network of groundwater monitoring wells at its Decatur facility as part of its environmental management program. Recent monitoring has detected a fluorinated surfactant compound used in the manufacture of firefighting foam concentrates in the shallow aquifer beneath the facility and at the facility's southern boundary. The compound is not regulated in groundwater under Illinois or federal standards. Meridian has ceased the process discharge that is believed to be the source, has begun closure of the affected surface impoundment, and has installed additional wells to define the extent of the affected groundwater. Meridian has informed the Illinois Environmental Protection Agency of these results and its response actions.

\fThe City's Wells 9 through 12 draw from the deep sand-and-gravel aquifer, which is separated from the shallow aquifer by a clay layer. Meridian's consultant, Beacon Environmental, considers it unlikely that the shallow groundwater affects the City's wells. As a precaution, however, Meridian offers to sample the City's Wells 9 through 12, at Meridian's expense, using a laboratory method capable of detecting the compound at very low concentrations, and to share the results with the City and the Illinois EPA. Meridian would also be glad to meet with the City's staff to review the monitoring data.

Please contact me at (217) 555-0141 to arrange sampling at the City's convenience.

Sincerely,

Gregory Hale
Director, Environmental Health & Safety

cc: Janet Rourke, Illinois EPA Bureau of Water; Martin Suarez, Meridian Fluorochem`,
  },
  {
    id: "ed_afff_0064",
    date: "2002-07-08",
    time: "15:22",
    custodian: "pryce",
    type: "Email",
    subject: "Decatur site — monitoring well MW-7 results",
    from: "Gregory Hale",
    to: ["Alan Pryce", "Martin Suarez"],
    cc: ["Nadia Brooks", "Paul Merrick"],
    threadId: T_MW7,
    duplicateOf: "ed_afff_0057",
    pages: 2,
    aiScore: 95,
    aiIssues: ["ENV-01", "REG-02"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["ENV-01", "REG-02"], reviewerId: R.lopez, reviewedAt: "2026-09-12T08:12:00Z", notes: "Exact duplicate of MFC-0052210 from Pryce mailbox." },
    body: `Alan, Martin —

Beacon's Q2 results for the Decatur wells are attached. I need decisions this week.

MW-7 (downgradient of Lagoon 2): PFOS 41 µg/L. That is up from 12 in September and 19 in December. MW-8, the new well at the south property line: 6.8 µg/L. MW-5: 2.1. MW-3 (upgradient): 0.3, unchanged. The liner survey in December found the 1989 liner intact but confirmed the south third of Lagoon 2 was never lined. Beacon's interpretation is that fluorosurfactant from the Building 7 drains has been infiltrating from the unlined section for a decade and the plume is moving south-southeast at roughly 150 feet a year. At that rate it is at the property line now (it is — MW-8) and under the Kessler farm within two years.

The Decatur municipal wellfield (Wells 9–12) is 1.4 miles in that direction. Beacon thinks the clay unit protects the deep aquifer but says "uncertain continuity" and will not put a number on it.

My recommendations:
1. Notify Illinois EPA (Janet Rourke, Bureau of Water) voluntarily, now. There is no PFOS standard, so this is not a reportable exceedance, but we have an off-site migration of a compound we know is persistent and bioaccumulative, toward a public water supply.
2. Ask Decatur Water (Lisa Ferrante) to let us sample Wells 9–12. Offer to pay.
\f3. Close Lagoon 2 and complete the Building 7 drain re-route (construction started in March, 60% done).
4. Install two more wells between MW-8 and the wellfield.

I know Alan will want Legal to look at (1) and (2) first. Fine, but I want it on the record that EHS recommended both today.

Greg

Gregory Hale
Director, Environmental Health & Safety
Meridian Fluorochem Corp.`,
  },

  // ------------------------------------------------------------------
  // Two-year bioassay interim (Sept 2002)
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0065",
    date: "2002-09-12",
    time: "10:05",
    custodian: "voss",
    type: "Email",
    subject: "Two-year bioassay — 12-month interim report received",
    to: ["Martin Suarez", "Gregory Hale", "Robert Kaine"],
    cc: ["Alan Pryce"],
    attachmentIds: ["ed_afff_0066"],
    aiScore: 91,
    aiIssues: ["TOX-02", "REG-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["TOX-02", "REG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-12T10:00:00Z", notes: "Transmittal of the interim. Voss expressly invokes the 'revisit' condition of the March 2001 memo." },
    tags: ["key-doc"],
    body: `All —

Whitfield's 12-month interim report on the two-year study (WL-2001-0512) came in this morning. Summary attached; full report to follow by courier.

The short version: at 12 months the 1.5 mg/kg-day group has serum PFOS of 96 µg/mL (still rising), hepatocellular hypertrophy in 9/10 males and 8/10 females, and — this is new — hepatocellular adenomas in 2/10 males. Two adenomas in ten animals at an interim is not a statistical finding and Whitfield says so. But the pathologist notes it, and the 0.3 group has hypertrophy in 4/10 males, so the NOAEL for the chronic study is going to be 0.03 mg/kg-day, three times lower than the 90-day NOAEL.

Martin — this is the "revisit" the March 2001 memo called for. I am sending it to you and Rob at the same time as Greg and Alan, on purpose.

Helen`,
  },
  {
    id: "ed_afff_0066",
    pages: 10,
    date: "2002-09-11",
    custodian: "voss",
    type: "Report",
    subject: "Whitfield WL-2001-0512 — two-year chronic bioassay of MF-3 in rats — 12-month interim report (summary)",
    from: "Dr. Linda Whitfield",
    parentId: "ed_afff_0065",
    aiScore: 96,
    aiIssues: ["TOX-02", "TOX-01"],
    aiSummary: "Twelve-month interim of the chronic dietary study of MF-3 in rats. Serum PFOS continues to rise at all doses (96 µg/mL at 1.5 mg/kg-day). Hepatocellular hypertrophy at 0.3 and 1.5 mg/kg-day; two hepatocellular adenomas in high-dose males at the interim sacrifice; thyroid follicular hypertrophy at the high dose. Interim NOAEL 0.03 mg/kg-day. Whitfield recommends the sponsor consider the regulatory significance of the adenoma finding.",
    entities: { people: ["Linda Whitfield", "Yusuf Bello", "Helen Voss"], orgs: ["Whitfield Laboratories", "Meridian Fluorochem Corp."], places: ["Research Triangle Park, NC"], chemicals: ["PFOS", "MF-3"] },
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["TOX-02", "TOX-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-12T10:20:00Z" },
    tags: ["key-doc", "exhibit-candidate"],
    body: `WHITFIELD LABORATORIES, INC.
INTERIM REPORT — 12 MONTHS — SUMMARY
Study No. WL-2001-0512
A Two-Year Dietary Chronic Toxicity and Carcinogenicity Study of MF-3 Fluorosurfactant Concentrate in Sprague-Dawley Rats
Sponsor: Meridian Fluorochem Corp. — Sponsor Representative: H. Voss
Study Director: L. Whitfield, Ph.D., DABT — Pathologist: Y. Bello, DVM, Ph.D., DACVP
In-life start: 27 August 2001 — Interim sacrifice: 26–28 August 2002 — Report: 11 September 2002

1. DESIGN. Dietary administration at 0, 0.5, 5 and 25 ppm (target 0, 0.03, 0.3 and 1.5 mg/kg-day) to 50 rats/sex/group (main) and 10/sex/group (interim). Interim animals were necropsied at 52 weeks with full histopathology of liver, thyroid, kidney, pancreas, testes and gross lesions.

2. ACHIEVED DOSE (weeks 1–52, mean): males 0.031, 0.31, 1.49; females 0.033, 0.33, 1.56 mg/kg-day.

\f3. SURVIVAL AND CLINICAL SIGNS. Survival at 52 weeks: 96–100% in all groups. No treatment-related clinical signs. Body weight of high-dose males 7% below control at week 52 (p<0.05).

4. SERUM PFOS (µg/mL, mean, n=10/sex):
   Group      3 mo    6 mo    9 mo    12 mo
   0.03       0.9     1.6     2.2     2.7
   0.3        8.7    16.1    22.4    28.9
   1.5       38.1    64.8    83.5    96.2
   Steady state has not been reached at any dose after 52 weeks.

\f5. CLINICAL CHEMISTRY (12 months). Total cholesterol reduced at 0.3 (-19%) and 1.5 (-37%) mg/kg-day in males; -15% and -31% in females. ALT elevated at 1.5 (1.7x males). T4 reduced 22% (males) and 29% (females) at 1.5 mg/kg-day; TSH increased.

6. ORGAN WEIGHTS. Relative liver weight: +9% (0.3, males, n.s.), +31% (1.5, males, p<0.01), +24% (1.5, females, p<0.01). Thyroid: +17% at 1.5 (both sexes, p<0.05).

\f7. HISTOPATHOLOGY — INTERIM SACRIFICE (10/sex/group)
LIVER
  Hepatocellular hypertrophy, centrilobular: M 0/10, 0/10, 4/10, 9/10; F 0/10, 0/10, 2/10, 8/10.
  Hepatocellular vacuolation: M 1/10, 0/10, 2/10, 6/10; F 0/10, 1/10, 1/10, 5/10.
  Focus of cellular alteration (eosinophilic): M 0/10, 0/10, 1/10, 3/10; F 0/10, 0/10, 0/10, 2/10.
  HEPATOCELLULAR ADENOMA: M 0/10, 0/10, 0/10, 2/10; F 0/10, 0/10, 0/10, 0/10.
  Hepatocellular carcinoma: 0 in all groups.
THYROID
  Follicular cell hypertrophy: M 0/10, 0/10, 1/10, 5/10; F 0/10, 0/10, 0/10, 6/10.
  Follicular cell adenoma: 0 in all groups.
PANCREAS
  Acinar cell hyperplasia: M 0/10, 0/10, 0/10, 2/10.
TESTES
  Leydig cell hyperplasia: 0/10, 0/10, 1/10, 1/10.

\f8. PATHOLOGIST'S COMMENT (Y. Bello). The two hepatocellular adenomas in high-dose males at 12 months are noted. Spontaneous hepatocellular adenomas in male Sprague-Dawley rats at 12 months are rare (Whitfield historical control range 0–1% at 12 months; 2–6% at 24 months). Two in ten animals is not statistically significant against a concurrent control of zero (Fisher exact p = 0.24), but the finding, together with the eosinophilic foci at 0.3 and 1.5 mg/kg-day, is consistent with a hepatocellular proliferative response and is of a kind that frequently precedes a positive carcinogenicity outcome at 24 months for peroxisome-proliferating compounds. The sponsor should be prepared for a positive liver tumour finding at the end of the study.

9. INTERIM NOAEL. 0.03 mg/kg-day (males), based on hepatocellular hypertrophy and eosinophilic foci at 0.3 mg/kg-day.

\f10. STUDY DIRECTOR'S RECOMMENDATIONS. (a) Continue the study to 104 weeks as planned. (b) Add serum sampling at 18 months (in protocol). (c) The sponsor should consider the regulatory significance of the adenoma finding and of the continued rise in serum concentration in consultation with its regulatory advisers. Whitfield Laboratories does not offer regulatory advice, but notes that the U.S. EPA has recently requested interim data on PFOS studies from other sponsors. (d) The sponsor may wish to commission a mechanistic study (peroxisome proliferation markers, cell proliferation) to inform human relevance.

L. Whitfield, Ph.D., DABT — 11 September 2002
QA statement: Interim data audited 3–9 September 2002 — M. Ortega`,
  },
  {
    id: "ed_afff_0067",
    date: "2002-09-16",
    time: "17:35",
    custodian: "kaine",
    type: "Email",
    subject: "RE: Two-year bioassay — 12-month interim report — privileged",
    to: ["Martin Suarez"],
    aiScore: 92,
    aiIssues: ["REG-01", "LEG-01", "TOX-02"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", hot: true, confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-12T10:40:00Z", notes: "AGC directing 8(e) submission after interim. Withhold; log. The fact of the October 2002 submission is not privileged and is in the EPA docket." },
    tags: ["privilege-review"],
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

Martin —

I have read the interim. My advice is that we file. The adenoma finding, the rising serum at every dose, and the MW-7 plume are, taken together, information that reasonably supports a substantial-risk conclusion, and the "corroborative" argument is no longer available to us. The fact that EPA already has the 90-day summary from our June 2001 voluntary submission helps on penalties, not on the obligation.

Please prepare an 8(e) notice covering (a) the 12-month interim, (b) the serum data from both studies, and (c) the groundwater results at MW-7 and MW-8, for submission by 11 October (30 days from receipt of the interim). Use the "does not constitute an admission" language. Attach the interim summary, not the full report.

Alan will need to be told today. I will do it. Do not send him the interim by email; give him the paper copy.

Separately, and for your file: I want a memorandum from you, privileged, reviewing whether the March 2001 analysis should have come out differently in light of what we knew by December 2001 (the MW-7 detection and the cholesterol finding). I would rather know the answer now than learn it from a subpoena.

Rob`,
  },

  // ------------------------------------------------------------------
  // Navy / MilSpec correspondence
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0068",
    date: "2002-10-03",
    time: "09:20",
    custodian: "pryce",
    type: "Email",
    subject: "MIL-F-24385F qualification — questions on environmental and toxicological profile of Aqua-Guard 3",
    from: "Cmdr. Dale Whitcomb",
    to: ["Alan Pryce"],
    cc: ["Nadia Brooks"],
    threadId: T_MIL,
    aiScore: 85,
    aiIssues: ["GOV-01", "MKT-01"],
    coding: { responsive: true, privileged: false, issues: ["GOV-01", "MKT-01"], reviewerId: R.lopez, reviewedAt: "2026-09-12T11:00:00Z" },
    body: `Mr. Pryce,

NAVSEA has received EPA's request for information regarding PFOS-based AFFF products on the Qualified Products List, and the Fire Fighting Foam Coalition's letter of 20 September. In connection with the QPL review, I am directed to ask each qualified supplier the following:

1. Does the fluorosurfactant in your qualified product contain perfluorooctane sulfonate or substances that degrade to it?
2. What toxicological studies has your company conducted or sponsored on the fluorosurfactant since 1998, and will you provide them to NAVSEA?
3. Has your company made any submissions to EPA under TSCA section 8(e) with respect to the fluorosurfactant?
4. What is your company's plan for continued supply of a MIL-F-24385F-qualified product if PFOS-based surfactants become unavailable?

Your qualification package of 15 June 2001 described the fluorosurfactant as "low toxicity" and stated that the product "presents no unusual environmental hazard when used as directed." Please confirm that these statements remain accurate.

Responses are requested within 30 days.

Respectfully,
D. R. Whitcomb, CDR, USN
NAVSEA 05P4 — Fire Protection Systems`,
  },
  {
    id: "ed_afff_0069",
    date: "2002-10-07",
    time: "14:50",
    custodian: "pryce",
    type: "Email",
    subject: "RE: MIL-F-24385F qualification — questions on environmental and toxicological profile of Aqua-Guard 3",
    to: ["Cmdr. Dale Whitcomb"],
    cc: ["Nadia Brooks", "Martin Suarez"],
    threadId: T_MIL,
    aiScore: 93,
    aiIssues: ["GOV-01", "MKT-01", "REG-01"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "confidential", issues: ["GOV-01", "MKT-01", "REG-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-12T11:15:00Z", notes: "Government contractor defense — Boyle third prong. Pryce's answer to Q2 omits the 12-month interim received 9/12/2002 and describes the 8(e) as 'may make.' Key document for both sides." },
    tags: ["key-doc", "exhibit-candidate"],
    body: `Commander Whitcomb,

Thank you for your message. Meridian's responses:

1. Yes. The fluorosurfactant in Aqua-Guard 3% and 6% is a perfluorooctane sulfonate salt (MF-3).

2. Meridian sponsored a 90-day oral toxicity study in rats (2000–2001), which identified the liver as the target organ with a no-observed-adverse-effect level of 0.1 mg/kg/day, and has a two-year study in progress. Meridian provided a summary of the 90-day study to EPA in June 2001 and will provide a copy to NAVSEA under our standard confidentiality terms.

3. Meridian has not filed a section 8(e) notice to date. Meridian keeps its reporting obligations under continuous review and may make a submission in connection with data from the two-year study.

4. Meridian has an active development program for a shorter-chain fluorosurfactant and expects to have a candidate formulation available for MilSpec qualification testing in 2004. Meridian will maintain supply of Aqua-Guard 3% and 6% for the term of the current NAVSUP contract.

With respect to the qualification package: the statements referred to were accurate when made on the basis of the data then available. Meridian's product literature and MSDS were revised in August 2001 to reflect the 90-day study; the current MSDS (rev. G) is attached. Meridian recommends that AFFF solution not be discharged to the environment and that training runoff be contained.

We would welcome the opportunity to brief NAVSEA in person.

Respectfully,
Alan Pryce
Vice President, Fire Suppression Products`,
  },

  // ------------------------------------------------------------------
  // 2003–2012: stewardship, EPA request, later results, litigation hold
  // ------------------------------------------------------------------
  {
    id: "ed_afff_0070",
    pages: 3,
    date: "2003-02-11",
    custodian: "brooks",
    type: "Memo",
    subject: "Product stewardship review — C8 chemistry alternatives and Aqua-Guard reformulation options",
    from: "Nadia Brooks",
    to: ["Alan Pryce", "Paul Merrick"],
    cc: ["Helen Voss"],
    aiScore: 76,
    aiIssues: ["PRD-01"],
    coding: { responsive: true, privileged: false, issues: ["PRD-01"], reviewerId: R.lopez, reviewedAt: "2026-09-12T11:30:00Z" },
    body: `MERIDIAN FLUOROCHEM — PRODUCT STEWARDSHIP
MEMORANDUM
To: A. Pryce; P. Merrick — Cc: H. Voss
From: N. Brooks
Date: 11 February 2003
Re: C8 chemistry alternatives — status of the C6 program and reformulation options

1. Context. EPA finalised the PFOS SNUR (67 Fed. Reg. 72854, 9 Dec 2002) with the AFFF exclusion. Meridian filed a TSCA 8(e) notice on 10 October 2002 (8EHQ-02-15201). NAVSEA has asked all QPL suppliers for transition plans. Three of our top-ten industrial accounts have asked for a "PFOS-free" timeline. The C6 program approved by the Board in June 2001 is 20 months in.

2. C6 program status. Two candidate fluorotelomer-based surfactants (MF-6A, MF-6B) have passed the bench film-forming screen. MF-6A meets MIL-F-24385F extinguishment and burnback in the 28 ft² pan test at 3%; MF-6B fails burnback. Neither has been tested for toxicity or kinetics beyond an acute oral screen. Following Helen's insistence, the first repeated-dose study of MF-6A will include serum kinetics (protocol in preparation, Whitfield, Q2 2003).

\f3. Reformulation options.
 (a) Full transition to MF-6A: 24–30 months to QPL listing, assuming no toxicology surprises. Cost to complete: $3.4M (over the $2.1M approved).
 (b) Interim "reduced-PFOS" blend (MF-3 at 60% of current loading plus hydrocarbon surfactant boost): passes 3% MilSpec at bench; would allow marketing of "reduced fluorosurfactant content" in 2003. Does not solve the persistence problem; Product Safety objects to marketing it as an environmental improvement.
 (c) Continue MF-3 and communicate transition timeline only.

4. Stewardship recommendation. (a), with a clear customer communication now that Meridian is transitioning and a target date. Do not pursue (b) as a marketing claim. Note: fluorotelomer surfactants degrade to perfluorohexanoic acid (PFHxA); EPA has begun asking questions about telomer chemistry as well (the "PFOA stewardship" discussions). We should not describe MF-6A as "non-persistent" without data.

\f5. Customer communication. Draft letter to customers of record attached for review, stating: PFOS content; transition program; recommended handling and disposal. Law Department review requested.

N. Brooks`,
  },
  {
    id: "ed_afff_0071",
    pages: 4,
    date: "2003-05-20",
    custodian: "suarez",
    type: "Memo",
    subject: "Regulatory affairs memo — EPA OPPT information request (TSCA section 8(d) and voluntary) on PFOS/PFOA — response plan",
    from: "Martin Suarez",
    to: ["Alan Pryce", "Paul Merrick", "Gregory Hale", "Helen Voss"],
    cc: ["Robert Kaine"],
    aiScore: 84,
    aiIssues: ["REG-02", "REG-01"],
    coding: { responsive: true, privileged: false, issues: ["REG-02", "REG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-12T11:45:00Z", notes: "Regulatory status memo; produce. Kaine cc only." },
    body: `MERIDIAN FLUOROCHEM — REGULATORY AFFAIRS
MEMORANDUM
To: A. Pryce; P. Merrick; G. Hale; H. Voss — Cc: R. Kaine
From: M. Suarez
Date: 20 May 2003
Re: EPA information requests on perfluorinated chemicals — status and response plan

1. Requests received.
 (a) EPA letter of 28 April 2003 (M. Feld, OPPT) requesting, under TSCA section 8(d) preliminary assessment and on a voluntary basis, copies of all unpublished health and safety studies on PFOS, PFOA and related compounds in Meridian's possession, and any environmental monitoring data.
 (b) EPA follow-up of 12 May asking for the 18-month serum data from WL-2001-0512 "when available."
 (c) Illinois EPA letter of 30 April requesting the complete Decatur groundwater monitoring record since 1997 and Beacon's closure plan for Lagoon 2.

\f2. What EPA already has. June 2001 voluntary submission (1993 study; acute package; Whitfield 90-day summary). October 2002 8(e) notice (8EHQ-02-15201): 12-month interim summary, serum data from both studies, MW-7/MW-8 results through June 2002. EPA acknowledged the 8(e) on 4 November 2002 and requested the full 90-day report, which was provided 22 November.

3. Response plan.
 (a) 8(d)/voluntary: provide the full 90-day report (already provided), the 12-month interim (full report, not only summary), the 18-month serum data when received (August 2003), the Castellano medical surveillance analysis (de-identified), and all Beacon groundwater reports. Withhold: internal legal memoranda; drafts; the March 2001 Law Department analysis. Log any withheld items.
 (b) Illinois EPA: provide the monitoring record and the closure plan (Beacon, 30 Sept 2002, closure under way). Note the city wellfield sampling (Nov 2002, Jan 2003, Apr 2003: all non-detect at 0.05 µg/L).
 (c) Coordinate the response through the Fire Fighting Foam Coalition where the request overlaps industry-wide issues; Meridian's data are Meridian's to produce.

\f4. Risks. EPA's enforcement office has, in the 3M matter, examined the timing of 8(e) submissions relative to receipt of the underlying studies. The interval between Meridian's receipt of the 90-day report (March 2001) and its 8(e) notice (October 2002) will be visible from the documents produced. The Law Department's position is that the March 2001 analysis was made in good faith on advice of counsel and that the June 2001 voluntary submission put the study before EPA in any event. Management should be aware that a penalty proceeding is possible.

5. Actions. Suarez: 8(d) response by 30 May; Illinois EPA by 6 June. Voss: assemble study reports. Hale: assemble monitoring record. Kaine: privilege review of the production.

\fAttachment: index of documents to be produced (draft).

M. Suarez`,
  },
  {
    id: "ed_afff_0072",
    date: "2004-01-14",
    time: "11:12",
    custodian: "hale",
    type: "Email",
    subject: "Decatur groundwater — 2003 annual results (MW-7, MW-8, MW-9, MW-10) and Lagoon 2 closure status",
    to: ["Paul Merrick", "Martin Suarez"],
    cc: ["Alan Pryce"],
    aiScore: 78,
    aiIssues: ["ENV-01"],
    coding: { responsive: null, privileged: null, issues: [] },
    body: `Paul, Martin —

2003 annual summary from Beacon:

- MW-7: 33 µg/L (Dec 2003), down from a peak of 44 in Sept 2002. Source removal (Lagoon 2 unlined section excavated and closed Aug 2003, 6,200 tons to Clinton landfill under a special waste profile) appears to be working.
- MW-8 (property line): 9.4 µg/L, still rising slowly.
- MW-9 and MW-10 (off-site, Kessler easement, installed Feb 2003): 3.1 and 0.8 µg/L.
- Kessler domestic well (deep, 110 ft): non-detect.
- City Wells 9–12: non-detect at 0.05 µg/L in all five rounds.

Illinois EPA accepted the closure report in December. They have asked for quarterly monitoring to continue for five years and for a contingency plan if MW-10 exceeds 5 µg/L. I have told Beacon to draft one.

The plume is what it is; it will be in the shallow aquifer for decades. But it is not reaching the city, and we can say that with data.

Greg`,
  },
  {
    id: "ed_afff_0073",
    date: "2005-03-02",
    time: "09:40",
    custodian: "voss",
    type: "Email",
    subject: "Two-year bioassay — final report received — summary of findings",
    to: ["Martin Suarez", "Gregory Hale", "Nadia Brooks", "Robert Kaine"],
    cc: ["Alan Pryce"],
    attachmentIds: ["ed_afff_0074"],
    aiScore: 90,
    aiIssues: ["TOX-02", "REG-01"],
    coding: { responsive: true, privileged: false, hot: true, issues: ["TOX-02", "REG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-12T12:10:00Z" },
    body: `All —

Final report on WL-2001-0512 received. Summary attached. Headlines:

- Hepatocellular adenomas: males 2/50, 3/50, 6/50, 14/50 (p<0.01 at 1.5 mg/kg-day; positive trend). Females 1/50, 1/50, 4/50, 9/50 (p<0.05 at high dose).
- Hepatocellular carcinomas: males 0, 0, 1, 3. Not significant individually; combined adenoma/carcinoma significant.
- Thyroid follicular adenomas: males 1/50, 0/50, 2/50, 5/50 (marginal).
- NOAEL: 0.03 mg/kg-day. Serum at that dose after 24 months: 4.1 µg/mL.

This is a positive rodent carcinogenicity study. Whitfield's report says so plainly. Martin — the 8(e) supplement is due 30 days from today; I assume you will want to file the summary. Nadia — the customer letter needs to be updated; "no chronic data" is no longer true and we should not wait for a customer to ask.

Helen`,
  },
  {
    id: "ed_afff_0074",
    pages: 3,
    date: "2005-02-28",
    custodian: "voss",
    type: "Report",
    subject: "Whitfield WL-2001-0512 — two-year chronic bioassay of MF-3 in rats — final report summary",
    from: "Dr. Linda Whitfield",
    parentId: "ed_afff_0073",
    aiScore: 94,
    aiIssues: ["TOX-02", "TOX-01"],
    coding: { responsive: true, privileged: false, hot: true, confidentiality: "highly confidential", issues: ["TOX-02"], reviewerId: R.whitfield, reviewedAt: "2026-09-12T12:20:00Z" },
    tags: ["exhibit-candidate"],
    body: `WHITFIELD LABORATORIES, INC. — FINAL REPORT SUMMARY — Study WL-2001-0512
A Two-Year Dietary Chronic Toxicity and Carcinogenicity Study of MF-3 Fluorosurfactant Concentrate in Sprague-Dawley Rats
Report date: 28 February 2005 — Study Director: L. Whitfield — Pathologist: Y. Bello — Peer review pathologist: R. Okonkwo (Experimental Pathology Laboratories)

1. SURVIVAL (104 weeks). Males: 52%, 54%, 50%, 44%. Females: 58%, 60%, 56%, 50%. No treatment-related effect on survival.

2. SERUM PFOS (µg/mL, 24 months): 0.03 group 4.1; 0.3 group 39.6; 1.5 group 131.8. Steady state was approached between 18 and 24 months at the low and mid dose.

\f3. NEOPLASTIC FINDINGS (incidence in 50/sex/group)
LIVER
  Hepatocellular adenoma: M 2, 3, 6, 14**; F 1, 1, 4, 9*
  Hepatocellular carcinoma: M 0, 0, 1, 3; F 0, 0, 0, 1
  Adenoma or carcinoma combined: M 2, 3, 7, 16**; F 1, 1, 4, 10*
THYROID
  Follicular cell adenoma: M 1, 0, 2, 5; F 0, 1, 1, 3
  Follicular cell carcinoma: M 0, 0, 0, 1
PANCREAS
  Acinar cell adenoma: M 0, 1, 1, 4
* p<0.05 ** p<0.01 (Fisher exact vs. concurrent control); trend tests (Cochran-Armitage) significant (p<0.01) for liver adenoma and combined liver tumours in both sexes.
Historical control (Whitfield, 24-month SD males, 1995–2004, 12 studies): hepatocellular adenoma 0–8%, mean 3.2%.

4. NON-NEOPLASTIC FINDINGS. Hepatocellular hypertrophy, eosinophilic and basophilic foci, and vacuolation at 0.3 and 1.5 mg/kg-day; thyroid follicular hypertrophy at 1.5; pancreatic acinar hyperplasia at 1.5.

\f5. CONCLUSIONS. Under the conditions of this study, MF-3 was carcinogenic to the liver of male and female Sprague-Dawley rats at 1.5 mg/kg-day and produced an increased incidence of hepatocellular adenomas in males at 0.3 mg/kg-day. Thyroid and pancreatic tumour findings are equivocal. The NOAEL for non-neoplastic effects is 0.03 mg/kg-day. Serum concentrations indicate substantial bioaccumulation with an elimination half-life in the rat of approximately 100 days. The mode of action for the liver tumours is likely to involve PPARα activation, but the sponsor has not commissioned mechanistic studies and the relevance of the findings to humans cannot be dismissed on the present data.

L. Whitfield, Ph.D., DABT`,
  },
  {
    id: "ed_afff_0075",
    date: "2006-06-19",
    time: "16:00",
    custodian: "pryce",
    type: "Email",
    subject: "Product line — Aqua-Guard C6 transition timeline and PFOS inventory run-out",
    to: ["Paul Merrick", "Nadia Brooks", "Karen Liu"],
    cc: ["Martin Suarez"],
    aiScore: 74,
    aiIssues: ["PRD-01", "MKT-01"],
    coding: { responsive: null, privileged: null, issues: [] },
    body: `All —

Decisions from the product review:

1. Aqua-Guard C6 (MF-6A) passed MilSpec qualification testing at NRL in April. QPL listing expected Q4 2006. We will launch to municipal and industrial accounts in Q1 2007.
2. MF-3 production at Decatur ends 31 December 2006. Remaining inventory (approx. 380,000 gal concentrate equivalent) will be sold through 2008 to existing contract customers only. No new MF-3 accounts from today.
3. Customer letter (Nadia's draft of 2 June) approved with Martin's edits. It goes to all customers of record by 15 July. It will say what MF-3 is, that we are replacing it, and what to do with existing stock. It will not say "safe."
4. Karen — the C6 launch literature says "PFOS-free." It does not say "PFAS-free," "non-persistent," or "environmentally friendly." Nadia signs off on every page.

The C6 transition cost us five years and about $6M. It was the right call in 2001 and it is the right call now.

Alan`,
  },
  {
    id: "ed_afff_0076",
    date: "2008-09-30",
    time: "10:25",
    custodian: "suarez",
    type: "Email",
    subject: "EPA 2010/2015 PFOA Stewardship Program — Meridian participation and C6 telomer data",
    to: ["Alan Pryce", "Nadia Brooks", "Helen Voss"],
    cc: ["Robert Kaine"],
    aiScore: 66,
    aiIssues: ["REG-02", "PRD-01"],
    coding: { responsive: null, privileged: null, issues: [] },
    body: `All —

EPA has invited Meridian to join the 2010/2015 PFOA Stewardship Program as a fluorotelomer producer, following our MF-6A launch. Participation means annual reporting of PFOA and long-chain precursor content in our products and a commitment to a 95% reduction by 2010 and elimination by 2015. MF-6A is a C6 telomer and our analytical work (Helen, May 2008) shows PFOA and C8 precursor content below 50 ppm, so we are effectively already compliant.

I recommend we join. It is the clearest signal we can send to customers and to EPA that the company has moved on from C8 chemistry. Rob agrees.

One caution from Helen that I want on the record: the 90-day study of MF-6A (Whitfield, 2004) showed serum PFHxA at steady state within 30 days and rapid elimination — very different from MF-3 — but the fluorotelomer alcohols in the raw material do degrade to PFHxA in the environment. "PFOS-free" is true. "Non-persistent" is not something we can say about the degradation products.

Martin`,
  },
  {
    id: "ed_afff_0077",
    date: "2010-02-16",
    time: "09:10",
    custodian: "brooks",
    type: "Email",
    subject: "Customer letter — PFOS content disclosure and disposal of legacy Aqua-Guard 3/6 stock",
    to: ["Karen Liu", "Alan Pryce"],
    cc: ["Martin Suarez", "Gregory Hale"],
    attachmentIds: ["ed_afff_0078"],
    aiScore: 72,
    aiIssues: ["CUS-01", "PRD-01"],
    coding: { responsive: true, privileged: false, issues: ["CUS-01", "PRD-01"], reviewerId: R.lopez, reviewedAt: "2026-09-12T12:40:00Z" },
    body: `Karen, Alan —

Final version of the legacy-stock customer letter attached (Martin has reviewed). It goes to every account that purchased Aqua-Guard 3 or 6 between 1994 and 2008 — 812 addresses — plus the state fire marshals in the 14 states where we have municipal accounts.

Three departments (Macon County, Savannah, Charleston) have already asked us to take back stock. I have approved take-back at our cost for municipal accounts under 500 gallons; Clean Harbors incineration at Aragonite. Industrial accounts pay their own disposal.

Nadia`,
  },
  {
    id: "ed_afff_0078",
    pages: 2,
    date: "2010-02-16",
    custodian: "brooks",
    type: "Letter",
    subject: "Letter to Aqua-Guard customers of record — product composition, PFOS content and disposal of legacy AFFF stock",
    from: "Nadia Brooks",
    parentId: "ed_afff_0077",
    aiScore: 75,
    aiIssues: ["CUS-01", "PRD-01"],
    coding: { responsive: true, privileged: false, issues: ["CUS-01"], reviewerId: R.lopez, reviewedAt: "2026-09-12T12:42:00Z" },
    body: `MERIDIAN FLUOROCHEM CORP.
1800 Industrial Parkway, Decatur, Illinois 62526

February 16, 2010

To: Customers of record for Aqua-Guard 3% and Aqua-Guard 6% AFFF concentrates (1994–2008)

Re: Product composition, PFOS content and recommended handling of legacy stock

Dear Customer:

Meridian Fluorochem manufactured Aqua-Guard 3% and 6% aqueous film-forming foam concentrates from 1989 through December 2006 using a fluorosurfactant based on perfluorooctane sulfonate (PFOS). Meridian ceased production of PFOS-based concentrates at the end of 2006 and sold remaining inventory through 2008. Since 2007 Meridian's AFFF products (Aqua-Guard C6 series) have been manufactured with a short-chain fluorotelomer surfactant and do not contain PFOS.

PFOS is persistent in the environment, accumulates in humans and animals, and has been shown to cause liver effects and liver tumours in laboratory rats in studies sponsored by Meridian and others. In 2009 PFOS was listed under Annex B of the Stockholm Convention on Persistent Organic Pollutants. The U.S. EPA has issued provisional health advisories for PFOS and PFOA in drinking water (0.2 and 0.4 micrograms per litre respectively).

\fMeridian recommends the following with respect to any Aqua-Guard 3% or 6% concentrate still in your inventory:
1. Do not use PFOS-based concentrate for training, testing or demonstration. Reserve it for emergency use only, or replace it.
2. Do not discharge foam solution to the environment. Contain and collect all discharges for disposal by high-temperature incineration through a licensed hazardous waste contractor.
3. Municipal fire departments holding fewer than 500 gallons may return concentrate to Meridian for disposal at Meridian's expense. Contact Product Stewardship at (217) 555-0160.
4. Facilities where PFOS-based foam has been used repeatedly (training grounds, fixed-system test areas) may wish to evaluate soil and groundwater. Meridian can provide a list of laboratories capable of PFOS analysis.

Meridian regrets any inconvenience and remains committed to supporting its customers through this transition.

Sincerely,

Nadia Brooks
Director, Product Stewardship`,
  },
  {
    id: "ed_afff_0079",
    date: "2011-08-23",
    time: "14:15",
    custodian: "hale",
    type: "Email",
    subject: "Decatur — MW-7, MW-8, MW-10 2011 sampling; IEPA five-year monitoring term ends; Kessler easement renewal",
    to: ["Martin Suarez", "Paul Merrick"],
    aiScore: 62,
    aiIssues: ["ENV-01"],
    coding: { responsive: null, privileged: null, issues: [] },
    body: `Martin, Paul —

2011 mid-year: MW-7 at 18 µg/L (down from 44 peak); MW-8 at 7.2; MW-10 (off-site) at 2.6 and roughly flat since 2008. City wells still non-detect (now at 0.01 µg/L reporting limit with the new method). Beacon's model has the plume stable — source removed, slow dilution, no further off-site advance.

IEPA's five-year term ends December 2011. I propose we ask to continue semi-annual monitoring voluntarily rather than have them impose it, and renew the Kessler easement for another five years. With EPA's PFOS advisory now at 0.2 µg/L and the Sangamon River discussion starting up, I would rather have current data than not.

Greg`,
  },
  {
    id: "ed_afff_0080",
    date: "2012-04-11",
    time: "17:05",
    custodian: "kaine",
    type: "Email",
    subject: "LITIGATION HOLD — AFFF / PFOS claims (privileged)",
    to: ["Alan Pryce", "Gregory Hale", "Helen Voss", "Nadia Brooks", "Martin Suarez", "Paul Merrick", "Frank Oduya"],
    aiScore: 58,
    aiIssues: ["LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-12T13:00:00Z", notes: "Litigation hold notice. Privileged per majority rule; log. Existence of hold not privileged." },
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

To all recipients:

Meridian Fluorochem has received notice of claims, and reasonably anticipates litigation, relating to the manufacture, sale and environmental release of PFOS-based aqueous film-forming foam products and the MF-3 fluorosurfactant. This notice requires you to preserve all documents and electronically stored information in your possession, custody or control that relate in any way to:

- MF-3 fluorosurfactant and Aqua-Guard 3%, 6% and AR concentrates (1989–2008): formulation, manufacture, testing, marketing, sales, regulatory submissions and customer communications;
- Toxicology, epidemiology and medical surveillance relating to PFOS, PFOA or other perfluorinated substances, including all Whitfield Laboratories studies;
- Environmental monitoring, releases and remediation at the Decatur facility, including Lagoon 2 and the monitoring well network;
- Communications with EPA, Illinois EPA, NAVSEA, customers and trade associations regarding the foregoing.

"Documents" includes email, instant messages, calendar entries, voicemail, drafts, notebooks, spreadsheets and data on any device or account, including personal accounts used for company business. Do not delete, alter or discard any such material. Routine deletion under the email retention schedule is suspended for your mailboxes effective today. IT has been instructed to preserve backup media and to export instant-message logs.

Direct any questions to me. Do not discuss the substance of the anticipated claims with anyone outside the Law Department. Please acknowledge receipt by reply.

Robert Kaine
Associate General Counsel`,
  },
  {
    id: "ed_afff_0081",
    pages: 3,
    date: "2012-11-29",
    custodian: "suarez",
    type: "Memo",
    subject: "Privileged & Confidential — Retrospective review of the March 2001 TSCA 8(e) decision (prepared at the request of counsel)",
    from: "Martin Suarez",
    to: ["Robert Kaine"],
    aiScore: 93,
    aiIssues: ["REG-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "work-product", hot: true, confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.whitfield, reviewedAt: "2026-09-12T13:20:00Z", notes: "Work product prepared in anticipation of litigation (post-hold). Withhold in full. Partner review: crime-fraud exposure is on the 2001 memo, not this one, but this memo characterises it." },
    tags: ["privilege-review"],
    body: `PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT — PREPARED IN ANTICIPATION OF LITIGATION AT THE REQUEST OF R. KAINE

MEMORANDUM
To: R. Kaine — From: M. Suarez — Date: 29 November 2012
Re: Retrospective review of the March 2001 decision not to file a TSCA § 8(e) notice on Whitfield Study WL-2000-0417

1. Purpose. You asked (September 2002, renewed April 2012) for an assessment of whether the March 2001 analysis was sound on the information available at the time and whether it should have been revisited earlier than October 2002. This memorandum is for use by counsel in evaluating the company's position in the anticipated AFFF litigation.

2. Information available in March 2001. The 90-day study (liver NOAEL 0.1 mg/kg-day; serum half-life ~100 days in rat); the 1993 Hazelton study; the 1997 TOF groundwater screen; published literature on PFOS/PFOA persistence in human serum (3M workers); Dr. Whitfield's transmittal letter recommending consideration of reporting; EPA's 1978 policy statement; and the fact of 3M's May 2000 announcement and its publicly filed 8(e) notices.

\f3. Assessment of the March 2001 analysis. The analysis correctly identified the hepatic findings as corroborative. The treatment of the bioaccumulation finding as "preliminary" was a defensible reading of the policy statement but was, in my view, at the aggressive end of the range, for two reasons I did not give sufficient weight: (a) the publicly available 3M data on PFOS in human serum made it unreasonable to treat rat persistence as an isolated observation; and (b) the policy statement's "pronounced bioaccumulation" language was directed at exactly this combination — a persistent substance with target-organ toxicity — and did not require that the toxicity be severe.

4. Events between March 2001 and October 2002 that should have prompted an earlier revisit. (a) June 2001: Castellano's finding of 9% lower cholesterol in the blending crew — a human finding on the endpoint identified in the rat. (b) September 2001: the MW-7 detection at 12 µg/L — evidence of environmental release and persistence. (c) February 2002: the 3-month serum data confirming continued accumulation. In my judgment the combination of (a) and (b), available by November 2001, met the standard. The revisit occurred eleven months later.

\f5. Mitigating considerations. The June 2001 voluntary submission of the 90-day summary to OPPT placed the core study before EPA fifteen months before the 8(e). The company commissioned and conducted the chronic study and the groundwater investigation without delay. The 8(e) was filed within 30 days of the interim report. EPA has not initiated an enforcement action, and the 2003 8(d) response was complete.

6. Documents of concern. The Pryce email of 19 March 2001 (commercial consequences); the Pryce email of 11 April 2001 (reducing the bioassay design); the Hale memorandum of 19 March 2001 ("no adverse findings") as compared with its draft; the Pryce email of 9 July 2002 ("do not put this in email"); the Pryce response to NAVSEA of 7 October 2002 (omitting the interim report received 12 September). None of these is privileged. Counsel should assume each will be produced.

7. Recommendation. The company's position should be that the 2001 decision was made in good faith on advice of counsel, was accompanied by an active investigation, and was corrected when the investigation produced results. I would not recommend asserting that the 2001 decision was correct.

M. Suarez`,
  },

  // ------------------------------------------------------------------
  // MFC-0043105 / 0043211 — 2017 documents relied on by the chronology workflow
  // ------------------------------------------------------------------
  {
    id: "ed_afff_43105",
    batesAt: 43105,
    date: "2017-10-11",
    time: "08:55",
    custodian: "hale",
    type: "Email",
    subject: "Q3 EHS report — distribution",
    to: ["Alan Pryce", "Nadia Brooks"],
    cc: ["Helen Voss"],
    aiScore: 71,
    aiIssues: ["ENV-01"],
    coding: { responsive: null, privileged: null, issues: [] },
    body: `Alan, Nadia —

Attaching the Q3 2017 EHS report. Note the groundwater monitoring section references the July and August interim reports on the MW-7 resampling; those went to Paul and Martin separately in August. MW-7 came back at 9.8 µg/L in the July round and 11.2 in August — the first increase since 2004. Beacon attributes it to the wet spring raising the water table into the residual source zone under the old Lagoon 2 footprint. They are recommending a fourth quarterly round and a review of the 2003 closure cap.

With EPA's 2016 lifetime health advisory now at 0.07 µg/L for PFOS+PFOA combined, "no standard" is no longer an answer we can give the city. I have asked Beacon to resample Wells 9–12 with the low-level method.

Greg`,
  },
  {
    id: "ed_afff_43211",
    batesAt: 43211,
    pages: 5,
    date: "2017-11-02",
    custodian: "voss",
    type: "Memo",
    subject: "Benchmark-dose analysis — hepatic endpoints (draft 2)",
    from: "Helen Voss",
    to: ["Martin Suarez", "Robert Kaine"],
    aiScore: 82,
    aiIssues: ["TOX-01", "TOX-02"],
    coding: { responsive: true, privileged: null, issues: ["TOX-01", "TOX-02"], notes: "Prepared at counsel's request (see header) — but is it a scientific analysis or legal work product? Draft 2. Hold for privilege review; likely produce with the header redacted if not at direction of counsel." },
    body: `MERIDIAN FLUOROCHEM — PRODUCT SAFETY
DRAFT 2 — 2 November 2017 — Prepared at the request of the Law Department in connection with EPA's 2016 health advisory and anticipated litigation
Benchmark-dose analysis of hepatic endpoints in Whitfield Studies WL-2000-0417 (90-day) and WL-2001-0512 (two-year)
H. Voss

1. Purpose. To derive benchmark doses (BMD) and lower confidence limits (BMDL) for hepatic endpoints from Meridian's rat studies of MF-3, using current EPA BMDS 2.7 software, and to compare with the points of departure used by EPA in the 2016 Health Effects Support Document for PFOS.

2. Data. This draft updates the BMD analysis using the 2001 90-day hepatic data and the two-year study interim (12-month) and terminal (24-month) data, and incorporates the Q3 2017 serum-to-dose relationships for internal-dose modelling.

\f3. Endpoints and models. Dichotomous: hepatocellular hypertrophy (incidence); hepatocellular adenoma (incidence, 24 months). Continuous: relative liver weight; serum total cholesterol. Models: log-logistic, Weibull, multistage (dichotomous); Hill, exponential (continuous). BMR: 10% extra risk (dichotomous); 1 SD (continuous).

4. Results (external dose, mg/kg-day)
   Endpoint                             Study      BMD10/1SD   BMDL10/1SD   Best model
   Hepatocellular hypertrophy (M)      90-day       0.68        0.39        Weibull
   Hepatocellular hypertrophy (M)      2-yr 12 mo   0.21        0.11        log-logistic
   Relative liver weight (M)           2-yr 24 mo   0.24        0.14        Hill
   Serum cholesterol (M)               2-yr 24 mo   0.12        0.07        exponential
   Hepatocellular adenoma (M)          2-yr 24 mo   0.46        0.27        multistage

\f5. Internal dose. Using the serum/dose ratio at steady state (approx. 30 µg/mL per mg/kg-day in the two-year study), the cholesterol BMDL of 0.07 mg/kg-day corresponds to a serum PFOS concentration of approximately 2.1 µg/mL (2,100 ng/mL). EPA's 2016 point of departure for PFOS (from a rat developmental study by another sponsor) corresponds to a serum concentration of approximately 6.3 µg/mL; Meridian's own cholesterol endpoint is therefore roughly three-fold more sensitive than the endpoint EPA used.

6. Comment. The 2001 NOAEL of 0.1 mg/kg-day was not unreasonable as a NOAEL. The two-year data, and BMD modelling that was available in 2001 in cruder form (see my March 2001 QA review, which reported a BMDL10 of 0.39 for hypertrophy), lower the point of departure by a factor of 3–5. The cholesterol endpoint, which was observed in the 90-day study and in the Decatur blending crew in 2001, is the most sensitive endpoint in either study.

\f7. Limitations. Draft. Model averaging not yet performed. Female data not yet modelled. Cholesterol endpoint modelled as continuous with 1 SD BMR; EPA may prefer a different BMR.

Appendix A: BMDS output files (attached electronically). Appendix B: Q3 2017 serum data summary.`,
  },

  // ------------------------------------------------------------------
  // MFC-0043877 … 0043951 — Kaine 2016 privileged series (privilege-log workflow)
  // ------------------------------------------------------------------
  {
    id: "ed_afff_kaine_0001",
    batesAt: 43877,
    date: "2016-08-19",
    time: "11:20",
    custodian: "kaine",
    type: "Email",
    subject: "RE: 8(e) — recommendation for the Tuesday call",
    to: ["Martin Suarez"],
    threadId: T_8E_2016,
    aiScore: 88,
    aiIssues: ["REG-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-13T10:00:00Z" },
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

Martin — per our discussion, my recommendation on the substantial-risk question is set out below. Please treat this as privileged and do not forward to the product team.

The question is whether the MW-7 increase reported in July and August, read with EPA's May 2016 lifetime health advisory of 0.07 µg/L, is new information reasonably supporting a substantial-risk conclusion that requires a supplemental 8(e). My view is no: the plume, its source and its persistence were all reported to EPA in 2002 and 2003; the advisory is EPA's own information, not ours; and the concentrations are within the range already reported. What has changed is the standard, not the facts.

That said, I want the city wells resampled before Tuesday and I want a voluntary update letter to OPPT and Illinois EPA ready to go if anything is detected. Being right on the legal question is not much use if the city finds it first.

Rob`,
  },
  {
    id: "ed_afff_kaine_0002",
    batesAt: 43881,
    date: "2016-08-22",
    time: "09:47",
    custodian: "kaine",
    type: "Email",
    subject: "FW: Voss August summary — legal review",
    from: "Martin Suarez",
    to: ["Robert Kaine"],
    cc: ["Gregory Hale"],
    threadId: T_8E_2016,
    aiScore: 84,
    aiIssues: ["REG-01", "LEG-01", "TOX-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-13T10:05:00Z" },
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

Rob, attaching Helen's summary. I need your read on whether the hepatic findings change the analysis we discussed. Her August summary re-analyses the 2005 two-year data against EPA's 2016 support document and concludes that our cholesterol endpoint is more sensitive than the endpoint EPA used. That is an analysis of data EPA has had since 2003, so I do not think it is "new information" for 8(e) purposes, but it is the kind of analysis that plaintiffs will say we should have done in 2001.

Greg is copied because he has the MW-7 data and because I want one thread, not three.

Martin

-----Original Message-----
From: Helen Voss
Sent: Friday, August 19, 2016 4:12 PM
To: Martin Suarez
Subject: August summary — hepatic endpoints vs EPA 2016 HESD

Martin — summary attached as requested. Short version: using EPA's own methods on our own studies, the point of departure is about three times lower than EPA's. I have not modelled the female data. Draft; not for distribution.
Helen`,
  },
  {
    id: "ed_afff_kaine_0003",
    batesAt: 43902,
    pages: 6,
    date: "2016-09-06",
    custodian: "kaine",
    type: "Memo",
    subject: "Privileged & Confidential — TSCA § 8(e) analysis (draft) — 2016 MW-7 results and Voss hepatic re-analysis",
    from: "Robert Kaine",
    to: ["Martin Suarez"],
    aiScore: 90,
    aiIssues: ["REG-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "work-product", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-13T10:15:00Z" },
    body: `DRAFT — ATTORNEY WORK PRODUCT — PRIVILEGED AND CONFIDENTIAL
MEMORANDUM — To: M. Suarez — From: R. Kaine — Date: 6 September 2016
Re: Whether the information described in the August 2016 EHS memorandum triggers a supplemental TSCA § 8(e) reporting obligation

This memorandum analyzes whether the information described in the August 2016 EHS memorandum (MW-7 resampling results of July and August 2016; Beacon's attribution to water-table rise into the residual source zone) and in Product Safety's August 2016 hepatic re-analysis triggers a reporting obligation under TSCA section 8(e), as construed by EPA's 2003 revised policy statement (68 Fed. Reg. 33129) and the 2006 TSCA Section 8(e) Reporting Guide.

I. SHORT ANSWER. No supplemental notice is required. [Analysis of the "previously reported" and "corroborative" exclusions; the 2002 8(e) (8EHQ-02-15201) and 2003 8(d) response placed the plume, the source, the serum kinetics and the two-year interim before EPA; the 2005 supplement placed the final bioassay before EPA.]

\fII. THE MW-7 RESULTS. [Concentrations of 9.8 and 11.2 µg/L are below the 2002 peak of 44 µg/L reported to EPA. Beacon's attribution is a hydrogeological interpretation, not new toxicity or exposure information. The city wellfield remains non-detect (August 2016 low-level round: <0.002 µg/L).]

III. THE HEPATIC RE-ANALYSIS. [Re-analysis of previously reported data using EPA's own methods is not "information" within 8(e); see 2006 Guide, Part IV. However, the analysis should be retained and, if the company communicates with EPA on the health advisory, should be provided voluntarily.]

\fIV. RISK ASSESSMENT. [Plaintiffs in the anticipated MDL will characterise the 2001–2002 interval as the core "knowledge" period; a 2016 decision not to supplement is unlikely to add materially to that exposure but a 2016 decision to supplement would be characterised as an admission that the 2002 notice was incomplete. Recommend voluntary update letter (not an 8(e)) to OPPT and IEPA with the 2016 monitoring data.]

V. RECOMMENDATIONS. 1. No supplemental 8(e). 2. Voluntary monitoring update to OPPT and IEPA by 30 September. 3. Retain outside regulatory counsel to review this analysis (see separate memorandum). 4. Product team to be told the conclusion, not the analysis.

\f[Pages 5–6: authorities; chronology of prior submissions 2001–2005; draft voluntary update letter.]`,
  },
  {
    id: "ed_afff_kaine_0004",
    batesAt: 43918,
    date: "2016-09-09",
    time: "15:30",
    custodian: "kaine",
    type: "Email",
    subject: "RE: Privileged — outside counsel engagement",
    to: ["Martin Suarez", "Alan Pryce"],
    aiScore: 70,
    aiIssues: ["LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-13T10:20:00Z" },
    body: `PRIVILEGED & CONFIDENTIAL

Alan, we are retaining outside regulatory counsel (Ashby Lowe — Thomas Ashby's environmental group) to advise on the question Martin raised. Until then please route questions through Legal; I do not want the product or EHS teams generating their own analyses in email. Engagement letter is signed; first call is Wednesday.

Martin — please send Tom the 2002 8(e), the 2003 8(d) response, the 2005 supplement, Beacon's 2016 reports, and my draft memo, under a privileged transmittal.

Rob`,
  },
  {
    id: "ed_afff_kaine_0005",
    batesAt: 43944,
    date: "2016-09-27",
    time: "12:05",
    custodian: "kaine",
    type: "Email",
    subject: "Outside counsel advice — 8(e) (privileged)",
    to: ["Martin Suarez"],
    aiScore: 86,
    aiIssues: ["REG-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-13T10:25:00Z" },
    body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION

Summary of the advice received this morning, for our internal deliberation only.

Tom Ashby concurs: no supplemental 8(e) is required on the 2016 MW-7 results or the hepatic re-analysis. He recommends (1) the voluntary update letter, sent by the end of the month; (2) that the update letter attach Beacon's 2016 reports in full and Helen's re-analysis, so that there is no later argument that we selected what to send; (3) that the company begin a document collection now, since the MDL is coming regardless.

He also said, and I want it recorded: "The 2001 decision is what the case will be about. Nothing you do in 2016 changes that; the only thing you can do is not add to it."

Decision memo to follow.

Rob`,
  },
  {
    id: "ed_afff_kaine_0006",
    batesAt: 43951,
    date: "2016-10-03",
    time: "10:12",
    custodian: "kaine",
    type: "Email",
    subject: "RE: Decision memo — final",
    from: "Martin Suarez",
    to: ["Robert Kaine"],
    aiScore: 68,
    aiIssues: ["REG-01", "LEG-01"],
    coding: { responsive: true, privileged: true, privilegeBasis: "attorney-client", confidentiality: "AEO", issues: ["REG-01", "LEG-01"], reviewerId: R.marsh, reviewedAt: "2026-09-13T10:30:00Z" },
    body: `PRIVILEGED & CONFIDENTIAL

Rob — final version attached reflecting your edits. I will brief Alan verbally per your guidance. The voluntary update letter went to OPPT (Feld's successor, Dana Okoro) and to IEPA on 29 September with Beacon's reports and Helen's re-analysis attached. Acknowledgement from IEPA received this morning; nothing yet from OPPT.

Document collection: Tom Bradley's group at Calloway & Reyes has sent the collection protocol. Custodians in the first tier are Hale, Voss, Brooks, Pryce, you and me. IT starts imaging on the 10th.

Martin`,
  },
];
