import { describe, expect, it } from "vitest";
import type { Provenance } from "@/lib/integrity/types";
import type { EditProposal } from "@/modules/office/shared/types";
import { KIND_BADGE, approximatePages, countLabel, downloadItemsToEntries, extractRunProvenance, mergeRunProvenance, needsNotSourceBackedBanner, proposalAuditPayload, saveButtonLabel, saveTone, savedAtLabel } from "@/modules/office/shared/office-chrome-helpers";

const prov = (over: Partial<Provenance> = {}): Provenance => ({ model: "gpt-test", generatedAt: "2026-09-24T12:00:00.000Z", sources: [], surface: "office.word", ...over });

describe("office chrome: run info merge", () => {
  const defaults = { research: false, mode: "draft", message: "Tighten the standard" };
  it("keeps the no-key flag and the values captured at send time when the provenance artifact arrives", () => {
    const merged = mergeRunProvenance({ provenance: null, research: true, mode: "ask", message: "first", noKey: true }, prov(), defaults);
    expect(merged.noKey).toBe(true);
    expect(merged.research).toBe(true);
    expect(merged.mode).toBe("ask");
    expect(merged.message).toBe("first");
    expect(merged.provenance?.model).toBe("gpt-test");
  });
  it("falls back to the panel's current state when the message had no run info yet", () => {
    const merged = mergeRunProvenance(undefined, null, defaults);
    expect(merged).toEqual({ provenance: null, research: false, mode: "draft", message: "Tighten the standard" });
  });
});

describe("office chrome: save state", () => {
  it("maps save states to a tone and a primary button label", () => {
    expect(saveTone("idle")).toBe("muted");
    expect(saveTone("saved")).toBe("muted");
    expect(saveTone("dirty")).toBe("warning");
    expect(saveTone("saving")).toBe("warning");
    expect(saveTone("error")).toBe("destructive");
    expect(saveButtonLabel("idle")).toBe("Saved");
    expect(saveButtonLabel("saved")).toBe("Saved");
    expect(saveButtonLabel("dirty")).toBe("Save");
    expect(saveButtonLabel("saving")).toBe("Saving…");
    expect(saveButtonLabel("error")).toBe("Retry");
  });

  it("renders the header save label with the clock time when known", () => {
    const at = new Date(2026, 8, 24, 15, 8);
    expect(savedAtLabel("saved", at)).toMatch(/^Saved 3:08/);
    expect(savedAtLabel("idle", at)).toMatch(/^Saved 3:08/);
    expect(savedAtLabel("idle", null)).toBe("All changes saved");
    expect(savedAtLabel("saved", null)).toBe("Saved");
    expect(savedAtLabel("dirty", at)).toBe("Unsaved changes");
    expect(savedAtLabel("saving", at)).toBe("Saving…");
    expect(savedAtLabel("error", at)).toBe("Save failed");
  });
});

describe("office chrome: kinds and labels", () => {
  it("has an upper-case file-type badge for every editor", () => {
    expect(KIND_BADGE.word).toBe("DOCX");
    expect(KIND_BADGE.sheet).toBe("XLSX");
    expect(KIND_BADGE.slides).toBe("PPTX");
    expect(KIND_BADGE.pdf).toBe("PDF");
  });

  it("formats counts", () => {
    expect(countLabel("Comments", 0)).toBe("Comments");
    expect(countLabel("Comments", undefined)).toBe("Comments");
    expect(countLabel("Comments", 3)).toBe("Comments (3)");
  });

  it("estimates pages from words and line spacing", () => {
    expect(approximatePages(0, 1.15)).toBe(1);
    expect(approximatePages(1000, 1.15)).toBe(2);
    expect(approximatePages(1000, 2)).toBe(4);
    expect(approximatePages(720, 1.5)).toBe(2);
  });

});

describe("office chrome: download menu", () => {
  it("converts DownloadItem lists into menu entries with separators", () => {
    const entries = downloadItemsToEntries([
      { id: "a", label: "A", onSelect: () => {} },
      { id: "b", label: "B", separatorBefore: true, onSelect: () => {} },
      { id: "c", label: "C", href: "/x.pdf", download: "x.pdf" },
    ]);
    expect(entries).toHaveLength(4);
    expect(entries[1]).toBe("separator");
    expect(entries[3]).toMatchObject({ label: "C", href: "/x.pdf", download: "x.pdf" });
  });

  it("does not start with a separator", () => {
    const entries = downloadItemsToEntries([{ id: "a", label: "A", separatorBefore: true }]);
    expect(entries).toHaveLength(1);
  });
});

describe("office chrome: provenance from the agent stream", () => {
  it("accepts a bare Provenance object (older servers)", () => {
    const p = prov({ sources: [{ kind: "web", url: "https://example.org" }] });
    const r = extractRunProvenance(p);
    expect(r.run?.sources).toHaveLength(1);
    expect(Object.keys(r.proposals)).toHaveLength(0);
  });

  it("accepts the { run, proposals, findings } envelope and maps per-item provenance", () => {
    const r = extractRunProvenance({ run: prov(), proposals: [{ id: "p1", provenance: prov({ confidence: 0.9 }) }, { id: "bad" }], findings: [{ id: "f1", provenance: prov({ confidence: 0.4 }) }] });
    expect(r.run?.model).toBe("gpt-test");
    expect(r.proposals.p1.confidence).toBe(0.9);
    expect(r.proposals.bad).toBeUndefined();
    expect(r.findings.f1.confidence).toBe(0.4);
  });

  it("ignores garbage", () => {
    expect(extractRunProvenance(null).run).toBeNull();
    expect(extractRunProvenance("x").run).toBeNull();
    expect(extractRunProvenance({ run: { model: 1 } }).run).toBeNull();
    expect(extractRunProvenance({ provenance: prov() }).run?.surface).toBe("office.word");
  });

  it("shows the not-source-backed banner only when research was on and nothing was read", () => {
    expect(needsNotSourceBackedBanner(false, null)).toBe(false);
    expect(needsNotSourceBackedBanner(true, null)).toBe(true);
    expect(needsNotSourceBackedBanner(true, prov())).toBe(true);
    expect(needsNotSourceBackedBanner(true, prov({ sources: [{ kind: "case-law", cite: "477 U.S. 317" }] }))).toBe(false);
    expect(needsNotSourceBackedBanner(false, prov())).toBe(false);
  });
});

describe("office chrome: audit payload for applied proposals", () => {
  const proposals: (EditProposal & { provenance?: Provenance })[] = [
    { id: "p1", kind: "rewrite_paragraph", title: "Rewrite ¶12", summary: "x".repeat(400), target: "b12", targetLabel: "¶12", payload: { text: "…" }, status: "pending", risk: "medium", provenance: prov() },
    { id: "p2", kind: "comment", title: "Comment on ¶3", payload: {}, status: "pending" },
  ];

  it("records the final status per proposal, truncates summaries and keeps provenance", () => {
    const body = proposalAuditPayload(proposals, (p) => (p.id === "p1" ? "applied" : "failed"), { mode: "draft", message: "m".repeat(500) });
    expect(body.mode).toBe("draft");
    expect(body.message).toHaveLength(300);
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0]).toMatchObject({ id: "p1", status: "applied", targetLabel: "¶12", risk: "medium" });
    expect(body.proposals[0].summary).toHaveLength(300);
    expect(body.proposals[0].provenance?.model).toBe("gpt-test");
    expect(body.proposals[1]).toMatchObject({ id: "p2", status: "failed" });
    expect(body.proposals[1].provenance).toBeUndefined();
  });

  it("marks discards", () => {
    const body = proposalAuditPayload(proposals, () => "discarded");
    expect(body.proposals.every((p) => p.status === "discarded")).toBe(true);
    expect(body.mode).toBeUndefined();
  });
});
