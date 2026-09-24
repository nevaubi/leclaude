import { describe, expect, it } from "vitest";
import { useSlidesStore } from "@/modules/office/slides/store";
import { emptyDeck } from "@/modules/office/slides/model";
import { buildSlide } from "@/modules/office/slides/layouts";

describe("slides store lifecycle", () => {
  it("load() resets the change tick so a freshly opened deck is not autosaved as an edit", () => {
    const deck = emptyDeck();
    deck.slides = [buildSlide("title", { title: "A" }, deck.theme)];
    const st = useSlidesStore.getState();
    st.load(deck);
    st.addSlide("bullets");
    expect(useSlidesStore.getState().changeTick).toBeGreaterThan(0);
    // Opening another deck (same singleton store) must start from tick 0 again.
    const other = emptyDeck();
    other.slides = [buildSlide("title", { title: "B" }, other.theme)];
    useSlidesStore.getState().load(other);
    const s = useSlidesStore.getState();
    expect(s.changeTick).toBe(0);
    expect(s.loaded).toBe(true);
    expect(s.past).toEqual([]);
    expect(s.currentSlideId).toBe(other.slides[0].id);
  });
});

import { applyOp } from "@/modules/office/sheet/ops";
import { emptyWorkbook } from "@/modules/office/sheet/model";

describe("sheet set_cells", () => {
  it("keeps a typed formula as a formula when value and formula are both sent (grid commit path)", () => {
    const wb = emptyWorkbook();
    const sheet = wb.sheets[0].id;
    const next = applyOp(wb, { type: "set_cells", sheet, cells: [{ ref: "A1", value: "=SUM(B1:B2)", formula: "=SUM(B1:B2)" }], parse: false });
    expect(next.sheets[0].cells.A1).toEqual({ f: "=SUM(B1:B2)" });
    const cleared = applyOp(next, { type: "set_cells", sheet, cells: [{ ref: "A1", value: "12", formula: null }], parse: true });
    expect(cleared.sheets[0].cells.A1).toEqual({ v: 12, t: "n" });
  });
});
