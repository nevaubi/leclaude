/**
 * Privilege-log description templates and the entry status workflow. Pure and
 * client-safe (the xlsx export lives in privilege-xlsx.ts so the spreadsheet
 * library never reaches the browser bundle).
 */
import type { PrivilegeLogEntry } from "@/lib/types/domain";

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

/** Templates that fit a coded basis ("Attorney-client; Work product" matches both families). */
export function templatesForBasis(basis: string): DescriptionTemplate[] {
  const b = basis.toLowerCase();
  const matches = DESCRIPTION_TEMPLATES.filter((t) => b.includes(t.basis.toLowerCase()));
  return matches.length ? matches : DESCRIPTION_TEMPLATES;
}

export type PrivilegeStatus = PrivilegeLogEntry["status"];

export const PRIVILEGE_STATUSES: { id: PrivilegeStatus; label: string; hint: string }[] = [
  { id: "draft", label: "Draft", hint: "Generated or first-pass description" },
  { id: "review", label: "In review", hint: "Second-level check of basis and description" },
  { id: "final", label: "Final", hint: "Approved for service" },
];

/** Allowed status moves: draft → review → final, and back one step for corrections. */
export function nextPrivilegeStatuses(status: PrivilegeStatus): PrivilegeStatus[] {
  switch (status) {
    case "draft": return ["review"];
    case "review": return ["final", "draft"];
    case "final": return ["review"];
  }
}

export function statusExportLabel(status: PrivilegeStatus): string {
  return status === "final" ? "Withheld" : status === "review" ? "In review" : "Draft";
}
