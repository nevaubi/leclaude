import { NextRequest } from "next/server";
import { blobs, db } from "@/lib/db";
import { jsonError } from "@/lib/ai/sse";
import { audit } from "@/lib/integrity/audit";
import { sha256 } from "@/lib/integrity/hash";

export const runtime = "nodejs";

const HASH_KEY = (hash: string, matterId?: string) => `blob:sha256:${matterId ?? "_"}:${hash}`;

/**
 * Upload a file (multipart "file" field or raw body with ?name=&mime=). Returns { id, url, size, mime, name, sha256, duplicate }.
 * Bytes are hashed; an identical upload returns the existing blob instead of storing it again. When a `matterId` is
 * given (form field or ?matterId=) and the same bytes were already uploaded for that matter, the response is
 * 409 { duplicate: true, id, url, message } unless allowDuplicate=1; without a matter the existing blob is returned with 200.
 */
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  let bytes: Uint8Array; let mime: string; let name: string | undefined; let matterId: string | undefined; let allowDuplicate = false;
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("`file` is required");
    bytes = new Uint8Array(await file.arrayBuffer()); mime = file.type || "application/octet-stream"; name = file.name;
    matterId = (form.get("matterId") as string | null) ?? undefined;
    allowDuplicate = ["1", "true"].includes(String(form.get("allowDuplicate") ?? ""));
  } else {
    bytes = new Uint8Array(await req.arrayBuffer());
    mime = req.nextUrl.searchParams.get("mime") ?? ct ?? "application/octet-stream";
    name = req.nextUrl.searchParams.get("name") ?? undefined;
    matterId = req.nextUrl.searchParams.get("matterId") ?? undefined;
    allowDuplicate = ["1", "true"].includes(req.nextUrl.searchParams.get("allowDuplicate") ?? "");
  }
  if (!bytes.byteLength) return jsonError("Empty upload");
  if (bytes.byteLength > 60 * 1024 * 1024) return jsonError("File exceeds 60 MB", 413);
  const hash = sha256(bytes);
  const d = db();
  const existingId = d.kv.get<string>(HASH_KEY(hash, matterId)) ?? (matterId ? null : d.kv.get<string>(HASH_KEY(hash)));
  const existing = existingId ? blobs.meta(existingId) : null;
  if (existing && !allowDuplicate) {
    audit("import", { kind: "blob", id: existing.id, label: existing.name ?? name ?? existing.id, matterId }, { duplicate: true, sha256: hash, bytes: bytes.byteLength });
    const body = { id: existing.id, url: `/api/blobs/${existing.id}`, size: existing.size, mime: existing.mime, name: existing.name ?? name, sha256: hash, duplicate: true, message: `Identical file already uploaded${matterId ? " for this matter" : ""} (${existing.name ?? existing.id}).` };
    return Response.json(body, { status: matterId ? 409 : 200 });
  }
  const rec = blobs.put(bytes, mime, { name, meta: { sha256: hash, matterId } });
  d.kv.set(HASH_KEY(hash, matterId), rec.id);
  if (matterId) d.kv.set(HASH_KEY(hash), rec.id);
  audit("import", { kind: "blob", id: rec.id, label: rec.name ?? rec.id, matterId }, { sha256: hash, bytes: rec.size, mime: rec.mime });
  return Response.json({ id: rec.id, url: `/api/blobs/${rec.id}`, size: rec.size, mime: rec.mime, name: rec.name, sha256: hash, duplicate: false });
}
