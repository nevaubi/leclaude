import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/auth/route";
import { bodyMatterId, queryParam, refs } from "@/lib/auth/resources";
import { errorResponse, readJson } from "@/modules/ediscovery/api-utils";
import { getEDiscoverySettings, ingestFiles, INGEST_MAX_FILES, INGEST_MAX_FILE_BYTES, INGEST_MAX_TOTAL_BYTES, updateEDiscoverySettings, type IngestFile } from "@/modules/ediscovery/ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

function matterParam(req: Request): string | undefined {
  return queryParam(req, "matter", "matterId");
}

function requireMatter(id: string | undefined): Response | null {
  if (!id) return jsonError("`matter` is required");
  if (!db().matters.get(id)) return jsonError(`Unknown matter ${id}`, 404);
  return null;
}

/** GET ?matter= → { settings, limits } — the matter's Bates numbering and the upload limits for the import dialog. */
async function handleGET(req: NextRequest) {
  const matterId = matterParam(req);
  const bad = requireMatter(matterId);
  if (bad) return bad;
  return Response.json({ settings: getEDiscoverySettings(matterId!), limits: { maxFiles: INGEST_MAX_FILES, maxFileBytes: INGEST_MAX_FILE_BYTES, maxTotalBytes: INGEST_MAX_TOTAL_BYTES } });
}

/** PATCH { matterId, batesPrefix?, batesWidth?, nextBates? } → { settings } */
async function handlePATCH(req: NextRequest) {
  const body = await readJson<{ matterId?: string; batesPrefix?: string; batesWidth?: number; nextBates?: number }>(req);
  const matterId = body?.matterId ?? matterParam(req);
  const bad = requireMatter(matterId);
  if (bad) return bad;
  try {
    return Response.json({ settings: updateEDiscoverySettings(matterId!, { batesPrefix: body?.batesPrefix, batesWidth: body?.batesWidth, nextBates: body?.nextBates }) });
  } catch (e) { return errorResponse(e); }
}

/**
 * POST ?matter=<id> multipart/form-data: `file` (repeatable), `custodian?`, `batesPrefix?`, `lastModified?` (JSON array
 * of ms timestamps, one per file, in order) → 200 { results: [{ name, status: created|duplicate|rejected, … }],
 * created, duplicates, rejected, indexed, settings }. Authorized as a write on the matter.
 */
async function handlePOST(req: NextRequest) {
  const matterId = matterParam(req);
  const bad = requireMatter(matterId);
  if (bad) return bad;
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return jsonError("Send the files as multipart/form-data", 415);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > INGEST_MAX_TOTAL_BYTES + 1024 * 1024) return jsonError(`Upload exceeds ${Math.round(INGEST_MAX_TOTAL_BYTES / 1024 / 1024)} MB`, 413);
  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError("Could not read the upload"); }
  const entries = form.getAll("file").filter((v): v is File => typeof v !== "string");
  if (!entries.length) return jsonError("Attach at least one `file`");
  if (entries.length > INGEST_MAX_FILES) return jsonError(`At most ${INGEST_MAX_FILES} files per upload`, 413);
  let lastModified: unknown[] = [];
  try { const raw = form.get("lastModified"); if (typeof raw === "string") lastModified = JSON.parse(raw); } catch { lastModified = []; }
  const files: IngestFile[] = [];
  for (const [i, f] of entries.entries()) {
    const lm = Number(Array.isArray(lastModified) ? lastModified[i] : NaN);
    files.push({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()), lastModified: Number.isFinite(lm) && lm > 0 ? lm : undefined });
  }
  const str = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : undefined; };
  try {
    const res = await ingestFiles(files, { matterId: matterId!, custodian: str("custodian"), batesPrefix: str("batesPrefix"), source: "upload" });
    return Response.json(res);
  } catch (e) { return errorResponse(e); }
}

export const GET = withAuth(handleGET, { action: "read", resource: (req) => refs.matter(matterParam(req)) });
export const PATCH = withAuth(handlePATCH, { action: "write", resource: async (req) => refs.matter((await bodyMatterId(req)) ?? matterParam(req)) });
export const POST = withAuth(handlePOST, { action: "write", resource: (req) => refs.matter(matterParam(req)) });
