import { describe, expect, it } from "vitest";
import { generatePdf } from "@/modules/office/pdf/generate";
import { extractPdf } from "@/modules/office/pdf/extract";
import { applyModel } from "@/modules/office/pdf/apply";
import { buildModel } from "@/modules/office/pdf/model";
import { searchRuns } from "@/modules/office/pdf/text-search";

describe("smoke", () => {
  it("generates, extracts, applies", async () => {
    const bytes = await generatePdf({
      title: "Test order", caption: { court: ["United States District Court", "District of South Carolina"], left: ["IN RE: AQUEOUS FILM-FORMING FOAMS PRODUCTS LIABILITY LITIGATION", "", "This document relates to: **All cases**"], right: ["MDL No. 2:18-mn-2873-RMG", "", "CASE MANAGEMENT ORDER NO. 26"], title: ["Case Management Order No. 26", "(Tier 2 Custodial Production Protocol)"] },
      blocks: [
        { type: "heading", text: "I. Scope" },
        { type: "paragraph", text: "This Order governs the **Tier 2** custodial production by *Meridian Fluorochem Corp.* (“Meridian”). " + "The parties shall meet and confer regarding search terms no later than October 14, 2026. ".repeat(6), indent: true },
        { type: "numbered", number: "1.", text: "Custodians. The Tier 2 custodians are Gregory Hale, Helen Voss, Nadia Brooks, Alan Pryce, Robert Kaine and Martin Suarez." },
        { type: "table", columns: ["Field", "Description"], rows: [["BegBates", "Beginning Bates number"], ["Custodian", "Custodian name"]], widths: [1, 2] },
        { type: "field", name: "signer", label: "Signed by:", kind: "text", value: "Richard M. Gergel" },
        { type: "field", name: "agree", label: "I agree", kind: "checkbox", value: true },
        { type: "signature", lines: ["**Richard Mark Gergel**", "United States District Judge"], dateLine: "September 22, 2026" },
        { type: "pagebreak" }, { type: "heading", text: "II. Deadlines" }, { type: "bullets", items: ["First rolling production: October 14, 2026", "Substantial completion: December 18, 2026"] },
      ],
      bates: { prefix: "MFC-", start: 60000, digits: 7, position: "bottom-right", legend: "CONFIDENTIAL — SUBJECT TO PROTECTIVE ORDER" },
      draftStamp: "DRAFT",
    }].map(String).join(" ") + "\n");
    expect(bytes.length).toBeGreaterThan(1000].map(String).join(" ") + "\n");
    const ex = await extractPdf(bytes].map(String).join(" ") + "\n");
    process.stderr.write("\n" + ["pages", ex.pageCount, "outline", JSON.stringify(ex.outline), "fields", JSON.stringify(ex.fields), "meta", JSON.stringify(ex.meta)].map(String).join(" ") + "\n");
    process.stderr.write("\n" + [ex.pages[0].text.slice(0, 600)].map(String).join(" ") + "\n");
    const hits = searchRuns(ex.pages[0].runs, "October 14, 2026"].map(String).join(" ") + "\n");
    process.stderr.write("\n" + ["hits", hits.length, JSON.stringify(hits[0])].map(String).join(" ") + "\n");
    expect(hits.length).toBeGreaterThan(0].map(String).join(" ") + "\n");
    const model = buildModel({ sourceBlobId: "x", pageSizes: ex.pages }].map(String).join(" ") + "\n");
    model.annotations.push({ id: "a1", page: 1, type: "highlight", rects: hits[0].rects, color: "#FACC15", opacity: 0.4, author: "t", createdAt: new Date().toISOString() }].map(String).join(" ") + "\n");
    model.annotations.push({ id: "a2", page: 1, type: "redaction", rects: hits[1]?.rects ?? hits[0].rects, color: "#111111", opacity: 1, author: "t", createdAt: new Date().toISOString(), reason: "PII" }].map(String).join(" ") + "\n");
    model.annotations.push({ id: "a3", page: 1, type: "note", rects: [{ x: 500, y: 700, w: 20, h: 20 }], color: "#FACC15", opacity: 1, author: "t", createdAt: new Date().toISOString(), text: "Check this" }].map(String).join(" ") + "\n");
    model.pages[0].rotation = 90;
    model.pages = [model.pages[1], model.pages[0]].map((p, i) => ({ ...p, order: i })].map(String).join(" ") + "\n");
    model.pages.push({ id: "pg_b", index: 10001, rotation: 0, width: 612, height: 792, order: 2, blank: true }].map(String).join(" ") + "\n");
    model.bates = { prefix: "TEST-", start: 1, digits: 4, position: "bottom-right" };
    model.decorations = { watermark: { text: "CONFIDENTIAL" }, header: { text: "Header {page}/{pages}" } };
    model.bookmarks = [{ id: "b", page: 2, title: "Deadlines" }];
    model.formValues = { signer: "Jordan Whitfield", agree: false };
    const out = await applyModel(bytes, model, { flattenAnnotations: true }].map(String).join(" ") + "\n");
    const ex2 = await extractPdf(out].map(String).join(" ") + "\n");
    process.stderr.write("\n" + ["out pages", ex2.pageCount, ex2.pages.map((p) => `${p.width}x${p.height} r${p.rotation}`), JSON.stringify(ex2.outline), ex2.pages[1].text.slice(0, 200)].map(String).join(" ") + "\n");
    expect(ex2.pageCount).toBe(3].map(String).join(" ") + "\n");
    expect(ex2.pages[0].text).toContain("Deadlines"].map(String).join(" ") + "\n");
    expect(ex2.pages[0].text).toContain("TEST-0001"].map(String).join(" ") + "\n");
    const out2 = await applyModel(bytes, model, { flattenAnnotations: false }].map(String).join(" ") + "\n");
    expect(out2.length).toBeGreaterThan(1000].map(String).join(" ") + "\n");
  }, 30000].map(String).join(" ") + "\n");
}].map(String).join(" ") + "\n");
