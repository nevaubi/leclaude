import { NextRequest } from "next/server";
import { blobs } from "@/lib/db";
import { jsonError } from "@/lib/ai/sse";

export const runtime = "nodejs";

/** Upload a file (multipart "file" field or raw body with ?name=&mime=). Returns { id, url }. */
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  let bytes: Uint8Array; let mime: string; let name: string | undefined;
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("`file` is required");
    bytes = new Uint8Array(await file.arrayBuffer()); mime = file.type || "application/octet-stream"; name = file.name;
  } else {
    bytes = new Uint8Array(await req.arrayBuffer());
    mime = req.nextUrl.searchParams.get("mime") ?? ct ?? "application/octet-stream";
    name = req.nextUrl.searchParams.get("name") ?? undefined;
  }
  if (!bytes.byteLength) return jsonError("Empty upload");
  if (bytes.byteLength > 60 * 1024 * 1024) return jsonError("File exceeds 60 MB", 413);
  const rec = blobs.put(bytes, mime, { name });
  return Response.json({ id: rec.id, url: `/api/blobs/${rec.id}`, size: rec.size, mime: rec.mime, name: rec.name });
}
