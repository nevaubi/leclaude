import type { CodingDecision, DocType, EDocument } from "@/lib/types/domain";
import type { CustKey } from "./people";

/** Authoring shape for one demo document; `buildCorpus` turns specs into `EDocument`s with Bates, headers and hashes. */
export interface DocSpec {
  id: string;
  date: string;
  time?: string;
  cust: CustKey;
  type: DocType;
  subject: string;
  from?: string;
  to?: string[];
  cc?: string[];
  body: string;
  pages?: number;
  /** Email thread id (shared by the messages of a conversation). */
  thread?: string;
  /** Parent email id for an attachment. */
  parent?: string;
  /** Attachment ids for a parent email. */
  attachments?: string[];
  /** Exact duplicate of another spec (same text and hash, different custodian). */
  dupOf?: string;
  aiScore?: number;
  aiSummary?: string;
  aiIssues?: string[];
  entities?: EDocument["entities"];
  coding?: Partial<CodingDecision>;
  tags?: string[];
}

export const DEMO_ID = (slug: string) => `demo_apl_ed_${slug}`;
