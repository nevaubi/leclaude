import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { mergeInto } from "@/modules/office/pdf/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** Append uploaded PDFs (multipart "files") to this document. Returns the updated model. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("multipart/form-data with `files` is required");
  const files = [...form.getAll("files"), ...form.getAll("file")].filter((f): f is File => f instanceof File);
  if (!files.length) return jsonError("`files` is required");
  const others: { bytes: Uint8Array; name?: string }[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!new TextDecoder("latin1").decode(bytes.subarray(0, 5)).startsWith("%PDF")) return jsonError(`${f.name} is not a PDF`, 415);
    others.push({ bytes, name: f.name });
  }
  try {
    const r = await mergeInto(id, others);
    if (!r) return jsonError("Document not found", 404);
    return Response.json({ doc: { ...r.doc, content: undefined }, model: r.model, appended: others.length });
  } catch (e) {
    return jsonError(`Merge failed: ${(e as Error).message}`, 500);
  }
}
