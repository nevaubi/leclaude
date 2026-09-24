import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { getOfficeDoc } from "@/modules/office/shared/docs-service";
import { exportCsv, exportXlsx } from "@/modules/office/sheet/export";
import { normalizeWorkbook, type Workbook } from "@/modules/office/sheet/model";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body { docId?: string; content?: unknown; title?: string; format?: "xlsx" | "csv"; sheet?: string }

/**
 * Export a workbook. Body: { docId | content, title?, format: xlsx|csv, sheet? (csv: sheet id or name) }.
 * XLSX carries values, formulas, number formats, column widths, merges, freeze panes and named ranges;
 * charts and conditional formats are not exported by the xlsx package.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return jsonError("Invalid body");
  let content = body.content;
  let title = body.title;
  if (body.docId) {
    const doc = getOfficeDoc(body.docId);
    if (!doc) return jsonError("Document not found", 404);
    if (doc.kind !== "sheet") return jsonError("Not a workbook", 400);
    content = content ?? doc.content;
    title = title ?? doc.title;
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
    const bytes = exportXlsx(wb);
    return new Response(new Uint8Array(bytes) as unknown as BodyInit, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${safe}.xlsx"`, "Content-Length": String(bytes.byteLength) } });
  } catch (e) {
    return jsonError(`Export failed: ${(e as Error).message}`, 500);
  }
}
