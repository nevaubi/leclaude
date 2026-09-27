import type { Deposition } from "@/lib/types/domain";
import { DEMO_DEPOSITIONS } from "../ids";
import { CUST, DEFENDED_BY, M, TAKEN_BY, tagged } from "./people";
import { assemble, DEFENSE_ATTORNEY as DA, EXAMINING_ATTORNEY as EA, obj, type DocIndex, type ExhibitSpec, type RawQA } from "./depo-helpers";

/**
 * Deposition of Rachel Okoro (FICTIONAL), Finance Lead, App Store Payments. Contradicts Marsh 64:10 on whether
 * Finance ever compared the commission to cost (41:3); a pass-through admission (88:4) is narrowed on cross (142:3).
 */

export const OKORO_CITES = {
  noCostComparison: { page: 41, line: 3 },
  boardSlide: { page: 60, line: 12 },
  passThrough: { page: 88, line: 4 },
  passThroughQualified: { page: 142, line: 3 },
  sbpTiming: { page: 101, line: 4 },
  processingCost: { page: 29, line: 5 },
} as const;

const EXHIBITS: ExhibitSpec[] = [
  { id: "Okoro-1", slug: "k01", page: 15, description: "Okoro email, 'Subscription rate change — year-two 15% model' (2 Jun 2016)", recognize: "Yes, that's my email." },
  { id: "Okoro-2", slug: "k02", page: 17, description: "subscription retention-rate model v3, summary tab", recognize: "Yes. It's the summary tab of my model.", author: "I did.", recipients: "It was attached to my email to Graham and Sofia, with Lena copied." },
  { id: "Okoro-3", slug: "p01", page: 28, description: "'In-app purchase economics: payment costs vs. commission' (Nov. 2017)", recognize: "Yes. My team prepared it.", author: "My team, under my direction.", recipients: "Services Finance leadership. I don't remember the exact list." },
  { id: "Okoro-4", slug: "k03", page: 35, description: "App Store services FY2017 contribution summary (14 Feb 2018)", recognize: "Yes.", author: "I prepared it for Sofia Lindqvist.", recipients: "Sofia. Then it went to the Services Finance folder." },
  { id: "Okoro-5", slug: "k09", page: 44, description: "commission cost-to-serve estimate — draft (18 Mar 2021)", recognize: "Yes.", author: "I did.", recipients: "I sent it to Legal." },
  { id: "Okoro-6", slug: "k04", page: 58, description: "Lindqvist email, 'RE: FY17 contribution — board materials' (15 Feb 2018)", recognize: "Yes, I received it." },
  { id: "Okoro-7", slug: "p02", page: 70, description: "Okoro email, 'Alternative payment processors — revenue at risk' (11 Feb 2019)", recognize: "Yes." },
  { id: "Okoro-8", slug: "p03", page: 71, description: "revenue-at-risk scenario tab attached to Okoro-7", recognize: "Yes, that's the attachment.", author: "My team.", recipients: "Sofia, with Lena copied, as an attachment." },
  { id: "Okoro-9", slug: "d01", page: 86, description: "'Commission pass-through: price-tier analysis' (3 Mar 2020)", recognize: "Yes.", author: "My team, and I reviewed it.", recipients: "Services Finance. I don't recall who else." },
  { id: "Okoro-10", slug: "k06", page: 99, description: "'Small Business Program — revenue impact scenarios' deck (28 Sep 2020)", recognize: "I recognise the format. It's one of ours.", author: "My team." },
  { id: "Okoro-11", slug: "x02", page: 120, description: "installed base and switching rates summary (15 Jan 2019)", recognize: "Yes." },
  { id: "Okoro-12", slug: "d02", page: 139, description: "Okoro email, 'Price tier update — expected consumer price effects' (15 Jun 2022)", recognize: "Yes, my email." },
  { id: "Okoro-13", slug: "b02", page: 150, description: "Audit & Finance Committee excerpt, 'Services economics' (Apr. 2021)", recognize: "I've seen it. Sofia presented it.", author: "Services Finance. Sofia presented it." },
];

const RAW: RawQA[] = [
  [5, 2, "(The witness was sworn.) Please state your name for the record.", "Rachel Adaeze Okoro."],
  [6, 9, "What is your current position?", "Finance Lead for App Store Payments."],
  [7, 3, "How long have you been in that role?", "Since 2015. Before that I was in treasury for three years."],
  [7, 17, "Who do you report to?", "Sofia Lindqvist, Senior Manager in Services Finance."],
  [8, 11, "What does your group do?", "Revenue reporting, forecasting and analysis for App Store commission and payments — refunds, fraud, processing costs, developer proceeds."],
  [10, 4, "Do you set the commission rate?", "No. I analyse it. I don't set it."],
  [11, 20, "Did you meet with anyone to prepare for today?", "With counsel.", { objection: obj(DA, "privilege", "Don't disclose the substance.") }],
  [16, 8, "Your subscription model assumed no developer price response. Why?", "We had no data on how developers would reprice. It was a revenue model, not a pricing model."],
  [16, 21, "Did Ms. Marsh ask whether developers would pass the difference on to subscribers?", "Yes. I said the data didn't answer that yet."],
  [18, 6, "The summary tab says that if developers cut year-two prices by the full 15 points, the effect would be visible in the tier mix within two quarters. What was the basis?", "How quickly developers had moved prices after earlier tier changes."],
  [21, 3, "Did anyone ask you to track whether subscription prices fell after the change?", "Not specifically."],
  [29, 5, "Exhibit Okoro-3 says payment processing, chargebacks and fraud averaged 2.5 to 3.5 percent of gross purchases, against a 30 percent commission. So payment costs were roughly a tenth of the commission?", "About that, yes.", { flags: ["admission", "key"] }],
  [30, 2, "The recommendation says 'Keep payment-cost figures in internal materials only.' Why?", "Because the numbers are easy to misread without context.", { flags: ["evasive"] }],
  [31, 14, "Finding 3 says the commercial value of the requirement lies in 'visibility of every digital transaction, which makes the commission collectible without audit.' Is that accurate?", "Yes. If we don't process the payment, we'd have to rely on developer reporting.", { flags: ["admission"] }],
  [36, 10, "The contribution summary shows contribution of 85.2 per 100 of commission before shared engineering, correct?", "Yes.", { flags: ["admission", "key"] }],
  [37, 4, "Paragraph 5(a): 'The commission rate is not set by reference to cost.' Was that accurate when you wrote it?", "That was my observation, yes.", { flags: ["admission", "key"] }],
  [38, 12, "And with shared engineering fully allocated, 71 to 76?", "Depending on the allocation key. And most of that engineering serves the device business anyway."],
  [41, 3, "Before 2021, did anyone ask you to compare the commission rate to the cost of running the store?", "No. No one asked me to compare the rate to costs, and I never told anyone the commission tracked our costs. It didn't — the contribution line shows that.", { flags: ["contradiction", "admission", "key"], note: "Contradicts Marsh 64:10 ('Finance told us the commission roughly tracked the cost of running the store')." }],
  [41, 22, "Are you aware of anyone else in Finance telling Ms. Marsh that?", "I'm not aware of it.", { objection: obj(DA, "foundation") }],
  [45, 2, "Exhibit Okoro-5 says 'First time this estimate has been assembled; prior finance reviews did not compare the rate to cost.' True?", "Yes, as far as I know."],
  [45, 14, "The title says 'prepared at the request of Legal.' What did Legal ask you to do?", "I can say Legal asked me to prepare it. I won't go into what they said.", { objection: obj(DA, "privilege", "Instruct the witness not to disclose communications with counsel."), flags: ["privilege"] }],
  [46, 5, "The estimate says direct cost-to-serve is 13 to 16 cents per dollar of commission?", "Yes."],
  [59, 6, "Ms. Lindqvist wrote: 'Graham asked that the contribution margin line stay off the board slide.' Did the margin line appear on the board slide?", "No."],
  [60, 12, "Why not?", "My recollection is it was left off for space. Board pages are tight.", { flags: ["contradiction", "evasive", "key"], note: "Compare Okoro-6 ({B:k04}): 'it does not invite a conversation about the rate.'" }],
  [61, 3, "Nothing in Ms. Lindqvist's email says anything about space, does it?", "No."],
  [61, 17, "She wrote that gross commission growth 'does not invite a conversation about the rate.' What did you understand that to mean?", "That the board had seen growth figures before and that's what they were used to.", { flags: ["evasive"] }],
  [63, 8, "Did you ever present contribution margin to the board or a board committee?", "Not that I recall."],
  [72, 5, "In Exhibit Okoro-7 you wrote that without seeing the transaction 'we would be relying on developer reporting.' Was that a concern about losing commission?", "Yes. Leakage was the main risk in every scenario.", { flags: ["admission"] }],
  [73, 18, "Scenario C in Exhibit Okoro-8 — processors allowed and a 20 percent commission — retains 79.4 per 100 of commission. Who asked for a 20 percent scenario?", "Sofia asked for a range. Twenty was the low end."],
  [76, 2, "Did anyone consider allowing third-party processors after that analysis?", "Not that I was involved in."],
  [88, 4, "Your 2020 analysis found that when developer proceeds fell, consumer prices rose in 64 percent of cases, with a median lag of five weeks?", "Yes. Developers target proceeds, so when proceeds change, prices move.", { flags: ["admission", "key"], note: "Pass-through admission; narrowed on cross at 142:3 (top-grossing apps only)." }],
  [88, 20, "So a change in the effective commission would likely be reflected in consumer prices?", "That's what the implication section says.", { flags: ["admission", "key"] }],
  [89, 11, "And the effect was asymmetric — prices rose more often than they fell?", "Yes. Increases were more common than decreases."],
  [92, 4, "Were those findings shared with anyone outside Services Finance?", "I don't know."],
  [101, 4, "When did you first see modelling for the Small Business Program?", "In November 2020, after the decision to announce it had been made.", { flags: ["contradiction", "key"], note: "Date conflict: Okoro-10 ({B:k06}) is dated 28 Sep 2020 and recommends preparing 'announcement materials for November'." }],
  [101, 15, "Exhibit Okoro-10 is dated September 28, 2020, and slide 6 says 'Prepare announcement materials for November.' That's your team's deck?", "It's my team's deck. I may have misremembered the timing."],
  [103, 9, "Slide 4 says almost all developers qualify at every threshold while 'the large developers who generate most commission do not.' Was that the design?", "That was the finding. The design was the threshold."],
  [104, 20, "At the one-million threshold the cost was 2.4 points of commission?", "Yes."],
  [121, 6, "Exhibit Okoro-11 shows outbound switching falling every year from 6.1 to 4.4 percent, while store spend per device rose. Did you prepare it?", "My team did, for a planning request."],
  [122, 14, "Did anyone discuss a connection between store spend and switching?", "Not with me."],
  [130, 6, "What did Ms. Cole advise about how the Small Business Program should be described?", "(Instructed not to answer.)", { objection: obj(DA, "privilege", "Instruct not to answer."), flags: ["privilege"] }],
  [135, 1, "(Examination by counsel for defendant.)", "(Mr. Mercer examining.)"],
  [140, 9, "Ms. Okoro, did your contribution summary include the cost of developing the operating system and developer tools?", "Not in the 85 figure. Those are shown separately and not allocated."],
  [142, 3, "Earlier you testified about pass-through at page 88. Is there anything you want to add?", "Yes. The 2020 analysis looked only at the top 2,000 grossing apps and at tier adjustments, not at commission changes. I wouldn't say it shows pass-through for all developers or all apps.", { flags: ["key"], note: "Late qualification of 88:4–88:20 on cross. Preserve both; the underlying finding (64% of prices rose) is unchanged." }],
  [143, 10, "Were subscriptions represented?", "Under-represented. That's in the caveat.", { objection: obj(EA, "form", "Leading.") }],
  [146, 2, "Is payment processing the only value In-App Purchase provides?", "No. There's fraud prevention, refunds, family sharing, parental controls, one account."],
  [150, 18, "(Further examination by Ms. Castell.)", "(Ms. Castell examining.)"],
  [152, 4, "Ms. Okoro, in the 2020 analysis, did any subset of apps show prices falling as often as they rose after a proceeds change?", "No. Decreases were less common across the board — 18 percent where proceeds rose."],
  [153, 19, "Your June 2022 email said 'We should not describe the update as price-neutral for consumers.' Why?", "Because based on our analysis prices were likely to move.", { flags: ["admission"] }],
  [156, 7, "Did anyone describe the 2022 tier update externally as price-neutral?", "I don't know what was said externally."],
  [186, 12, "Nothing further. (Whereupon, at 4:37 p.m., the deposition was adjourned.)", "(Signature reserved.)"],
];

export function buildOkoroDeposition(ix: DocIndex): Deposition {
  const { transcript, exhibits } = assemble(RAW, EXHIBITS, ix);
  return tagged<Deposition>({
    id: DEMO_DEPOSITIONS.paymentsFinance, matterId: M, witnessId: CUST.okoro.id, witnessName: CUST.okoro.name, witnessTitle: `${CUST.okoro.title} (fictional witness)`,
    date: "2026-05-20", takenBy: TAKEN_BY, defendingBy: DEFENDED_BY, location: "Hartwell & Pryor LLP (fictional), San Francisco, CA — Conference Room 21A", volume: 1, pages: 188,
    status: "reviewed", transcript, exhibits,
    aiDigest: {
      summary: "Finance lead for App Store Payments. Authenticated the FY2017 contribution summary (85.2 per 100 of commission before shared engineering), the payment-cost report (processing 2.5–3.5% of gross) and the 2020 pass-through analysis. Testified no one asked her to compare the rate to costs before 2021 and she never told anyone the commission tracked costs, contradicting Marsh 64:10. Narrowed the pass-through finding on cross (142:3).",
      keyAdmissions: [
        "Payment costs roughly a tenth of commission (29:5).",
        "Contribution 85.2 per 100 of commission; rate not set by reference to cost (36:10, 37:4).",
        "No cost comparison before 2021; commission did not track costs (41:3).",
        "Developers target proceeds; prices rose in 64% of cases when proceeds fell (88:4, 88:20).",
      ],
      themes: ["Commission vs. cost", "Payment processing", "Pass-through", "Board reporting", "Small Business Program timing"],
      credibilityNotes: ["'Left off for space' (60:12) is inconsistent with the Lindqvist email.", "Misdated first sight of SBP modelling (101:4 vs. Okoro-10)."],
      followUps: ["Depose Sofia Lindqvist on the board-slide instruction.", "Request underlying pass-through dataset (top 2,000 apps).", "Rule 30(b)(6) topic: cost-to-serve analyses before 2021."],
    },
  });
}
