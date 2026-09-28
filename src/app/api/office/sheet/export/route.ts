import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { getOfficeDoc } from "@/modules/office/shared/docs-service";
import { exportCsv, exportXlsxWithReport } from "@/modules/office/sheet/export";
import { blobs } from "@/lib/db";
import { sha256 } from "@/lib/integrity/hash";
import { normalizeWorkbook, type Workbook } from "@/modules/office/sheet/model";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body { docId?: string; content?: unknown; title?: string; format?: "xlsx" | "csv"; sheet?: string }

/**
 * Export a workbook. Body: { docId | content, title?, format: xlsx|csv, sheet? (csv: sheet id or name) }.
 * XLSX is written by the direct OOXML writer (styles, number formats, formulas + cached values, validation,
 * conditional formatting, hyperlinks, notes, print settings, defined names, charts). For a workbook imported from
 * .xlsx, the original package (doc.meta.originalBlobId, verified against content.xlsxSource.sha256) is kept and
 * only changed parts are rewritten; the X-Xlsx-Export header reports "preserve" or "fresh".
 */
async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return jsonError("Invalid body");
  let content = body.content;
  let title = body.title;
  let originalBlobId: string | undefined;
  if (body.docId) {
    const doc = getOfficeDoc(body.docId);
    if (!doc) return jsonError("Document not found", 404);
    if (doc.kind !== "sheet") return jsonError("Not a workbook", 400);
    content = content ?? doc.content;
    title = title ?? doc.title;
    originalBlobId = typeof doc.meta?.originalBlobId === "string" ? doc.meta.originalBlobId : undefined;
  }
  if (!content) return jsonError("`content` (workbook) or `docId` is required");
  let wb: Workbook;
  try { wb = normalizeWorkbook(content); } catch (e) { return jsonError(`Invalid workbook: ${(e as Error).message}`); }
  const safe = (title ?? "workbook").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "workbook";
  try {
    if ((body.format ?? "xlsx") === "csv") {
      const csv = exportCsv(wb, body.sheet);
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.csv"` } });
    }
    // The original package is used only when it is the exact file this workbook was imported from.
    let original: Uint8Array | null = null;
    if (originalBlobId && wb.xlsxSource?.sha256) {
      const blob = blobs.get(originalBlobId);
      if (blob && sha256(blob.bytes) === wb.xlsxSource.sha256) original = new Uint8Array(blob.bytes);
    }
    const { bytes, report } = exportXlsxWithReport(wb, { original });
    return new Response(new Uint8Array(bytes) as unknown as BodyInit, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${safe}.xlsx"`, "Content-Length": String(bytes.byteLength), "X-Xlsx-Export": report.mode } });
  } catch (e) {
    return jsonError(`Export failed: ${(e as Error).message}`, 500);
  }
}

export const POST = withDb(withAuth(handlePOST, { action: "export", resource: officeDocFromBody }));
