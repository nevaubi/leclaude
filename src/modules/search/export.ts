import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/integrity/audit";
import { createOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import type { OfficeDocument } from "@/lib/types/domain";
import { getThread } from "./engine/threads";
import type { ResearchMessage, ResearchThread } from "./engine/types";
import { jurisdictionByKey } from "./jurisdictions";
import { buildResearchMemo, buildTableOfAuthorities, memoTitle } from "./memo";

export class ResearchExportError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ResearchExportError"; }
}

/** The assistant answer to export (by id, else the latest with content) and the question that produced it. */
export function answerForExport(thread: ResearchThread, messageId?: string | null): { question: string; message: ResearchMessage } {
  const idx = messageId ? thread.messages.findIndex((m) => m.id === messageId && m.role === "assistant") : thread.messages.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === "assistant" && m.content)?.i ?? -1;
  if (idx < 0) throw new ResearchExportError(messageId ? "Answer not found in this thread" : "This thread has no answer to export", 404);
  const message = thread.messages[idx];
  if (!message.content) throw new ResearchExportError("This answer has no text to export", 409);
  const question = thread.messages[idx - 1]?.role === "user" ? thread.messages[idx - 1].content : thread.title;
  return { question, message };
}

/** Memo markdown for a persisted answer (server-side, from the stored thread — the authoritative copy). */
export function researchMemoMarkdown(threadId: string, messageId?: string | null): { markdown: string; question: string; message: ResearchMessage; thread: ResearchThread } {
  const thread = getThread(threadId);
  if (!thread) throw new ResearchExportError("Thread not found", 404);
  const { question, message } = answerForExport(thread, messageId);
  const matter = thread.matterId ? db().matters.get(thread.matterId) : null;
  const markdown = buildResearchMemo({ question, message, sources: thread.sources, matterName: matter?.name, matterCaption: matter?.caption, jurisdictionLabel: jurisdictionByKey(thread.settings.jurisdiction).label });
  return { markdown, question, message, thread };
}

export function researchToaMarkdown(threadId: string, messageId?: string | null): string {
  const thread = getThread(threadId);
  if (!thread) throw new ResearchExportError("Thread not found", 404);
  const { question, message } = answerForExport(thread, messageId);
  return buildTableOfAuthorities(question, message, thread.sources);
}

/** "Send to Word": create an office Word document holding the memo, bound to the answer hash it was built from. */
export function sendResearchToWord(input: { threadId: string; messageId?: string | null }): { doc: OfficeDocument; markdown: string } {
  const { markdown, question, message, thread } = researchMemoMarkdown(input.threadId, input.messageId);
  const doc = createOfficeDoc({
    kind: "word",
    title: memoTitle(question),
    content: markdownToDoc(markdown),
    matterId: thread.matterId ?? undefined,
    tags: ["research", "memo"],
    meta: { source: "search-research", threadId: thread.id, messageId: message.id, runId: message.runId, artifactHash: message.artifactHash, terminal: message.terminal, trust: message.trust, provenance: message.provenance },
  });
  audit("export", { kind: "research", id: message.runId ?? message.id, label: question.slice(0, 120), matterId: thread.matterId ?? undefined }, { format: "word", docId: doc.id, artifactHash: message.artifactHash ?? null });
  return { doc, markdown };
}
