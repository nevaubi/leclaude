/**
 * Privilege-log spreadsheet export (xlsx package) and the description templates
 * reviewers pick from when drafting entries by hand. Pure; no server-only imports.
 */
import * as XLSX from "xlsx";
import type { PrivilegeLogRow } from "./types";

export interface DescriptionTemplate {
  id: string;
  basis: string;
  label: string;
  /** Placeholders: {type} {author} {recipients} {topic} {date}. */
  template: string;
}

export const DESCRIPTION_TEMPLATES: DescriptionTemplate[] = [
  { id: "ac-advice", basis: "Attorney-client", label: "Counsel providing legal advice", template: "{type} from {author} to {recipients} providing legal advice regarding {topic}." },
  { id: "ac-request", basis: "Attorney-client", label: "Client requesting legal advice", template: "{type} from {author} to {recipients} requesting legal advice from counsel regarding {topic} and providing information to counsel for that purpose." },
  { id: "ac-reflect", basis: "Attorney-client", label: "Reflecting counsel's advice", template: "{type} from {author} to {recipients} reflecting and transmitting legal advice of counsel regarding {topic}, prepared for the purpose of obtaining or implementing that advice." },
  { id: "wp-anticipation", basis: "Work product", label: "Prepared in anticipation of litigation", template: "{type} prepared by or at the direction of {author} in anticipation of litigation, analysing {topic} and reflecting the mental impressions and legal theories of counsel." },
  { id: "wp-draft", basis: "Work product", label: "Draft prepared for counsel", template: "Draft {type} prepared by {author} at the request of counsel in anticipation of litigation concerning {topic}; not distributed outside the legal department." },
  { id: "ci-exchange", basis: "Common interest", label: "Common-interest exchange", template: "{type} from {author} to {recipients} exchanged between parties sharing a common legal interest pursuant to a common-interest agreement, conveying legal advice regarding {topic}." },
  { id: "jd-exchange", basis: "Joint defense", label: "Joint-defense communication", template: "{type} from {author} to {recipients}, members of a joint defense group, conveying counsel's legal analysis regarding {topic}." },
];

export function fillTemplate(t: DescriptionTemplate, values: { type: string; author: string; recipients: string; topic: string; date?: string }): string {
  return t.template
    .replace(/\{type\}/g, values.type)
    .replace(/\{author\}/g, values.author)
    .replace(/\{recipients\}/g, values.recipients || "counsel")
    .replace(/\{topic\}/g, values.topic || "legal matters")
    .replace(/\{date\}/g, values.date ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export const PRIVILEGE_STATUSES: { id: PrivilegeLogRow["status"]; label: string; hint: string }[] = [
  { id: "draft", label: "Draft", hint: "Generated or first-pass description" },
  { id: "review", label: "In review", hint: "Second-level check of basis and description" },
  { id: "final", label: "Final", hint: "Approved for service" },
];

export function statusExportLabel(status: PrivilegeLogRow["status"]): string {
  return status === "final" ? "Withheld" : status === "review" ? "In review" : "Draft";
}

/** Rows as an .xlsx workbook (Privilege log sheet + Legend sheet). */
export function privilegeLogWorkbook(rows: PrivilegeLogRow[], meta: { matterName: string; caption?: string; generatedAt?: string }): XLSX.WorkBook {
  const header = ["Log No.", "Beg Bates", "End Bates", "Date", "Document Type", "Author", "Recipients", "Custodian", "Privilege Basis", "Description", "Status"];
  const data = rows.map((r, i) => {
    const [beg, end] = r.bates.split(/\s*–\s*/);
    return [i + 1, beg, end ?? beg, r.date, r.docType, r.author, r.recipients.join("; "), r.custodianName, r.basis, r.description, statusExportLabel(r.status)];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws["!cols"] = [{ wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 28 }, { wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 80 }, { wch: 10 }];
  ws["!autofilter"] = { ref: `A1:K${Math.max(1, data.length + 1)}` };
  const legend = XLSX.utils.aoa_to_sheet([
    ["Privilege log", meta.matterName],
    ["Caption", meta.caption ?? ""],
    ["Generated", meta.generatedAt ?? new Date().toISOString().slice(0, 10)],
    ["Entries", rows.length],
    [],
    ["Basis", "Meaning"],
    ["Attorney-client", "Confidential communication between client and counsel for the purpose of obtaining or providing legal advice."],
    ["Work product", "Material prepared by or at the direction of counsel in anticipation of litigation (Fed. R. Civ. P. 26(b)(3))."],
    ["Common interest", "Exchange between parties sharing a common legal interest under a common-interest agreement."],
    ["Joint defense", "Communication among members of a joint defense group."],
    [],
    ["Status", "Meaning"],
    ["Withheld", "Final entry; the document is withheld in full."],
    ["In review", "Second-level review pending."],
    ["Draft", "Generated description; not yet reviewed."],
  ]);
  legend["!cols"] = [{ wch: 18 }, { wch: 100 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Privilege log");
  XLSX.utils.book_append_sheet(wb, legend, "Legend");
  return wb;
}

export function privilegeLogXlsx(rows: PrivilegeLogRow[], meta: { matterName: string; caption?: string; generatedAt?: string }): Uint8Array {
  const wb = privilegeLogWorkbook(rows, meta);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
