import type { CodingDecision } from "@/lib/types/domain";
import { DEMO_ID as D, type DocSpec } from "./doc-spec";
import { REVIEWER as R } from "./people";

/**
 * Hand-authored key documents, block A: App Store commission, anti-steering, in-app payments and super apps.
 * FICTIONAL: every document, figure and statement is invented for the demonstration and authored by fictional people.
 */

export const coded = (responsive: boolean, issues: string[], at: string, extra: Partial<CodingDecision> = {}, reviewer: string = R.associate): Partial<CodingDecision> => ({
  responsive, privileged: false, issues, reviewerId: reviewer, reviewedAt: at, confidentiality: responsive ? "confidential" : undefined, ...extra,
});

const T_SUBS = "demo_apl_thr_subs_rate";
const T_KITE = "demo_apl_thr_kitebird_link";
const T_FY17 = "demo_apl_thr_fy17_contribution";
const T_SBP = "demo_apl_thr_sbp_messaging";
const T_LINK = "demo_apl_thr_link_entitlement";
const T_PSP = "demo_apl_thr_psp_revenue";
const T_ENF = "demo_apl_thr_enforcement_2020";
const T_MINI = "demo_apl_thr_miniapps";

export const KEY_DOCS_A: DocSpec[] = [
  // ---------------------------------------------------------------- Commission
  {
    id: D("k01"), date: "2016-06-02", time: "10:12", cust: "okoro", type: "Email", subject: "Subscription rate change — year-two 15% model",
    to: ["Graham Whitaker", "Sofia Lindqvist"], cc: ["Lena Marsh"], thread: T_SUBS, attachments: [D("k02")],
    aiScore: 88, aiIssues: ["ASC-01", "DMG-01"], aiSummary: "Okoro sends the model for reducing the subscription commission to 15% after a subscriber's first year; estimates the revenue give-up and notes most subscription revenue sits in year one.",
    coding: coded(true, ["ASC-01", "DMG-01"], "2026-08-11T15:02:00Z"),
    body: `Graham, Sofia —

Attached is v3 of the retention-rate model for the year-two subscription change. Short version:

- Moving qualifying subscriptions from 30% to 15% after 12 paid months reduces subscription commission by roughly 6–8% in the first full year, because most subscription revenue is still in first-year cohorts.
- The give-up grows as cohorts age. By year three the model has it at 11–13% of subscription commission.
- Developers of long-lived subscriptions (news, productivity, streaming video) capture most of the benefit. Games are largely unaffected.

I have not modelled any change in developer pricing. Lena asked whether developers would pass the difference to subscribers; nothing in our data answers that yet.

Happy to walk through before Thursday.

Rachel

Rachel Okoro
Finance Lead, App Store Payments`,
  },
  {
    id: D("k02"), date: "2016-06-02", cust: "okoro", type: "Spreadsheet", subject: "Subscription retention-rate model v3 (summary tab)", pages: 3, parent: D("k01"),
    aiScore: 81, aiIssues: ["ASC-01", "DMG-01"], aiSummary: "Summary tab of the year-two 15% subscription model: cohort revenue by tenure and commission give-up by year.",
    coding: coded(true, ["ASC-01", "DMG-01"], "2026-08-11T15:04:00Z", { confidentiality: "highly confidential" }),
    body: `SUBSCRIPTION RETENTION-RATE MODEL — v3 — SUMMARY
Prepared by: R. Okoro, App Store Payments Finance     Status: Internal draft

Cohort tenure      Share of subscription gross     Commission today     Commission at 15% after month 12
Months 1–12        71%                              30%                  30%
Months 13–24       18%                              30%                  15%
Months 25+         11%                              30%                  15%

Estimated reduction in subscription commission
FY2017 (partial year)     6.4% – 8.1%
FY2018                    9.0% – 10.7%
FY2019                    11.2% – 12.9%
\fSensitivities
- Churn +/- 5 points moves FY2019 give-up by about 1.5 points.
- No developer price response is assumed. If developers cut year-two prices by the full 15 points the consumer price effect would be visible in the tier mix within two quarters; if they do not, the change is a transfer to developers only.
\fNotes
Model uses FY2015–FY2016 subscription receipts; excludes family-sharing edge cases. Not reviewed by Services Finance.`,
  },
  {
    id: D("k01dup"), date: "2016-06-02", time: "10:12", cust: "marsh", type: "Email", subject: "Subscription rate change — year-two 15% model", dupOf: D("k01"),
    to: ["Graham Whitaker", "Sofia Lindqvist"], cc: ["Lena Marsh"], thread: T_SUBS, from: "Rachel Okoro",
    aiScore: 88, aiIssues: ["ASC-01", "DMG-01"],
    body: "",
  },
  {
    id: D("k03"), date: "2018-02-14", cust: "okoro", type: "Report", subject: "App Store services — FY2017 contribution summary", pages: 4, from: "Rachel Okoro",
    aiScore: 96, aiIssues: ["ASC-01", "DMG-01", "MKT-01"], aiSummary: "Internal contribution summary for the App Store business: commission revenue, direct operating costs by function and a contribution margin line far above the cost of running the store.",
    entities: { people: ["Rachel Okoro", "Sofia Lindqvist"], orgs: ["App Store Payments Finance"], places: [] },
    coding: coded(true, ["ASC-01", "DMG-01", "MKT-01"], "2026-08-12T10:40:00Z", { hot: true, confidentiality: "highly confidential", notes: "Contribution margin line is the key figure for the economist; pair with the board-slide email (FY17 thread)." }),
    tags: ["key-doc", "expert-reliance"],
    body: `APP STORE SERVICES — FY2017 CONTRIBUTION SUMMARY
Prepared by App Store Payments Finance for Services Finance review. Internal — do not distribute.

1. Scope
This summary allocates direct operating costs of the App Store (App Review, developer relations, storefront engineering, payments operations, fraud and refunds, hosting and content delivery) against commission revenue. Shared platform engineering and corporate overhead are shown separately and are not allocated.

2. Headline (FY2017, indexed; commission revenue = 100)
Commission revenue                          100.0
Payment processing and fraud losses           4.1
App Review and developer relations            2.3
Storefront, search and hosting                5.8
Other direct costs                            2.6
Direct operating costs                       14.8
Contribution before shared engineering       85.2
\f3. Shared engineering
Allocating the full developer-tools and platform-engineering budget to the store would reduce the contribution line to 71–76, depending on the allocation key. Most of that engineering serves the device business whether or not a store exists.

4. Trend
Direct costs grew 9% year over year; commission revenue grew 31%. The contribution line has risen in each of the last four years.
\f5. Observations
(a) The commission rate is not set by reference to cost. The rate has been unchanged since launch while direct costs as a share of commission have fallen by about half.
(b) Payment processing is the only cost that scales with transaction value, and it is under 5 points.
(c) The subscription change (year-two 15%) is visible in FY2018 guidance but immaterial to this summary.
\f6. Distribution
Summary prepared for S. Lindqvist. Contribution figures are not included in the external segment reporting and should not be circulated outside Services Finance without approval.`,
  },
  {
    id: D("k04"), date: "2018-02-15", time: "08:47", cust: "okoro", type: "Email", subject: "RE: FY17 contribution — board materials", from: "Sofia Lindqvist",
    to: ["Rachel Okoro"], thread: T_FY17,
    aiScore: 94, aiIssues: ["ASC-01", "MKT-01"], aiSummary: "Lindqvist relays an instruction that the contribution-margin line be kept off the board slide and replaced with gross commission growth.",
    coding: coded(true, ["ASC-01", "MKT-01"], "2026-08-12T10:48:00Z", { hot: true, notes: "Instruction to drop the margin line from board slide — contradicts Okoro 60:12 ('space')." }),
    tags: ["key-doc"],
    body: `Rachel,

Thanks for turning this around. Graham asked that the contribution margin line stay off the board slide. Use gross commission growth and developer payouts instead; that is the story the board has seen before and it does not invite a conversation about the rate.

Keep the full summary in the Services Finance folder. If anyone outside the group asks for it, send them to me.

Sofia

-----Original Message-----
From: Rachel Okoro
Sent: Wednesday, February 14, 2018 6:02 PM
Subject: FY17 contribution — board materials

Sofia — summary attached. The contribution line is 85 before shared engineering, 71–76 after. Let me know what you want on the board page.`,
  },
  {
    id: D("k05"), date: "2019-09-10", cust: "marsh", type: "Memo", subject: "Commission rate: developer sentiment and policy options", pages: 2, from: "Lena Marsh",
    to: ["Graham Whitaker"],
    aiScore: 79, aiIssues: ["ASC-01"], aiSummary: "Policy memo summarising developer complaints about the 30% rate and options (status quo, small-developer tier, category rates).",
    coding: coded(true, ["ASC-01"], "2026-08-13T09:15:00Z"),
    body: `MEMORANDUM
TO: Graham Whitaker
FROM: Lena Marsh, App Store Policy
DATE: September 10, 2019
RE: Commission rate — developer sentiment and policy options

1. Where we are. Complaints about the 30% rate have moved from a handful of large developers to trade associations and, increasingly, legislators. The volume of rate-related escalations to Developer Relations is up roughly 3x since 2017.

2. What developers say. (a) The rate is the same regardless of what the store does for a given app. (b) They cannot tell customers that a lower price exists elsewhere. (c) Subscription businesses see the year-two change as helpful but insufficient.

3. Options.
A. Status quo, with better communication of the value of review, distribution and payments.
B. A reduced rate for small developers (under a revenue threshold). Low revenue impact, strong signal.
C. Category-specific rates (e.g., reader apps). Operationally complex; invites arbitrage.
\f4. Recommendation. B deserves modelling by Finance. Any option should be framed as a benefit to developers, not a response to regulatory pressure.

5. Not recommended. Relaxing the guideline limits on communicating other purchase options. That change affects the entire commission base, not a tier.`,
  },
  {
    id: D("k06e"), date: "2020-09-28", time: "19:04", cust: "okoro", type: "Email", subject: "SBP scenarios — draft for Sofia", from: "Rachel Okoro",
    to: ["Sofia Lindqvist"], attachments: [D("k06")],
    aiScore: 80, aiIssues: ["ASC-01", "DMG-01"], aiSummary: "Okoro sends Lindqvist the draft Small Business Program scenario deck recommending a $1M threshold.",
    coding: coded(true, ["ASC-01", "DMG-01"], "2026-08-13T11:00:00Z", {}, R.paralegal),
    body: `Sofia,

Draft scenarios attached. The $1M threshold gets us to roughly 98% of developers for about 2.4 points of commission. The developers who account for most spending stay at the standard rate.

If this is the direction, I'll turn the deck into announcement support for November.

Rachel`,
  },
  {
    id: D("k06"), date: "2020-09-28", cust: "okoro", type: "Presentation", subject: "Small Business Program — revenue impact scenarios", pages: 6, from: "Rachel Okoro", parent: D("k06e"),
    aiScore: 92, aiIssues: ["ASC-01", "DMG-01"], aiSummary: "Deck modelling a 15% rate for developers under a revenue threshold: most developers qualify while the commission impact stays in the low single digits; dated before the November 2020 announcement.",
    coding: coded(true, ["ASC-01", "DMG-01"], "2026-08-13T11:05:00Z", { hot: true, confidentiality: "highly confidential", notes: "Dated 28 Sep 2020 — predates the announcement decision; conflicts with Okoro 101:4 (first saw SBP modelling in November)." }),
    tags: ["key-doc"],
    body: `SMALL BUSINESS PROGRAM — REVENUE IMPACT SCENARIOS
App Store Payments Finance · Draft for discussion · 28 September 2020

Slide 1 — Question
What does a 15% commission for developers under an annual proceeds threshold cost, and how many developers does it reach?
\fSlide 2 — Thresholds tested
$250K · $500K · $1M · $2M prior-year proceeds, with re-qualification each calendar year.
\fSlide 3 — Reach vs. cost (indexed, FY2020 commission = 100)
Threshold    Developers qualifying    Commission impact
$250K        95%                      1.1
$500K        97%                      1.7
$1M          98%                      2.4
$2M          98.5%                    3.6
\fSlide 4 — Reading
Almost all developers qualify at every threshold; the large developers who generate most commission do not. At $1M the program reaches ~98% of developers for ~2.4 points of commission.
\fSlide 5 — Risks
- Developers splitting accounts to stay under the threshold (mitigation: associated-developer rules).
- The program does not change the rate for the developers who account for most consumer spending.
\fSlide 6 — Recommendation
$1M threshold. Prepare announcement materials for November.`,
  },
  {
    id: D("k07"), date: "2020-11-03", time: "14:31", cust: "marsh", type: "Email", subject: "Small Business Program — announcement messaging", from: "Lena Marsh",
    to: ["Victor Ames", "Graham Whitaker"], cc: ["Hannah Cole"], thread: T_SBP,
    aiScore: 77, aiIssues: ["ASC-01"], aiSummary: "Business messaging plan for the Small Business Program announcement sent to developer relations and the VP; counsel is copied but no legal advice is requested or given.",
    coding: coded(true, ["ASC-01"], "2026-08-14T13:20:00Z", { notes: "Privilege-CC rule: Cole is copied only; business messaging, no request for legal advice. Not privileged — challenge defendant's log entry.", confidentiality: "confidential" }),
    tags: ["privilege-cc", "privilege-challenge"],
    body: `Victor, Graham —

Messaging for the developer call on the 18th:

1. Lead with the number of developers who benefit (nearly all of them), not the revenue impact.
2. Say "the vast majority of developers" rather than a percentage until Finance signs off on the final count.
3. Do not describe the program as a change to the standard commission. The standard rate is unchanged.
4. If asked whether the program responds to regulators or litigation, the answer is that we have been listening to small developers for years.

Victor, please prepare a one-page FAQ for the regional developer relations leads by Friday. Hannah, copying you so you have the timing.

Lena`,
  },
  {
    id: D("k09"), date: "2021-03-18", cust: "okoro", type: "Spreadsheet", subject: "Commission cost-to-serve estimate — DRAFT", pages: 2, from: "Rachel Okoro",
    aiScore: 90, aiIssues: ["ASC-01", "DMG-01"], aiSummary: "First cost-to-serve estimate per dollar of commission; direct costs cover 13–16 cents of each commission dollar.",
    coding: coded(true, ["ASC-01", "DMG-01"], "2026-08-14T15:00:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["expert-reliance"],
    body: `COMMISSION COST-TO-SERVE ESTIMATE — DRAFT (prepared at the request of Legal)
Prepared by R. Okoro · 18 March 2021 · Not for distribution

Per $1.00 of commission (FY2020)
Payment processing and fraud                $0.04
Review, developer relations, support         $0.03
Storefront, search, hosting                  $0.05
Other direct                                 $0.02–$0.04
Direct cost-to-serve                         $0.13–$0.16
\fMethod notes
- First time this estimate has been assembled; prior finance reviews did not compare the rate to cost.
- Shared engineering excluded (see FY2017 contribution summary for allocation sensitivities).
- Draft assumptions to be confirmed with Services Finance.`,
  },
  {
    id: D("k10"), date: "2019-04-22", cust: "marsh", type: "Presentation", subject: "Board of Directors — Services review (App Store excerpt)", pages: 5, from: "Graham Whitaker",
    aiScore: 83, aiIssues: ["ASC-01", "MKT-01"], aiSummary: "Board excerpt presenting App Store growth as gross commission and developer payouts; no margin or cost information is shown.",
    coding: coded(true, ["ASC-01", "MKT-01"], "2026-08-15T09:30:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["board-materials"],
    body: `BOARD OF DIRECTORS — SERVICES REVIEW
App Store excerpt · April 2019 · Presented by G. Whitaker

Page 1 — App Store at a glance
Developer payouts since launch continue to grow; gross commission growth of 27% year over year; weekly visitors at record levels.
\fPage 2 — Growth drivers
Games (in-app purchases), subscriptions, emerging markets.
\fPage 3 — Developer relations
Rate criticism concentrated among large subscription and game developers. Year-two subscription rate change well received.
\fPage 4 — Regulatory
Inquiries in several jurisdictions focus on the rate and on communication of alternative purchase options. See Legal update (separate).
\fPage 5 — Priorities
Protect the integrity of in-app purchase; expand payment methods; continue review-time improvements.`,
  },

  // ---------------------------------------------------------------- Anti-steering
  {
    id: D("a01"), date: "2016-09-12", cust: "marsh", type: "Contract", subject: "Developer agreement — in-app purchase and communication provisions (annotated excerpt)", pages: 3, from: "Lena Marsh",
    aiScore: 72, aiIssues: ["AST-01", "IAP-01"], aiSummary: "Internal annotated excerpt of the developer agreement and review guidelines covering mandatory in-app purchase and limits on directing users to other purchase methods.",
    coding: coded(true, ["AST-01", "IAP-01"], "2026-08-15T11:00:00Z"),
    body: `DEVELOPER PROGRAM AGREEMENT — ANNOTATED EXCERPT (internal policy annotation, App Store Policy)

Schedule 2, §3.4 (paraphrased for internal training): Applications that offer digital content, subscriptions or features for use within the application must offer them through In-App Purchase.

Review guideline, purchases (paraphrased): Apps may not include buttons, external links or other calls to action that direct customers to purchasing mechanisms other than In-App Purchase.

Review guideline, reader apps (paraphrased): Apps may allow a user to access previously purchased content but may not direct users to purchase outside the app.
\fANNOTATIONS
[A1] "Direct" includes price comparisons that name a lower price elsewhere, even without a link.
[A2] Emails to customers who gave an address outside the app are not reviewed by App Review; do not tell developers this is permitted, only that App Review does not evaluate it.
[A3] Reviewers escalate borderline cases to App Store Policy, not to Legal.
\fRevision: v2016.3 · Owner: L. Marsh · For internal training use only.`,
  },
  {
    id: D("a02"), date: "2017-05-08", time: "17:20", cust: "ames", type: "Email", subject: "FW: Kitebird — request to show web pricing in app", from: "Victor Ames",
    to: ["Lena Marsh"], thread: T_KITE,
    aiScore: 80, aiIssues: ["AST-01"], aiSummary: "Developer relations forwards Kitebird's request to tell users that a lower price is available on its website.",
    coding: coded(true, ["AST-01"], "2026-08-15T11:12:00Z"),
    body: `Lena — escalation from Kitebird below. They have been polite about it but they are going to keep asking. Can you give me a position I can take back?

Victor

-----Original Message-----
From: Mira Solberg <mira@kitebird.example>
Sent: Monday, May 8, 2017 1:04 PM
To: Victor Ames
Subject: Request to show web pricing in app

Victor,

Our annual plan is $59.99 on our website and $79.99 in the app, because of the commission. We would like to show a single line of text on the upgrade screen: "Also available at kitebird.example for less." No button, no link. Is that acceptable under the guidelines?

Thanks,
Mira`,
  },
  {
    id: D("a03"), date: "2017-05-09", time: "09:02", cust: "marsh", type: "Email", subject: "RE: FW: Kitebird — request to show web pricing in app", from: "Lena Marsh",
    to: ["Victor Ames"], cc: ["Graham Whitaker"], thread: T_KITE,
    aiScore: 97, aiIssues: ["AST-01", "ASC-01"], aiSummary: "Marsh rejects Kitebird's request and explains that allowing a price comparison would let the lower web price 'do the work' of moving purchases out of the app.",
    entities: { people: ["Lena Marsh", "Victor Ames", "Graham Whitaker", "Mira Solberg"], orgs: ["Kitebird Labs"], places: [] },
    coding: coded(true, ["AST-01", "ASC-01"], "2026-08-15T11:20:00Z", { hot: true, notes: "Core anti-steering admission; impeaches Marsh 97:3 'user trust' framing." }),
    tags: ["key-doc", "exhibit-candidate"],
    body: `Victor,

It's a no. Text without a link is still steering. If they can tell users the price is lower on the web, the price comparison does the work for them and the purchase leaves the app. Every subscription developer would do the same within a quarter.

What you can say: the guidelines do not allow apps to direct customers to other purchasing methods, and that includes statements about pricing elsewhere. Don't get into why.

If she pushes, offer a call with me. Graham, FYI — Kitebird is the third reader-style app this quarter.

Lena`,
  },
  {
    id: D("a03dup"), date: "2017-05-09", time: "09:02", cust: "ames", type: "Email", subject: "RE: FW: Kitebird — request to show web pricing in app", from: "Lena Marsh", dupOf: D("a03"),
    to: ["Victor Ames"], cc: ["Graham Whitaker"], thread: T_KITE, aiScore: 97, aiIssues: ["AST-01", "ASC-01"], body: "",
  },
  {
    id: D("a04"), date: "2017-05-09", time: "11:40", cust: "ames", type: "Email", subject: "RE: Kitebird — request to show web pricing in app", from: "Victor Ames",
    to: ["Mira Solberg"], thread: T_KITE,
    aiScore: 74, aiIssues: ["AST-01"],
    coding: coded(true, ["AST-01"], "2026-08-15T11:24:00Z", {}, R.paralegal),
    body: `Mira,

Thanks for checking before submitting. The guidelines do not allow apps to direct customers to purchasing methods other than In-App Purchase, and that includes statements about prices available elsewhere, with or without a link.

I know that is not the answer you wanted. Lena Marsh on our policy team is happy to join a call next week if that would help.

Best,
Victor`,
  },
  {
    id: D("a05"), date: "2018-07-19", cust: "marsh", type: "Memo", subject: "Anti-steering guideline: rationale and enforcement consistency", pages: 3, from: "Lena Marsh",
    to: ["Graham Whitaker"], cc: ["Jae Park"],
    aiScore: 93, aiIssues: ["AST-01", "ASC-01"], aiSummary: "Final policy memo presenting user trust and fraud prevention as the rationale for the anti-steering guideline, while acknowledging that enforcement protects the commission base.",
    coding: coded(true, ["AST-01", "ASC-01"], "2026-08-16T10:00:00Z", { hot: true }),
    tags: ["key-doc"],
    body: `MEMORANDUM
TO: Graham Whitaker
CC: Jae Park, App Review
FROM: Lena Marsh, App Store Policy
DATE: July 19, 2018
RE: Anti-steering guideline — rationale and enforcement consistency

1. Purpose. App Review has asked for a single written rationale so that rejections are explained consistently.

2. Rationale. The guideline keeps the purchase experience inside a system users trust: one account, one set of refund rights, parental controls and protection from payment fraud. Users who are sent to unfamiliar payment pages are exposed to phishing and subscription traps.
\f3. Commercial effect. Consistent enforcement also protects the commission on digital purchases. We should not pretend otherwise internally; externally, the trust rationale is the one we explain because it is the one that applies to every app.

4. Enforcement. In the first half of 2018, 1,140 submissions were rejected under the guideline; 61% were reader or subscription apps. Inconsistency complaints concern text-only mentions of other prices; these should be rejected.
\f5. Next steps. App Review to adopt the rejection language in Appendix A. Developer Relations to use the same language in escalations.

Appendix A — Rejection language: "Your app directs customers to purchasing mechanisms other than In-App Purchase, which is not permitted."`,
  },
  {
    id: D("a07"), date: "2018-07-17", cust: "marsh", type: "Memo", subject: "DRAFT — Anti-steering guideline: rationale and enforcement consistency", pages: 3, from: "Lena Marsh",
    to: ["Graham Whitaker"],
    aiScore: 91, aiIssues: ["AST-01", "ASC-01"], aiSummary: "Earlier draft of the anti-steering rationale memo; the commercial paragraph is stated more directly than in the final.",
    coding: coded(true, ["AST-01", "ASC-01"], "2026-08-16T10:06:00Z", { hot: true, notes: "Draft v1 of the rationale memo — compare paragraph 3 with the final (19 Jul 2018)." }),
    tags: ["draft"],
    body: `MEMORANDUM — DRAFT v1
TO: Graham Whitaker
FROM: Lena Marsh, App Store Policy
DATE: July 17, 2018
RE: Anti-steering guideline — rationale and enforcement consistency

1. Purpose. App Review has asked for a single written rationale so that rejections are explained consistently.

2. Rationale. The guideline keeps the purchase experience inside a system users trust: one account, one set of refund rights, parental controls and protection from payment fraud. Users who are sent to unfamiliar payment pages are exposed to phishing and subscription traps.
\f3. Commercial effect. The main effect of consistent enforcement is to protect the commission on digital purchases; if price comparisons were allowed, subscription revenue would move to the web within a year. Internally that is the reason the line matters; externally, the trust rationale is the one we explain because it is the one that applies to every app.

4. Enforcement. In the first half of 2018, 1,140 submissions were rejected under the guideline; 61% were reader or subscription apps. Inconsistency complaints concern text-only mentions of other prices; these should be rejected.
\f5. Next steps. App Review to adopt the rejection language in Appendix A. Developer Relations to use the same language in escalations.

Appendix A — Rejection language: "Your app directs customers to purchasing mechanisms other than In-App Purchase, which is not permitted."`,
  },
  {
    id: D("a08"), date: "2021-09-14", cust: "ames", type: "Chat", subject: "#dev-relations — reader app link entitlement", from: "Victor Ames",
    aiScore: 68, aiIssues: ["AST-01"],
    body: `[#dev-relations · 14 Sep 2021]
09:14 Victor Ames: heads up — reader apps will get a single link to their website for account management. Details still moving.
09:15 Jae Park: does App Review check the destination page?
09:17 Victor Ames: yes, and the link can't show pricing in the app itself. Lena's team is writing the entitlement terms.
09:18 Jae Park: devs are going to ask why games don't get it
09:21 Victor Ames: answer is it's for reader apps only — no purchasable content in app. don't speculate beyond that
09:22 Jae Park: ok`,
  },
  {
    id: D("a09"), date: "2022-01-20", time: "16:05", cust: "marsh", type: "Email", subject: "Link-out entitlement — conversion tracking", from: "Lena Marsh",
    to: ["Rachel Okoro"], cc: ["Hannah Cole", "Victor Ames"], thread: T_LINK, attachments: [D("a10")],
    aiScore: 85, aiIssues: ["AST-01", "ASC-01", "DMG-01"], aiSummary: "Marsh asks Finance to track how many users follow reader-app links and complete purchases outside the app; counsel is copied, no legal advice requested.",
    coding: coded(true, ["AST-01", "ASC-01", "DMG-01"], "2026-08-16T14:10:00Z", { hot: true, notes: "Privilege-CC rule: counsel copied on business instruction to Finance; not privileged." }),
    tags: ["privilege-cc", "privilege-challenge"],
    body: `Rachel,

For the reader-app link entitlement we need a baseline and monthly tracking: how many users tap the account link, how many complete a purchase on the developer's site, and what that does to reader-app commission.

If conversion through the link is low, the entitlement is a pressure valve we can point to. If it is high, we need to know before anyone asks us to extend it to other categories.

Scenario tab attached; please sanity-check the take-rate assumptions. Hannah and Victor copied for visibility.

Lena`,
  },
  {
    id: D("a10"), date: "2022-01-20", cust: "marsh", type: "Spreadsheet", subject: "Link-out scenarios — commission on linked purchases", pages: 2, parent: D("a09"),
    aiScore: 84, aiIssues: ["AST-01", "ASC-01", "DMG-01"], aiSummary: "Scenario tab estimating reader-app commission retained under different link conversion rates and hypothetical commissions on linked purchases.",
    coding: coded(true, ["AST-01", "ASC-01", "DMG-01"], "2026-08-16T14:12:00Z", { hot: true, confidentiality: "highly confidential" }),
    body: `LINK-OUT SCENARIOS (reader apps) — working tab
Conversion via link     Commission retained (no fee on linked sales)     With 20% fee     With 24% fee     With 27% fee
2%                      98.6                                             99.7             99.8             99.9
5%                      96.4                                             99.3             99.6             99.8
10%                     92.9                                             98.6             99.2             99.6
20%                     85.7                                             97.1             98.3             99.1
\fNotes
Indexed to FY2021 reader-app commission = 100. A fee on linked purchases is hypothetical; no decision has been made. Assumes developer web prices equal in-app prices.`,
  },

  // ---------------------------------------------------------------- In-app payments
  {
    id: D("p01"), date: "2017-11-06", cust: "okoro", type: "Report", subject: "In-app purchase economics: payment costs vs. commission", pages: 3, from: "Rachel Okoro",
    aiScore: 95, aiIssues: ["IAP-01", "ASC-01", "DMG-01"], aiSummary: "Finance report showing payment processing and fraud cost 2.5–3.5% of gross purchases, a small fraction of the 30% commission.",
    coding: coded(true, ["IAP-01", "ASC-01", "DMG-01"], "2026-08-17T09:00:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["key-doc", "expert-reliance"],
    body: `IN-APP PURCHASE ECONOMICS — PAYMENT COSTS VS. COMMISSION
App Store Payments Finance · November 2017

Summary
Payment processing, chargebacks and fraud losses for in-app purchases averaged 2.5%–3.5% of gross purchase value in FY2017, varying by region and payment method (carrier billing highest). The standard commission is 30%.

Findings
1. The in-app purchase requirement is not primarily a payment-cost recovery mechanism; processing accounts for roughly one-tenth of commission.
2. Third-party processors offer comparable fraud tooling at 2.9% + fixed fee in major markets.
\f3. The commercial value of the requirement lies in visibility of every digital transaction, which makes the commission collectible without audit.
4. If developers could use their own processors, commission collection would depend on self-reporting and audit rights, which our current tooling does not support.
\fRecommendation
Keep payment-cost figures in internal materials only. Where external audiences ask about the value of in-app purchase, emphasise security, refunds and parental controls.`,
  },
  {
    id: D("p02"), date: "2019-02-11", time: "13:22", cust: "okoro", type: "Email", subject: "Alternative payment processors — revenue at risk", from: "Rachel Okoro",
    to: ["Sofia Lindqvist"], cc: ["Lena Marsh"], thread: T_PSP, attachments: [D("p03")],
    aiScore: 86, aiIssues: ["IAP-01", "ASC-01"], coding: coded(true, ["IAP-01", "ASC-01"], "2026-08-17T09:20:00Z"),
    body: `Sofia,

As requested, attached is the revenue-at-risk view if developers were permitted to use third-party payment processors inside their apps. The scenarios assume we keep a commission but lose transaction visibility.

The big number is not the commission rate; it is leakage. Without seeing the transaction we would be relying on developer reporting, and our audit experience with the enterprise program suggests under-reporting in the high single digits.

Rachel`,
  },
  {
    id: D("p03"), date: "2019-02-11", cust: "okoro", type: "Spreadsheet", subject: "Revenue at risk — third-party processor scenarios", pages: 2, parent: D("p02"),
    aiScore: 84, aiIssues: ["IAP-01", "ASC-01", "DMG-01"],
    coding: coded(true, ["IAP-01", "ASC-01", "DMG-01"], "2026-08-17T09:22:00Z", { confidentiality: "highly confidential" }),
    body: `REVENUE AT RISK — THIRD-PARTY PROCESSOR SCENARIOS (indexed, FY2018 IAP commission = 100)
Scenario                                   Adoption    Leakage    Commission retained
A. Processors allowed, full commission      35%         8%         97.2
B. Processors allowed, 26% commission       35%         8%         92.6
C. Processors allowed, 20% commission       60%         10%        79.4
D. Processors + link-outs, 20% commission   70%         12%        71.8
\fAssumptions: adoption concentrated in top-grossing games and subscriptions; leakage from enterprise audit experience; no change in consumer prices.`,
  },
  {
    id: D("p04"), date: "2020-08-24", time: "07:55", cust: "marsh", type: "Email", subject: "Enforcement — game developer switched to direct payment", from: "Lena Marsh",
    to: ["Graham Whitaker", "Victor Ames"], cc: ["Ruth Adeyemi"], thread: T_ENF,
    aiScore: 82, aiIssues: ["IAP-01", "AST-01"], aiSummary: "Operational update on a large game developer that enabled direct payment in its app; counsel copied; next steps are business enforcement actions.",
    coding: coded(true, ["IAP-01", "AST-01"], "2026-08-17T10:30:00Z", { notes: "Privilege-CC rule: Adeyemi copied on an operational update; no request for legal advice. Not privileged." }),
    tags: ["privilege-cc", "privilege-challenge"],
    body: `Graham, Victor —

Status as of this morning: the developer pushed a server-side change that offers a direct-payment option at a lower price alongside In-App Purchase. App Review has confirmed it on three builds.

Business steps under way:
1. App Review to reject further updates until the direct option is removed.
2. Developer Relations to contact the developer's account team today with the standard notice.
3. Editorial to pull the app from featuring pending resolution.

We are not changing the guideline or making exceptions. Ruth is copied so Legal has the timeline.

Lena`,
  },

  // ---------------------------------------------------------------- Super apps
  {
    id: D("s01"), date: "2018-10-03", time: "15:44", cust: "ames", type: "Email", subject: "Kitebird mini-programs — review status", from: "Victor Ames",
    to: ["Lena Marsh"], cc: ["Jae Park"], thread: T_MINI,
    aiScore: 76, aiIssues: ["SUP-01"], coding: coded(true, ["SUP-01"], "2026-08-18T09:00:00Z", {}, R.paralegal),
    body: `Lena,

Kitebird's 5.0 build adds a directory of third-party "mini-programs" (lightweight HTML5 apps from other developers that run inside Kitebird, with Kitebird handling login and payments). Jae's team has it on hold under the guideline on apps that offer other apps.

Kitebird's position is that the mini-programs are web content, not apps. They have around 400 partners lined up. How do you want to play this?

Victor`,
  },
  {
    id: D("s02"), date: "2018-10-04", cust: "marsh", type: "Memo", subject: "Mini-apps inside host apps: policy position", pages: 2, from: "Lena Marsh",
    to: ["Graham Whitaker"], thread: T_MINI,
    aiScore: 95, aiIssues: ["SUP-01", "ASC-01", "MKT-01"], aiSummary: "Policy memo recommending restrictions on mini-app directories because a host app could become 'a store inside our store', reducing commission and lowering the cost of switching devices.",
    coding: coded(true, ["SUP-01", "ASC-01", "MKT-01"], "2026-08-18T09:15:00Z", { hot: true }),
    tags: ["key-doc", "exhibit-candidate"],
    body: `MEMORANDUM
TO: Graham Whitaker
FROM: Lena Marsh
DATE: October 4, 2018
RE: Mini-apps inside host apps

Issue. Kitebird 5.0 introduces a directory of third-party mini-programs that run inside the Kitebird app with Kitebird's own login and payments.

Concerns.
1. Store-within-a-store. A host app with its own directory, identity and payments becomes a distribution channel we do not review and do not collect on.
2. Platform neutrality. Mini-programs written once run the same on any phone. If users' most-used services live inside a host app that works everywhere, the device matters less and switching gets easier.
3. Safety. We cannot review content that changes server-side.
\fRecommendation. Allow mini-programs only if (a) each is submitted for review individually, (b) purchases inside them use In-App Purchase, and (c) there is no directory that lets users browse or search mini-programs as a catalog.

Note on communication: externally, lead with safety and review (concern 3). Concerns 1 and 2 are the business reasons and should stay internal.`,
  },
  {
    id: D("s03"), date: "2018-10-05", time: "07:31", cust: "marsh", type: "Email", subject: "RE: Mini-apps inside host apps", from: "Graham Whitaker",
    to: ["Lena Marsh"], thread: T_MINI,
    aiScore: 92, aiIssues: ["SUP-01", "MKT-01"], aiSummary: "Whitaker agrees with holding the Kitebird build and asks that the decision stay firm through the holiday quarter.",
    coding: coded(true, ["SUP-01", "MKT-01"], "2026-08-18T09:20:00Z", { hot: true }),
    body: `Agree. Hold the build. I don't want a directory in the store going into the holiday quarter, and I don't want a precedent that makes a host app the place people go for everything.

Use the individual-submission condition. If they can live with it, fine — they won't be able to.

G.`,
  },
  {
    id: D("s03dup"), date: "2018-10-05", time: "07:31", cust: "ames", type: "Email", subject: "RE: Mini-apps inside host apps", from: "Graham Whitaker", dupOf: D("s03"),
    to: ["Lena Marsh"], thread: T_MINI, aiScore: 92, aiIssues: ["SUP-01", "MKT-01"], body: "",
    tags: ["forwarded-copy"],
  },
  {
    id: D("s04"), date: "2019-03-12", cust: "ames", type: "Chat", subject: "#dev-relations — Kitebird escalation (mini-program directory)", from: "Victor Ames",
    aiScore: 71, aiIssues: ["SUP-01"],
    body: `[#dev-relations · 12 Mar 2019]
16:02 Victor Ames: Kitebird resubmitted without the directory. mini-programs now reachable only by deep link from partner websites
16:04 Jae Park: that passes the letter of the conditions
16:05 Victor Ames: Lena wants it held for another look
16:09 Jae Park: on what basis? individual submission is done for the 12 they launched with
16:11 Victor Ames: "catalog-like experience via search". I'll write it up
16:12 Jae Park: ok but that's new`,
  },
];
