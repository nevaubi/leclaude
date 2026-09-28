import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";
import { researchMemoMarkdown, researchToaMarkdown, ResearchExportError, sendResearchToWord } from "@/modules/search/export";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/search/threads/:id/export {format: "word" | "memo" | "toa", messageId?}
 * - word: creates an office Word document with the research memo (server-built from the stored answer) → {doc}
 * - memo / toa: returns markdown → {markdown}
 */
async function handlePOST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { format?: string; messageId?: string } | null;
  const format = body?.format ?? "word";
  const messageId = typeof body?.messageId === "string" ? body.messageId : undefined;
  try {
    if (format === "word") {
      const { doc } = sendResearchToWord({ threadId: id, messageId });
      return Response.json({ doc: { id: doc.id, title: doc.title, kind: doc.kind } });
    }
    if (format === "memo") return Response.json({ markdown: researchMemoMarkdown(id, messageId).markdown });
    if (format === "toa") return Response.json({ markdown: researchToaMarkdown(id, messageId) });
    return jsonError("format must be word, memo or toa");
  } catch (e) {
    if (e instanceof ResearchExportError) return jsonError(e.message, e.status);
    throw e;
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: (_req, { id }) => refs.research(id) }));
