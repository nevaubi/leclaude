/**
 * Sensitivity of evidence records for the authorization policy (constitution §22, §24 privilege). Pure, client-safe.
 *
 * Privilege is a coded decision, never an inference: a document is "privileged" only when review coded it so.
 * An attorney merely copied on a business email does not make the record privileged (constitution §44 privilege cc).
 */
import type { ResourceRef, Sensitivity } from "@/lib/auth/types";
import type { EDocument } from "@/lib/types/domain";

export type CodedDocument = Pick<EDocument, "id" | "matterId"> & { coding?: Partial<EDocument["coding"]> | null; cc?: string[]; to?: string[]; from?: string };

export function sensitivityOf(doc: CodedDocument): Sensitivity {
  return doc.coding?.privileged === true ? "privileged" : "normal";
}

/** The policy resource for an e-discovery document. */
export function documentResource(doc: CodedDocument): ResourceRef {
  return { kind: "document", id: doc.id, matterId: doc.matterId, sensitivity: sensitivityOf(doc) };
}
