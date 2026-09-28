/**
 * .pptx fidelity suite: fixtures are built in-test (hand-written OOXML with masters/layouts/placeholders/theme/
 * sections/transitions/groups/tables/charts/notes, plus a pptxgenjs deck), imported, exported and re-imported.
 * Asserts exact EMU geometry, text runs, bullet levels, table merges, notes, byte-identical untouched parts and
 * valid relationships after reorder/add/delete/duplicate.
 */
import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { resetSqlite } from "@/lib/db";
import { cloneDeck, cloneSlide, getTheme, normalizeDeck, plainText, slideTitle, type DeckContent, type DeckElement, type DeckSlide } from "@/modules/office/slides/model";
import { readPptx } from "@/modules/office/slides/ooxml/reader";
import { exportPptx } from "@/modules/office/slides/export";
import { importDocument } from "@/modules/office/slides/import";
import { buildSlide } from "@/modules/office/slides/layouts";
import { pxToEmuLen, pxToEmuX, pxToEmuY } from "@/modules/office/slides/ooxml/writer";
import { parseXml, serialize } from "@/modules/office/slides/ooxml/xml";
import { normalizedDeck } from "@/modules/office/slides/ooxml/normalize";
import { PNG_1x1, handFixture, pptxgenFixture } from "./office-slides-fixtures";

beforeAll(() => { resetSqlite(); });

async function importBytes(bytes: Uint8Array, name = "fixture.pptx"): Promise<DeckContent> {
  const r = await importDocument(bytes, name);
  return normalizeDeck(r.content);
}
const fetchImage = async (src: string) => (src.startsWith("data:") ? src : `data:image/png;base64,${Buffer.from(PNG_1x1).toString("base64")}`);
const exportDeck = async (deck: DeckContent, pkg: Uint8Array) => {
  let mode = "";
  const buf = await exportPptx(normalizeDeck(JSON.parse(JSON.stringify(deck))), { title: "x", fetchImage, sourcePackage: pkg, onReport: (r) => { mode = r.mode; } });
  expect(mode).toBe("package");
  return new Uint8Array(buf);
};

async function files(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const z = await JSZip.loadAsync(bytes);
  const out = new Map<string, Uint8Array>();
  for (const [name, f] of Object.entries(z.files)) if (!f.dir) out.set(name, await f.async("uint8array"));
  return out;
}
const eq = (a?: Uint8Array, b?: Uint8Array) => Boolean(a && b && a.length === b.length && a.every((v, i) => v === b[i]));
function changedParts(a: Map<string, Uint8Array>, b: Map<string, Uint8Array>): string[] {
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names].filter((n) => !eq(a.get(n), b.get(n))).sort();
}

/** Every relationship target exists, every slide in sldIdLst resolves, ids are unique, content types cover parts. */
async function assertValidPackage(bytes: Uint8Array) {
  const z = await JSZip.loadAsync(bytes);
  const text = async (p: string) => (await z.file(p)?.async("string")) ?? "";
  const ct = await text("[Content_Types].xml");
  for (const name of Object.keys(z.files)) {
    if (!name.endsWith(".rels")) continue;
    const owner = name === "_rels/.rels" ? "" : name.replace(/_rels\/([^/]+)\.rels$/, "$1");
    expect(owner === "" || Boolean(z.file(owner)), `rels without owner: ${name}`).toBe(true);
    const dir = owner.split("/").slice(0, -1).join("/");
    for (const m of (await text(name)).matchAll(/<Relationship\b[^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const target = /Target="([^"]*)"/.exec(m[0])![1];
      const parts = dir.split("/").filter(Boolean);
      for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
      const resolved = target.startsWith("/") ? target.slice(1) : parts.join("/");
      expect(Boolean(z.file(resolved)), `${name} → missing ${resolved}`).toBe(true);
    }
  }
  const pres = parseXml(await text("ppt/presentation.xml")).root;
  const presRels = await text("ppt/_rels/presentation.xml.rels");
  const ids = [...serialize(pres).matchAll(/<p:sldId id="(\d+)" r:id="(rId\d+)"\/>/g)].map((m) => ({ id: Number(m[1]), rid: m[2] }));
  expect(new Set(ids.map((x) => x.id)).size).toBe(ids.length);
  expect(new Set(ids.map((x) => x.rid)).size).toBe(ids.length);
  for (const { id, rid } of ids) {
    expect(id).toBeGreaterThanOrEqual(256);
    const m = new RegExp(`<Relationship Id="${rid}" Type="[^"]*/slide" Target="([^"]+)"`).exec(presRels);
    expect(m, `sldId ${id} ${rid} has a slide relationship`).toBeTruthy();
    expect(ct).toContain(`PartName="/ppt/${m![1]}"`);
  }
  for (const name of Object.keys(z.files).filter((n) => /^ppt\/(slides|notesSlides|charts)\/[^/]+\.xml$/.test(n))) expect(ct, `content type for ${name}`).toContain(`PartName="/${name}"`);
  return ids;
}

describe("pptx import (hand-written OOXML with masters/layouts/theme)", () => {
  it("reads theme, layouts, placeholders, inheritance and slide features", async () => {
    const deck = await importBytes(await handFixture());
    const meta = deck.meta!.pptx!;
    expect(meta.slideSize).toEqual({ cx: 12192000, cy: 6858000 });
    expect(meta.layouts.map((l) => [l.name, l.type])).toEqual([["Title Slide", "title"], ["Title and Content", "obj"], ["Two Content", "twoObj"], ["Blank", "blank"]]);
    expect(meta.layouts[2].placeholders.map((p) => [p.type, p.idx])).toEqual([["title", undefined], ["obj", "1"], ["obj", "2"]]);
    expect(deck.theme.fonts).toEqual({ heading: "Georgia", body: "Calibri" });
    expect(deck.theme.colors).toMatchObject({ fg: "#1B1B1B", bg: "#FFFFFF", accent: "#7A1F1F", accent2: "#C8A24A", muted: "#1F3A6B", surface: "#EEF1F6" });
    expect(meta.scheme?.accent4).toBe("#9BB0C9");
    expect(deck.slides.map((s) => s.section)).toEqual(["Opening", "Opening", "Evidence", "Evidence", "Evidence"]);
    expect(deck.slides.map((s) => s.hidden)).toEqual([false, false, false, true, false]);
    expect(deck.slides.map((s) => s.layout)).toEqual(["title", "bullets", "two_column", "chart", "bullets"]);

    // slide 1: placeholder geometry inherited from the layout, exact EMU; transition from mc:Fallback; notes
    const [s1, s2, s3, s4] = deck.slides;
    const title = s1.elements.find((e) => e.role === "title")!;
    expect(title.ooxml!.emu).toEqual({ x: 1524000, y: 1122363, cx: 9144000, cy: 2387600 });
    expect(title.ooxml!.inherited).toBe(true);
    expect(title.style.fontSize).toBe(44); // master titleStyle sz=4400
    expect(title.style.bold).toBe(true);
    expect(title.style.fontFamily).toBe("heading");
    expect(s1.elements.find((e) => e.role === "subtitle")!.style).toMatchObject({ fontSize: 24, align: "center" });
    expect(s1.transition).toBe("fade");
    expect(s1.notes).toBe("Open with the caption.");

    // slide 2: body inherits geometry from the master via the layout; runs, levels, bullets, spacing, autofit, link
    const body = s2.elements.find((e) => e.role === "body")!;
    expect(body.ooxml!.emu).toEqual({ x: 838200, y: 1825625, cx: 10515600, cy: 4351338 });
    const paras = body.rich!.paragraphs;
    expect(paras.map((p) => [p.level, p.bullet])).toEqual([[0, "inherit"], [1, "inherit"], [0, "none"], [0, "number"]]);
    expect(paras[0].runs.map((r) => [r.text, r.bold, r.italic])).toEqual([["Meridian ", undefined, undefined], ["knew", true, undefined], [" in ", undefined, undefined], ["1998", undefined, true]]);
    expect(paras[1].runs[1]).toMatchObject({ text: "MFC-0102211", underline: true, link: "https://example.com/docs/MFC-0102211" });
    expect(paras[2].align).toBe("center");
    expect(paras[3]).toMatchObject({ numScheme: "arabicPeriod", spaceBefore: "6pt" });
    expect(paras[3].runs[0]).toMatchObject({ size: 20, color: "#FF0000", font: "Consolas" });
    expect(paras[3].runs[1]).toMatchObject({ br: true });
    expect(body.rich!).toMatchObject({ autofit: "norm", fontScale: 0.925 });
    expect(body.text).toBe("- Meridian **knew** in *1998*\n  - Rat study __MFC-0102211__\nPlain paragraph\n1. Numbered point\nafter break");
    expect(body.style.fontSize).toBeCloseTo(28 * 0.925, 1);
    const box = s2.elements.find((e) => e.ooxml?.name === "TextBox 3")!;
    expect(box.ooxml!.emu).toEqual({ x: 9000000, y: 5600000, cx: 2400000, cy: 600000, rot: 5400000, flipH: true });
    expect(box.rotation).toBe(90);
    expect(box.flipH).toBe(true);
    expect(box.style.color).toBe("accent");

    // slide 3: two-content roles, group child transform → absolute EMU, connector with arrow
    expect(s3.elements.filter((e) => e.role === "left" || e.role === "right").map((e) => [e.role, plainText(e.text)])).toEqual([["left", "Plaintiffs: sole source"], ["right", "Defense: four suppliers"]]);
    const rect = s3.elements.find((e) => e.ooxml?.name === "Rectangle 5")!;
    expect(rect.ooxml!.emu).toEqual({ x: 1000000, y: 6000000, cx: 800000, cy: 400000 });
    expect(rect.style).toMatchObject({ fill: "accent2", stroke: "#1F3A6B", strokeWidth: 1 });
    expect(rect.groupId).toBeTruthy();
    const line = s3.elements.find((e) => e.type === "line")!;
    expect(line.ooxml!.emu).toMatchObject({ x: 2000000, y: 6200000, cx: 1000000, cy: 0, flipV: true });
    expect(line.style).toMatchObject({ arrowEnd: true, lineDir: "up", strokeWidth: 1.5 });
    expect(line.groupId).toBe(rect.groupId);

    // slide 4: table merges/fills/borders, picture crop + media, chart from cache, background, notes
    const table = s4.elements.find((e) => e.type === "table")!.table!;
    expect(table.header).toEqual(["Bates", "Document", ""]);
    expect(table.cells![0][1]).toMatchObject({ text: "Document", gridSpan: 2 });
    expect(table.cells![0][2]).toMatchObject({ hMerge: true });
    expect(table.cells![1][0]).toMatchObject({ text: "MFC-0102211", rowSpan: 2 });
    expect(table.cells![2][0]).toMatchObject({ vMerge: true });
    expect(table.cells![0][0]).toMatchObject({ fill: "#1F3A6B", borders: { b: { color: "#000000", width: 1 } } });
    expect(table.cells![2][2].fill).toBe("#FFF2CC");
    const pic = s4.elements.find((e) => e.type === "image")!;
    expect(pic.crop).toEqual({ l: 0.1, t: 0.05, r: 0.2, b: 0 });
    expect(pic.alt).toBe("Plume map");
    expect(pic.src).toMatch(/^\/api\/blobs\//);
    expect(pic.ooxml!.media).toBe("ppt/media/image1.png");
    const chart = s4.elements.find((e) => e.type === "chart")!.chart!;
    expect(chart).toMatchObject({ type: "bar", categories: ["2024", "2025", "2026"], title: "Exposure ($M)", showLegend: true });
    expect(chart.series).toEqual([{ name: "Plaintiffs", values: [184, 120, 65] }, { name: "Defense", values: [84, 60, 45] }]);
    expect(s4.background).toEqual({ color: "#F3EDE0" });
    expect(s4.notes).toBe("Walk the key documents; read MFC-0102211 aloud.");
    // master background (bgRef bg1) is inherited for display
    expect(deck.slides[4].background).toEqual({ color: "bg" });
  });
});

describe("package-preserving export", () => {
  it("an unchanged import exports every part byte-identical", async () => {
    const src = await handFixture();
    const deck = await importBytes(src);
    const out = await exportDeck(deck, src);
    expect(changedParts(await files(src), await files(out))).toEqual([]);
  });

  it("an edited slide rewrites only that slide; untouched shapes keep their bytes; re-import matches the edit", async () => {
    const src = await handFixture();
    const deck = await importBytes(src);
    const edited = cloneDeck(deck);
    const s2 = edited.slides[1];
    const body = s2.elements.find((e) => e.role === "body")!;
    body.text = "- Meridian **knew** in *1998*\n  - Rat study __MFC-0102211__\n- New third point\nPlain paragraph";
    const titleBefore = s2.elements.find((e) => e.role === "title")!;
    const box = s2.elements.find((e) => e.ooxml?.name === "TextBox 3")!;
    box.x += 40; // moved 40 px
    const before = await files(src);
    const out = await exportDeck(edited, src);
    const after = await files(out);
    expect(changedParts(before, after)).toEqual(["ppt/slides/slide2.xml"]);
    const xml = new TextDecoder().decode(after.get("ppt/slides/slide2.xml"));
    const srcXml = new TextDecoder().decode(before.get("ppt/slides/slide2.xml"));
    // the untouched title shape is byte-identical inside the patched slide
    const titleXml = /<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"\/>[\s\S]*?<\/p:sp>/.exec(srcXml)![0];
    expect(xml).toContain(titleXml);
    expect(xml).not.toContain("lnSpcReduction"); // edited text clears the stale autofit scale
    const re = await importBytes(out);
    const s2b = re.slides[1];
    const body2 = s2b.elements.find((e) => e.role === "body")!;
    expect(body2.text).toBe(body.text);
    expect(body2.rich!.paragraphs.map((p) => p.level)).toEqual([0, 1, 0, 0]);
    expect(body2.rich!.paragraphs[1].runs[1].link).toBe("https://example.com/docs/MFC-0102211"); // untouched paragraph reused verbatim
    expect(body2.rich!.paragraphs[2].runs[0]).toMatchObject({ text: "New third point" });
    expect(body2.rich!.paragraphs[2].runs[0].color).toBeUndefined(); // new bullet borrows a plain bullet paragraph, not the red numbered one
    const box2 = s2b.elements.find((e) => e.ooxml?.name === "TextBox 3")!;
    expect(box2.ooxml!.emu).toEqual({ ...box.ooxml!.emu, x: pxToEmuX(box.x, deck.meta!.pptx!.map) });
    expect(s2b.elements.find((e) => e.role === "title")!.ooxml!.emu).toEqual(titleBefore.ooxml!.emu);
    // the rest of the deck is identical in the normalized model
    const a = normalizedDeck(deck), b = normalizedDeck(re);
    expect(b.slides.filter((_, i) => i !== 1)).toEqual(a.slides.filter((_, i) => i !== 1));
  });

  it("import → export → re-import keeps the normalized model (geometry EMU exact, runs, levels, merges, notes)", async () => {
    for (const bytes of [await handFixture(), await pptxgenFixture()]) {
      const deck = await importBytes(bytes);
      // untouched: full equality including every run
      const same = await importBytes(await exportDeck(deck, bytes));
      expect(normalizedDeck(same)).toEqual(normalizedDeck(deck));
      // edit every slide: notes, every non-empty text, every top-level shape position
      const edited = cloneDeck(deck);
      for (const s of edited.slides) {
        s.notes = `${s.notes} [reviewed]`.trim();
        for (const el of s.elements) {
          if ((el.type === "text" || el.type === "shape") && el.text?.trim() && !el.ooxml?.opaque) el.text = `${el.text} (rev)`;
          if (!el.ooxml?.group) el.x += 8;
        }
      }
      const out = await exportDeck(edited, bytes);
      await assertValidPackage(out);
      const re = await importBytes(out);
      expect(normalizedDeck(re, { runs: false })).toEqual(normalizedDeck(edited, { runs: false }));
    }
  });

  it("geometry, style, table and chart edits round-trip exactly", async () => {
    const src = await handFixture();
    const deck = await importBytes(src);
    const map = deck.meta!.pptx!.map;
    const e = cloneDeck(deck);
    const s4 = e.slides[3];
    const table = s4.elements.find((x) => x.type === "table")!;
    table.table!.rows[2][2] = "Stewardship program (2006)";
    table.table!.cells![3][2].text = "Stewardship program (2006)";
    const chart = s4.elements.find((x) => x.type === "chart")!;
    chart.chart = { ...chart.chart!, series: chart.chart!.series.map((s) => ({ ...s, values: s.values.map((v) => v + 1) })) };
    const pic = s4.elements.find((x) => x.type === "image")!;
    pic.w = 300; pic.h = 200; pic.crop = { l: 0, t: 0, r: 0, b: 0.25 };
    const rect = e.slides[2].elements.find((x) => x.ooxml?.name === "Rectangle 5")!;
    rect.x += 32; rect.style = { ...rect.style, fill: "#123456" };
    const title = e.slides[4].elements.find((x) => x.role === "title")!;
    title.style = { ...title.style, fontSize: 36, color: "accent2" };
    const out = await exportDeck(e, src);
    const re = await importBytes(out);
    const t2 = re.slides[3].elements.find((x) => x.type === "table")!.table!;
    expect(t2.rows[2][2]).toBe("Stewardship program (2006)");
    expect(t2.cells![0][1]).toMatchObject({ gridSpan: 2 });
    expect(t2.cells![2][0]).toMatchObject({ vMerge: true });
    expect(re.slides[3].elements.find((x) => x.type === "chart")!.chart!.series[0].values).toEqual([185, 121, 66]);
    const pic2 = re.slides[3].elements.find((x) => x.type === "image")!;
    expect(pic2.ooxml!.emu).toEqual({ x: pic.ooxml!.emu.x, y: pic.ooxml!.emu.y, cx: pxToEmuLen(300, map), cy: pxToEmuLen(200, map) });
    expect(pic2.crop).toEqual({ l: 0, t: 0, r: 0, b: 0.25 });
    const rect2 = re.slides[2].elements.find((x) => x.ooxml?.name === "Rectangle 5")!;
    // group member: written in child coordinates (scale 2), so within one child unit of the requested EMU
    expect(Math.abs(rect2.ooxml!.emu.x - pxToEmuX(rect.x, map))).toBeLessThanOrEqual(2);
    expect({ ...rect2.ooxml!.emu, x: 0 }).toEqual({ ...rect.ooxml!.emu, x: 0 });
    expect(rect2.style.fill).toBe("#123456");
    const title2 = re.slides[4].elements.find((x) => x.role === "title")!;
    expect(title2.style).toMatchObject({ fontSize: 36, color: "accent2" });
    expect(title2.ooxml!.inherited).toBe(true); // still no explicit xfrm: geometry untouched
    await assertValidPackage(out);
  });

  it("reorder, add, delete and duplicate keep relationships, ids, sections and notes valid", async () => {
    const src = await handFixture();
    const deck = await importBytes(src);
    const e = cloneDeck(deck);
    const [a, b, c, , f] = e.slides;
    const dup = cloneSlide(b);
    const fresh = buildSlide("bullets", { title: "Added in LeClaude", body: "- one\n- two" }, e.theme);
    fresh.notes = "New slide notes";
    fresh.section = "Evidence";
    const img = { id: "el_newimg", type: "image" as const, src: "/api/blobs/new", x: 900, y: 400, w: 200, h: 100, z: 50, style: { fit: "cover" as const } };
    fresh.elements.push(img);
    const chartEl: DeckElement = { id: "el_newchart", type: "chart", x: 80, y: 420, w: 400, h: 240, z: 51, style: {}, chart: { type: "pie", categories: ["A", "B"], series: [{ name: "Share", values: [60, 40] }] } };
    fresh.elements.push(chartEl);
    e.slides = [f, a, dup, fresh, c, b]; // slide 4 (d) deleted; slide 2 duplicated; new slide added; reordered
    f.section = "Opening";
    const out = await exportDeck(e, src);
    const ids = await assertValidPackage(out);
    expect(ids.length).toBe(6);
    const re = await importBytes(out);
    expect(re.slides.map((s) => slideTitle(s))).toEqual(["Next steps", "Meridian v. Halvorsen", "Key facts", "Added in LeClaude", "Their theory vs ours", "Key facts"]);
    expect(re.slides.map((s) => s.section)).toEqual(["Opening", "Opening", "Opening", "Evidence", "Evidence", "Opening"]);
    const presXml = new TextDecoder().decode((await files(out)).get("ppt/presentation.xml"));
    expect([...presXml.matchAll(/<p14:section name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Opening", "Evidence", "Opening"]);
    expect(re.slides[3].notes).toBe("New slide notes");
    expect(re.slides[1].notes).toBe("Open with the caption.");
    expect(re.slides[3].elements.find((x) => x.role === "title")!.ooxml!.ph).toMatchObject({ type: "title" });
    expect(re.slides[3].elements.some((x) => x.type === "chart" && x.chart?.type === "pie")).toBe(true);
    expect(re.slides[3].elements.some((x) => x.type === "image")).toBe(true);
    // the duplicate has its own part; both copies match the original content
    expect(re.slides[2].ooxml!.part).not.toBe(re.slides[5].ooxml!.part);
    expect(normalizedDeck(re).slides[2].elements).toEqual(normalizedDeck(re).slides[5].elements);
    // deleted slide 4: its notes, chart and media are gone; unknown parts survive byte-for-byte
    const after = await files(out), before = await files(src);
    expect([...after.keys()].some((k) => k === "ppt/notesSlides/notesSlide4.xml")).toBe(false);
    expect([...after.keys()].some((k) => k === "ppt/charts/chart1.xml")).toBe(false);
    for (const k of ["customXml/item1.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout2.xml", "ppt/theme/theme1.xml", "ppt/notesMasters/notesMaster1.xml", "ppt/slides/slide1.xml", "ppt/slides/slide3.xml"]) expect(eq(after.get(k), before.get(k)), k).toBe(true);
    expect(new TextDecoder().decode(after.get("docProps/app.xml"))).toContain("<Slides>6</Slides>");
  });

  it("restyling the deck theme patches only the theme part", async () => {
    const src = await handFixture();
    const deck = await importBytes(src);
    const e = cloneDeck(deck);
    e.theme = { ...e.theme, fonts: { heading: "Cambria", body: "Arial" }, colors: { ...e.theme.colors, accent: "#0F766E" } };
    const out = await exportDeck(e, src);
    expect(changedParts(await files(src), await files(out))).toEqual(["ppt/theme/theme1.xml"]);
    const re = await importBytes(out);
    expect(re.theme.fonts).toEqual({ heading: "Cambria", body: "Arial" });
    expect(re.theme.colors.accent).toBe("#0F766E");
    expect(re.theme.colors.accent2).toBe("#C8A24A");
  });

  it("refuses to borrow slide parts from a different package", async () => {
    const src = await handFixture();
    const deck = await importBytes(src);
    const other = await importBytes(await handFixture(), "other.pptx");
    // different import → different package id; the slide is written fresh, never mapped onto slide1.xml bytes
    other.slides[0].ooxml!.pkg = "pkg_someone_else";
    const e = cloneDeck(deck);
    e.slides = [other.slides[0], ...e.slides.slice(1)];
    const out = await exportDeck(e, src);
    const re = await importBytes(out);
    expect(re.slides[0].ooxml!.part).not.toBe("ppt/slides/slide1.xml");
    expect(slideTitle(re.slides[0])).toBe("Meridian v. Halvorsen");
  });
});

describe("generated export (new decks)", () => {
  it("writes the deck theme into the package and preserves roles on re-import", async () => {
    const deck = normalizeDeck({ version: 1, theme: getTheme("courtroom-serif"), size: { w: 1280, h: 720 }, slides: [buildSlide("bullets", { title: "Themes", body: "- a\n  - b" }, getTheme("courtroom-serif"))] });
    const buf = await exportPptx(deck, { title: "New deck" });
    const z = await JSZip.loadAsync(buf);
    const theme = await z.file("ppt/theme/theme1.xml")!.async("string");
    expect(theme).toContain(`val="7A1F1F"`); // accent1 = theme accent
    expect(theme).toContain(`typeface="Times New Roman"`);
    const re = await importBytes(new Uint8Array(buf));
    expect(re.theme.colors.accent).toBe("#7A1F1F");
    expect(re.slides[0].elements.find((e) => e.role === "title")).toBeTruthy();
    expect(re.slides[0].elements.find((e) => e.role === "body")!.text).toContain("  - b");
  });

  it("pptxgenjs fixture imports sections, hidden, flips, merges and links", async () => {
    const deck = await importBytes(await pptxgenFixture());
    expect(deck.slides.map((s) => s.section)).toEqual(["Intro", "Record"]);
    expect(deck.slides[1].hidden).toBe(true);
    const shape = deck.slides[0].elements.find((e) => e.type === "shape")!;
    expect(shape).toMatchObject({ rotation: 30, flipH: true });
    const body = deck.slides[0].elements.find((e) => e.rich?.paragraphs.some((p) => p.runs.some((r) => r.link)))!;
    expect(body.rich!.paragraphs.flatMap((p) => p.runs).find((r) => r.link)!.link).toBe("https://example.com/record");
    const t = deck.slides[1].elements.find((e) => e.type === "table")!.table!;
    expect(t.cells![0][1]).toMatchObject({ gridSpan: 2 });
    expect(t.cells![1][0]).toMatchObject({ rowSpan: 2 });
    expect(deck.slides[0].notes).toBe("Emphasize the timeline.");
  });
});

describe("normalized model helper", () => {
  it("ignores app ids but keeps OOXML identity", async () => {
    const deck = await importBytes(await handFixture());
    const n = normalizedDeck(deck);
    expect(JSON.stringify(n)).not.toMatch(/"sl_|"el_/);
    expect(n.slides[1].elements.some((e) => e.spid === 3)).toBe(true);
    const s: DeckSlide = deck.slides[0];
    expect(pxToEmuY(s.elements[0].y, deck.meta!.pptx!.map)).toBeGreaterThan(0);
  });
});

void readPptx;
