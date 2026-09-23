/**
 * Reusable legal drafting building blocks (pure JSON). Used by templates,
 * seeds and the agent's apply_template_section / insert_toc_after tools.
 */
import type { Matter } from "@/lib/types/domain";
import { makeHeading, makeParagraph, makeTable, newId, type PMNode, type DocSection } from "./doc-model";

export const FIRM = {
  name: "Calloway & Reyes LLP",
  address1: "1201 Main Street, Suite 1900",
  address2: "Columbia, South Carolina 29201",
  phone: "(803) 555-0140",
  email: "jwhitfield@callowayreyes.com",
};

export type TemplateSectionId = "signature_block" | "certificate_of_service" | "table_of_authorities_placeholder" | "caption_block" | "notary_block" | "verification" | "proposed_order" | "definitions" | "exhibit_list";

export const TEMPLATE_SECTIONS: { id: TemplateSectionId; label: string; description: string }[] = [
  { id: "caption_block", label: "Caption block", description: "Court caption with parties, case number, judge and document title" },
  { id: "signature_block", label: "Signature block", description: "Respectfully submitted, counsel signature with firm details" },
  { id: "certificate_of_service", label: "Certificate of service", description: "CM/ECF certificate of service" },
  { id: "table_of_authorities_placeholder", label: "Table of authorities", description: "Placeholder TOA with Cases / Statutes / Rules headings" },
  { id: "notary_block", label: "Notary block", description: "Jurat and notary acknowledgment" },
  { id: "verification", label: "Verification", description: "28 U.S.C. § 1746 declaration under penalty of perjury" },
  { id: "proposed_order", label: "Proposed order", description: "Short proposed order granting the motion" },
  { id: "definitions", label: "Definitions", description: "Standard defined terms for discovery requests" },
  { id: "exhibit_list", label: "Exhibit list", description: "Table of exhibits with description and Bates range" },
];

export interface CaptionInfo {
  court: string;
  division?: string;
  plaintiff: string;
  defendant: string;
  caseNo: string;
  judge?: string;
  documentTitle: string;
  extra?: string; // "MDL No. 2873" / "This document relates to: …"
}

export function captionFromMatter(m: Matter | null | undefined, documentTitle: string): CaptionInfo {
  if (!m) return { court: "IN THE UNITED STATES DISTRICT COURT\nFOR THE DISTRICT OF SOUTH CAROLINA", division: "CHARLESTON DIVISION", plaintiff: "[PLAINTIFF]", defendant: "[DEFENDANT]", caseNo: "Case No. [X:XX-cv-XXXXX]", judge: "[JUDGE]", documentTitle };
  const court = (m.court ?? "[COURT]").toUpperCase().replace(/^U\.S\. DISTRICT COURT FOR THE/, "IN THE UNITED STATES DISTRICT COURT\nFOR THE");
  if (m.id === "m_afff_2873") {
    return { court, division: "CHARLESTON DIVISION", plaintiff: "IN RE: AQUEOUS FILM-FORMING FOAMS PRODUCTS LIABILITY LITIGATION", defendant: "", caseNo: "MDL No. 2:18-mn-2873-RMG", judge: m.judge, documentTitle, extra: "This Document Relates To: [CASE NAME], No. 2:[XX]-cv-[XXXXX]-RMG" };
  }
  const [p, d] = (m.name.includes(" v. ") ? m.name.split(" v. ") : [m.client, "[DEFENDANT]"]);
  return { court, plaintiff: p.trim(), defendant: (d ?? "").trim(), caseNo: m.caption ? m.caption.replace(/\s*\(.*\)$/, "") : "Case No. [X:XX-cv-XXXXX]", judge: m.judge, documentTitle };
}

export function captionBlock(c: CaptionInfo): PMNode[] {
  const left = [`${c.plaintiff},`, "", c.defendant ? "Plaintiff," : "", "", c.defendant ? "v." : "", "", c.defendant ? `${c.defendant},` : "", "", c.defendant ? "Defendant." : ""].filter((s, i, a) => !(s === "" && a[i - 1] === ""));
  const right = [c.caseNo, "", c.judge ? `Hon. ${c.judge.replace(/^Hon\.\s*/, "")}` : "", "", c.extra ?? "", "", `**${c.documentTitle.toUpperCase()}**`].filter((s, i, a) => !(s === "" && a[i - 1] === ""));
  const cell = (lines: string[], type: "tableCell"): PMNode => ({ type, attrs: { id: newId(), colspan: 1, rowspan: 1, colwidth: null }, content: lines.map((l) => makeParagraph(l)) });
  const table: PMNode = { type: "table", attrs: { id: newId(), caption: true }, content: [{ type: "tableRow", attrs: { id: newId() }, content: [cell(left, "tableCell"), cell(right, "tableCell")] }] };
  return [
    ...c.court.split("\n").map((l) => makeParagraph(`**${l}**`, { textAlign: "center", pStyle: "caption_court" })),
    ...(c.division ? [makeParagraph(`**${c.division}**`, { textAlign: "center", pStyle: "caption_court" })] : []),
    makeParagraph(""),
    table,
    makeParagraph(""),
  ];
}

export function signatureBlock(opts: { date?: string; attorney?: string; barNo?: string; title?: string; forParty?: string } = {}): PMNode[] {
  const date = opts.date ?? "[DATE]";
  return [
    makeParagraph(`Dated: ${date}`),
    makeParagraph("Respectfully submitted,", { spacingBefore: 12 }),
    makeParagraph(`**${FIRM.name.toUpperCase()}**`, { indent: 4, spacingBefore: 12 }),
    makeParagraph("", { indent: 4 }),
    makeParagraph("/s/ " + (opts.attorney ?? "Jordan Whitfield"), { indent: 4, spacingBefore: 18 }),
    makeParagraph(`${opts.attorney ?? "Jordan Whitfield"} (${opts.barNo ?? "Fed. ID No. 11842"})`, { indent: 4 }),
    makeParagraph(FIRM.address1, { indent: 4 }),
    makeParagraph(FIRM.address2, { indent: 4 }),
    makeParagraph(`Telephone: ${FIRM.phone}`, { indent: 4 }),
    makeParagraph(`Email: ${FIRM.email}`, { indent: 4 }),
    makeParagraph(`*${opts.title ?? "Counsel for"} ${opts.forParty ?? "[PARTY]"}*`, { indent: 4, spacingBefore: 6 }),
  ];
}

export function certificateOfService(opts: { date?: string; documentTitle?: string; attorney?: string } = {}): PMNode[] {
  return [
    makeHeading("CERTIFICATE OF SERVICE", 2, { textAlign: "center" }),
    makeParagraph(`I hereby certify that on ${opts.date ?? "[DATE]"}, I electronically filed the foregoing ${opts.documentTitle ?? "[DOCUMENT TITLE]"} with the Clerk of Court using the CM/ECF system, which will send notification of such filing to all counsel of record. Any counsel not registered with CM/ECF has been served by first-class mail, postage prepaid, at the address of record.`),
    makeParagraph(`/s/ ${opts.attorney ?? "Jordan Whitfield"}`, { indent: 4, spacingBefore: 18 }),
    makeParagraph(opts.attorney ?? "Jordan Whitfield", { indent: 4 }),
  ];
}

export function tableOfAuthoritiesPlaceholder(): PMNode[] {
  return [
    makeHeading("TABLE OF AUTHORITIES", 1, { textAlign: "center" }),
    makeParagraph("**Cases**", { pStyle: "toa_group" }),
    makeParagraph("[Case name, reporter citation (court year)] .......................................... [page]"),
    makeParagraph("**Statutes and Regulations**", { pStyle: "toa_group" }),
    makeParagraph("[Title U.S.C. § section] .......................................... [page]"),
    makeParagraph("**Rules**", { pStyle: "toa_group" }),
    makeParagraph("Fed. R. Civ. P. [rule] .......................................... [page]"),
    makeParagraph("**Other Authorities**", { pStyle: "toa_group" }),
    makeParagraph("[Secondary source] .......................................... [page]"),
    makeParagraph("*[TOA placeholder — regenerate from marked citations before filing.]*", { pStyle: "caption" }),
  ];
}

export function notaryBlock(state = "South Carolina", county = "Richland"): PMNode[] {
  return [
    makeParagraph(`STATE OF ${state.toUpperCase()}\t)`, { spacingBefore: 18 }),
    makeParagraph("\t)  ss."),
    makeParagraph(`COUNTY OF ${county.toUpperCase()}\t)`),
    makeParagraph(`Sworn to and subscribed before me this ____ day of __________, 20__, by [AFFIANT], who is personally known to me or who produced __________ as identification.`, { spacingBefore: 12 }),
    makeParagraph("______________________________", { spacingBefore: 24 }),
    makeParagraph("Notary Public for the State of " + state),
    makeParagraph("My commission expires: __________"),
  ];
}

export function verification(declarant = "[DECLARANT]"): PMNode[] {
  return [
    makeHeading("VERIFICATION", 2, { textAlign: "center" }),
    makeParagraph(`I, ${declarant}, declare under penalty of perjury under the laws of the United States of America, pursuant to 28 U.S.C. § 1746, that I have read the foregoing and that the factual statements contained therein are true and correct to the best of my knowledge, information, and belief.`),
    makeParagraph("Executed on [DATE] at [CITY, STATE].", { spacingBefore: 12 }),
    makeParagraph("______________________________", { spacingBefore: 24 }),
    makeParagraph(declarant),
  ];
}

export function proposedOrder(title = "[MOTION TITLE]"): PMNode[] {
  return [
    makeHeading("[PROPOSED] ORDER", 1, { textAlign: "center" }),
    makeParagraph(`This matter is before the Court on ${title} (ECF No. [__]). Having considered the motion, the memoranda, the record, and the applicable law, the Court finds that the motion should be **GRANTED**.`),
    makeParagraph("IT IS THEREFORE ORDERED that the motion is GRANTED as set forth herein. [RELIEF]."),
    makeParagraph("IT IS SO ORDERED."),
    makeParagraph("______________________________", { spacingBefore: 24, indent: 4 }),
    makeParagraph("United States District Judge", { indent: 4 }),
    makeParagraph("[CITY], South Carolina\n[DATE]", { indent: 4 }),
  ];
}

export function discoveryDefinitions(parties: { requesting: string; responding: string }): PMNode[] {
  const defs = [
    `“**You**,” “**Your**,” and “**${parties.responding}**” mean ${parties.responding}, its predecessors, successors, parents, subsidiaries, affiliates, divisions, and each of its present and former officers, directors, employees, agents, attorneys, and all other persons acting or purporting to act on its behalf.`,
    `“**Document**” has the broadest meaning permitted by Fed. R. Civ. P. 34(a)(1)(A) and includes electronically stored information (“**ESI**”), drafts, non-identical copies, and all metadata.`,
    `“**Communication**” means any transmission of information by any means, including email, text or instant message, collaboration-platform message (e.g., Teams, Slack), letter, memorandum, voicemail, or oral conversation.`,
    `“**Concerning**” means relating to, referring to, describing, evidencing, constituting, reflecting, or commenting on.`,
    `“**Relevant Period**” means [START DATE] through the present, unless otherwise stated in a specific request.`,
    `“**Identify**,” with respect to a person, means to state the person’s full name, present or last known address and telephone number, and present or last known employer and title; with respect to a Document, means to state its date, author, recipients, type, subject, and Bates number, or to produce it.`,
  ];
  return [
    makeHeading("DEFINITIONS", 2),
    { type: "orderedList", attrs: { id: newId(), start: 1, listStyle: "decimal" }, content: defs.map((d) => ({ type: "listItem", attrs: { id: newId() }, content: [makeParagraph(d)] })) },
    makeHeading("INSTRUCTIONS", 2),
    { type: "orderedList", attrs: { id: newId(), start: 1, listStyle: "decimal" }, content: [
      "These requests are continuing. Supplement responses as required by Fed. R. Civ. P. 26(e).",
      "If any Document is withheld under a claim of privilege or work product, provide a privilege log conforming to Fed. R. Civ. P. 26(b)(5)(A) identifying the date, author, recipients, subject matter, and basis for the claim.",
      "Produce ESI in the form specified in the parties’ ESI Protocol [ECF No. __], or, absent a protocol, as single-page TIFF images with load files, extracted text, and the metadata fields listed in Schedule A; produce spreadsheets and audio/video files natively.",
      "If You object to part of a request, state the objection with specificity and respond to the remainder as required by Fed. R. Civ. P. 34(b)(2)(C).",
    ].map((d) => ({ type: "listItem", attrs: { id: newId() }, content: [makeParagraph(d)] })) },
  ];
}

export function exhibitList(rows: [string, string, string][] = [["A", "[Description]", "[BATES-START – BATES-END]"], ["B", "[Description]", "[BATES-START – BATES-END]"]]): PMNode[] {
  return [makeHeading("EXHIBIT LIST", 2), makeTable(["Exhibit", "Description", "Bates range"], rows.map((r) => [...r]))];
}

/** Table of contents generated from the current sections. */
export function tableOfContents(sections: DocSection[]): PMNode[] {
  const rows = sections.filter((s) => s.level <= 3).map((s) => makeParagraph(`${s.title} .......... ¶${s.index}`, { indent: Math.max(0, s.level - 1), pStyle: "toc_entry", tocRef: s.id }));
  return [
    { type: "heading", attrs: { id: newId(), level: 1, textAlign: "center", pStyle: "toc_title" }, content: [{ type: "text", text: "TABLE OF CONTENTS" }] },
    ...(rows.length ? rows : [makeParagraph("*[No headings yet — add Heading 1–3 paragraphs and regenerate.]*", { pStyle: "caption" })]),
  ];
}

export function buildTemplateSection(id: TemplateSectionId, ctx: { matter?: Matter | null; documentTitle?: string; date?: string }): PMNode[] {
  switch (id) {
    case "caption_block": return captionBlock(captionFromMatter(ctx.matter, ctx.documentTitle ?? "[DOCUMENT TITLE]"));
    case "signature_block": return signatureBlock({ date: ctx.date, forParty: ctx.matter ? `${ctx.matter.clientSide === "plaintiff" ? "Plaintiff" : ctx.matter.clientSide === "defendant" ? "Defendant" : ""} ${ctx.matter.client}`.trim() : undefined });
    case "certificate_of_service": return certificateOfService({ date: ctx.date, documentTitle: ctx.documentTitle });
    case "table_of_authorities_placeholder": return tableOfAuthoritiesPlaceholder();
    case "notary_block": return notaryBlock();
    case "verification": return verification();
    case "proposed_order": return proposedOrder(ctx.documentTitle);
    case "definitions": return discoveryDefinitions({ requesting: ctx.matter?.client ?? "[REQUESTING PARTY]", responding: "[RESPONDING PARTY]" });
    case "exhibit_list": return exhibitList();
  }
}
