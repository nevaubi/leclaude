import type { Conflict } from "@/lib/types/domain";
import { MATTERS } from "@/lib/seed/ids";

const M = MATTERS.afff;
const VOSS = "dep_afff_voss_v1";
const HALE = "dep_afff_hale_v1";
const PRYCE = "dep_afff_pryce_v1";

type Side = Conflict["sides"][number];
const depo = (label: string, sourceId: string, cite: string, excerpt: string): Side => ({ label, sourceKind: "deposition", sourceId, cite, excerpt });
const doc = (label: string, sourceId: string, cite: string, excerpt: string): Side => ({ label, sourceKind: "document", sourceId, cite, excerpt });

export const AFFF_CONFLICTS: Conflict[] = [
  {
    id: "cf_afff_001", matterId: M, kind: "testimony_vs_document", severity: "high", status: "open", createdBy: "user",
    title: "Voss: 90-day study was 'preliminary' vs. Whitfield 'FINAL REPORT SUMMARY' and her own 'the Whitfield final' email",
    sides: [
      depo("Voss testimony", VOSS, "Voss 19:15", "From my perspective, in March 2001 it was a preliminary result. We did not yet have the individual animal data, and I had not completed my own review."),
      doc("Whitfield report summary", "ed_afff_0001", "MFC-0041877", "WHITFIELD LABORATORIES — FINAL REPORT SUMMARY — Study WL-2000-0417. NOAEL 0.1 mg/kg-day; test article persisted in serum after the recovery period."),
      doc("Voss email, 14 Mar 2001", "ed_afff_0002", "MFC-0041880", "The Whitfield final came in this afternoon … the liver effects are real, they are dose-related, and they did not fully reverse in the recovery animals."),
    ],
    analysis: "The witness characterises the March 2001 result as preliminary, but the report is captioned 'final', she used the word 'final' herself on the day it arrived, and she conceded at 24:5 that the dose-related liver effect was her opinion at the time. Her distinction between 'the deliverable' and 'the interpretation' (226:3) is the defence framing; plaintiffs will pair 19:15 with Pryce's 4 Apr 2001 email (MFC-0041942) that leans on 'our own toxicologist says is preliminary' to argue the label was adopted to defer reporting. Prepare her for the sequence Voss-1 → Voss-2 → Pryce-3 on redirect.",
  },
  {
    id: "cf_afff_002", matterId: M, kind: "date_inconsistency", severity: "high", status: "open", createdBy: "user",
    title: "Hale dates receipt of the 41 µg/L MW-7 result to 'late August 2002'; his transmittal email is dated 8 Jul 2002",
    sides: [
      depo("Hale testimony", HALE, "Hale 46:7", "That would have been late August 2002, when Beacon delivered the Q2 report."),
      doc("Hale email, 8 Jul 2002", "ed_afff_0057", "MFC-0052210", "Beacon's Q2 results for the Decatur wells are attached. I need decisions this week. MW-7 (downgradient of Lagoon 2): PFOS 41 µg/L."),
      doc("Beacon Q2 2002 report", "ed_afff_0058", "MFC-0052212", "Report date 3 July 2002."),
    ],
    analysis: "The witness corrected himself once shown Exhibit 4 (47:14) and again in his closing correction (208:2), so the error is cured on this record, but the seven-week gap matters: it compresses the interval between receipt and the October 24 city letter from ~60 days to 108 days. Expect plaintiffs to use the initial error to suggest the witness is minimising the delay. Vol. II prep: walk the July 3 → July 8 → July 9 → October 24 sequence with dates in hand.",
  },
  {
    id: "cf_afff_003", matterId: M, kind: "document_vs_document", severity: "medium", status: "open", createdBy: "user",
    title: "Hale EHS memo 'no adverse findings' vs. Voss email 'the liver effects are real' and Hale's own draft v2",
    sides: [
      doc("Hale EHS memo (final)", "ed_afff_0011", "MFC-0041912", "On the basis of the daily-dose comparison there are no adverse findings at exposures relevant to occupational use of the product."),
      doc("Voss email, 14 Mar 2001", "ed_afff_0002", "MFC-0041880", "the liver effects are real, they are dose-related, and they did not fully reverse in the recovery animals."),
      doc("Hale EHS memo (draft v2)", "ed_afff_0034", "MFC-0041965", "Effects observed are consistent with a persistent, bioaccumulative compound and margins for end-users cannot be established on current data."),
    ],
    analysis: "The final memo narrows the draft's end-user conclusion to occupational exposure and drops the persistence sentence. Hale attributes the edit to his own judgment (25:21) but concedes Pryce told him to 'stick to what EHS knew' (26:18). The two documents are consistent if read as answering different questions (plant exposure vs. hazard), which is the position to hold; the risk is the near-duplicate pairing in the production, which invites a 'sanitised' narrative.",
  },
  {
    id: "cf_afff_004", matterId: M, kind: "testimony_vs_document", severity: "high", status: "open", createdBy: "user",
    title: "Pryce: 'I did not restrict' the Whitfield report vs. 'keep to the four of us … do not forward'",
    sides: [
      depo("Pryce testimony", PRYCE, "Pryce 19:2", "I did not restrict it. I asked that it stay within the working group until we had met on Friday."),
      doc("Pryce email, 15 Mar 2001", "ed_afff_0004", "MFC-0041882", "please keep the report and the summary to the four of us. Do not forward it to the plant, to marketing, or to the Navy program office."),
      depo("Voss testimony", VOSS, "Voss 44:13", "Alan. He had said the same thing in an email the day before."),
    ],
    analysis: "Semantic quarrel the witness cannot win: the email is a distribution restriction on its face and Voss confirms the instruction was repeated at the Friday meeting. The defensible position is the one he gave at 18:10 (avoid a garbled version reaching customers before the working group met). Prep note: drop 'I did not restrict' and own the instruction with its rationale; the Navy did receive a summary in October 2002 (20:9).",
  },
  {
    id: "cf_afff_005", matterId: M, kind: "testimony_vs_document", severity: "high", status: "open", createdBy: "user",
    title: "Pryce: 'Budget was not a factor in the design' vs. 'Three groups, not four … takes it to about $920K'",
    sides: [
      depo("Pryce testimony", PRYCE, "Pryce 39:17", "Budget was not a factor in the design. The design was Whitfield's recommendation. Cost was a factor in what we did in that fiscal year."),
      doc("Pryce email, 11 Apr 2001", "ed_afff_0027", "MFC-0041948", "I will sign the bioassay. I will not sign $1.62M. … Bioassay: yes, but the reduced design. Three groups, not four, and drop the 12-month interim sacrifice. Whitfield told Paul on the phone that takes it to about $920K."),
      depo("Voss testimony", VOSS, "Voss 49:8", "Alan Pryce. It was a budget decision."),
    ],
    analysis: "Direct contradiction corroborated by the company's own toxicologist. Whitfield's proposal (MFC-0041945) was four groups with a 12-month interim sacrifice; the reduced design is Pryce's, priced in his own email. The salvageable point is scientific adequacy: the three-group study was capable of detecting carcinogenicity and did (Voss 233:14). Recommend an errata-sheet correction to 39:17 limited to 'cost was a factor in the number of dose groups'.",
  },
  {
    id: "cf_afff_006", matterId: M, kind: "position_inconsistency", severity: "medium", status: "open", createdBy: "user",
    title: "Pryce's account of 'Do not put this in email' (preliminary numbers) vs. the email's stated reason (hold until Legal reviews)",
    sides: [
      depo("Pryce testimony", PRYCE, "Pryce 72:14", "The numbers were preliminary and the recommendations were Greg's personal views."),
      doc("Pryce email, 9 Jul 2002", "ed_afff_0059", "MFC-0052217", "Do not put this in email. Not the recommendations, not the numbers, not the farm. … Nothing goes to the state or to the city until Legal has looked at it. That is not a 'no,' it is a 'not yet.'"),
      depo("Hale testimony", HALE, "Hale 50:16", "I had been told nothing goes to the state until Legal had looked at it."),
    ],
    analysis: "The Beacon report was a final laboratory report (Hale 48:3), so 'preliminary numbers' is not sustainable. The email's own rationale (legal review before external notification) is a better position and is consistent with Hale. The exposure is the phrase 'not the farm' — the Kessler private well — which reads as concealment; the answer is that the well was sampled in 2003 (Hale 52:14) and the city was offered sampling in October 2002.",
  },
  {
    id: "cf_afff_007", matterId: M, kind: "testimony_vs_testimony", severity: "medium", status: "open", createdBy: "user",
    title: "Who owned the 2001 MSDS language: Voss says Hale had no role; Hale says he 'signed off with Helen'",
    sides: [
      depo("Voss testimony", VOSS, "Voss 156:20", "Not that I recall. It was Product Stewardship and Alan."),
      depo("Hale testimony", HALE, "Hale 142:6", "Product Stewardship drafted it; I signed off on the MSDS language with Helen, and Alan approved the final."),
      depo("Pryce testimony", PRYCE, "Pryce 49:8", "Greg was copied. It was my call."),
    ],
    analysis: "Three witnesses, three accounts of Hale's role. The documents (MFC-0041938, MFC-0041942) show Brooks drafting, Voss supplying Section 11 language, and Pryce deciding; Hale appears only as a cc. Voss and Pryce are consistent with the record; Hale overstates his involvement. Low stakes on the merits but it will be used to attack Hale's reliability alongside the MW-7 date error. Address in Hale Vol. II.",
  },
  {
    id: "cf_afff_008", matterId: M, kind: "testimony_vs_testimony", severity: "medium", status: "open", createdBy: "user",
    title: "Voss says she objected to 'no adverse findings' verbally; Hale says Voss reviewed the memo without asking for changes",
    sides: [
      depo("Voss testimony", VOSS, "Voss 39:15", "No. That was Greg's framing. I would not have written 'no adverse findings' about a study that found dose-related liver effects."),
      depo("Voss testimony", VOSS, "Voss 40:6", "I raised it with Greg verbally. I did not put anything in writing."),
      depo("Hale testimony", HALE, "Hale 22:19", "Yes. Helen reviewed the final and did not ask for changes to that paragraph."),
    ],
    analysis: "Irreconcilable as stated; no contemporaneous document resolves it (Voss is a cc on MFC-0041912 and there is no reply). The practical answer is that both can be true — she raised it, he did not treat it as a change request. Neither witness should be pushed to call the other wrong. Consider whether Brooks (cc on the memo) recalls the exchange; ask in her Vol. II if one is taken.",
  },
  {
    id: "cf_afff_009", matterId: M, kind: "testimony_vs_document", severity: "medium", status: "open", createdBy: "user",
    title: "Voss: 'not a measured' half-life before March 2001 vs. her email reporting Whitfield's ~100-day verbal estimate as the number 'that worries me'",
    sides: [
      depo("Voss testimony", VOSS, "Voss 28:1", "I recall that Linda gave me a rough number on the phone. I would not have treated it as a determined value."),
      doc("Voss email, 14 Mar 2001", "ed_afff_0002", "MFC-0041880", "Her verbal estimate to me was a half-life in the rat on the order of 100 days. … The number that worries me is not the liver weight. It is the serum concentration in the recovery group."),
      doc("Sponsor QA re-analysis", "ed_afff_0017", "MFC-0041922", "Re-analysis of recovery-group serum: estimated elimination half-life 98–103 days."),
    ],
    analysis: "Not a true contradiction (she is consistent that the March value was an estimate), but the QA re-analysis a week later put a measured number on it (98–103 days), and she conceded at 28:14 that the estimate was 'the number that worried me'. Plaintiffs' theme: Meridian had a quantified persistence signal by 20 March 2001. Resolve by stipulating to the re-analysis date rather than fighting the estimate.",
  },
  {
    id: "cf_afff_010", matterId: M, kind: "document_vs_document", severity: "medium", status: "resolved", createdBy: "user",
    title: "Navy response says a 90-day summary went to EPA in June 2001; Suarez email shows the June 2001 EPA inquiry was still unanswered",
    sides: [
      doc("Pryce to NAVSEA, 7 Oct 2002", "ed_afff_0069", "MFC-0052238", "Meridian provided a summary of the 90-day study to EPA in June 2001 and will provide a copy to NAVSEA under our standard confidentiality terms."),
      doc("Suarez email, 8 Jun 2001", "ed_afff_0040", "MFC-0041976", "Feld called again this morning … I said I would need to check and get back to him. … My recommendation is option three [voluntary submission with cover letter]."),
      depo("Pryce testimony", PRYCE, "Pryce 88:12", "Martin told me a summary went to EPA in response to the voluntary data request. I relied on that."),
    ],
    analysis: "Resolved on the documents: the voluntary submission to OPPT went out 27 June 2001 under Suarez's cover letter (produced in the Tier 1 set, MFC-0031877, outside this workspace), so the Navy letter is accurate as to the fact though not the date precision. Pryce did not review the submission (89:3). Keep the Tier 1 cover letter in the Pryce exhibit binder for redirect.",
  },
  {
    id: "cf_afff_011", matterId: M, kind: "date_inconsistency", severity: "low", status: "dismissed", createdBy: "user",
    title: "Hale: Illinois EPA 'notified' by the October 2002 city letter vs. formal state submission in November 2002",
    sides: [
      depo("Hale testimony", HALE, "Hale 49:17", "The formal letter did not go until later."),
      depo("Pryce testimony", PRYCE, "Pryce 74:17", "The formal submission was in November, in response to their request."),
      doc("City of Decatur letter", "ed_afff_0063", "MFC-0052221", "Letter to City of Decatur Water Management — notification of shallow groundwater monitoring results and offer of wellfield sampling."),
    ],
    analysis: "Dismissed: the witnesses are describing two different recipients (city in October, state in November) and the testimony is consistent once the recipients are distinguished. No action.",
  },
];
