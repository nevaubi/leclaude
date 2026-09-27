import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LECLAUDE_DATA_DIR = `${process.env.TMPDIR || "/tmp"}/wf-extract-vitest-${process.pid}`;
  process.env.LECLAUDE_SEED = "reference";
  process.env.LECLAUDE_BACKGROUND = "off";
});

import { extractTextFromBytes } from "@/modules/workflows/extract-text";
import { exportDocx } from "@/modules/office/word/export";
import { exportXlsx } from "@/modules/office/sheet/export";
import { emptyWorkbook } from "@/modules/office/sheet/model";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("workflow upload text extraction", () => {
  it("extracts paragraph text from a .docx (the OOXML MIME type contains 'xml' but is a zip, not text)", async () => {
    const doc = markdownToDoc("# Engagement terms\n\nThe retainer is due within thirty days of signature.\n\nScope is limited to the arbitration.");
    const bytes = new Uint8Array(await exportDocx(doc, { title: "Engagement terms" }));
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0x50, 0x4b]);
    for (const [name, mime] of [["terms.docx", DOCX], [undefined, DOCX], ["terms.docx", "application/octet-stream"]] as const) {
      const r = await extractTextFromBytes(bytes, name, mime);
      expect(r.method, `${name} ${mime}`).toBe("mammoth");
      expect(r.text).toContain("The retainer is due within thirty days of signature.");
      expect(r.text).toContain("Scope is limited to the arbitration.");
      expect(r.text).not.toMatch(/PK\u0003\u0004|\[Content_Types\]/);
    }
  });

  it("extracts an .xlsx by its MIME type and never decodes a zip as text", async () => {
    const wb = emptyWorkbook();
    const sheet = wb.sheets[0];
    sheet.cells = { ...(sheet.cells ?? {}), A1: { v: "Custodian" }, B1: { v: "Pages" }, A2: { v: "Records office" }, B2: { v: 12 } } as typeof sheet.cells;
    const bytes = exportXlsx(wb);
    const r = await extractTextFromBytes(bytes, undefined, XLSX_MIME);
    expect(r.method).toBe("sheetjs");
    expect(r.text).toContain("Records office");
    // A zip declared as XML is refused rather than returned as garbage text.
    await expect(extractTextFromBytes(bytes, "data.bin", "application/xml")).rejects.toThrow(/Unsupported file type/);
  });

  it("still decodes plain text, Markdown and XML", async () => {
    const enc = new TextEncoder();
    expect((await extractTextFromBytes(enc.encode("hello world"), "a.txt", "text/plain")).text).toBe("hello world");
    expect((await extractTextFromBytes(enc.encode("<note>due Friday</note>"), "a.xml", "application/xml")).text).toContain("due Friday");
  });
});
