import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { intelBootstrap } from "@/modules/intel/bootstrap";
import { flagDocument, getDocument, getDocumentText, listChunks, unflagDocument } from "@/modules/intel/store";
import type { IntelFlagKind } from "@/modules/intel/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const FLAG_KINDS: IntelFlagKind[] = ["low_confidence", "unverified", "contradicted", "stale", "parse_error", "duplicate", "needs_review", "broken_link"];

/** GET ?maxChars=60000&chunks=1 → { document, text, textLength, truncated, chunks? }. */
export async function GET(req: NextRequest, { params }: Ctx) {
  intelBootstrap();
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return jsonError("Document not found", 404);
  const url = new URL(req.url);
  const maxChars = Math.max(200, Math.min(Number(url.searchParams.get("maxChars") ?? 60_000) || 60_000, 600_000));
  const full = getDocumentText(id) ?? "";
  const withChunks = url.searchParams.get("chunks") === "1";
  return Response.json({ document: doc, text: full.slice(0, maxChars), textLength: full.length, truncated: full.length > maxChars, chunks: withChunks ? listChunks(id) : undefined });
}

/** POST { flag: { kind, note? } } | { unflag: kind } → { document }. */
export async function POST(req: NextRequest, { params }: Ctx) {
  intelBootstrap();
  const { id } = await params;
  if (!getDocument(id)) return jsonError("Document not found", 404);
  const body = (await req.json().catch(() => ({}))) as { flag?: { kind?: string; note?: string }; unflag?: string };
  if (body.flag?.kind) {
    if (!FLAG_KINDS.includes(body.flag.kind as IntelFlagKind)) return jsonError(`kind must be one of ${FLAG_KINDS.join(", ")}`, 422);
    return Response.json({ document: flagDocument(id, { kind: body.flag.kind as IntelFlagKind, note: body.flag.note?.slice(0, 500), by: "human" }) });
  }
  if (body.unflag) {
    if (!FLAG_KINDS.includes(body.unflag as IntelFlagKind)) return jsonError(`unflag must be one of ${FLAG_KINDS.join(", ")}`, 422);
    return Response.json({ document: unflagDocument(id, body.unflag as IntelFlagKind) });
  }
  return jsonError("Provide { flag: { kind, note? } } or { unflag: kind }", 422);
}
