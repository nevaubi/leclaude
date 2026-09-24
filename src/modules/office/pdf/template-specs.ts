/**
 * Document specs for PDF templates and seeds. Each builder returns a DocSpec
 * that `generatePdf` typesets with pdf-lib. Content is realistic litigation
 * paper for Calloway & Reyes LLP matters (AFFF MDL, Northgate v. Apex, …).
 */
import type { Block, CaptionSpec, DocSpec } from "./generate";

export interface SpecContext { matterId?: string; title?: string; date?: Date }

const AFFF_COURT = ["United States District Court", "District of South Carolina", "Charleston Division"];
const AFFF_LEFT = ["IN RE: AQUEOUS FILM-FORMING FOAMS PRODUCTS LIABILITY LITIGATION", "", "This Document Relates to: **All Cases**"];
const AFFF_RIGHT = ["MDL No. 2:18-mn-2873-RMG", "", "Hon. Richard M. Gergel"];
const NORTHGATE_COURT = ["Supreme Court of the State of New York", "County of New York: Commercial Division"];
const NORTHGATE_LEFT = ["NORTHGATE LOGISTICS HOLDINGS, LLC,", "                    Plaintiff,", "        – against –", "APEX FREIGHT SYSTEMS, INC.,", "                    Defendant."];
const NORTHGATE_RIGHT = ["Index No. 654412/2025", "", "Hon. Andrea Masley, J.S.C.", "Part 48"];

const FIRM_SIGNATURE = ["**Jordan Whitfield** (D.S.C. Bar No. 11642)", "Priya Raman", "**CALLOWAY & REYES LLP**", "1201 Main Street, Suite 2400", "Columbia, South Carolina 29201", "Tel. (803) 555-0140", "jwhitfield@callowayreyes.com", "", "*Counsel for Defendant Meridian Fluorochem Corp.*"];

function longDate(d = new Date()) { return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }
function afffCaption(title: string[]): CaptionSpec { return { court: AFFF_COURT, left: AFFF_LEFT, right: AFFF_RIGHT, title }; }
function northgateCaption(title: string[]): CaptionSpec { return { court: NORTHGATE_COURT, left: NORTHGATE_LEFT, right: NORTHGATE_RIGHT, title }; }

// ---------------------------------------------------------------------------
// Deposition notice
// ---------------------------------------------------------------------------
export function depositionNoticeSpec(ctx: SpecContext = {}, o: { witness?: string; witnessTitle?: string; date?: string; time?: string; location?: string; topics?: string[] } = {}): DocSpec {
  const witness = o.witness ?? "Helen Voss";
  const witnessTitle = o.witnessTitle ?? "Senior Toxicologist, Meridian Fluorochem Corp.";
  const date = o.date ?? "Thursday, October 22, 2026";
  const time = o.time ?? "9:30 a.m. Eastern";
  const location = o.location ?? "Calloway & Reyes LLP, 1201 Main Street, Suite 2400, Columbia, South Carolina 29201 (and by remote videoconference)";
  const topics = o.topics ?? [
    "The witness's role in Meridian's toxicology program from 1996 to 2012, including the design, review and internal circulation of the 1998 rodent study summarized at MFC-0102211.",
    "Receipt, routing and review of third-party PFOA/PFOS study data, including the November 1999 routing slip at MFC-0077102 and any related correspondence.",
    "The June 2001 draft TSCA §8(e) notice (MFC-0119377), the persons who reviewed it, the reasons it was not submitted, and any later drafts.",
    "Meridian's participation in the 2006 PFOA Stewardship Program (MFC-0140011) and the internal analyses supporting the phase-out decision.",
    "Communications with Gregory Hale, Nadia Brooks and Robert Kaine concerning the health effects of fluorosurfactants used in AFFF concentrate.",
    "The documents identified on Schedule A hereto and the witness's document retention practices.",
  ];
  return {
    title: ctx.title ?? `Notice of Deposition of ${witness}`,
    subject: "Deposition notice",
    keywords: ["deposition", "Fed. R. Civ. P. 30", witness],
    caption: afffCaption(["Notice of Videotaped Deposition of", witness]),
    blocks: [
      { type: "paragraph", text: `**TO:** Rebecca Klein, Plaintiffs' Executive Committee, Klein & Associates, 400 Poydras Street, Suite 2100, New Orleans, Louisiana 70130, and all counsel of record.` },
      { type: "paragraph", text: `PLEASE TAKE NOTICE that, pursuant to Rules 26 and 30 of the Federal Rules of Civil Procedure and Case Management Orders Nos. 3, 19 and 26, Defendant Meridian Fluorochem Corp. ("Meridian"), by and through its undersigned counsel, will take the videotaped deposition upon oral examination of **${witness}**, ${witnessTitle}, commencing on **${date}, at ${time}**, at ${location}, and continuing from day to day until completed.`, indent: true },
      { type: "paragraph", text: `The deposition will be taken before a notary public or other officer authorized to administer oaths and will be recorded by stenographic means and by videotape, with real-time transcription (LiveNote or equivalent) available to all parties. Pursuant to Fed. R. Civ. P. 30(b)(3)(A), the deposition may also be recorded by audio means. The videographer will be provided by Veritext Legal Solutions.`, indent: true },
      { type: "paragraph", text: `The deposition will be taken for the purposes of discovery, for use at trial, and for any other purpose permitted under the Federal Rules of Civil Procedure and the Federal Rules of Evidence. The deposition is expected to require one day of seven hours of testimony on the record, as provided by Fed. R. Civ. P. 30(d)(1), subject to the enlargement provisions of CMO No. 19 ¶ 7.`, indent: true },
      { type: "heading", text: "Subject Matter of Examination", level: 2 },
      { type: "paragraph", text: "Without limiting the scope of examination permitted by Rule 26(b)(1), Meridian anticipates that the examination will address the following subjects:" },
      ...topics.map((t, i) => ({ type: "numbered", number: `${i + 1}.`, text: t }) as Block),
      { type: "heading", text: "Documents to Be Produced at the Deposition", level: 2 },
      { type: "paragraph", text: "Pursuant to Fed. R. Civ. P. 30(b)(2) and 34, the deponent is requested to produce at the deposition the documents and electronically stored information described on **Schedule A**, to the extent not previously produced in this litigation with Bates numbers in the MFC- prefix series. Documents withheld on the basis of privilege shall be identified on a log conforming to CMO No. 9." },
      { type: "heading", text: "Confidentiality", level: 2 },
      { type: "paragraph", text: "The deposition transcript and exhibits shall be treated as **CONFIDENTIAL – SUBJECT TO PROTECTIVE ORDER** under Paragraph 14 of the Stipulated Protective Order (Dkt. 2:18-mn-2873, ECF No. 1183) for thirty (30) days following receipt of the final transcript, during which time any party may designate portions as Confidential or Highly Confidential – Attorneys' Eyes Only." },
      { type: "signature", lines: FIRM_SIGNATURE, dateLine: `Dated: ${longDate(ctx.date)}` },
      { type: "pagebreak" },
      { type: "heading", text: "Schedule A — Documents Requested", level: 1, align: "center" },
      { type: "paragraph", text: "**Definitions.** \"Document\" has the broadest meaning permitted by Fed. R. Civ. P. 34(a) and includes electronically stored information, drafts, and non-identical copies. \"Fluorosurfactant\" means any perfluorinated or polyfluorinated surface-active compound, including PFOA, PFOS, and their precursors, salts and homologues. The relevant period is January 1, 1996 through December 31, 2012 unless otherwise stated." },
      { type: "numbered", number: "1.", text: "All laboratory notebooks, study protocols, raw data and reports for the 1998 rodent hepatotoxicity study summarized at MFC-0102211, including peer review comments and statistical analyses." },
      { type: "numbered", number: "2.", text: "All routing slips, transmittal memoranda and correspondence concerning the receipt of third-party study data on fluorosurfactants between 1998 and 2002, including the document at MFC-0077102." },
      { type: "numbered", number: "3.", text: "All drafts of any notice, submission or communication to the U.S. Environmental Protection Agency under Section 8(e) of the Toxic Substances Control Act, 15 U.S.C. § 2607(e), including MFC-0119377 and any redlines, comment bubbles or metadata." },
      { type: "numbered", number: "4.", text: "Meeting minutes, agendas and presentations of the Product Stewardship Committee for 2005 and 2006 relating to the decision to join the PFOA Stewardship Program." },
      { type: "numbered", number: "5.", text: "The witness's calendar entries, travel records and expense reports reflecting meetings with regulators, trade associations or other manufacturers concerning fluorosurfactant toxicology." },
      { type: "numbered", number: "6.", text: "The witness's current curriculum vitae, publication list and a list of all prior deposition or trial testimony given in the last ten years." },
      { type: "table", columns: ["Bates range", "Description", "Custodian", "Date"], widths: [1.2, 2.6, 1.2, 1], rows: [
        ["MFC-0102211 – 0102248", "1998 rodent study summary and appendices", "H. Voss", "03/17/1998"],
        ["MFC-0077102 – 0077104", "Routing slip and cover memo re 3M data", "H. Voss", "11/04/1999"],
        ["MFC-0119377 – 0119391", "Draft §8(e) notice with legal comments", "R. Kaine", "06/22/2001"],
        ["MFC-0140011 – 0140036", "Stewardship Program decision memorandum", "N. Brooks", "01/26/2006"],
        ["MFC-0163402 – 0163409", "Toxicology program budget summaries FY2002–2008", "G. Hale", "various"],
      ] },
      { type: "paragraph", text: "Documents produced pursuant to this Schedule shall be produced in the format specified in the ESI Protocol (CMO No. 5) with load files, extracted text and the metadata fields listed in Appendix B thereto.", italic: true, size: 10 },
    ],
    footer: { left: "Notice of Deposition — " + witness, right: "Calloway & Reyes LLP" },
  };
}

// ---------------------------------------------------------------------------
// Protective order (two-tier)
// ---------------------------------------------------------------------------
export function protectiveOrderSpec(ctx: SpecContext = {}): DocSpec {
  return {
    title: ctx.title ?? "Stipulated Protective Order (Two-Tier Confidentiality)",
    subject: "Protective order",
    keywords: ["protective order", "confidentiality", "AEO", "Fed. R. Civ. P. 26(c)"],
    caption: afffCaption(["Stipulated Protective Order Governing", "Confidential and Highly Confidential Material"]),
    blocks: [
      { type: "paragraph", text: "WHEREAS, discovery in this multidistrict litigation will involve the production of trade secrets, proprietary formulations, non-public regulatory submissions, personnel records and protected health information; and WHEREAS, the parties have stipulated to the entry of this Order pursuant to Fed. R. Civ. P. 26(c) and Local Civ. Rule 26.08 (D.S.C.); it is hereby ORDERED as follows:", indent: true },
      { type: "heading", text: "1. Scope and Definitions", level: 2 },
      { type: "numbered", number: "1.1", text: "**\"Material\"** means all documents, electronically stored information, testimony, interrogatory answers, responses to requests for admission, and other information produced, served or otherwise disclosed in this Litigation, including all copies, excerpts, summaries and compilations thereof." },
      { type: "numbered", number: "1.2", text: "**\"Confidential Material\"** means Material that the Producing Party reasonably and in good faith believes contains non-public commercial, financial, personal or medical information the disclosure of which would be harmful to the Producing Party or a third party, including personnel files, information protected by 45 C.F.R. § 164.512(e), and information a party is obligated by contract or statute to keep confidential." },
      { type: "numbered", number: "1.3", text: "**\"Highly Confidential – Attorneys' Eyes Only Material\"** (\"AEO Material\") means Confidential Material that constitutes or reveals trade secrets within the meaning of 18 U.S.C. § 1839(3) or S.C. Code Ann. § 39-8-20(5), including chemical formulations, manufacturing process parameters, supplier and customer pricing, unpublished research protocols and raw toxicological data, the disclosure of which to a competitor would cause serious competitive injury." },
      { type: "numbered", number: "1.4", text: "**\"Producing Party\"** means any party or non-party that produces Material; **\"Receiving Party\"** means any party that receives Material; **\"Outside Counsel\"** means attorneys of record and their firms who are not employees of a party." },
      { type: "heading", text: "2. Designation of Material", level: 2 },
      { type: "numbered", number: "2.1", text: "Documents shall be designated by affixing the legend **\"CONFIDENTIAL – SUBJECT TO PROTECTIVE ORDER\"** or **\"HIGHLY CONFIDENTIAL – ATTORNEYS' EYES ONLY\"** to each page containing protected Material, in a manner that does not obscure the text and adjacent to the Bates number. Native files shall be designated by including the legend in the file name and on the accompanying slip sheet." },
      { type: "numbered", number: "2.2", text: "Deposition testimony may be designated on the record or by written notice served within thirty (30) days after receipt of the final transcript. All transcripts shall be treated as AEO Material during that period." },
      { type: "numbered", number: "2.3", text: "Designations shall be made in good faith and shall not be used to cover Material that is publicly available or that was independently obtained by the Receiving Party without breach of any obligation. Mass, indiscriminate or routinized designations are prohibited; the Court may impose sanctions on a party that designates Material without a good-faith basis." },
      { type: "heading", text: "3. Access to Confidential Material (Tier 1)", level: 2 },
      { type: "paragraph", text: "Confidential Material may be disclosed only to:" },
      { type: "bullets", items: [
        "the Receiving Party, its officers, directors and employees to whom disclosure is reasonably necessary for the Litigation;",
        "Outside Counsel and their paralegal, clerical, litigation support and e-discovery vendor personnel;",
        "experts and consultants retained for the Litigation who have executed **Exhibit A** (Acknowledgment and Agreement to Be Bound);",
        "the Court, its personnel, court reporters and videographers;",
        "mediators and their staff, and mock jurors who have executed Exhibit A;",
        "the author, addressee or any recipient of the Material, or any person who is shown on the face of the Material to have had prior access to it; and",
        "any deponent or trial witness, provided the witness may not retain a copy.",
      ] },
      { type: "heading", text: "4. Access to Highly Confidential – Attorneys' Eyes Only Material (Tier 2)", level: 2 },
      { type: "numbered", number: "4.1", text: "AEO Material may be disclosed only to the persons identified in Paragraphs 3(b) through 3(f). AEO Material **may not** be disclosed to a party, its officers, directors or employees, or to in-house counsel, except that each party may designate up to two (2) in-house attorneys who have no responsibility for competitive decision-making and who have executed Exhibit A; such designations shall be served in writing and are subject to objection within ten (10) days." },
      { type: "numbered", number: "4.2", text: "Before disclosing AEO Material to an expert or consultant, the Receiving Party shall serve on the Producing Party the expert's curriculum vitae, a list of engagements in the preceding five years, and the executed Exhibit A. The Producing Party may object within seven (7) days; disclosure shall not occur until the objection is resolved by agreement or by the Court." },
      { type: "numbered", number: "4.3", text: "AEO Material shall be maintained in a secure workspace with access limited to persons authorized under Paragraph 4.1, shall not be uploaded to any generative AI service that retains or trains on inputs, and shall be produced in the review platform with the AEO tier flag set so that platform permissions enforce the restriction." },
      { type: "heading", text: "5. Challenges to Designations", level: 2 },
      { type: "numbered", number: "5.1", text: "A Receiving Party may challenge a designation at any time by written notice identifying the Material by Bates number and stating the basis for the challenge. The parties shall meet and confer within fourteen (14) days. If the dispute is not resolved, the Producing Party shall move for an order upholding the designation within twenty-one (21) days after the conference; the Producing Party bears the burden of persuasion. Frivolous challenges and unjustified designations may both be sanctioned." },
      { type: "heading", text: "6. Use in Court Filings and at Trial", level: 2 },
      { type: "numbered", number: "6.1", text: "A party seeking to file Confidential or AEO Material shall comply with Local Civ. Rule 5.03 (D.S.C.) and the Court's Electronic Case Filing Policies and Procedures regarding sealed filings. Redacted public versions shall be filed within seven (7) days of the sealed filing." },
      { type: "numbered", number: "6.2", text: "The use of protected Material at trial shall be governed by a separate order to be entered at the final pretrial conference. Nothing in this Order restricts a party's use of its own Material." },
      { type: "heading", text: "7. Inadvertent Production; Rule 502(d)", level: 2 },
      { type: "numbered", number: "7.1", text: "Pursuant to Fed. R. Evid. 502(d), the production of any Material subject to the attorney-client privilege or work-product protection shall not constitute a waiver in this or any other federal or state proceeding. Upon written notice of a clawback, the Receiving Party shall within five (5) business days return or destroy the Material and all copies, and shall not use the Material for any purpose pending resolution of any challenge under Fed. R. Civ. P. 26(b)(5)(B)." },
      { type: "numbered", number: "7.2", text: "Inadvertent failure to designate Material may be corrected by written notice; the Receiving Party shall thereafter treat the Material in accordance with the corrected designation and make reasonable efforts to retrieve any copies disclosed to persons not authorized to receive it." },
      { type: "heading", text: "8. Protected Health Information", level: 2 },
      { type: "paragraph", text: "This Order constitutes a qualified protective order under 45 C.F.R. § 164.512(e)(1)(v). The parties are prohibited from using or disclosing protected health information for any purpose other than this Litigation and shall return or destroy such information at the conclusion of the Litigation." },
      { type: "heading", text: "9. Duration and Final Disposition", level: 2 },
      { type: "numbered", number: "9.1", text: "The obligations of this Order survive the termination of the Litigation. Within ninety (90) days after final disposition, each Receiving Party shall return or destroy all protected Material and certify in writing that it has done so, except that Outside Counsel may retain one archival copy of pleadings, expert reports, deposition transcripts and work product, which shall remain subject to this Order." },
      { type: "numbered", number: "9.2", text: "The Court retains jurisdiction to enforce this Order after the Litigation concludes." },
      { type: "paragraph", text: "**IT IS SO ORDERED.**", before: 10 },
      { type: "signature", lines: ["**Richard Mark Gergel**", "United States District Judge"], dateLine: `Charleston, South Carolina — ${longDate(ctx.date)}` },
      { type: "pagebreak" },
      { type: "heading", text: "Exhibit A — Acknowledgment and Agreement to Be Bound", level: 1, align: "center" },
      { type: "paragraph", text: "I, ______________________________ [print full name], of ______________________________ [address and employer], declare under penalty of perjury that I have read in its entirety and understand the Stipulated Protective Order entered in *In re: Aqueous Film-Forming Foams Products Liability Litigation*, MDL No. 2:18-mn-2873-RMG (D.S.C.). I agree to comply with and be bound by all of its terms and I understand and acknowledge that failure to comply could expose me to sanctions and punishment in the nature of contempt. I will not disclose in any manner any information or item subject to this Order to any person or entity except in strict compliance with its provisions." },
      { type: "paragraph", text: "I further agree to submit to the jurisdiction of the United States District Court for the District of South Carolina for the purpose of enforcing the terms of this Order, even if such enforcement proceedings occur after termination of this action. I designate ______________________________ [name and address] as my South Carolina agent for service of process in connection with this action or any proceedings related to enforcement of this Order." },
      { type: "spacer", height: 8 },
      { type: "field", name: "ack_name", label: "Printed name:", kind: "text", width: 280 },
      { type: "field", name: "ack_employer", label: "Employer / affiliation:", kind: "text", width: 240 },
      { type: "field", name: "ack_role", label: "Role in litigation:", kind: "dropdown", options: ["Expert witness", "Consultant", "Litigation support vendor", "In-house counsel (¶ 4.1)", "Mock juror", "Other"], width: 220 },
      { type: "field", name: "ack_date", label: "Date:", kind: "text", width: 160 },
      { type: "field", name: "ack_aeo", label: "I have been granted access to Highly Confidential – Attorneys' Eyes Only Material and understand the Tier 2 restrictions in Paragraph 4.", kind: "checkbox" },
      { type: "field", name: "ack_ai", label: "I will not upload protected Material to any generative AI service that retains or trains on inputs (¶ 4.3).", kind: "checkbox" },
      { type: "spacer", height: 18 },
      { type: "paragraph", text: "Signature: ____________________________________________" },
    ],
    footer: { left: "Stipulated Protective Order", right: "MDL No. 2873" },
  };
}

// ---------------------------------------------------------------------------
// Case management order excerpt (CMO 26 — Tier 2 custodial production)
// ---------------------------------------------------------------------------
export function cmoSpec(ctx: SpecContext = {}): DocSpec {
  return {
    title: ctx.title ?? "Case Management Order No. 26 — Tier 2 Custodial Production Protocol",
    subject: "Case management order",
    keywords: ["CMO", "custodial production", "ESI", "Tier 2"],
    caption: afffCaption(["Case Management Order No. 26", "(Tier 2 Custodial Production Protocol)"]),
    blocks: [
      { type: "paragraph", text: "This Order supplements Case Management Orders Nos. 5 (ESI Protocol), 9 (Privilege Logs) and 19 (Deposition Protocol) and governs the second tier of custodial document production by Defendant Meridian Fluorochem Corp. (\"Meridian\") in connection with the Group C bellwether cases. The Court has considered the parties' joint status report of September 8, 2026 (ECF No. 4712), Plaintiffs' motion to compel (ECF No. 4688) and Meridian's opposition (ECF No. 4701).", indent: true },
      { type: "heading", text: "I. Tier 2 Custodians", level: 1 },
      { type: "numbered", number: "1.", text: "Meridian shall collect and review documents from the following six (6) custodians (the \"Tier 2 Custodians\"): **Gregory Hale** (Director, Environmental Health & Safety), **Helen Voss** (Senior Toxicologist), **Nadia Brooks** (Product Stewardship Manager), **Alan Pryce** (VP, Fire Suppression Products), **Robert Kaine** (Associate General Counsel) and **Martin Suarez** (Regulatory Affairs Counsel)." },
      { type: "numbered", number: "2.", text: "The relevant period for Tier 2 collection is **January 1, 1996 through December 31, 2016**, except that for Mr. Kaine and Mr. Suarez the period shall begin January 1, 2000. Plaintiffs' request to extend the period for Ms. Voss to 1990 is DENIED without prejudice to renewal upon a showing, from the Tier 1 production, that responsive toxicology work predates 1996." },
      { type: "numbered", number: "3.", text: "Data sources shall include the custodians' Exchange mailboxes (including archived .pst files identified in Meridian's data map at ECF No. 4712-2), OneDrive and departmental SharePoint sites, the LIMS toxicology database export, and hard-copy files inventoried by Meridian's records vendor." },
      { type: "heading", text: "II. Search Methodology", level: 1 },
      { type: "numbered", number: "4.", text: "The parties shall meet and confer regarding search terms no later than **October 14, 2026**. Meridian shall apply the agreed terms set out in **Appendix A** and shall report hit counts, unique hit counts and family-inclusive counts per custodian within seven (7) days of the conference. Any term returning more than 25,000 family-inclusive documents for a single custodian shall be renegotiated in good faith." },
      { type: "numbered", number: "5.", text: "Meridian may use technology-assisted review (\"TAR 2.0 / continuous active learning\") to prioritize review, subject to the validation protocol in CMO No. 5 ¶ 12. Meridian shall disclose the elusion rate and recall estimate, with the 95% confidence interval, at the conclusion of review. A recall estimate below 75% shall require further review." },
      { type: "numbered", number: "6.", text: "Documents identified as privileged shall be logged in accordance with CMO No. 9. Email threads may be logged at the thread level; the log shall identify every attorney on the communication with an asterisk. Redactions shall bear the legend \"REDACTED – PRIVILEGE\" or \"REDACTED – PII\" as applicable." },
      { type: "heading", text: "III. Production Schedule and Format", level: 1 },
      { type: "numbered", number: "7.", text: "Meridian shall make rolling productions as follows: (a) a first production of no fewer than 40,000 documents by **October 14, 2026**; (b) subsequent productions every three (3) weeks thereafter; and (c) substantial completion by **December 18, 2026**. Meridian shall certify substantial completion by declaration of its e-discovery project manager." },
      { type: "numbered", number: "8.", text: "Productions shall be Bates-numbered consecutively in the **MFC-** prefix series beginning at **MFC-0060000** and shall bear the confidentiality legend required by the Protective Order in the lower-left corner of each page, with the Bates number in the lower-right corner. Native productions of spreadsheets and presentations shall be accompanied by a slip sheet bearing the Bates number and legend." },
      { type: "table", columns: ["Milestone", "Date", "Responsible", "Reference"], widths: [2.2, 1.2, 1.3, 1], rows: [
        ["Search-term meet and confer", "Oct. 14, 2026", "Both parties", "¶ 4"],
        ["Hit reports served", "Oct. 21, 2026", "Meridian", "¶ 4"],
        ["First rolling production (≥ 40,000 docs)", "Oct. 14, 2026", "Meridian", "¶ 7(a)"],
        ["Privilege log for first production", "Nov. 4, 2026", "Meridian", "CMO 9 ¶ 3"],
        ["Rebuttal expert reports", "Nov. 6, 2026", "Both parties", "CMO 23"],
        ["Substantial completion certification", "Dec. 18, 2026", "Meridian", "¶ 7(c)"],
        ["TAR validation report", "Jan. 8, 2027", "Meridian", "¶ 5"],
        ["Daubert motions", "Dec. 18, 2026", "Both parties", "CMO 23"],
      ] },
      { type: "numbered", number: "9.", text: "The metadata fields listed in Appendix B to CMO No. 5 shall be produced for every document. In addition, Meridian shall populate the **Custodian**, **AllCustodians**, **DateSent**, **DateLastModified**, **ThreadID** and **ConfidentialityTier** fields, and shall produce the hash value used for de-duplication (MD5)." },
      { type: "heading", text: "IV. Disputes", level: 1 },
      { type: "numbered", number: "10.", text: "Any dispute arising under this Order shall first be raised with the Special Master (Hon. Joseph F. Anderson, Jr., ret.) by joint letter not exceeding five (5) pages. The Special Master's recommendations shall be reviewed by the Court under the standard set out in CMO No. 2 ¶ 6. The parties are reminded that the Court expects proportionality, cooperation and candor in all discovery matters, and that the deadlines in this Order will not be extended absent a showing of good cause made before the deadline passes." },
      { type: "paragraph", text: "**AND IT IS SO ORDERED.**", before: 10 },
      { type: "signature", lines: ["**Richard Mark Gergel**", "United States District Judge"], dateLine: `Charleston, South Carolina — September 22, 2026` },
      { type: "pagebreak" },
      { type: "heading", text: "Appendix A — Agreed Search Terms (Tier 2)", level: 1, align: "center" },
      { type: "paragraph", text: "Terms are applied to extracted text and metadata, case-insensitive, with the proximity operator w/N meaning within N words. Terms marked † are limited to the Voss, Hale and Brooks custodial files.", size: 10 },
      { type: "table", columns: ["No.", "Search string", "Notes"], widths: [0.4, 2.8, 1.6], size: 9.5, rows: [
        ["A-1", "(PFOA OR PFOS OR C8 OR \"perfluorooctan*\" OR fluorosurfactant*) w/25 (toxic* OR hepat* OR liver OR carcino* OR \"bio-persist*\" OR bioaccum*)", "Core toxicology"],
        ["A-2", "(\"8(e)\" OR \"8e\" OR \"substantial risk\" OR TSCA) w/15 (notice OR notif* OR submi* OR report* OR draft)", "Regulatory knowledge"],
        ["A-3", "(\"stewardship program\" OR \"phase-out\" OR phaseout OR \"phase out\") w/20 (PFOA OR fluorosurfactant* OR AFFF)", "2006 program †"],
        ["A-4", "(AFFF OR \"film-forming\" OR \"fire fighting foam\" OR \"firefighting foam\" OR \"MIL-F-24385\") w/30 (formulat* OR specification OR \"mil spec\")", "Product formulation"],
        ["A-5", "(groundwater OR aquifer OR \"drinking water\" OR \"well water\") w/20 (contaminat* OR migrat* OR plume OR detect*)", "Environmental release"],
        ["A-6", "(\"3M\" OR DuPont OR Chemours OR Dynax OR \"Tyco\") w/15 (study OR data OR letter OR meeting)", "Industry communications"],
        ["A-7", "(\"MW-7\" OR \"monitoring well 7\" OR \"MW7\") ", "Site monitoring well †"],
        ["A-8", "(Voss OR Hale OR Brooks OR Pryce) w/10 (memo* OR \"routing slip\" OR transmittal)", "Internal routing"],
      ] },
    ],
    footer: { left: "CMO No. 26 — Tier 2 Custodial Production Protocol", right: "MDL No. 2:18-mn-2873-RMG" },
  };
}

// ---------------------------------------------------------------------------
// Subpoena duces tecum
// ---------------------------------------------------------------------------
export function subpoenaSpec(ctx: SpecContext = {}, o: { recipient?: string; recipientAddress?: string; returnDate?: string } = {}): DocSpec {
  const recipient = o.recipient ?? "Custodian of Records, Lowcountry Environmental Testing, LLC";
  const address = o.recipientAddress ?? "3350 Ashley Phosphate Road, North Charleston, South Carolina 29418";
  const returnDate = o.returnDate ?? "November 12, 2026 at 10:00 a.m.";
  return {
    title: ctx.title ?? "Subpoena to Produce Documents, Information, or Objects (Duces Tecum)",
    subject: "Subpoena duces tecum",
    keywords: ["subpoena", "Rule 45", "duces tecum"],
    caption: afffCaption(["Subpoena to Produce Documents, Information, or Objects", "or to Permit Inspection of Premises in a Civil Action"]),
    blocks: [
      { type: "paragraph", text: `**TO:** ${recipient}, ${address}` },
      { type: "paragraph", text: `☒ **Production:** YOU ARE COMMANDED to produce at the time, date, and place set forth below the following documents, electronically stored information, or objects, and to permit inspection, copying, testing, or sampling of the material: **See Attachment A.**` },
      { type: "keyvalue", rows: [["Place:", "Calloway & Reyes LLP, 1201 Main Street, Suite 2400, Columbia, SC 29201 (or by secure electronic transfer arranged with counsel)"], ["Date and time:", returnDate]], keyWidth: 110 },
      { type: "paragraph", text: "☐ **Inspection of Premises:** Not applicable." },
      { type: "paragraph", text: "The following provisions of Fed. R. Civ. P. 45 are attached — Rule 45(c), relating to the place of compliance; Rule 45(d), relating to your protection as a person subject to a subpoena; and Rule 45(e) and (g), relating to your duty to respond to this subpoena and the potential consequences of not doing so." },
      { type: "keyvalue", rows: [["Date:", longDate(ctx.date)], ["Issued by:", "CLERK OF COURT — or — Attorney's signature: /s/ Jordan Whitfield"]], keyWidth: 110 },
      { type: "paragraph", text: "The name, address, e-mail address, and telephone number of the attorney representing Defendant Meridian Fluorochem Corp., who issues or requests this subpoena, are: Jordan Whitfield, Calloway & Reyes LLP, 1201 Main Street, Suite 2400, Columbia, SC 29201; jwhitfield@callowayreyes.com; (803) 555-0140.", size: 10.5 },
      { type: "heading", text: "Notice to the Person Who Issues or Requests This Subpoena", level: 3 },
      { type: "paragraph", text: "If this subpoena commands the production of documents, electronically stored information, or tangible things or the inspection of premises before trial, a notice and a copy of the subpoena must be served on each party in this case before it is served on the person to whom it is directed. Fed. R. Civ. P. 45(a)(4).", size: 10.5 },
      { type: "pagebreak" },
      { type: "heading", text: "Proof of Service", level: 1, align: "center" },
      { type: "paragraph", text: "(This section should not be filed with the court unless required by Fed. R. Civ. P. 45.)", align: "center", italic: true, size: 10 },
      { type: "field", name: "svc_received", label: "I received this subpoena for (name of individual and title, if any):", kind: "text", width: 200 },
      { type: "field", name: "svc_date", label: "on (date):", kind: "text", width: 160 },
      { type: "field", name: "svc_served", label: "I served the subpoena by delivering a copy to the named person as follows:", kind: "text", width: 200 },
      { type: "field", name: "svc_method", label: "Method of service:", kind: "dropdown", options: ["Personal delivery", "Delivery to registered agent", "Certified mail, return receipt", "Electronic delivery by agreement"], width: 220 },
      { type: "field", name: "svc_fees", label: "Fees tendered ($):", kind: "text", width: 120 },
      { type: "field", name: "svc_unexecuted", label: "I returned the subpoena unexecuted because:", kind: "text", width: 240 },
      { type: "paragraph", text: "I declare under penalty of perjury that this information is true." },
      { type: "keyvalue", rows: [["Date:", "______________________"], ["Server's signature:", "______________________________"], ["Printed name and title:", "______________________________"], ["Server's address:", "______________________________"]], keyWidth: 150 },
      { type: "pagebreak" },
      { type: "heading", text: "Attachment A — Documents to Be Produced", level: 1, align: "center" },
      { type: "heading", text: "Definitions and Instructions", level: 2 },
      { type: "numbered", number: "1.", text: "\"You\" and \"Your\" mean Lowcountry Environmental Testing, LLC and its predecessors, officers, employees, agents and contractors. \"Meridian\" means Meridian Fluorochem Corp. \"The Site\" means the Meridian Berkeley County facility at 1800 Industrial Parkway, Moncks Corner, South Carolina, and the property within one mile of its boundary." },
      { type: "numbered", number: "2.", text: "\"Document\" has the meaning given in Fed. R. Civ. P. 34(a)(1)(A) and includes ESI, laboratory data files, chain-of-custody forms and QA/QC records. The relevant period is January 1, 2010 through the date of Your response." },
      { type: "numbered", number: "3.", text: "Produce ESI in the format described in CMO No. 5 (ESI Protocol) in this litigation, a copy of which accompanies this subpoena. Documents withheld on a claim of privilege shall be identified on a log." },
      { type: "heading", text: "Requests", level: 2 },
      { type: "numbered", number: "1.", text: "All analytical reports, raw instrument data (LC-MS/MS), calibration records and QA/QC documentation for groundwater samples collected from monitoring wells **MW-1 through MW-12** at the Site, including all samples from **MW-7**." },
      { type: "numbered", number: "2.", text: "All chain-of-custody forms, sampling logs, field notes and photographs for any sampling event at the Site." },
      { type: "numbered", number: "3.", text: "All communications with Meridian, the South Carolina Department of Environmental Services (formerly DHEC), or the U.S. EPA Region 4 concerning PFAS results at the Site, including any notices of exceedance of the 4 ppt MCL for PFOA or PFOS under 40 C.F.R. Part 141, Subpart Z." },
      { type: "numbered", number: "4.", text: "Your standard operating procedures for EPA Method 537.1 and Method 1633 in effect during the relevant period, and any deviations documented for Site samples." },
      { type: "numbered", number: "5.", text: "Invoices, engagement letters and statements of work with Meridian or its consultants (including Patel Groundwater Sciences) relating to the Site." },
      { type: "numbered", number: "6.", text: "Documents sufficient to identify each analyst and project manager who worked on Site samples, and their qualifications." },
    ],
    footer: { left: "Subpoena Duces Tecum — " + recipient.split(",")[0], right: "Fed. R. Civ. P. 45" },
  };
}

// ---------------------------------------------------------------------------
// Certificate of service
// ---------------------------------------------------------------------------
export function certificateOfServiceSpec(ctx: SpecContext = {}, o: { document?: string; date?: string; recipients?: string[][] } = {}): DocSpec {
  const document = o.document ?? "Defendant Meridian Fluorochem Corp.'s Objections and Responses to Plaintiffs' Fourth Set of Requests for Production";
  const recipients = o.recipients ?? [
    ["Rebecca Klein", "Klein & Associates", "Plaintiffs' Executive Committee", "rklein@kleinlaw.com", "CM/ECF and e-mail"],
    ["Michael T. Ferrante", "Ferrante Whitmore LLP", "Co-Lead Counsel for Plaintiffs", "mferrante@fwlaw.com", "CM/ECF and e-mail"],
    ["Susan Okonkwo-Reyes", "U.S. Department of Justice, ENRD", "Counsel for the United States", "susan.okonkwo-reyes@usdoj.gov", "CM/ECF"],
    ["David Lindqvist", "Lindqvist Shaw PC", "Counsel for Defendant Tyco Fire Products LP", "dlindqvist@lindqvistshaw.com", "E-mail (MDL service list)"],
    ["Priya Raman", "Calloway & Reyes LLP", "Counsel for Meridian (internal)", "praman@callowayreyes.com", "E-mail"],
  ];
  return {
    title: ctx.title ?? "Certificate of Service",
    subject: "Certificate of service",
    keywords: ["certificate of service", "Fed. R. Civ. P. 5"],
    caption: afffCaption(["Certificate of Service"]),
    blocks: [
      { type: "paragraph", text: `I, Jordan Whitfield, a member of the bar of this Court, hereby certify that on **${o.date ?? longDate(ctx.date)}**, I caused a true and correct copy of the foregoing **${document}** to be served on the persons listed below by the means indicated, in accordance with Fed. R. Civ. P. 5(b) and Case Management Order No. 2 ¶ 9 (electronic service through the MDL Centrality service list).`, indent: true },
      { type: "table", columns: ["Name", "Firm / office", "Role", "E-mail", "Method"], widths: [1.2, 1.4, 1.6, 1.6, 1.1], size: 9.5, rows: recipients },
      { type: "paragraph", text: "Documents designated **CONFIDENTIAL** or **HIGHLY CONFIDENTIAL – ATTORNEYS' EYES ONLY** under the Protective Order (ECF No. 1183) were transmitted through the secure file-transfer portal maintained by Calloway & Reyes LLP and not by unencrypted e-mail. Access credentials were sent under separate cover to the designated Tier 2 recipients only." },
      { type: "paragraph", text: "I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct. Executed at Columbia, South Carolina." },
      { type: "signature", lines: FIRM_SIGNATURE, dateLine: `Dated: ${o.date ?? longDate(ctx.date)}` },
    ],
    footer: { left: "Certificate of Service", right: "MDL No. 2873" },
  };
}

// ---------------------------------------------------------------------------
// Exhibit cover sheet
// ---------------------------------------------------------------------------
export function exhibitCoverSpec(ctx: SpecContext = {}, o: { exhibit?: string; description?: string; bates?: string; deponent?: string; date?: string; confidentiality?: string } = {}): DocSpec {
  const exhibit = o.exhibit ?? "A";
  return {
    title: ctx.title ?? `Exhibit ${exhibit}`,
    subject: "Exhibit cover sheet",
    keywords: ["exhibit", "cover sheet"],
    pageSize: [612, 792],
    margins: { top: 150, right: 72, bottom: 72, left: 72 },
    blocks: [
      { type: "paragraph", text: `**EXHIBIT ${exhibit}**`, align: "center", size: 40, after: 30 },
      { type: "rule" },
      { type: "spacer", height: 12 },
      { type: "keyvalue", keyWidth: 150, rows: [
        ["Case:", "In re: Aqueous Film-Forming Foams Products Liability Litigation, MDL No. 2:18-mn-2873-RMG (D.S.C.)"],
        ["Description:", o.description ?? "Meridian Fluorochem Corp. Product Stewardship Committee — Decision Memorandum re PFOA Stewardship Program"],
        ["Bates range:", o.bates ?? "MFC-0140011 – MFC-0140036"],
        ["Deponent:", o.deponent ?? "Nadia Brooks"],
        ["Date marked:", o.date ?? longDate(ctx.date)],
        ["Confidentiality:", o.confidentiality ?? "CONFIDENTIAL – SUBJECT TO PROTECTIVE ORDER"],
        ["Offered by:", "Defendant Meridian Fluorochem Corp."],
      ] },
      { type: "spacer", height: 30 },
      { type: "paragraph", text: "Reporter's exhibit sticker to be affixed below. Do not write on the underlying document.", align: "center", italic: true, size: 10 },
    ],
    footer: { center: `Exhibit ${exhibit}`, right: "Calloway & Reyes LLP" },
    outline: false,
  };
}

// ---------------------------------------------------------------------------
// Northgate MSA excerpt (seed)
// ---------------------------------------------------------------------------
export function northgateMsaSpec(ctx: SpecContext = {}): DocSpec {
  return {
    title: ctx.title ?? "Northgate / Apex Master Services Agreement — Excerpt (Arts. 7, 9, 12)",
    subject: "Contract excerpt",
    keywords: ["MSA", "limitation of liability", "termination", "Northgate", "Apex"],
    caption: northgateCaption(["Exhibit 4 to the Affirmation of Daniel Okafor", "Master Services Agreement dated March 3, 2023 (Excerpt)"]),
    blocks: [
      { type: "paragraph", text: "The following are true and correct excerpts of the Master Services Agreement between Northgate Logistics Holdings, LLC (\"Northgate\") and Apex Freight Systems, Inc. (\"Apex\") dated March 3, 2023 (the \"MSA\"), produced by Apex at **APEX-0000412 – APEX-0000471**. Internal page references are to the executed MSA. Portions not relevant to the pending motion are omitted; the complete MSA is filed under seal as Exhibit 4-A.", italic: true, size: 10.5 },
      { type: "heading", text: "Article 7 — Service Levels and Credits", level: 1 },
      { type: "numbered", number: "7.1", text: "**On-Time Performance.** Apex shall achieve an on-time delivery rate of not less than ninety-seven percent (97%) for all Shipments in each calendar month, measured in accordance with Schedule 7-A. \"On-time\" means delivery within the delivery window specified in the applicable Shipment Order, excluding delays caused by Force Majeure or by Northgate's failure to tender the Shipment on schedule." },
      { type: "numbered", number: "7.2", text: "**Service Credits.** If Apex fails to meet the On-Time Performance standard in any month, Apex shall credit Northgate two percent (2%) of the Monthly Fees for that month for each full percentage point below 97%, up to a maximum credit of fifteen percent (15%) of Monthly Fees. Service Credits are Northgate's sole and exclusive monetary remedy for a failure to meet the service levels in this Article 7, **except** as provided in Section 7.4 and Article 12." },
      { type: "numbered", number: "7.3", text: "**Reporting.** Apex shall deliver a monthly performance report within ten (10) Business Days after month-end in the format of Schedule 7-B, including root-cause analysis for every Shipment delivered more than twenty-four (24) hours late. Northgate may audit the underlying telematics data on thirty (30) days' notice, not more than twice per Contract Year." },
      { type: "numbered", number: "7.4", text: "**Chronic Failure.** If Apex fails to meet the On-Time Performance standard in any three (3) months in a rolling six-month period, or falls below ninety percent (90%) in any single month, such failure shall constitute a \"Chronic Failure\" entitling Northgate to terminate this Agreement for cause under Section 9.2 without the cure period set forth therein." },
      { type: "heading", text: "Article 9 — Term and Termination", level: 1 },
      { type: "numbered", number: "9.1", text: "**Term.** This Agreement shall commence on the Effective Date and continue for an initial term of three (3) years (the \"Initial Term\"), and shall thereafter renew automatically for successive one-year terms unless either party gives written notice of non-renewal at least one hundred eighty (180) days before the end of the then-current term." },
      { type: "numbered", number: "9.2", text: "**Termination for Cause.** Either party may terminate this Agreement upon written notice if the other party materially breaches this Agreement and fails to cure such breach within thirty (30) days after receipt of written notice describing the breach in reasonable detail. Notice of breach shall be delivered in accordance with Section 15.3 to the addresses set forth therein, with a copy to the receiving party's General Counsel." },
      { type: "numbered", number: "9.3", text: "**Termination for Convenience.** Northgate may terminate this Agreement for convenience upon ninety (90) days' written notice, subject to payment of the Early Termination Fee set forth in Schedule 9-A, which the parties agree is a reasonable estimate of Apex's unrecovered investment in dedicated equipment and is not a penalty." },
      { type: "numbered", number: "9.4", text: "**Transition Assistance.** Upon any termination or expiration, Apex shall provide up to one hundred twenty (120) days of transition assistance at the rates set forth in Schedule 4, including the orderly transfer of in-transit Shipments, return of Northgate-owned trailers and pallets, and delivery of all shipment data in a commercially reasonable electronic format." },
      { type: "heading", text: "Article 12 — Limitation of Liability", level: 1 },
      { type: "numbered", number: "12.1", text: "**Exclusion of Consequential Damages.** EXCEPT FOR (a) A PARTY'S INDEMNIFICATION OBLIGATIONS UNDER ARTICLE 11, (b) BREACH OF ARTICLE 10 (CONFIDENTIALITY), (c) A PARTY'S GROSS NEGLIGENCE, WILLFUL MISCONDUCT OR FRAUD, AND (d) LIABILITY FOR CARGO LOSS OR DAMAGE UNDER SECTION 6.5, NEITHER PARTY SHALL BE LIABLE TO THE OTHER FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS OR LOSS OF BUSINESS, ARISING OUT OF OR RELATING TO THIS AGREEMENT, HOWEVER CAUSED AND UNDER ANY THEORY OF LIABILITY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES." },
      { type: "numbered", number: "12.2", text: "**Cap.** EXCEPT FOR THE MATTERS EXCLUDED IN SECTION 12.1(a) THROUGH (d), EACH PARTY'S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE FEES PAID OR PAYABLE BY NORTHGATE TO APEX UNDER THIS AGREEMENT IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM. The parties acknowledge that the limitations in this Article 12 are an essential basis of the bargain and that the Fees reflect such limitations." },
      { type: "numbered", number: "12.3", text: "**Cargo Claims.** Apex's liability for loss of or damage to cargo shall be governed by 49 U.S.C. § 14706 and Section 6.5, provided that Apex's liability for any single Shipment shall not exceed the declared value stated on the bill of lading or, if none is stated, $250,000 per Shipment." },
      { type: "heading", text: "Article 15 — General (excerpt)", level: 1 },
      { type: "numbered", number: "15.3", text: "**Notices.** All notices shall be in writing and delivered by hand, by nationally recognized overnight courier, or by e-mail with confirmation of receipt, to: if to Northgate, 500 Seventh Avenue, 18th Floor, New York, NY 10018, Attn: Chief Operating Officer, with a copy to legal@northgatelogistics.com; if to Apex, 7100 Commerce Way, Suite 300, Memphis, TN 38118, Attn: President, with a copy to General Counsel, notices@apexfreight.com." },
      { type: "numbered", number: "15.7", text: "**Governing Law; Forum.** This Agreement shall be governed by the laws of the State of New York without regard to its conflict-of-laws principles. The parties consent to the exclusive jurisdiction of the state and federal courts located in New York County, New York, and waive trial by jury in any action arising out of this Agreement." },
      { type: "paragraph", text: "[Remainder of page intentionally left blank; signature page follows in the complete MSA at APEX-0000471.]", align: "center", italic: true, size: 10, before: 12 },
    ],
    footer: { left: "Exhibit 4 — MSA Excerpt", right: "Index No. 654412/2025" },
    bates: { prefix: "APEX-", start: 412, digits: 7, position: "bottom-right", legend: "CONFIDENTIAL — PRODUCED PURSUANT TO STIPULATED CONFIDENTIALITY ORDER" },
  };
}

// ---------------------------------------------------------------------------
// Meridian custodial production excerpt (seed — for redaction / PII demos)
// ---------------------------------------------------------------------------
export function custodialExcerptSpec(ctx: SpecContext = {}): DocSpec {
  return {
    title: ctx.title ?? "MFC-0060000 — Tier 2 Production Excerpt (Hale custodial file)",
    subject: "Production excerpt",
    keywords: ["production", "Bates", "custodial", "PII"],
    fontSize: 10.5,
    blocks: [
      { type: "paragraph", text: "**From:** Gregory Hale <g.hale@meridianfluorochem.com>\n**Sent:** Tuesday, April 11, 2006 4:47 PM\n**To:** Nadia Brooks <n.brooks@meridianfluorochem.com>; Helen Voss <h.voss@meridianfluorochem.com>\n**Cc:** Robert Kaine <r.kaine@meridianfluorochem.com>\n**Subject:** RE: MW-7 quarterly results — draft response to DHEC", font: "sans", size: 10 },
      { type: "rule" },
      { type: "paragraph", text: "Nadia, Helen —" },
      { type: "paragraph", text: "I have gone through the Q1 monitoring package from Lowcountry. The MW-7 result (PFOA 1,140 ng/L; PFOS 2,360 ng/L) is the third consecutive quarter above the internal action level we set in the 2005 stewardship plan. MW-3 and MW-9 remain non-detect. Before we send anything to DHEC I want Helen's read on whether the MW-7 trend is consistent with the historical fire-training area or whether we are looking at a new source on the north lot." },
      { type: "paragraph", text: "Rob has asked that the response go out under his review given the pending EPA information request. Please treat this thread as **privileged and confidential — prepared at the direction of counsel** and do not forward outside the distribution." },
      { type: "paragraph", text: "Also — HR needs the updated emergency contact for the sampling contractor's site lead. His details are: Marcus Delgado, DOB 03/14/1971, SSN 412-55-8367, cell (843) 555-0192, marcus.delgado@lowcountryenv.com. Please pass to Dana in HR and delete from your copy." },
      { type: "paragraph", text: "The reimbursement for the Q1 lab invoice should go to Lowcountry's operating account: First Palmetto Bank, routing 053200983, account no. 4471029835. Invoice 26-0412 total $18,640.00." },
      { type: "paragraph", text: "Greg" },
      { type: "paragraph", text: "Gregory Hale | Director, Environmental Health & Safety | Meridian Fluorochem Corp. | 1800 Industrial Parkway, Moncks Corner, SC 29461 | (843) 555-0110", size: 9, font: "sans" },
      { type: "spacer", height: 10 },
      { type: "rule" },
      { type: "paragraph", text: "**From:** Nadia Brooks\n**Sent:** Monday, April 10, 2006 9:12 AM\n**To:** Gregory Hale; Helen Voss\n**Subject:** MW-7 quarterly results — draft response to DHEC", font: "sans", size: 10 },
      { type: "paragraph", text: "Greg — attached is the draft cover letter to DHEC for the Q1 groundwater results. I kept the narrative factual and did not characterize the MW-7 exceedance beyond what the lab reported. Two items for you: (1) whether we reference the 2005 stewardship action level at all, since it is an internal number; and (2) whether Helen's 1998 rodent study summary should be referenced as background on the toxicology program. My instinct is no on both, but Rob may want the second point handled differently in light of the §8(e) history." },
      { type: "paragraph", text: "The stewardship program memo (MFC-0140011) commits us to a 95% reduction in PFOA emissions by 2010. If the MW-7 plume is migrating toward the Cooper River intake, we should model it now rather than wait for DHEC to ask. Raj Patel's group quoted $42,000 for the transport model; PO attached." },
      { type: "paragraph", text: "Nadia" },
      { type: "pagebreak" },
      { type: "paragraph", text: "**ATTACHMENT — DRAFT** cover letter to SCDHEC (not sent)", font: "sans", size: 10 },
      { type: "rule" },
      { type: "paragraph", text: "April 12, 2006", align: "right" },
      { type: "paragraph", text: "South Carolina Department of Health and Environmental Control\nBureau of Water — Groundwater Management Section\n2600 Bull Street\nColumbia, South Carolina 29201\nAttn: Ms. Carla Jennings, Hydrogeologist" },
      { type: "paragraph", text: "**Re: Meridian Fluorochem Corp., Berkeley County Facility — Permit No. SC0043215 — First Quarter 2006 Groundwater Monitoring Results**" },
      { type: "paragraph", text: "Dear Ms. Jennings:" },
      { type: "paragraph", text: "Enclosed please find the First Quarter 2006 groundwater monitoring report for the above-referenced facility, prepared by Lowcountry Environmental Testing, LLC in accordance with Condition 14 of the facility's NPDES permit and the Groundwater Monitoring Plan approved on June 3, 2004. Samples were collected from monitoring wells MW-1 through MW-12 on February 27–28, 2006 and analyzed for perfluorinated compounds by liquid chromatography/tandem mass spectrometry.", indent: true },
      { type: "paragraph", text: "Results for eleven of the twelve wells were consistent with prior sampling events. Monitoring well **MW-7**, located downgradient of the former fire-training area, reported perfluorooctanoic acid at 1,140 ng/L and perfluorooctane sulfonate at 2,360 ng/L. Meridian is evaluating the MW-7 results and will submit a supplemental assessment, including a proposed scope for additional delineation wells, within sixty (60) days. Please direct any questions to the undersigned at (843) 555-0110.", indent: true },
      { type: "paragraph", text: "Sincerely," },
      { type: "spacer", height: 24 },
      { type: "paragraph", text: "Gregory Hale\nDirector, Environmental Health & Safety" },
      { type: "paragraph", text: "cc: Robert Kaine, Esq. (Associate General Counsel)\n     Nadia Brooks (Product Stewardship)", size: 10 },
      { type: "pagebreak" },
      { type: "paragraph", text: "**ATTACHMENT — Lowcountry Environmental Testing, LLC**\nAnalytical Summary — Project 2006-0117 — Meridian Berkeley County\nSampling event: February 27–28, 2006 · Method: LC-MS/MS (Method 537 draft) · Units: ng/L", font: "sans", size: 10 },
      { type: "table", columns: ["Well", "Sample ID", "PFOA", "PFOS", "PFHxS", "Qualifier", "Analyst"], widths: [0.7, 1.3, 0.8, 0.8, 0.8, 0.9, 1.2], size: 9, rows: [
        ["MW-1", "LET-060227-01", "< 10", "< 10", "< 10", "U", "T. Nguyen"],
        ["MW-2", "LET-060227-02", "14", "22", "< 10", "J", "T. Nguyen"],
        ["MW-3", "LET-060227-03", "< 10", "< 10", "< 10", "U", "T. Nguyen"],
        ["MW-4", "LET-060227-04", "38", "61", "12", "", "T. Nguyen"],
        ["MW-5", "LET-060227-05", "27", "40", "< 10", "", "K. Ortiz"],
        ["MW-6", "LET-060227-06", "96", "188", "31", "", "K. Ortiz"],
        ["MW-7", "LET-060228-07", "1,140", "2,360", "412", "", "K. Ortiz"],
        ["MW-7 (dup)", "LET-060228-07D", "1,102", "2,290", "398", "", "K. Ortiz"],
        ["MW-8", "LET-060228-08", "210", "455", "77", "", "K. Ortiz"],
        ["MW-9", "LET-060228-09", "< 10", "< 10", "< 10", "U", "T. Nguyen"],
        ["MW-10", "LET-060228-10", "18", "33", "< 10", "J", "T. Nguyen"],
        ["MW-11", "LET-060228-11", "12", "19", "< 10", "J", "T. Nguyen"],
        ["MW-12", "LET-060228-12", "< 10", "15", "< 10", "J", "T. Nguyen"],
        ["Trip blank", "LET-060227-TB", "< 10", "< 10", "< 10", "U", "—"],
      ] },
      { type: "paragraph", text: "U = not detected above the reporting limit. J = estimated value between the method detection limit and the reporting limit. Duplicate RPD for MW-7: PFOA 3.4%, PFOS 3.0% (acceptance ≤ 30%). Matrix spike recoveries within 70–130%. Reviewed by: L. Castellanos, QA Manager, March 9, 2006.", size: 9 },
    ],
    footer: { left: "Hale custodial file — Q1 2006 MW-7 thread", center: "" },
    bates: { prefix: "MFC-", start: 60000, digits: 7, position: "bottom-right", legend: "CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER" },
    outline: false,
  };
}

/** Registry used by templates.ts and seed.ts to regenerate a document from its spec id. */
export const SPEC_BUILDERS: Record<string, (ctx: SpecContext) => DocSpec> = {
  "deposition-notice": (ctx) => depositionNoticeSpec(ctx),
  "protective-order": (ctx) => protectiveOrderSpec(ctx),
  "cmo-excerpt": (ctx) => cmoSpec(ctx),
  "subpoena-duces-tecum": (ctx) => subpoenaSpec(ctx),
  "certificate-of-service": (ctx) => certificateOfServiceSpec(ctx),
  "exhibit-cover": (ctx) => exhibitCoverSpec(ctx),
  "northgate-msa-excerpt": (ctx) => northgateMsaSpec(ctx),
  "custodial-excerpt": (ctx) => custodialExcerptSpec(ctx),
};
