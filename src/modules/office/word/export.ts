/**
 * DOCX export with the `docx` package: headings, paragraph styles, inline
 * marks, numbered/bulleted/legal lists, tables, images, page breaks,
 * footnotes, Word comments, tracked changes (w:ins/w:del) and page setup.
 * Runs on the server (route) and in tests; image bytes come through `fetchImage`.
 */
import {
  AlignmentType, BorderStyle, CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document, ExternalHyperlink, FootnoteReferenceRun, Footer, HeadingLevel, ImageRun, InsertedTextRun, LevelFormat, PageBreak, PageNumber, PageOrientation, Packer, Paragraph, ShadingType, Tab, TabStopType, Table, TableCell, TableRow, TextRun, UnderlineType, WidthType,
  type IParagraphOptions, type IRunOptions, type ISectionOptions, type ParagraphChild,
} from "docx";
import type { OfficeComment } from "@/lib/types/domain";
import { DEFAULT_SETTINGS, FONT_FAMILIES, HIGHLIGHT_COLORS, MARGIN_PRESETS, PAGE_SIZES, type DocSettings } from "./constants";
import { collectFootnotes, docToMarkdown, docToPlainText, type PMNode } from "./doc-model";

export interface ExportImage { bytes: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width?: number; height?: number }

export interface ExportOptions {
  title: string;
  settings?: Partial<DocSettings>;
  comments?: OfficeComment[];
  fetchImage?: (src: string) => Promise<ExportImage | null>;
  author?: string;
  /** "revisions" keeps tracked changes as Word revisions (default); "accepted" exports the clean text. */
  changes?: "revisions" | "accepted";
}

const TWIP = 1440;
const NUMBERING_REFS = ["decimal", "legal", "outline", "alpha", "roman", "bullets"] as const;

function numberingConfig() {
  const dec = (level: number) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } });
  const legal = (level: number) => ({ level, format: LevelFormat.DECIMAL, text: Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join(".") + (level === 0 ? "." : ""), alignment: AlignmentType.START, isLegalNumberingStyle: true, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 480 } } } });
  const outline = (level: number) => {
    const fmt = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level];
    const text = level === 0 ? "%1." : `(%${level + 1})`;
    return { level, format: fmt, text, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } };
  };
  const alpha = (level: number) => ({ level, format: level % 2 === 0 ? LevelFormat.LOWER_LETTER : LevelFormat.LOWER_ROMAN, text: `(%${level + 1})`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } });
  const roman = (level: number) => ({ level, format: level % 2 === 0 ? LevelFormat.UPPER_ROMAN : LevelFormat.UPPER_LETTER, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } });
  const bullets = (level: number) => ({ level, format: LevelFormat.BULLET, text: ["•", "◦", "▪", "•", "◦", "▪"][level], alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } });
  const six = (f: (l: number) => unknown) => Array.from({ length: 6 }, (_, i) => f(i));
  return { config: [
    { reference: "decimal", levels: six(dec) }, { reference: "legal", levels: six(legal) }, { reference: "outline", levels: six(outline) },
    { reference: "alpha", levels: six(alpha) }, { reference: "roman", levels: six(roman) }, { reference: "bullets", levels: six(bullets) },
  ] as unknown as NonNullable<ConstructorParameters<typeof Document>[0]["numbering"]>["config"] };
}

interface Ctx {
  settings: DocSettings;
  font: string;
  images: Map<string, ExportImage | null>;
  footnotes: Map<string, number>;
  footnoteBodies: Record<number, { children: Paragraph[] }>;
  comments: { id: number; author: string; date: Date; text: string; key: string }[];
  commentIds: Map<string, number>;
  revisionId: number;
  listInstance: number;
  author: string;
  changes: "revisions" | "accepted";
}

const HIGHLIGHT_MAP: Record<string, string> = Object.fromEntries(HIGHLIGHT_COLORS.map((h) => [h.css.toLowerCase(), h.docx]));

type RunExtras = { link?: string; footnote?: string; comment?: string; insertion?: Record<string, unknown>; deletion?: Record<string, unknown> };
type MutableRun = { -readonly [K in keyof IRunOptions]: IRunOptions[K] } & RunExtras;

function runOptionsFromMarks(marks: PMNode["marks"] | undefined, ctx: Ctx): IRunOptions & RunExtras {
  void ctx;
  const o: MutableRun = {};
  for (const m of marks ?? []) {
    switch (m.type) {
      case "bold": o.bold = true; break;
      case "italic": o.italics = true; break;
      case "underline": o.underline = { type: UnderlineType.SINGLE }; break;
      case "strike": o.strike = true; break;
      case "superscript": o.superScript = true; break;
      case "subscript": o.subScript = true; break;
      case "smallCaps": o.smallCaps = true; break;
      case "code": o.font = "Consolas"; o.shading = { type: ShadingType.CLEAR, fill: "F2F2F2" }; break;
      case "highlight": { const c = String(m.attrs?.color ?? "#fff3a3").toLowerCase(); const named = HIGHLIGHT_MAP[c]; if (named) o.highlight = named as IRunOptions["highlight"]; else o.shading = { type: ShadingType.CLEAR, fill: c.replace("#", "") }; break; }
      case "textStyle": {
        if (m.attrs?.color) o.color = String(m.attrs.color).replace("#", "");
        if (m.attrs?.fontSize) { const pt = parseFloat(String(m.attrs.fontSize)); if (pt) o.size = Math.round(pt * 2); }
        if (m.attrs?.fontFamily) { const f = FONT_FAMILIES.find((x) => String(m.attrs?.fontFamily).includes(x.label) || x.css === m.attrs?.fontFamily); o.font = f?.docx ?? String(m.attrs.fontFamily).split(",")[0].replace(/['"]/g, ""); }
        break;
      }
      case "link": o.link = String(m.attrs?.href ?? ""); break;
      case "footnote": o.footnote = String(m.attrs?.id ?? ""); break;
      case "comment": o.comment = String(m.attrs?.id ?? ""); break;
      case "insertion": o.insertion = m.attrs ?? {}; break;
      case "deletion": o.deletion = m.attrs ?? {}; break;
    }
  }
  return o;
}

function inlineChildren(content: PMNode[] | undefined, ctx: Ctx): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const openComments = new Set<string>();
  const commentLastIndex = new Map<string, number>();
  const nodes = content ?? [];
  nodes.forEach((n, i) => { for (const m of n.marks ?? []) if (m.type === "comment") commentLastIndex.set(String(m.attrs?.id ?? ""), i); });

  nodes.forEach((n, i) => {
    if (n.type === "hardBreak") { out.push(new TextRun({ break: 1 })); return; }
    if (n.type !== "text") { if (n.content) out.push(...inlineChildren(n.content, ctx)); return; }
    const { link, footnote, comment, insertion, deletion, ...run } = runOptionsFromMarks(n.marks, ctx);
    const text = n.text ?? "";
    if (deletion && ctx.changes === "accepted") return;
    if (comment) {
      const cid = commentNumber(ctx, comment);
      if (cid != null && !openComments.has(comment)) { out.push(new CommentRangeStart(cid)); openComments.add(comment); }
    }
    let child: ParagraphChild;
    if (deletion && ctx.changes === "revisions") child = new DeletedTextRun({ ...run, text, id: ctx.revisionId++, author: String(deletion.author ?? ctx.author), date: String(deletion.date ?? new Date().toISOString()) });
    else if (insertion && ctx.changes === "revisions") child = new InsertedTextRun({ ...run, text, id: ctx.revisionId++, author: String(insertion.author ?? ctx.author), date: String(insertion.date ?? new Date().toISOString()) });
    else child = new TextRun({ ...run, text });
    if (link && !deletion) out.push(new ExternalHyperlink({ children: [new TextRun({ ...run, text, style: "Hyperlink", color: "1F4E9A", underline: { type: UnderlineType.SINGLE } })], link }));
    else out.push(child);
    if (footnote) {
      const num = ctx.footnotes.get(footnote);
      if (num != null) out.push(new FootnoteReferenceRun(num));
    }
    if (comment && commentLastIndex.get(comment) === i) {
      const cid = commentNumber(ctx, comment);
      if (cid != null && openComments.has(comment)) { out.push(new CommentRangeEnd(cid)); out.push(new TextRun({ children: [new CommentReference(cid)] })); openComments.delete(comment); }
    }
  });
  for (const c of openComments) { const cid = commentNumber(ctx, c); if (cid != null) { out.push(new CommentRangeEnd(cid)); out.push(new TextRun({ children: [new CommentReference(cid)] })); } }
  return out;
}

function commentNumber(ctx: Ctx, key: string): number | null {
  return ctx.commentIds.get(key) ?? null;
}

function alignmentOf(v: unknown) {
  switch (v) { case "center": return AlignmentType.CENTER; case "right": return AlignmentType.RIGHT; case "justify": return AlignmentType.JUSTIFIED; default: return AlignmentType.LEFT; }
}

function paragraphProps(n: PMNode, ctx: Ctx): Partial<IParagraphOptions> {
  const a = n.attrs ?? {};
  const spacing: { before?: number; after?: number; line?: number } = {};
  if (a.spacingBefore != null) spacing.before = Number(a.spacingBefore) * 20;
  if (a.spacingAfter != null) spacing.after = Number(a.spacingAfter) * 20;
  const lh = a.lineHeight != null ? Number(a.lineHeight) : ctx.settings.lineSpacing;
  if (lh) spacing.line = Math.round(240 * lh);
  const props: { -readonly [K in keyof IParagraphOptions]?: IParagraphOptions[K] } = { alignment: alignmentOf(a.textAlign), spacing };
  if (a.indent) props.indent = { left: Math.round(720 * Number(a.indent)) };
  if (a.pStyle === "toc_entry") props.tabStops = [{ type: TabStopType.RIGHT, position: 9000, leader: "dot" }];
  return props;
}

function headingLevel(level: number, title: boolean) {
  if (title) return HeadingLevel.TITLE;
  return [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.max(0, Math.min(5, level - 1))];
}

async function blockToDocx(n: PMNode, ctx: Ctx, list?: { reference: string; level: number; instance: number }): Promise<(Paragraph | Table)[]> {
  switch (n.type) {
    case "heading": {
      const title = n.attrs?.pStyle === "title";
      return [new Paragraph({ ...paragraphProps(n, ctx), heading: headingLevel(Number(n.attrs?.level ?? 1), title), children: inlineChildren(n.content, ctx), keepNext: true })];
    }
    case "paragraph": {
      const props = paragraphProps(n, ctx);
      const style = n.attrs?.pStyle === "caption" ? "Caption" : n.attrs?.pStyle === "title" ? undefined : undefined;
      let children = inlineChildren(n.content, ctx);
      if (n.attrs?.pStyle === "toc_entry") {
        // "Title .......... ¶n" → "Title<tab>n"
        const text = (n.content ?? []).map((c) => c.text ?? "").join("").replace(/\s*\.{3,}\s*¶?(\d+)\s*$/, "\t$1");
        const [t, page] = text.split("\t");
        children = [new TextRun(t), new Tab(), new TextRun(page ?? "")];
      }
      const p = new Paragraph({ ...props, style, children, ...(list ? { numbering: { reference: list.reference, level: list.level, instance: list.instance } } : {}), ...(n.attrs?.pStyle === "title" ? { heading: HeadingLevel.TITLE } : {}) });
      return [p];
    }
    case "blockquote": {
      const out: (Paragraph | Table)[] = [];
      for (const c of n.content ?? []) for (const p of await blockToDocx(c, ctx)) { if (p instanceof Paragraph) out.push(new Paragraph({ children: inlineChildren(c.content, ctx), indent: { left: 720, right: 720 }, spacing: { after: 160 }, alignment: AlignmentType.JUSTIFIED })); else out.push(p); }
      return out;
    }
    case "codeBlock": return [new Paragraph({ children: [new TextRun({ text: (n.content ?? []).map((c) => c.text ?? "").join(""), font: "Consolas", size: 18 })], shading: { type: ShadingType.CLEAR, fill: "F2F2F2" }, spacing: { after: 160 } })];
    case "horizontalRule": return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, spacing: { after: 160 } })];
    case "pageBreak": return [new Paragraph({ children: [new PageBreak()] })];
    case "image": {
      const src = String(n.attrs?.src ?? "");
      const img = ctx.images.get(src);
      if (!img) return [new Paragraph({ children: [new TextRun({ text: `[Image${n.attrs?.alt ? `: ${String(n.attrs.alt)}` : ""}]`, italics: true, color: "777777" })], alignment: AlignmentType.CENTER })];
      const width = Number(n.attrs?.width) || img.width || 480;
      const ratio = img.width && img.height ? img.height / img.width : 0.66;
      const height = Number(n.attrs?.height) || Math.round(width * ratio);
      return [new Paragraph({ alignment: alignmentOf(n.attrs?.align ?? "center"), spacing: { before: 120, after: 120 }, children: [new ImageRun({ type: img.type, data: img.bytes, transformation: { width: Math.min(width, 640), height: Math.round(Math.min(width, 640) * (height / width)) }, altText: { name: String(n.attrs?.alt ?? "Image"), description: String(n.attrs?.alt ?? "Image"), title: String(n.attrs?.title ?? n.attrs?.alt ?? "Image") } })] })];
    }
    case "bulletList": case "orderedList": case "taskList": {
      const style = String(n.attrs?.listStyle ?? "decimal");
      const reference = n.type === "orderedList" ? (NUMBERING_REFS.includes(style as typeof NUMBERING_REFS[number]) ? style : "decimal") : "bullets";
      const level = list ? list.level + 1 : 0;
      const instance = list ? list.instance : ++ctx.listInstance;
      const out: (Paragraph | Table)[] = [];
      for (const item of n.content ?? []) {
        let first = true;
        for (const c of item.content ?? []) {
          if (c.type === "paragraph" && first) { out.push(...(await blockToDocx(c, ctx, { reference, level: Math.min(5, level), instance }))); first = false; }
          else if (c.type === "paragraph") out.push(new Paragraph({ ...paragraphProps(c, ctx), children: inlineChildren(c.content, ctx), indent: { left: 720 * (level + 1) } }));
          else out.push(...(await blockToDocx(c, ctx, { reference, level: Math.min(5, level), instance })));
        }
      }
      return out;
    }
    case "table": {
      const rows = n.content ?? [];
      const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
      const caption = Boolean(n.attrs?.caption);
      const widths = rows[0]?.content?.map((c) => (Array.isArray(c.attrs?.colwidth) ? Number((c.attrs?.colwidth as number[])[0]) : 0)) ?? [];
      const total = widths.reduce((a, b) => a + b, 0);
      const pct = (i: number) => (total > 0 && widths[i] ? Math.round((widths[i] / total) * 100) : Math.round(100 / cols));
      const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      const single = { style: BorderStyle.SINGLE, size: 4, color: "444444" };
      const trows = await Promise.all(rows.map(async (r) => new TableRow({
        tableHeader: (r.content ?? []).every((c) => c.type === "tableHeader"),
        children: await Promise.all((r.content ?? []).map(async (c, ci) => {
          const children: (Paragraph | Table)[] = [];
          for (const b of c.content ?? []) children.push(...(await blockToDocx(b, ctx)));
          const header = c.type === "tableHeader";
          return new TableCell({
            children: children.length ? children : [new Paragraph("")],
            width: { size: pct(ci), type: WidthType.PERCENTAGE },
            columnSpan: Number(c.attrs?.colspan ?? 1) || 1,
            rowSpan: Number(c.attrs?.rowspan ?? 1) || 1,
            shading: header ? { type: ShadingType.CLEAR, fill: "EDEDED" } : undefined,
            borders: caption ? { top: none, bottom: ci === 0 ? single : none, left: none, right: ci === 0 ? single : none } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
          });
        })),
      })));
      return [new Table({ rows: trows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: caption ? { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none } : undefined }), new Paragraph({ spacing: { after: 60 } })];
    }
    default: {
      const out: (Paragraph | Table)[] = [];
      for (const c of n.content ?? []) out.push(...(await blockToDocx(c, ctx)));
      return out;
    }
  }
}

function collectImageSrcs(doc: PMNode): string[] {
  const out = new Set<string>();
  const walk = (n: PMNode) => { if (n.type === "image" && n.attrs?.src) out.add(String(n.attrs.src)); for (const c of n.content ?? []) walk(c); };
  walk(doc);
  return Array.from(out);
}

/** Build a .docx buffer from a document. */
export async function exportDocx(doc: PMNode, opts: ExportOptions): Promise<Buffer> {
  const settings: DocSettings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };
  const font = settings.font === "sans" ? "Calibri" : "Times New Roman";
  const ctx: Ctx = { settings, font, images: new Map(), footnotes: new Map(), footnoteBodies: {}, comments: [], commentIds: new Map(), revisionId: 1, listInstance: 0, author: opts.author ?? "Calloway & Reyes LLP", changes: opts.changes ?? "revisions" };

  for (const src of collectImageSrcs(doc)) { try { ctx.images.set(src, opts.fetchImage ? await opts.fetchImage(src) : null); } catch { ctx.images.set(src, null); } }

  const fns = collectFootnotes(doc);
  fns.forEach((f, i) => { ctx.footnotes.set(f.id, i + 1); ctx.footnoteBodies[i + 1] = { children: [new Paragraph({ children: [new TextRun({ text: f.text, size: 20 })] })] }; });

  // Comments: only those anchored to comment marks present in the document text get ranges; the rest are attached to their anchor paragraph.
  const markIds = new Set<string>();
  const walkMarks = (n: PMNode) => { for (const m of n.marks ?? []) if (m.type === "comment") markIds.add(String(m.attrs?.id ?? "")); for (const c of n.content ?? []) walkMarks(c); };
  walkMarks(doc);
  let cid = 0;
  for (const c of opts.comments ?? []) {
    if (c.resolved) continue;
    const key = markIds.has(c.id) ? c.id : `anchor:${c.anchor}`;
    if (ctx.commentIds.has(key)) continue;
    ctx.commentIds.set(key, cid);
    ctx.comments.push({ id: cid, author: c.authorName, date: new Date(c.createdAt), text: `${c.body}${c.replies?.length ? "\n" + c.replies.map((r) => `${r.authorName}: ${r.body}`).join("\n") : ""}`, key });
    cid++;
  }
  // Paragraph-anchored comments: wrap the whole paragraph content with a synthetic comment mark.
  if (ctx.comments.some((c) => c.key.startsWith("anchor:"))) {
    const wrap = (n: PMNode) => {
      const key = `anchor:${String(n.attrs?.id ?? "")}`;
      if ((n.type === "paragraph" || n.type === "heading") && ctx.commentIds.has(key) && n.content?.length) {
        n.content = n.content.map((c) => (c.type === "text" ? { ...c, marks: [...(c.marks ?? []), { type: "comment", attrs: { id: key } }] } : c));
      }
      for (const c of n.content ?? []) wrap(c);
    };
    doc = JSON.parse(JSON.stringify(doc)) as PMNode;
    wrap(doc);
  }

  const children: (Paragraph | Table)[] = [];
  for (const n of doc.content ?? []) children.push(...(await blockToDocx(n, ctx)));

  const size = PAGE_SIZES[settings.pageSize];
  const m = MARGIN_PRESETS[settings.margins];
  const landscape = settings.orientation === "landscape";
  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: Math.round((landscape ? size.height : size.width) * TWIP), height: Math.round((landscape ? size.width : size.height) * TWIP), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: Math.round(m.top * TWIP), right: Math.round(m.right * TWIP), bottom: Math.round(m.bottom * TWIP), left: Math.round(m.left * TWIP) },
      },
    },
    footers: settings.pageNumbers ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] }) } : undefined,
    children,
  };

  const document = new Document({
    creator: ctx.author,
    title: opts.title,
    description: "Exported from LeClaude",
    styles: {
      default: { document: { run: { font, size: settings.fontSize * 2 }, paragraph: { spacing: { after: 160, line: Math.round(240 * settings.lineSpacing) } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, font }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: settings.fontSize * 2 + 4, bold: true, font, color: "000000" }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: settings.fontSize * 2 + 2, bold: true, font, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: settings.fontSize * 2, bold: true, italics: true, font, color: "000000" }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 2 } },
        { id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", run: { size: settings.fontSize * 2 - 4, italics: true, color: "555555" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 } } },
      ],
    },
    numbering: numberingConfig(),
    footnotes: Object.keys(ctx.footnoteBodies).length ? ctx.footnoteBodies : undefined,
    comments: ctx.comments.length ? { children: ctx.comments.map((c) => ({ id: c.id, author: c.author, date: c.date, initials: c.author.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase(), children: c.text.split("\n").map((t) => new Paragraph({ children: [new TextRun({ text: t, size: 20 })] })) })) } : undefined,
    sections: [section],
  });
  return Packer.toBuffer(document);
}

export function exportMarkdown(doc: PMNode, title: string) { return docToMarkdown(doc, { title }); }
export function exportText(doc: PMNode) { return docToPlainText(doc); }

/** Parse PNG/JPEG/GIF dimensions from bytes (enough for aspect ratio). */
export function imageDimensions(bytes: Uint8Array): { type: ExportImage["type"]; width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { type: "png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) return { type: "gif", width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: "jpg", width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
      i += 2 + len;
    }
    return { type: "jpg", width: 0, height: 0 };
  }
  if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) { const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return { type: "bmp", width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) }; }
  return null;
}
