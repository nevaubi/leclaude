import "server-only";
import type { OfficeTemplate } from "@/modules/office/shared/template-registry";
import { emptyModel, type PdfModel } from "./model";

/**
 * PDF editor templates. `build()` is synchronous (the registry contract) and
 * returns a model flagged `meta.pending`; the PDF itself is generated with
 * pdf-lib from the matching spec in template-specs.ts the first time the
 * document is opened (see `materialize()` in service.ts).
 */
function pendingModel(specId: string, templateId: string, title: string): PdfModel {
  const m = emptyModel();
  m.meta = { pending: true, templateId, specId, title };
  return m;
}

export const PDF_TEMPLATES: OfficeTemplate[] = [
  {
    id: "pdf-deposition-notice",
    kind: "pdf",
    name: "Deposition notice",
    description: "Notice of videotaped deposition under Fed. R. Civ. P. 30 with subject-matter list, Schedule A document requests and a Bates table.",
    category: "Litigation",
    practiceArea: "Litigation",
    tags: ["deposition", "Rule 30", "notice"],
    build: (ctx) => pendingModel("deposition-notice", "pdf-deposition-notice", ctx.title ?? "Notice of Deposition"),
  },
  {
    id: "pdf-protective-order",
    kind: "pdf",
    name: "Protective order (two-tier)",
    description: "Stipulated protective order with Confidential and Highly Confidential – AEO tiers, Rule 502(d) clawback, HIPAA qualified-order language and a fillable Exhibit A acknowledgment.",
    category: "Litigation",
    practiceArea: "Litigation",
    tags: ["protective order", "confidentiality", "AEO", "form"],
    build: (ctx) => pendingModel("protective-order", "pdf-protective-order", ctx.title ?? "Stipulated Protective Order"),
  },
  {
    id: "pdf-cmo-excerpt",
    kind: "pdf",
    name: "Case management order excerpt",
    description: "CMO governing a tiered custodial production: custodians, search methodology, TAR validation, production schedule table and an agreed search-term appendix.",
    category: "Litigation",
    practiceArea: "Products Liability",
    tags: ["CMO", "ESI", "custodial production"],
    build: (ctx) => pendingModel("cmo-excerpt", "pdf-cmo-excerpt", ctx.title ?? "Case Management Order"),
  },
  {
    id: "pdf-subpoena-duces-tecum",
    kind: "pdf",
    name: "Subpoena duces tecum",
    description: "Rule 45 subpoena to a non-party records custodian with a fillable proof-of-service page and an Attachment A of document requests.",
    category: "Litigation",
    practiceArea: "Litigation",
    tags: ["subpoena", "Rule 45", "form"],
    build: (ctx) => pendingModel("subpoena-duces-tecum", "pdf-subpoena-duces-tecum", ctx.title ?? "Subpoena Duces Tecum"),
  },
  {
    id: "pdf-certificate-of-service",
    kind: "pdf",
    name: "Certificate of service",
    description: "Certificate of service with a service-list table (name, firm, role, e-mail, method) and secure-transfer language for protected material.",
    category: "Litigation",
    practiceArea: "Litigation",
    tags: ["certificate of service", "filing"],
    build: (ctx) => pendingModel("certificate-of-service", "pdf-certificate-of-service", ctx.title ?? "Certificate of Service"),
  },
  {
    id: "pdf-exhibit-cover",
    kind: "pdf",
    name: "Exhibit cover sheet",
    description: "Single-page exhibit slip sheet: exhibit letter, case, description, Bates range, deponent, date marked and confidentiality tier.",
    category: "Litigation",
    practiceArea: "Litigation",
    tags: ["exhibit", "deposition", "cover sheet"],
    build: (ctx) => pendingModel("exhibit-cover", "pdf-exhibit-cover", ctx.title ?? "Exhibit A"),
  },
];
