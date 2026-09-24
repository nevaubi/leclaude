import { blobs } from "@/lib/db";
import { jsonError } from "@/lib/ai/sse";
import { audit } from "@/lib/integrity/audit";
import { bootstrap } from "@/modules/workflows/api-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 25;

/**
 * POST /api/workflows/uploads — multipart upload for workflow front ends.
 * Accepts one or more `file` fields (plus optional `matterId` and `workflowId`)
 * and stores each as a blob. Returns `{ blobId, name, mime, size }` for a single
 * file, or `{ files: [...] }` when several were sent. Text is extracted
 * separately through POST /api/workflows/extract-text { blobId }.
 */
export async function POST(req: Request) {
  bootstrap();
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return jsonError("Send the file as multipart/form-data with a `file` field", 415);
  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError("Could not read the upload"); }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return jsonError("`file` is required");
  if (files.length > MAX_FILES) return jsonError(`At most ${MAX_FILES} files per upload`, 413);
  const matterId = (form.get("matterId") as string | null) || undefined;
  const workflowId = (form.get("workflowId") as string | null) || undefined;
  const out: { blobId: string; name: string; mime: string; size: number }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength) return jsonError(`${file.name}: empty file`);
    if (bytes.byteLength > MAX_BYTES) return jsonError(`${file.name}: exceeds 60 MB`, 413);
    const mime = file.type || "application/octet-stream";
    const rec = blobs.put(bytes, mime, { name: file.name, meta: { matterId, workflowId, source: "workflow.frontend" } });
    audit("import", { kind: "blob", id: rec.id, label: file.name, matterId }, { source: "workflow.frontend", workflowId, bytes: rec.size, mime });
    out.push({ blobId: rec.id, name: file.name, mime, size: rec.size });
  }
  return Response.json(out.length === 1 ? { ...out[0], files: out } : { files: out }, { status: 201 });
}
