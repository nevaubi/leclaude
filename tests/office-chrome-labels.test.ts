import { describe, expect, it } from "vitest";
import { changePositionLabel, kindBadgeLabel, modKeyFor, pageOfLabel, pluralize, rowRangeLabel, shortcutFor, trackedChangesLabel, NARROW_VIEWPORT } from "@/modules/office/shared/office-chrome";

describe("office chrome: status and strip labels", () => {
  it("labels the tracked-changes strip", () => {
    expect(trackedChangesLabel(0)).toBe("No tracked changes");
    expect(trackedChangesLabel(1)).toBe("1 tracked change");
    expect(trackedChangesLabel(5)).toBe("5 tracked changes");
    expect(changePositionLabel(0, 0)).toBe("–");
    expect(changePositionLabel(2, 5)).toBe("3 / 5");
    expect(changePositionLabel(9, 5)).toBe("5 / 5");
    expect(changePositionLabel(-3, 5)).toBe("1 / 5");
  });

  it("labels the sheet status bar", () => {
    expect(rowRangeLabel(1, 100)).toBe("Rows 1–100");
    expect(rowRangeLabel(7, 7)).toBe("Row 7");
    expect(pageOfLabel(1, 1)).toBe("Page 1 of 1");
    expect(pageOfLabel(0, 0)).toBe("Page 1 of 1");
    expect(pageOfLabel(2, 3)).toBe("Page 2 of 3");
  });

  it("pluralizes with locale grouping", () => {
    expect(pluralize(1, "word")).toBe("1 word");
    expect(pluralize(1234, "word")).toBe("1,234 words");
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });

  it("badges every kind", () => {
    expect(kindBadgeLabel("word")).toBe("DOCX");
    expect(kindBadgeLabel("sheet")).toBe("XLSX");
    expect(kindBadgeLabel("slides")).toBe("PPTX");
    expect(kindBadgeLabel("pdf")).toBe("PDF");
  });
});

describe("office chrome: platform hints", () => {
  it("picks the modifier from the platform string", () => {
    expect(modKeyFor("MacIntel")).toBe("⌘");
    expect(modKeyFor("iPhone")).toBe("⌘");
    expect(modKeyFor("Win32")).toBe("Ctrl");
    expect(modKeyFor("Linux x86_64")).toBe("Ctrl");
    expect(modKeyFor(undefined)).toBe("⌘");
    expect(modKeyFor("")).toBe("⌘");
  });

  it("rewrites shortcut hints for Windows/Linux", () => {
    expect(shortcutFor("⌘S", "Ctrl")).toBe("Ctrl+S");
    expect(shortcutFor("⌘⇧E", "Ctrl")).toBe("Ctrl+⇧E");
    expect(shortcutFor("⌘S", "⌘")).toBe("⌘S");
  });

  it("collapses side panels below the narrow breakpoint only", () => {
    expect(NARROW_VIEWPORT).toBeGreaterThan(1024);
    expect(NARROW_VIEWPORT).toBeLessThanOrEqual(1280);
  });
});
