import type { CodingDecision } from "@/lib/types/domain";
import { DEMO_ID as D, type DocSpec } from "./doc-spec";
import { REVIEWER as R, type CustKey } from "./people";

/**
 * Privileged documents: communications with the fictional in-house counsel (Hannah Cole, Ruth Adeyemi) and fictional
 * outside counsel (Colin Mercer). In this plaintiffs' workspace "privileged" records the defendant's assertion (the
 * documents were clawed back under the Rule 502(d) order and are logged); reviewers track whether to challenge it.
 */

const HEAD = "PRIVILEGED & CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION";
const WP = "PRIVILEGED & CONFIDENTIAL — ATTORNEY WORK PRODUCT — PREPARED IN ANTICIPATION OF LITIGATION";

interface P {
  slug: string; date: string; time?: string; cust: CustKey; type?: DocSpec["type"]; subject: string; from: string; to: string[]; cc?: string[];
  basis: NonNullable<CodingDecision["privilegeBasis"]>; issues: string[]; body: string; pages?: number; reviewed?: string; note?: string; thread?: string; tags?: string[];
}

function priv(p: P): DocSpec {
  const header = p.basis === "work-product" ? WP : HEAD;
  return {
    id: D(p.slug), date: p.date, time: p.time, cust: p.cust, type: p.type ?? "Email", subject: p.subject, from: p.from, to: p.to, cc: p.cc, thread: p.thread, pages: p.pages,
    aiScore: 70, aiIssues: ["LEG-01", ...p.issues],
    aiSummary: `${p.basis === "work-product" ? "Work-product communication" : "Communication"} between ${p.from} and ${p.to.join(", ")} concerning ${p.subject.toLowerCase()}; logged by defendant as ${p.basis === "work-product" ? "work product" : "attorney-client privileged"}.`,
    coding: {
      responsive: true, privileged: true, privilegeBasis: p.basis, issues: ["LEG-01", ...p.issues], confidentiality: "AEO",
      reviewerId: R.associate, reviewedAt: p.reviewed ?? "2026-08-26T10:00:00Z", notes: p.note ?? "Clawed back by defendant (502(d) notice); logged. Sequestered — do not use.",
    },
    tags: ["clawback", ...(p.tags ?? [])],
    body: `${header}\n\n${p.body}`,
  };
}

export const PRIVILEGED_DOCS: DocSpec[] = [
  priv({ slug: "l01", date: "2016-07-06", time: "12:02", cust: "okoro", subject: "Subscription rate change — disclosure considerations", from: "Hannah Cole", to: ["Rachel Okoro"], cc: ["Lena Marsh"], basis: "attorney-client", issues: ["ASC-01"],
    body: `Rachel,

You asked whether the year-two subscription change requires any change to the developer agreement or public disclosures. My advice: the change can be implemented through a schedule amendment; the announcement should describe eligibility precisely, and the model assumptions should stay internal because they would be read as an admission about what the rate reflects.

Hannah` }),
  priv({ slug: "l02", date: "2017-05-10", time: "10:14", cust: "marsh", subject: "Kitebird request — guideline wording", from: "Hannah Cole", to: ["Lena Marsh"], basis: "attorney-client", issues: ["AST-01"],
    body: `Lena,

On the Kitebird response: you asked whether a text-only price reference falls within the current guideline language. As written, "direct customers to purchasing mechanisms" is ambiguous for a statement without a link. I recommend revising the guideline to address price references expressly before relying on it in further rejections, and keeping rejection explanations to the guideline text.

Hannah` }),
  priv({ slug: "a06", date: "2018-07-18", time: "18:40", cust: "marsh", subject: "Draft rationale memo — comments", from: "Hannah Cole", to: ["Lena Marsh"], basis: "attorney-client", issues: ["AST-01", "ASC-01"],
    body: `Lena,

Comments on draft v1 of the anti-steering rationale memo, as requested:

1. Paragraph 3: the way the commercial effect is described is a legal risk. Please revise so the memo states the rationale that applies to every app, and move the commercial discussion into a separate note to Graham if needed.
2. Appendix A: fine.

Happy to discuss.

Hannah`, note: "Clawed back; logged as legal advice on the rationale memo. Compare draft v1 and final para. 3 — possible challenge on the business-advice portion." , tags: ["privilege-challenge"] }),
  priv({ slug: "l04", date: "2018-10-04", time: "19:22", cust: "marsh", subject: "Mini-app conditions — legal risk", from: "Hannah Cole", to: ["Lena Marsh", "Graham Whitaker"], basis: "attorney-client", issues: ["SUP-01"],
    body: `Lena, Graham —

You asked for a view on the proposed conditions for Kitebird's mini-programs. The individual-submission condition is defensible on review grounds. The no-directory condition is harder to explain on safety grounds alone and is the part a regulator would focus on. My recommendation is to document the review rationale for each condition now.

Hannah` }),
  priv({ slug: "s05", date: "2019-03-20", cust: "cole", type: "Memo", pages: 3, subject: "Super app guideline revisions — legal risk analysis", from: "Hannah Cole", to: ["Lena Marsh", "Graham Whitaker"], basis: "attorney-client", issues: ["SUP-01", "MKT-01"],
    body: `MEMORANDUM
TO: Lena Marsh; Graham Whitaker
FROM: Hannah Cole, Senior Counsel, Competition
DATE: March 20, 2019
RE: Proposed guideline revisions for apps hosting mini-apps

You asked for an assessment of the proposed guideline revisions. This memo addresses (1) how the revisions would be analysed under the monopolization and tying frameworks, (2) the documentation needed to support the review rationale, and (3) recommended wording.
\fAnalysis and recommendations are set out in Parts II–IV.
\fPart IV — Recommended wording (attached).` }),
  priv({ slug: "l06", date: "2019-09-12", time: "08:31", cust: "marsh", subject: "Request for advice — small developer rate option", from: "Lena Marsh", to: ["Hannah Cole"], basis: "attorney-client", issues: ["ASC-01"],
    body: `Hannah,

Before Finance models option B from my September 10 memo (a reduced rate for developers under a revenue threshold), I'd like your advice on (1) whether a threshold-based rate raises discrimination issues under the developer agreement and (2) how the program should be described given the pending inquiries.

Lena` }),
  priv({ slug: "k08", date: "2020-11-03", time: "17:05", cust: "okoro", subject: "Small Business Program — eligibility rules and regulatory exposure", from: "Hannah Cole", to: ["Lena Marsh", "Rachel Okoro"], basis: "attorney-client", issues: ["ASC-01"], thread: "demo_apl_thr_sbp_messaging",
    body: `Lena, Rachel —

Following up on Lena's messaging email: my advice on the associated-developer rules and on how the program is described. (1) The associated-developer rule should be stated in the terms, not only in FAQs. (2) The program should not be described as a response to any inquiry or lawsuit. (3) Finance's scenario deck should not be shared outside the working group.

Hannah` }),
  priv({ slug: "p05", date: "2020-08-24", time: "09:50", cust: "marsh", subject: "Legal assessment — enforcement options", from: "Ruth Adeyemi", to: ["Lena Marsh", "Graham Whitaker"], basis: "attorney-client", issues: ["IAP-01", "AST-01"], thread: "demo_apl_thr_enforcement_2020",
    body: `Lena, Graham —

You asked for Legal's view on the enforcement steps in Lena's email this morning. Rejecting further updates is consistent with the agreement. Removing the developer's other apps or tools would raise additional risk and should not be done without further advice. Litigation is likely; please preserve all related communications.

Ruth` }),
  priv({ slug: "l09", date: "2020-08-25", cust: "cole", type: "Memo", pages: 2, subject: "Litigation hold — App Store distribution, payments and platform interoperability", from: "Hannah Cole", to: ["Lena Marsh", "Victor Ames", "Rachel Okoro", "Marcus Lee", "Priya Nand", "Daniel Frey", "Tomas Reyes"], basis: "attorney-client", issues: [],
    body: `LEGAL HOLD NOTICE

You are receiving this notice because you may have documents relevant to pending and anticipated litigation concerning App Store distribution and commissions, in-app payment rules, and interoperability of messaging, watch and wallet features.

Effective immediately, preserve all documents and data, including email, chat, drafts and personal devices used for work, from January 1, 2015 forward.
\fQuestions to Hannah Cole or Ruth Adeyemi. Do not forward this notice outside the listed recipients.` }),
  priv({ slug: "g06", date: "2021-02-03", cust: "cole", subject: "Streaming guideline — regulatory inquiry response draft", from: "Hannah Cole", to: ["Marcus Lee", "Lena Marsh"], basis: "work-product", issues: ["CGM-01"],
    body: `Marcus, Lena —

Attached is outside counsel's draft response to the inquiry on game streaming, prepared for the anticipated proceeding. Please check the factual statements in section 2 (review times, number of streaming apps) and send corrections to me only.

Hannah` }),
  priv({ slug: "l11", date: "2021-03-17", time: "15:40", cust: "okoro", subject: "Request — cost estimate for counsel", from: "Hannah Cole", to: ["Rachel Okoro"], basis: "work-product", issues: ["ASC-01"],
    body: `Rachel,

To help outside counsel evaluate the pending claims, please prepare an estimate of direct costs per dollar of commission for FY2020. Mark it as prepared at the request of Legal and send it only to me.

Hannah`, note: "Logged as work product. The resulting estimate (18 Mar 2021) was produced without redaction — waiver argument for the request itself.", tags: ["privilege-challenge"] }),
  priv({ slug: "w09", date: "2021-06-03", cust: "frey", subject: "Interoperability requests — legal considerations", from: "Hannah Cole", to: ["Daniel Frey", "Beatrice Kowal"], basis: "attorney-client", issues: ["SWI-01"],
    body: `Daniel, Beatrice —

You asked how pending interoperability proposals abroad and the U.S. inquiries affect responses to accessory makers. My advice: responses should state the technical and privacy basis for each limit specifically; general statements will be compared with internal documents. Please route draft responses to me before sending.

Hannah` }),
  priv({ slug: "n06", date: "2021-11-30", cust: "cole", type: "Memo", pages: 3, subject: "NFC access — regulatory commitments analysis", from: "Hannah Cole", to: ["Tomas Reyes", "Alicia Ferreira"], basis: "work-product", issues: ["NFC-01"],
    body: `MEMORANDUM (prepared in anticipation of proceedings)
TO: Tomas Reyes; Alicia Ferreira
FROM: Hannah Cole
DATE: November 30, 2021
RE: Options for third-party contactless access and potential commitments

This memo analyses possible commitments on third-party NFC access in response to regulatory inquiries, the litigation risk of each option and the evidence likely to be requested.
\fPart II — Options and risk assessment.
\fPart III — Documents likely to be requested; preservation reminder.` }),
  priv({ slug: "l14", date: "2022-01-21", time: "09:12", cust: "marsh", subject: "Link entitlement — terms review", from: "Hannah Cole", to: ["Lena Marsh"], basis: "attorney-client", issues: ["AST-01"], thread: "demo_apl_thr_link_entitlement",
    body: `Lena,

Separately from your note to Rachel: my comments on the draft entitlement terms. Section 2 should define "account management" narrowly; section 4 (no pricing information in the app) needs a stated rationale. Please do not circulate the scenario tab more widely.

Hannah` }),
  priv({ slug: "l15", date: "2022-09-12", cust: "nand", subject: "RCS — regulatory landscape", from: "Hannah Cole", to: ["Priya Nand", "Owen Hartley"], basis: "attorney-client", issues: ["MSG-01"],
    body: `Priya, Owen —

You asked whether upcoming interoperability rules would require RCS support. My view: likely yes in some jurisdictions within two to three years. Decisions not to support the standard should be documented with engineering reasons.

Hannah` }),
  priv({ slug: "l16", date: "2019-11-20", time: "08:15", cust: "lee", subject: "Request for advice — streaming per-title condition", from: "Marcus Lee", to: ["Hannah Cole"], basis: "attorney-client", issues: ["CGM-01"],
    body: `Hannah,

Before the January review, could you advise on the legal risk of option B in my streaming memo (per-title review for streamed games)? In particular whether requiring separate listings for server-side games creates exposure given the regulatory inquiries.

Marcus` }),
  priv({ slug: "l17", date: "2017-04-07", time: "09:30", cust: "reyes", subject: "Tandem Pay response — please review", from: "Tomas Reyes", to: ["Hannah Cole"], basis: "attorney-client", issues: ["NFC-01"],
    body: `Hannah,

Draft response to Tandem Pay below for your legal review before Alicia sends it. Is it acceptable to rely only on the security rationale?

Tomas` }),
  priv({ slug: "l18", date: "2018-05-31", time: "10:02", cust: "frey", subject: "Pulsewear — response wording", from: "Daniel Frey", to: ["Hannah Cole"], basis: "attorney-client", issues: ["SWI-01"],
    body: `Hannah,

Beatrice has declined both Pulsewear requests. I need your advice on how to word the response to Ines — specifically whether we can cite battery and privacy given the engineering estimate from last year.

Daniel`, note: "Clawed back and logged. Request for advice is privileged on its face; underlying facts (engineering estimate) are in produced documents." }),
  priv({ slug: "l19", date: "2023-02-08", cust: "cole", subject: "Draft interrogatory responses — commission rate topics", from: "Colin Mercer", to: ["Hannah Cole"], basis: "work-product", issues: ["ASC-01"],
    body: `Hannah,

Attached are our draft responses to Plaintiffs' Interrogatories 4–9 (commission rate, cost-to-serve, Small Business Program). Please confirm the factual statements with Finance by the 15th.

Colin Mercer
Hartwell & Pryor LLP` }),
  priv({ slug: "l20", date: "2023-03-15", cust: "okoro", subject: "Document collection — Services Finance", from: "Hannah Cole", to: ["Rachel Okoro", "Sofia Lindqvist"], basis: "attorney-client", issues: [],
    body: `Rachel, Sofia —

Outside counsel will collect the Services Finance shared folders next week. Please identify any locations not on the attached list, including personal folders used for board materials.

Hannah` }),
  priv({ slug: "l21", date: "2023-05-22", cust: "cole", subject: "Economic consultant — scope of engagement", from: "Colin Mercer", to: ["Hannah Cole", "Ruth Adeyemi"], basis: "work-product", issues: ["DMG-01"],
    body: `Hannah, Ruth —

Proposed scope for the consulting economist: (1) market definition; (2) pass-through; (3) critique of plaintiffs' damages model. Engagement through counsel to preserve work product.

Colin` }),
  priv({ slug: "l22", date: "2022-10-04", cust: "cole", type: "Memo", pages: 2, subject: "Class certification exposure — pass-through evidence", from: "Hannah Cole", to: ["Ruth Adeyemi"], basis: "work-product", issues: ["DMG-01"],
    body: `MEMORANDUM (work product)
TO: Ruth Adeyemi
FROM: Hannah Cole
RE: Internal analyses bearing on pass-through

This memo identifies internal finance analyses that plaintiffs will likely rely on for class-wide impact and assesses how each would be characterised.
\fAssessment of each analysis and recommended witness preparation.` }),
  priv({ slug: "l23", date: "2016-11-10", cust: "reyes", subject: "NFC access memo — comments", from: "Hannah Cole", to: ["Tomas Reyes"], basis: "attorney-client", issues: ["NFC-01"],
    body: `Tomas,

Comments on your November 8 memo as requested. Sections 3 and 4 should be revised; the recommendation should rest on the security design. I'd like to discuss before it goes to your leadership.

Hannah`, note: "Logged as legal advice on the 8 Nov 2016 NFC memo; the memo itself was produced.", tags: ["privilege-challenge"] }),
  priv({ slug: "l24", date: "2017-01-13", cust: "nand", subject: "Messaging client decision — legal considerations", from: "Hannah Cole", to: ["Owen Hartley", "Priya Nand"], basis: "attorney-client", issues: ["MSG-01"],
    body: `Owen, Priya —

As requested after yesterday's decision, my advice on documenting the deferral of the cross-platform client. The decision record should reflect the engineering and product reasons considered.

Hannah` }),
  priv({ slug: "l25", date: "2021-09-15", cust: "ames", type: "Chat", subject: "#legal-devrel — link entitlement questions", from: "Hannah Cole", to: ["Victor Ames"], basis: "attorney-client", issues: ["AST-01"],
    body: `[#legal-devrel · 15 Sep 2021]
10:02 Victor Ames: Hannah — devs asking whether games will get the link entitlement. what can I say?
10:05 Hannah Cole: Nothing beyond the published terms. Please don't characterise the reasons; send any regulator or press questions to me.
10:06 Victor Ames: understood` }),
];
