import { describe, expect, it } from "vitest";
import { generatePdf } from "@/modules/office/pdf/generate";
import { extractPdf } from "@/modules/office/pdf/extract";
import { applyModel } from "@/modules/office/pdf/apply";
import { buildModel } from "@/modules/office/pdf/model";
import { searchRuns } from "@/modules/office/pdf/text-search";

describe("smoke", () => {
  it("generates, extracts, applies", async () => {
    const bytes = await generatePdf({
      title: "Test order", caption: { court: ["United States District Court", "District of South Carolina"], left: ["IN RE: AQUEOUS FILM-FORMING FOAMS PRODUCTS LIABILITY LITIGATION", "", "This document relates to: **All cases**"], right: ["MDL No. 2:18-mn-2873-RMG", "", "CASE MANAGEMENT ORDER NO. 26"], title: ["Case Management Order No. 26"] },
      blocks: [
        { type: "heading", text: "I. Scope" },
        { type: "paragraph", text: "This Order governs the **Tier 2** custodial production by *Meridian Fluorochem Corp.* The parties shall meet and confer regarding search terms no later than October 14, 2026. ".repeat(6), indent: true },
        { type: "field", name: "signer", label: "Signed by:", kind: "text", value: "Richard M. Gergel" },
        { type: "pagebreak" }, { type: "heading", text: "II. Deadlines" }, { type: "bullets", items: ["First rolling production: October 14, 2026"] },
      ],
      bates: { prefix: "MFC-", start: 60000, digits: 7, position: "bottom-right" },
    });
    const ex = await extractPdf(bytes);
    console.log("pages", ex.pageCount, "outline", JSON.stringify(ex.outline), "fields", JSON.stringify(ex.fields));
    console.log(ex.pages[0].text.slice(0, 300));
    const hits = searchRuns(ex.pages[0].runs, "October 14, 2026");
    expect(hits.length).toBeGreaterThan(0);
    const model = buildModel({ sourceBlobId: "x", pageSizes: ex.pages });
    model.annotations.push({ id: "a1", page: 1, type: "highlight", rects: hits[0].rects, color: "#FACC15", opacity: 0.4, author: "t", createdAt: new Date().toISOString() });
    model.pages = [model.pages[1], model.pages[0]].map((p, i) => ({ ...p, order: i }));
    model.bates = { prefix: "TEST-", start: 1, digits: 4, position: "bottom-right" };
    const out = await applyModel(bytes, model, { flattenAnnotations: true });
    const ex2 = await extractPdf(out);
    expect(ex2.pageCount).toBe(2);
    expect(ex2.pages[0].text).toContain("Deadlines");
    expect(ex2.pages[0].text).toContain("TEST-0001");
  }, 30000);
});
