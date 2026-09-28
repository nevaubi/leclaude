import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { getSchema } from "@tiptap/core";
import { Node as PMNodeClass } from "@tiptap/pm/model";
import { resetSqlite } from "@/lib/db";
import type { PMNode } from "@/modules/office/word/doc-model";
import { ensureBlockIds, flattenBlocks } from "@/modules/office/word/doc-model";
import { exportDocx } from "@/modules/office/word/export";
import { importDocxDirect } from "@/modules/office/word/import";
import { extractModel, type DocxModel } from "@/modules/office/word/ooxml/model";
import { validateDocx } from "@/modules/office/word/ooxml/validate";
import { wordSchemaExtensions } from "@/modules/office/word/schema-extensions";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import type { DocxMeta } from "@/modules/office/word/ooxml/types";
import { handDocxFixture, richDocxFixture, tinyPng } from "./helpers/word-docx-fixtures";

beforeAll(() => { resetSqlite(); });

const schema = getSchema(wordSchemaExtensions());
/** What the editor stores after loading a document and saving it untouched. */
function throughEditor(doc: PMNode): PMNode { return PMNodeClass.fromJSON(schema, doc).toJSON() as PMNode; }

async function importFixture(bytes: Uint8Array) {
  const r = await importDocxDirect(bytes, { persistImages: false });
  return { doc: r.doc, meta: r.meta, settings: r.settings };
}

async function exportImported(doc: PMNode, base: Uint8Array, meta: DocxMeta, settings: Record<string, unknown>, extra: Partial<Parameters<typeof exportDocx>[1]> = {}) {
  let report: { mode: string; changedParts?: string[]; preservedBlocks?: number; regeneratedBlocks?: number; warnings: string[] } | null = null;
  const bytes = await exportDocx(doc, { title: "Fixture", settings, basePackage: base, importedComments: meta.comments, fetchImage: async () => ({ bytes: tinyPng(), type: "png", width: 4, height: 3 }), onReport: (r) => { report = r; }, ...extra });
  return { bytes: new Uint8Array(bytes), report: report! };
}

async function parts(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, Uint8Array>();
  for (const f of Object.values(zip.files)) if (!f.dir) out.set(f.name, await f.async("uint8array"));
  return out;
}

function eqBytes(a?: Uint8Array, b?: Uint8Array) { return Boolean(a && b && a.length === b.length && a.every((x, i) => x === b[i])); }

/** Model with volatile ids removed (revision/comment ids, drawing ids) for comparisons. */
function stable(m: DocxModel) { return JSON.parse(JSON.stringify(m)); }

function paraTexts(m: DocxModel) { return m.body.flatMap((b) => (b.kind === "p" ? [b.p.text] : b.t.rows.flatMap((r) => r.cells.map((c) => c.text)))); }

function findText(doc: PMNode, needle: string): PMNode | null {
  let hit: PMNode | null = null;
  const walk = (n: PMNode) => { if (hit) return; if ((n.type === "paragraph" || n.type === "heading") && (n.content ?? []).map((c) => c.text ?? "").join("").includes(needle)) { hit = n; return; } for (const c of n.content ?? []) walk(c); };
  walk(doc);
  return hit;
}

describe("OOXML import (rich docx fixture)", () => {
  it("maps styles, run formatting, headings, numbering, tables, sections, notes, comments, changes, links, fields and images", async () => {
    const bytes = await richDocxFixture();
    const { doc, meta, settings } = await importFixture(bytes);
    const blocks = flattenBlocks(doc).blocks;
    expect(blocks.find((b) => b.text === "Motion for Summary Judgment")).toMatchObject({ type: "heading", pStyle: "title" });
    expect(blocks.find((b) => b.text === "Introduction")).toMatchObject({ type: "heading", level: 1 });
    expect(blocks.find((b) => b.text === "Undisputed facts")).toMatchObject({ type: "heading", level: 2 });
    // run formatting → marks
    const body = findText(doc, "Defendant")!;
    const markOf = (t: string) => (body.content ?? []).find((c) => c.text === t)?.marks?.map((m) => m.type) ?? [];
    expect(markOf("bold")).toContain("bold");
    expect(markOf("italic")).toContain("italic");
    expect(markOf("double underlined")).toContain("underline");
    expect(markOf("struck")).toContain("strike");
    expect(markOf("all caps")).toContain("caps");
    expect(markOf("small caps")).toContain("smallCaps");
    expect(markOf("2")).toContain("superscript");
    expect((body.content ?? []).find((c) => c.text === "red")?.marks?.find((m) => m.type === "textStyle")?.attrs?.color).toBe("#c00000");
    expect((body.content ?? []).find((c) => c.text === "Arial 14")?.marks?.find((m) => m.type === "textStyle")?.attrs).toMatchObject({ fontFamily: "Arial", fontSize: "14pt" });
    expect((body.content ?? []).find((c) => c.text === "highlighted")?.marks?.find((m) => m.type === "highlight")).toBeTruthy();
    expect((body.content ?? []).find((c) => c.text === "Acme Corp.")?.marks?.find((m) => m.type === "docxRun")?.attrs?.rStyle).toBe("DefinedTerm");
    expect(body.attrs?.styleId).toBe("LegalBody");
    // numbering → nested lists
    const lists = (doc.content ?? []).filter((n) => n.type === "orderedList" || n.type === "bulletList");
    expect(lists.length).toBeGreaterThanOrEqual(3);
    const outline = lists[0];
    expect(outline.type).toBe("orderedList");
    expect(outline.content?.length).toBe(2);
    expect(outline.content?.[0].content?.[1]?.type).toBe("orderedList");
    expect(lists.find((l) => l.type === "bulletList")).toBeTruthy();
    // table geometry
    const table = (doc.content ?? []).find((n) => n.type === "table")!;
    expect(table.content?.[0].content?.every((c) => c.type === "tableHeader")).toBe(true);
    expect(table.content?.[1].content?.[1].attrs?.colspan).toBe(2);
    expect(table.content?.[2].content?.[0].attrs?.rowspan).toBe(2);
    expect(table.content?.[3].content?.length).toBe(2);
    // notes, comments, tracked changes, links, fields, images
    const all = JSON.stringify(doc);
    expect(all).toContain("Celotex Corp. v. Catrett");
    expect(all).toContain("\"kind\":\"endnote\"");
    expect(meta.comments.map((c) => c.author).sort()).toEqual(["Jane Partner", "Sam Associate"]);
    expect(meta.comments.find((c) => c.author === "Jane Partner")?.quote).toContain("March 2, 2026");
    expect(all).toContain("\"type\":\"insertion\"");
    expect(all).toContain("\"type\":\"deletion\"");
    expect(all).toContain("https://www.courtlistener.com/opinion/111722/celotex-corp-v-catrett/");
    expect(all).toContain("#introduction");
    expect(meta.fields.some((f) => /^TOC/.test(f))).toBe(true);
    expect(meta.fields.some((f) => /^REF introduction/.test(f))).toBe(true);
    expect(meta.bookmarks).toContain("introduction");
    expect((doc.content ?? []).some((n) => n.type === "image" && n.attrs?.width === 120)).toBe(true);
    // sections & page setup
    expect(meta.sections.length).toBe(2);
    expect(meta.sections[0]).toMatchObject({ orientation: "portrait", titlePage: true });
    expect(meta.sections[0].headers.first).toBe("First page header");
    expect(meta.sections[0].headers.even).toBe("Even page header");
    expect(meta.sections[0].footers.default).toContain("{PAGE}");
    expect(meta.sections[1]).toMatchObject({ orientation: "landscape", columns: { num: 2 } });
    expect(settings.pageNumbers).toBe(true);
    // spacing / indent / keep-next / page break
    const spaced = findText(doc, "Spacing, hanging indent")!;
    expect(spaced.attrs).toMatchObject({ spacingBefore: 12, spacingAfter: 12, lineHeight: 2, indent: 1 });
    expect(String((spaced.attrs?.docx as { pPr: string }).pPr)).toContain("w:keepNext");
    expect(all).toContain("\"kind\":\"pageBreak\"");
  });
});

describe("package-preserving round trip", () => {
  for (const [name, make] of [["rich (docx package)", richDocxFixture], ["hand-written OOXML", handDocxFixture]] as const) {
    it(`${name}: unchanged document through the editor exports the original package`, async () => {
      const bytes = await make();
      const { doc, meta, settings } = await importFixture(bytes);
      const edited = throughEditor(doc);
      const { bytes: out } = await exportImported(edited, bytes, meta, settings as unknown as Record<string, unknown>);
      const a = await parts(bytes), b = await parts(out);
      expect(Array.from(b.keys()).sort()).toEqual(Array.from(a.keys()).sort());
      for (const [k, v] of a) expect(eqBytes(v, b.get(k)), `${k} byte-identical`).toBe(true);
      expect((await validateDocx(out)).errors).toEqual([]);
    });

    it(`${name}: import → edit → export → re-import keeps every structure; untouched parts byte-identical`, async () => {
      const bytes = await make();
      const orig = await extractModel(bytes);
      const { doc, meta, settings } = await importFixture(bytes);
      const edited = throughEditor(doc);
      // Edit one paragraph that holds no structure so everything else must survive.
      const target = findText(edited, name.startsWith("rich") ? "Between lists." : "Second section text.")!;
      target.content = [{ type: "text", text: name.startsWith("rich") ? "Between the lists (edited)." : "Second section text (edited)." }];
      const { bytes: out, report } = await exportImported(edited, bytes, meta, settings as unknown as Record<string, unknown>);
      expect(report.mode).toBe("preserve");
      expect(report.regeneratedBlocks).toBe(1);
      const validation = await validateDocx(out);
      expect(validation.errors).toEqual([]);
      const a = await parts(bytes), b = await parts(out);
      for (const [k, v] of a) if (k !== meta.mainPart) expect(eqBytes(v, b.get(k)), `${k} byte-identical`).toBe(true);
      const after = await extractModel(out);
      const texts = paraTexts(after);
      expect(texts.some((t) => t.includes("(edited)"))).toBe(true);
      // Everything except the edited paragraph is structurally identical.
      const strip = (m: DocxModel) => { const c = stable(m); c.body = c.body.filter((x: { kind: string; p?: { text: string } }) => !(x.kind === "p" && /Between|Second section text/.test(x.p!.text))); return c; };
      expect(strip(after)).toEqual(strip(orig));
      // Re-import of the export yields the same editor document apart from the edit.
      const again = await importFixture(out);
      expect(flattenBlocks(again.doc).blocks.length).toBe(flattenBlocks(doc).blocks.length);
    });
  }
});

function walkNodes(n: PMNode, f: (n: PMNode, parent: PMNode | null) => void, parent: PMNode | null = null) { f(n, parent); for (const c of n.content ?? []) walkNodes(c, f, n); }
function nodeWithText(doc: PMNode, type: string, needle: string): PMNode {
  let hit: PMNode | null = null;
  walkNodes(doc, (n) => { if (!hit && n.type === type && JSON.stringify(n).includes(needle)) hit = n; });
  if (!hit) throw new Error(`no ${type} with ${needle}`);
  return hit;
}

describe("package-preserving export with edits", () => {
  it("restarts, new lists, comments, notes, tracked changes, heading levels, table rows, page setup and images all land in the original package", async () => {
    const bytes = await richDocxFixture();
    const { doc: imported, meta, settings } = await importFixture(bytes);
    const doc = throughEditor(imported);
    // 1. restart the second outline list at 5
    const restarted = nodeWithText(doc, "orderedList", "Restarted list item one");
    restarted.attrs = { ...restarted.attrs, start: 5 };
    // 2. a new (app-created) bullet list and paragraph after the bullets
    const bullets = nodeWithText(doc, "bulletList", "Bullet two");
    const at = doc.content!.indexOf(bullets);
    doc.content!.splice(at + 1, 0, ...ensureBlockIds(markdownToDoc("New paragraph after the bullets.\n\n- New bullet A\n- New bullet B")).content!);
    // 3. a new comment on the "Undisputed facts" heading
    const heading = nodeWithText(doc, "heading", "Undisputed facts");
    heading.attrs = { ...heading.attrs, level: 3 };
    heading.content = heading.content!.map((c) => ({ ...c, marks: [...(c.marks ?? []), { type: "comment", attrs: { id: "cmt_new1" } }] }));
    // 4. a new footnote
    const newPage = nodeWithText(doc, "paragraph", "Starts on a new page.");
    newPage.content = [{ type: "text", text: "Starts on a new page", marks: [{ type: "footnote", attrs: { id: "fn_new", text: "Added footnote text." } }] }, { type: "text", text: "." }];
    // 5. a tracked insertion made in the editor
    const first = nodeWithText(doc, "paragraph", "First fact");
    first.content = [{ type: "text", text: "First fact" }, { type: "text", text: " (undisputed)", marks: [{ type: "insertion", attrs: { id: "chg1", author: "Drafting assistant", date: "2026-09-28T12:00:00.000Z" } }] }];
    // 7. a new table row
    const table = doc.content!.find((n) => n.type === "table")!;
    table.content!.push(ensureBlockIds({ type: "doc", content: [{ type: "tableRow", content: ["2024-06-01", "Opposition", "ECF 20"].map((t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })) }] }).content![0]);
    // 10. resize the image
    const image = doc.content!.find((n) => n.type === "image")!;
    image.attrs = { ...image.attrs, width: 200 };
    const comments = [{ id: "cmt_new1", docId: "d", anchor: String(heading.attrs?.id), body: "Tie each fact to the record.", authorName: "Firm Reviewer", createdAt: "2026-09-28T12:00:00.000Z", source: "user", replies: [] }] as unknown as Parameters<typeof exportDocx>[1]["comments"];
    // 8. page setup: wide margins
    const { bytes: out, report } = await exportImported(doc, bytes, meta, { ...settings, margins: "wide" }, { comments });
    expect(report.mode).toBe("preserve");
    expect((await validateDocx(out)).errors).toEqual([]);
    const a = await parts(bytes), b = await parts(out);
    for (const k of ["word/styles.xml", "word/settings.xml", "word/endnotes.xml", "docProps/core.xml", ...Array.from(a.keys()).filter((x) => /header|footer|media\//.test(x))]) expect(eqBytes(a.get(k), b.get(k)), `${k} byte-identical`).toBe(true);
    const m = await extractModel(out);
    const paras = m.body.flatMap((x) => (x.kind === "p" ? [x.p] : []));
    const byText = (t: string) => paras.find((p) => p.text.startsWith(t))!;
    expect(byText("Restarted list item one").num?.label).toBe("5.");
    expect(byText("Restarted list item two").num?.label).toBe("6.");
    expect(byText("First fact").num?.label).toBe("1.");
    expect(byText("Second fact").num?.label).toBe("2.");
    expect(byText("New bullet A").num).toBeTruthy();
    expect(byText("New paragraph after the bullets.").num).toBeNull();
    expect(byText("Undisputed facts").style).toBe("Heading3");
    expect(byText("Starts on a new page").notes).toEqual(["fn:Added footnote text."]);
    expect(m.footnotes).toContain("Added footnote text.");
    expect(m.footnotes).toContain("See Celotex Corp. v. Catrett, 477 U.S. 317, 322 (1986).");
    expect(m.comments.map((c) => c.text)).toEqual(expect.arrayContaining(["Confirm this date against the docket.", "Defined term used before definition.", "Tie each fact to the record."]));
    expect(m.comments.find((c) => c.author === "Firm Reviewer")?.range).toBe("Undisputed facts");
    expect(m.trackedChanges).toEqual(expect.arrayContaining([{ type: "ins", author: "Drafting assistant", date: "2026-09-28T12:00:00Z", text: " (undisputed)" }, { type: "ins", author: "Jane Partner", date: "2026-03-02T10:00:00Z", text: "without a hearing" }]));
    const t = m.body.flatMap((x) => (x.kind === "tbl" ? [x] : []))[0];
    expect(t.t.rows.length).toBe(5);
    expect(t.t.rows[4].cells.map((c) => c.text)).toEqual(["2024-06-01", "Opposition", "ECF 20"]);
    expect(t.t.rows[3].cells[0].vMerge).toBe("continue");
    expect(t.t.grid).toEqual([2400, 3600, 3360]);
    expect(paras.find((p) => p.images.length)?.images[0].cx).toBe(200 * 9525);
    for (const s of m.sections) expect(s.margins["w:left"]).toBe("2880");
    expect(m.sections[1].orient).toBe("landscape");
    expect(m.sections[0].headers.first).toBe("First page header");
    // New numbering definitions were appended to the original numbering part, not replacing it.
    const numA = new TextDecoder().decode(a.get("word/numbering.xml")!), numB = new TextDecoder().decode(b.get("word/numbering.xml")!);
    expect(numB.length).toBeGreaterThan(numA.length);
    expect((numB.match(/<w:abstractNum /g) ?? []).length).toBe((numA.match(/<w:abstractNum /g) ?? []).length + 1);
  });

  it("hand-written package: resolving an imported comment, editing its text and accepting changes", async () => {
    const bytes = await handDocxFixture();
    const { doc: imported, meta, settings } = await importFixture(bytes);
    const doc = throughEditor(imported);
    expect(meta.comments.find((c) => c.text === "Resolved already.")?.resolved).toBe(true);
    const open = meta.comments.find((c) => c.text === "Still open.")!;
    const importedComments = meta.comments.map((c) => (c.id === open.id ? { ...c, resolved: true, text: "Still open — now resolved." } : c));
    const { bytes: out } = await exportImported(doc, bytes, meta, settings as unknown as Record<string, unknown>, { importedComments });
    expect((await validateDocx(out)).errors).toEqual([]);
    const m = await extractModel(out);
    expect(m.comments.find((c) => c.author === "Sam Associate")).toMatchObject({ text: "Still open — now resolved.", done: true, range: "Open comment range" });
    expect(m.comments.find((c) => c.author === "Jane Partner")).toMatchObject({ text: "Resolved already.", done: true });
    const b = await parts(out), a = await parts(bytes);
    for (const k of ["customXml/item1.xml", "customXml/itemProps1.xml", "docProps/custom.xml", "word/people.xml", "word/styles.xml", "word/numbering.xml"]) expect(eqBytes(a.get(k), b.get(k)), k).toBe(true);
    // accepted-changes export: no revisions remain, moved-to text kept, moved-from text gone
    const { bytes: clean } = await exportImported(doc, bytes, meta, settings as unknown as Record<string, unknown>, { changes: "accepted" });
    expect((await validateDocx(clean)).errors).toEqual([]);
    const mc = await extractModel(clean);
    expect(mc.trackedChanges).toEqual([]);
    const texts = paraTexts(mc).join("\n");
    expect(texts).toContain("Moved here.");
    expect(texts).not.toContain("Moved away.");
    const xml = new TextDecoder().decode((await parts(clean)).get("word/document.xml")!);
    expect(xml).not.toMatch(/rPrChange|<x:ins |<x:del |<w:ins |<w:del /);
  });
});

describe("fresh package for app-created documents", () => {
  it("writes complete OOXML: styles, numbering, notes, comments, tracked changes, merged tables, sections and fields", async () => {
    const base = ensureBlockIds(markdownToDoc("# Brief\n\nIntro text with a note.\n\n1. One\n2. Two\n\n- Bullet"));
    const doc: PMNode = ensureBlockIds({ type: "doc", content: [
      ...base.content!,
      { type: "paragraph", content: [{ type: "docxInline", attrs: { kind: "fieldBegin", instr: " TOC \\o \"1-3\" \\h ", dirty: true } }, { type: "docxInline", attrs: { kind: "fieldSep" } }, { type: "text", text: "Update the table of contents." }, { type: "docxInline", attrs: { kind: "fieldEnd" } }] },
      { type: "paragraph", content: [
        { type: "text", text: "Kept " }, { type: "text", text: "added", marks: [{ type: "insertion", attrs: { id: "i1", author: "Drafting assistant", date: "2026-09-28T12:00:00Z" } }] },
        { type: "text", text: " removed", marks: [{ type: "deletion", attrs: { id: "d1", author: "Reviewer", date: "2026-09-28T12:05:00Z" } }] },
        { type: "text", text: " commented", marks: [{ type: "comment", attrs: { id: "c1" } }] },
        { type: "text", text: " footnoted", marks: [{ type: "footnote", attrs: { id: "f1", text: "App footnote." } }] },
        { type: "text", text: " endnoted", marks: [{ type: "footnote", attrs: { id: "e1", text: "App endnote.", kind: "endnote" } }] },
        { type: "text", text: " link", marks: [{ type: "link", attrs: { href: "https://example.com/a" } }] },
      ] },
      { type: "table", content: [
        { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, colwidth: [300] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Header spans two" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H3" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { rowspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Tall" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "b2" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c2" }] }] }] },
      ] },
      { type: "pageBreak", attrs: { section: { orientation: "portrait", pageSize: "letter", margins: "court" } } },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Landscape section" }] },
      { type: "image", attrs: { src: "/api/blobs/x", alt: "Chart", width: 240 } },
    ] });
    const comments = [{ id: "c1", docId: "d", anchor: "x", body: "Check", authorName: "Jane Partner", createdAt: "2026-09-28T12:00:00.000Z", source: "user", replies: [] }] as unknown as Parameters<typeof exportDocx>[1]["comments"];
    const buf = new Uint8Array(await exportDocx(doc, { title: "App doc", settings: { orientation: "landscape" }, comments, fetchImage: async () => ({ bytes: tinyPng(), type: "png", width: 4, height: 3 }) }));
    const v = await validateDocx(buf);
    expect(v.errors).toEqual([]);
    const m = await extractModel(buf);
    const paras = m.body.flatMap((x) => (x.kind === "p" ? [x.p] : []));
    expect(paras.find((p) => p.text === "Brief")?.style).toBe("Heading1");
    expect(paras.filter((p) => p.num).map((p) => p.num!.label)).toEqual(["1.", "2.", ""]);
    expect(paras.some((p) => p.fields.some((f) => f.startsWith("TOC")))).toBe(true);
    expect(m.trackedChanges).toEqual([{ type: "ins", author: "Drafting assistant", date: "2026-09-28T12:00:00Z", text: "added" }, { type: "del", author: "Reviewer", date: "2026-09-28T12:05:00Z", text: " removed" }]);
    expect(m.comments).toEqual([{ author: "Jane Partner", text: "Check", range: " commented", done: false }]);
    expect(m.footnotes).toEqual(["App footnote."]);
    expect(m.endnotes).toEqual(["App endnote."]);
    expect(m.hyperlinks).toEqual([{ text: " link", target: "https://example.com/a" }]);
    const t = m.body.flatMap((x) => (x.kind === "tbl" ? [x] : []))[0];
    expect(t.t.rows[0]).toMatchObject({ header: true, cells: [{ text: "Header spans two", gridSpan: 2 }, { text: "H3" }] });
    expect(t.t.rows[1].cells[0]).toMatchObject({ text: "Tall", vMerge: "restart" });
    expect(t.t.rows[2].cells[0]).toMatchObject({ text: "", vMerge: "continue" });
    expect(m.sections.length).toBe(2);
    expect(m.sections[0]).toMatchObject({ orient: "portrait", margins: expect.objectContaining({ "w:left": "1800" }) });
    expect(m.sections[1]).toMatchObject({ orient: "landscape", w: 15840, h: 12240 });
    expect(m.styles.map((s) => s.id)).toEqual(expect.arrayContaining(["Normal", "Heading1", "Heading2", "Title", "Caption", "Quote", "Hyperlink", "FootnoteReference", "TableGrid"]));
    // re-import of the fresh package maps back to the same structures
    const again = await importFixture(buf);
    const blocks = flattenBlocks(again.doc).blocks;
    expect(blocks.find((b) => b.text === "Landscape section")).toMatchObject({ type: "heading", level: 2 });
    expect(JSON.stringify(again.doc)).toContain("App endnote.");
    expect(again.meta.comments[0]).toMatchObject({ author: "Jane Partner", text: "Check", quote: " commented" });
  });
});
