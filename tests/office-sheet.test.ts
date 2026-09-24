import { beforeAll, describe, expect, it } from "vitest";
import { db, resetSqlite } from "@/lib/db";
import { SHEET_TEMPLATES } from "@/modules/office/sheet/templates";
import { computeWorkbook, formulaErrors } from "@/modules/office/sheet/engine";
import type { Workbook } from "@/modules/office/sheet/model";
import { seedSheet } from "@/modules/office/sheet/seed";

beforeAll(() => { resetSqlite(); });

describe("templates", () => {
  it("build and compute without formula errors", () => {
    for (const t of SHEET_TEMPLATES) {
      const wb = t.build({}) as Workbook;
      const errs = formulaErrors(wb, computeWorkbook(wb));
      expect(errs, t.id).toEqual([]);
    }
  });
});

describe("seed", () => {
  it("seeds 5 workbooks with versions, comments and library items", () => {
    const d = db();
    seedSheet(d);
    const docs = d.officeDocs.find((x) => x.kind === "sheet" && x.id.startsWith("ws_"));
    expect(docs.length).toBeGreaterThanOrEqual(5);
    for (const doc of docs) {
      const wb = doc.content as Workbook;
      const errs = formulaErrors(wb, computeWorkbook(wb));
      console.log(doc.id, "versions", d.officeVersions.count((v) => v.docId === doc.id), "comments", d.officeComments.count((c) => c.docId === doc.id), "lib", d.library.count((l) => l.officeDocId === doc.id), "errors", errs.map((e) => `${e.ref} ${e.formula} ${e.error}`).join("|"));
      expect(errs).toEqual([]);
      expect(d.officeVersions.count((v) => v.docId === doc.id)).toBeGreaterThanOrEqual(3);
      expect(d.officeComments.count((c) => c.docId === doc.id)).toBeGreaterThanOrEqual(1);
      expect(d.library.count((l) => l.officeDocId === doc.id)).toBe(1);
    }
    seedSheet(d); // idempotent
    expect(d.officeDocs.count((x) => x.kind === "sheet" && x.id.startsWith("ws_"))).toBe(docs.length);
  });
});
