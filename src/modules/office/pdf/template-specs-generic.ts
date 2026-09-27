/**
 * Generic document specs for the PDF template gallery. Reference content: no client, matter, person or
 * Bates series from any dataset. Bracketed placeholders ([CLIENT], [WITNESS], …) mark what the drafter
 * fills in; when the document is created on a matter, the caption, court, judge and client come from the
 * matter record (ctx.matter) instead of placeholders.
 */
import type { Block, CaptionSpec, DocSpec } from "./generate";

export interface GenericMatterInfo { name?: string; caption?: string; court?: string; judge?: string; client?: string }
export interface GenericSpecContext { matterId?: string; title?: string; date?: Date; matter?: GenericMatterInfo }

function longDate(d = new Date()) { return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }

function parts(ctx: GenericSpecContext) {
  const m = ctx.matter ?? {};
  return {
    court: m.court ? [m.court] : ["[NAME OF COURT]", "[DISTRICT / DIVISION]"],
    caseName: m.name ? m.name.toUpperCase() : "[CASE NAME]",
    caseNo: m.caption || "Case No. [NUMBER]",
    judge: m.judge ? `Hon. ${m.judge.replace(/^Hon\.?\s*/i, "")}` : "Hon. [JUDGE]",
    client: m.client || "[CLIENT]",
  };
}

function caption(ctx: GenericSpecContext, title: string[]): CaptionSpec {
  const p = parts(ctx);
  return { court: p.court, left: [p.caseName, "", "This Document Relates to: [ALL CASES / CASE]"], right: [p.caseNo, "", p.judge], title };
}

function signature(ctx: GenericSpecContext): string[] {
  const p = parts(ctx);
  return ["**[ATTORNEY NAME]** ([BAR NO.])", "[FIRM NAME]", "[STREET ADDRESS]", "[CITY, STATE ZIP]", "Tel. [PHONE]", "[EMAIL]", "", `*Counsel for ${p.client}*`];
}

export function genericDepositionNoticeSpec(ctx: GenericSpecContext = {}): DocSpec {
  const p = parts(ctx);
  return {
    title: ctx.title ?? "Notice of Deposition",
    subject: "Deposition notice",
    keywords: ["deposition", "Fed. R. Civ. P. 30"],
    caption: caption(ctx, ["Notice of Videotaped Deposition of", "[WITNESS NAME]"]),
    blocks: [
      { type: "paragraph", text: "**TO:** [OPPOSING COUNSEL], [FIRM], [ADDRESS], and all counsel of record." },
      { type: "paragraph", text: `PLEASE TAKE NOTICE that, pursuant to Rules 26 and 30 of the Federal Rules of Civil Procedure and the applicable case management orders, ${p.client}, by and through its undersigned counsel, will take the videotaped deposition upon oral examination of **[WITNESS NAME]**, [TITLE / AFFILIATION], commencing on **[DATE], at [TIME]**, at [LOCATION] (and by remote videoconference), and continuing from day to day until completed.`, indent: true },
      { type: "paragraph", text: "The deposition will be taken before a notary public or other officer authorized to administer oaths and will be recorded by stenographic means and by videotape, with real-time transcription available to all parties. Pursuant to Fed. R. Civ. P. 30(b)(3)(A), the deposition may also be recorded by audio means.", indent: true },
      { type: "paragraph", text: "The deposition will be taken for the purposes of discovery, for use at trial, and for any other purpose permitted under the Federal Rules of Civil Procedure and the Federal Rules of Evidence. It is expected to require one day of seven hours of testimony on the record, as provided by Fed. R. Civ. P. 30(d)(1).", indent: true },
      { type: "heading", text: "Subject Matter of Examination", level: 2 },
      { type: "paragraph", text: "Without limiting the scope of examination permitted by Rule 26(b)(1), the examination is expected to address:" },
      ...["[TOPIC 1: the witness's role and responsibilities during the relevant period]", "[TOPIC 2: specific documents, decisions or events]", "[TOPIC 3: communications with identified persons]", "The documents identified on Schedule A hereto and the witness's document retention practices."].map((t, i) => ({ type: "numbered", number: `${i + 1}.`, text: t }) as Block),
      { type: "heading", text: "Documents to Be Produced at the Deposition", level: 2 },
      { type: "paragraph", text: "Pursuant to Fed. R. Civ. P. 30(b)(2) and 34, the deponent is requested to produce at the deposition the documents and electronically stored information described on **Schedule A**, to the extent not previously produced. Documents withheld on the basis of privilege shall be identified on a privilege log." },
      { type: "heading", text: "Confidentiality", level: 2 },
      { type: "paragraph", text: "The transcript and exhibits shall be treated as **CONFIDENTIAL – SUBJECT TO PROTECTIVE ORDER** for thirty (30) days following receipt of the final transcript, during which time any party may designate portions under the protective order entered in this action." },
      { type: "signature", lines: signature(ctx), dateLine: `Dated: ${longDate(ctx.date)}` },
      { type: "pagebreak" },
      { type: "heading", text: "Schedule A — Documents Requested", level: 1, align: "center" },
      { type: "paragraph", text: "**Definitions.** \"Document\" has the broadest meaning permitted by Fed. R. Civ. P. 34(a) and includes electronically stored information, drafts, and non-identical copies. The relevant period is [START DATE] through [END DATE] unless otherwise stated." },
      ...["[REQUEST 1]", "[REQUEST 2]", "[REQUEST 3]", "The witness's current curriculum vitae and a list of all prior deposition or trial testimony given in the last ten years."].map((t, i) => ({ type: "numbered", number: `${i + 1}.`, text: t }) as Block),
      { type: "table", columns: ["Bates range", "Description", "Custodian", "Date"], widths: [1.2, 2.6, 1.2, 1], rows: [["[PREFIX-0000001–0000010]", "[Description]", "[Custodian]", "[Date]"], ["", "", "", ""], ["", "", "", ""]] },
    ],
    footer: { left: "Notice of Deposition", right: "[FIRM NAME]" },
  };
}

export function genericProtectiveOrderSpec(ctx: GenericSpecContext = {}): DocSpec {
  return {
    title: ctx.title ?? "Stipulated Protective Order",
    subject: "Protective order",
    keywords: ["protective order", "confidentiality", "Rule 26(c)", "Rule 502(d)"],
    caption: caption(ctx, ["Stipulated Protective Order"]),
    blocks: [
      { type: "paragraph", text: "The parties having stipulated and good cause appearing under Fed. R. Civ. P. 26(c), IT IS HEREBY ORDERED as follows:", indent: true },
      { type: "heading", text: "1. Scope", level: 2 },
      { type: "paragraph", text: "This Order governs all documents, electronically stored information, testimony and other material produced or disclosed in this action (\"Material\"), and all copies, excerpts and summaries of it.", indent: true },
      { type: "heading", text: "2. Designations", level: 2 },
      { type: "numbered", number: "2.1", text: "**Confidential.** Material that the producing party in good faith believes contains non-public commercial, financial, personal or proprietary information." },
      { type: "numbered", number: "2.2", text: "**Highly Confidential – Attorneys' Eyes Only.** Confidential Material whose disclosure to another party, even under this Order, would create a substantial risk of serious harm that could not be avoided by less restrictive means." },
      { type: "heading", text: "3. Access", level: 2 },
      { type: "paragraph", text: "Confidential Material may be disclosed only to counsel of record and their staff, the parties' officers and employees with a need to know, the Court and its personnel, court reporters, retained experts and consultants who have signed Exhibit A, and mediators. Highly Confidential Material may not be disclosed to party officers or employees other than designated in-house counsel under paragraph [__].", indent: true },
      { type: "heading", text: "4. Use of Material", level: 2 },
      { type: "paragraph", text: "Material shall be used solely for the prosecution, defense or settlement of this action. No recipient may upload protected Material to any generative AI or other service that retains or trains on inputs.", indent: true },
      { type: "heading", text: "5. Clawback (Fed. R. Evid. 502(d))", level: 2 },
      { type: "paragraph", text: "The production of privileged or work-product protected Material, whether inadvertent or otherwise, is not a waiver in this or any other proceeding. On notice, the receiving party shall return, sequester or destroy the Material within [__] days.", indent: true },
      { type: "heading", text: "6. Protected Health Information", level: 2 },
      { type: "paragraph", text: "This Order is a qualified protective order under 45 C.F.R. § 164.512(e)(1)(v). Protected health information shall be used only for this litigation and returned or destroyed at its conclusion.", indent: true },
      { type: "heading", text: "7. Filing Under Seal", level: 2 },
      { type: "paragraph", text: "A party seeking to file protected Material shall comply with the Court's local rules on sealed filings.", indent: true },
      { type: "heading", text: "8. Final Disposition", level: 2 },
      { type: "paragraph", text: "Within sixty (60) days after final disposition, each receiving party shall return or destroy all protected Material and certify that it has done so; counsel may retain archival copies of pleadings, transcripts and work product.", indent: true },
      { type: "signature", lines: ["**[JUDGE]**", "[TITLE]"], dateLine: `[CITY, STATE] — ${longDate(ctx.date)}` },
      { type: "pagebreak" },
      { type: "heading", text: "Exhibit A — Acknowledgment and Agreement to Be Bound", level: 1, align: "center" },
      { type: "paragraph", text: "I have read the Stipulated Protective Order entered in this action, understand its terms and agree to be bound by it. I submit to the jurisdiction of the Court for enforcement of the Order." },
      { type: "field", name: "ack_name", label: "Printed name:", kind: "text", width: 280 },
      { type: "field", name: "ack_employer", label: "Employer / affiliation:", kind: "text", width: 240 },
      { type: "field", name: "ack_role", label: "Role in litigation:", kind: "dropdown", options: ["Expert witness", "Consultant", "Litigation support vendor", "In-house counsel", "Mock juror", "Other"], width: 220 },
      { type: "field", name: "ack_date", label: "Date:", kind: "text", width: 160 },
      { type: "field", name: "ack_aeo", label: "I have been granted access to Highly Confidential – Attorneys' Eyes Only Material and understand the restrictions in paragraph 3.", kind: "checkbox" },
      { type: "field", name: "ack_ai", label: "I will not upload protected Material to any generative AI service that retains or trains on inputs (paragraph 4).", kind: "checkbox" },
      { type: "spacer", height: 18 },
      { type: "paragraph", text: "Signature: ______________________________" },
    ],
    footer: { left: "Stipulated Protective Order", right: "[CASE NO.]" },
  };
}

export function genericCmoSpec(ctx: GenericSpecContext = {}): DocSpec {
  return {
    title: ctx.title ?? "Case Management Order",
    subject: "Case management order",
    keywords: ["CMO", "ESI", "custodial production"],
    caption: caption(ctx, ["Case Management Order No. [__]", "(Custodial Production Protocol)"]),
    blocks: [
      { type: "paragraph", text: "This Order governs the collection, review and production of custodial documents and electronically stored information. It supplements the ESI protocol entered in this action; where they conflict, this Order controls.", indent: true },
      { type: "heading", text: "I. Custodians", level: 2 },
      { type: "table", columns: ["Custodian", "Title / role", "Date range", "Sources"], widths: [1.4, 1.8, 1.2, 1.6], rows: [["[Name]", "[Title]", "[Start – End]", "Email; network shares; mobile"], ["[Name]", "[Title]", "[Start – End]", "Email; network shares"], ["", "", "", ""]] },
      { type: "heading", text: "II. Search Methodology", level: 2 },
      { type: "numbered", number: "1.", text: "The producing party shall apply the agreed search terms in Appendix A to the custodial sources, after de-duplication across custodians." },
      { type: "numbered", number: "2.", text: "The producing party may use technology-assisted review, provided it discloses the tool, the training approach and a validation protocol with an elusion sample sufficient to estimate recall of at least [__]% at a 95% confidence level." },
      { type: "numbered", number: "3.", text: "Documents that hit on a search term but are not produced shall be sampled and the results shared with the requesting party on request." },
      { type: "heading", text: "III. Production Schedule", level: 2 },
      { type: "table", columns: ["Milestone", "Date", "Responsible", "Reference"], widths: [2.2, 1.2, 1.3, 1], rows: [["Collection complete", "[Date]", "[Party]", "¶ I"], ["Hit report exchanged", "[Date]", "[Party]", "¶ II.1"], ["Rolling productions begin", "[Date]", "[Party]", "¶ III"], ["Production substantially complete", "[Date]", "[Party]", "¶ III"], ["Privilege log served", "[Date]", "[Party]", "¶ IV"]] },
      { type: "heading", text: "IV. Privilege Logs", level: 2 },
      { type: "paragraph", text: "Privilege logs shall be served within [__] days of each production and shall identify, for each document withheld or redacted, the date, author, recipients, privilege asserted and a description sufficient to assess the claim without revealing privileged content.", indent: true },
      { type: "heading", text: "V. Metadata", level: 2 },
      { type: "paragraph", text: "Productions shall include the metadata fields listed in the ESI protocol, including Custodian, AllCustodians, DateSent, DateLastModified and thread identifiers.", indent: true },
      { type: "signature", lines: ["**[JUDGE]**", "[TITLE]"], dateLine: `[CITY, STATE] — ${longDate(ctx.date)}` },
      { type: "pagebreak" },
      { type: "heading", text: "Appendix A — Agreed Search Terms", level: 1, align: "center" },
      { type: "table", columns: ["No.", "Search string", "Notes"], widths: [0.4, 2.8, 1.6], size: 9.5, rows: [["1", "[term] w/10 ([term] OR [term])", "[Notes]"], ["2", "[term]*", ""], ["3", "\"[phrase]\"", ""]] },
    ],
    footer: { left: "Case Management Order — Custodial Production Protocol", right: "[CASE NO.]" },
  };
}

export function genericSubpoenaSpec(ctx: GenericSpecContext = {}): DocSpec {
  const p = parts(ctx);
  return {
    title: ctx.title ?? "Subpoena Duces Tecum",
    subject: "Subpoena to produce documents",
    keywords: ["subpoena", "Rule 45"],
    caption: caption(ctx, ["Subpoena to Produce Documents, Information, or Objects", "(Fed. R. Civ. P. 45)"]),
    blocks: [
      { type: "keyvalue", rows: [["To:", "[RECIPIENT NAME], Custodian of Records"], ["Address:", "[RECIPIENT ADDRESS]"], ["Return date:", "[DATE AND TIME]"], ["Place of production:", "[FIRM NAME], [ADDRESS], or by secure electronic transfer"]], keyWidth: 130 },
      { type: "paragraph", text: "**YOU ARE COMMANDED** to produce at the time, date and place set forth above the documents, electronically stored information or objects described in **Attachment A**, and to permit inspection, copying, testing or sampling of the material.", indent: true },
      { type: "paragraph", text: "The provisions of Fed. R. Civ. P. 45(c), relating to the place of compliance; Rule 45(d), relating to your protection as a person subject to a subpoena; and Rule 45(e) and (g), relating to your duty to respond to this subpoena and the potential consequences of not doing so, are attached.", indent: true },
      { type: "keyvalue", rows: [["Date:", longDate(ctx.date)], ["Issued by:", "CLERK OF COURT — or — Attorney's signature: /s/ [ATTORNEY NAME]"]], keyWidth: 110 },
      { type: "paragraph", text: `The name, address, e-mail address, and telephone number of the attorney representing ${p.client}, who issues or requests this subpoena, are: [ATTORNEY NAME], [FIRM NAME], [ADDRESS], [EMAIL], [PHONE].`, size: 10 },
      { type: "pagebreak" },
      { type: "heading", text: "Proof of Service", level: 1, align: "center" },
      { type: "paragraph", text: "(This section should not be filed with the court unless required by Fed. R. Civ. P. 45.)", italic: true, size: 10 },
      { type: "field", name: "svc_received", label: "I received this subpoena for (name of individual and title, if any):", kind: "text", width: 200 },
      { type: "field", name: "svc_date", label: "on (date):", kind: "text", width: 160 },
      { type: "field", name: "svc_served", label: "I served the subpoena by delivering a copy to the named person as follows:", kind: "text", width: 200 },
      { type: "field", name: "svc_method", label: "Method of service:", kind: "dropdown", options: ["Personal delivery", "Delivery to registered agent", "Certified mail, return receipt", "Electronic delivery by agreement"], width: 220 },
      { type: "field", name: "svc_fees", label: "Fees tendered ($):", kind: "text", width: 120 },
      { type: "field", name: "svc_unexecuted", label: "I returned the subpoena unexecuted because:", kind: "text", width: 240 },
      { type: "paragraph", text: "I declare under penalty of perjury that this information is true." },
      { type: "paragraph", text: "Server's signature: ______________________________    Printed name and title: ______________________________" },
      { type: "pagebreak" },
      { type: "heading", text: "Attachment A — Documents to Be Produced", level: 1, align: "center" },
      { type: "paragraph", text: "**Instructions.** Produce documents as they are kept in the usual course of business, with ESI in native format or as searchable PDF with load files. If any document is withheld on a claim of privilege, describe it as required by Rule 45(e)(2). The relevant period is [START DATE] through [END DATE]." },
      ...["[REQUEST 1]", "[REQUEST 2]", "[REQUEST 3]", "Documents sufficient to identify the custodians and systems in which the documents requested above are maintained."].map((t, i) => ({ type: "numbered", number: `${i + 1}.`, text: t }) as Block),
    ],
    footer: { left: "Subpoena Duces Tecum", right: "Fed. R. Civ. P. 45" },
  };
}

export function genericCertificateOfServiceSpec(ctx: GenericSpecContext = {}): DocSpec {
  return {
    title: ctx.title ?? "Certificate of Service",
    subject: "Certificate of service",
    keywords: ["certificate of service"],
    caption: caption(ctx, ["Certificate of Service"]),
    blocks: [
      { type: "paragraph", text: `I, [ATTORNEY NAME], a member of the bar of this Court, hereby certify that on **${longDate(ctx.date)}**, I caused a true and correct copy of **[DOCUMENT TITLE]** to be served on the following counsel of record by the method indicated:`, indent: true },
      { type: "table", columns: ["Name", "Firm / office", "Role", "E-mail", "Method"], widths: [1.2, 1.4, 1.6, 1.6, 1.1], size: 9.5, rows: [["[Name]", "[Firm]", "[Counsel for …]", "[email]", "CM/ECF"], ["[Name]", "[Firm]", "[Counsel for …]", "[email]", "E-mail"], ["", "", "", "", ""]] },
      { type: "paragraph", text: "Material designated under the protective order was served by secure file transfer only and was not attached to any e-mail.", indent: true },
      { type: "signature", lines: signature(ctx), dateLine: `Dated: ${longDate(ctx.date)}` },
    ],
    footer: { left: "Certificate of Service", right: "[CASE NO.]" },
  };
}

export function genericExhibitCoverSpec(ctx: GenericSpecContext = {}): DocSpec {
  const p = parts(ctx);
  return {
    title: ctx.title ?? "Exhibit A",
    subject: "Exhibit cover sheet",
    keywords: ["exhibit"],
    blocks: [
      { type: "spacer", height: 160 },
      { type: "heading", text: "EXHIBIT [__]", level: 1, align: "center", bookmark: false },
      { type: "spacer", height: 24 },
      { type: "keyvalue", rows: [["Case:", p.caseName === "[CASE NAME]" ? "[CASE NAME], [CASE NO.]" : `${p.caseName}, ${p.caseNo}`], ["Description:", "[DESCRIPTION]"], ["Bates range:", "[PREFIX-0000001 – PREFIX-0000010]"], ["Deponent:", "[DEPONENT]"], ["Date marked:", "[DATE]"], ["Confidentiality:", "[CONFIDENTIALITY TIER]"]], keyWidth: 130 },
    ],
    footer: { center: "Exhibit [__]", right: "[FIRM NAME]" },
    outline: false,
  };
}

/** Generic builders by spec id; used for documents created from the template gallery. */
export const GENERIC_SPEC_BUILDERS: Record<string, (ctx: GenericSpecContext) => DocSpec> = {
  "deposition-notice": genericDepositionNoticeSpec,
  "protective-order": genericProtectiveOrderSpec,
  "cmo-excerpt": genericCmoSpec,
  "subpoena-duces-tecum": genericSubpoenaSpec,
  "certificate-of-service": genericCertificateOfServiceSpec,
  "exhibit-cover": genericExhibitCoverSpec,
};
