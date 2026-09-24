import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import type { LibraryItem, OfficeKind } from "@/lib/types/domain";
import type { Provenance } from "@/lib/integrity/types";
import { LIBRARY_FOLDERS, matterFolderId } from "@/modules/library/ids";
import { createOfficeDoc } from "@/modules/office/shared/docs-service";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { workbookFromTable } from "@/modules/office/sheet/from-rows";
import { exportXlsx } from "@/modules/office/sheet/export";
import { ensureBlockIds, type PMNode } from "@/modules/office/word/doc-model";
import { exportDocx } from "@/modules/office/word/export";
import { generatePdf, type Block, type DocSpec } from "@/modules/office/pdf/generate";
import { createFromBlob } from "@/modules/office/pdf/service";
import { deckFromOutline } from "@/modules/office/slides/templates";
import { exportPptx } from "@/modules/office/slides/export";
import { tableFromRows } from "./executors";
import { WORKFLOW_CURRENT_USER } from "./types";
import type { OutputFormat } from "./frontend";

/**
 * Deliverable rendering for `output.file`: Markdown or rows become a Word
 * document, workbook, PDF, CSV, Markdown file or slide deck through the office
 * generators, a downloadable blob is stored, and the result is filed in the
 * library (matter folder by default) with the run's provenance.
 */
export const OUTPUT_MIME: Record<OutputFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv",
  md: "text/markdown",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export interface RenderFileInput {
  format: OutputFormat;
  title: string;
  markdown?: string;
  rows?: unknown;
  matterId?: string;
  folderId?: string;
  addToLibrary?: boolean;
  tags?: string[];
  description?: string;
  provenance?: Provenance;
  meta?: Record<string, unknown>;
}

export interface RenderedFile {
  format: OutputFormat;
  ext: string;
  mime: string;
  title: string;
  filename: string;
  blobId: string;
  url: string;
  size: number;
  kind?: OfficeKind;
  docId?: string;
  href?: string;
  libraryItemId?: string;
  libraryFolderId?: string;
}

/** Excel sheet names cannot contain : \ / ? * [ ] and are capped at 31 characters. */
export function safeSheetName(name: string): string {
  const clean = name.replace(/[:\\/?*[\]]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 31).trim();
  return clean || "Sheet1";
}

export function safeFilename(title: string, ext: string): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "output";
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/** Parse a Markdown-ish text into the PDF typesetter's blocks (headings, paragraphs, bullets, numbered items, tables, rules). */
export function markdownToDocSpec(markdown: string, title: string, opts: { author?: string; footer?: string } = {}): DocSpec {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let bullets: string[] = [];
  let table: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ type: "paragraph", text: para.join(" ").trim() }); para = []; } };
  const flushBullets = () => { if (bullets.length) { blocks.push({ type: "bullets", items: bullets }); bullets = []; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((l) => !/^\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
    const [header, ...body] = rows;
    if (header?.length) blocks.push({ type: "table", columns: header, rows: body.map((r) => header.map((_, i) => r[i] ?? "")), size: 9 });
    table = [];
  };
  let sawTitle = false;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    const t = line.trim();
    if (t.startsWith("|")) { flushPara(); flushBullets(); table.push(t); continue; }
    flushTable();
    const h = t.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara(); flushBullets();
      const level = h[1].length as 1 | 2 | 3;
      if (level === 1 && !sawTitle && h[2].trim() === title.trim()) { sawTitle = true; continue; }
      blocks.push({ type: "heading", text: h[2].trim(), level, bookmark: level <= 2 });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); flushBullets(); blocks.push({ type: "rule" }); continue; }
    const b = t.match(/^[-*+]\s+(.+)$/);
    if (b) { flushPara(); bullets.push(b[1].replace(/^\[[ x]\]\s*/i, "")); continue; }
    const n = t.match(/^(\d+)[.)]\s+(.+)$/);
    if (n) { flushPara(); flushBullets(); blocks.push({ type: "numbered", number: `${n[1]}.`, text: n[2] }); continue; }
    if (!t) { flushPara(); flushBullets(); continue; }
    if (t.startsWith(">")) { flushBullets(); para.push(t.replace(/^>\s?/, "")); continue; }
    flushBullets();
    para.push(t);
  }
  flushPara(); flushBullets(); flushTable();
  if (!blocks.length) blocks.push({ type: "paragraph", text: "(empty)" });
  return { title, author: opts.author, blocks, footer: { left: opts.footer ?? title, right: "Page {page} of {pages}" }, outline: true };
}

function putBlob(bytes: Uint8Array, mime: string, filename: string, meta: Record<string, unknown>) {
  const rec = db().blobs.put(bytes, mime, { name: filename, meta });
  return { blobId: rec.id, url: `/api/blobs/${rec.id}`, size: rec.size };
}

function fileLibraryItem(input: RenderFileInput, r: Omit<RenderedFile, "libraryItemId" | "libraryFolderId">, kind: "office" | "file"): { id: string; parentId: string } {
  const now = new Date().toISOString();
  const parentId = input.folderId || (input.matterId ? matterFolderId(input.matterId) : LIBRARY_FOLDERS.myFiles);
  const type: LibraryItem["type"] = r.format === "docx" || r.format === "xlsx" || r.format === "pptx" || r.format === "pdf" ? r.format : r.format === "md" ? "note" : "link";
  const item: LibraryItem = {
    id: `lib_${nanoid(10)}`,
    parentId,
    name: r.title,
    type,
    matterId: input.matterId,
    officeDocId: kind === "office" ? r.docId : undefined,
    url: kind === "file" ? r.url : undefined,
    content: r.format === "md" ? (input.markdown ?? "").slice(0, 200_000) : undefined,
    size: r.size,
    tags: input.tags ?? ["workflow"],
    ownerId: WORKFLOW_CURRENT_USER.id,
    sharedWith: ["matter-team"],
    createdAt: now,
    updatedAt: now,
    description: input.description,
    status: "draft",
  };
  db().library.put(item);
  return { id: item.id, parentId };
}

/** Render a deliverable in the requested format; stores the blob, creates the office document where one exists and files a library item. */
export async function renderOutputFile(input: RenderFileInput): Promise<RenderedFile> {
  const title = input.title.trim() || "Output";
  const mime = OUTPUT_MIME[input.format];
  const ext = input.format;
  const filename = safeFilename(title, ext);
  const blobMeta = { ...(input.meta ?? {}), title, format: input.format };
  const docMeta = { source: "workflow", ...(input.meta ?? {}), provenance: input.provenance };
  const markdown = (input.markdown ?? "").trim();
  const description = input.description;

  if (input.format === "xlsx" || input.format === "csv") {
    const source = input.rows ?? markdown;
    const table = tableFromRows(title, source).sheets[0];
    if (table.rows.length <= 1) throw new Error(`Nothing tabular to write: ${input.format} output needs rows (an array of objects, CSV or a Markdown table).`);
    if (input.format === "csv") {
      const esc = (c: unknown) => { const s = c == null ? "" : typeof c === "object" ? JSON.stringify(c) : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = table.rows.map((r) => r.map(esc).join(",")).join("\n");
      const b = putBlob(new TextEncoder().encode(csv), mime, filename, blobMeta);
      const r: RenderedFile = { format: "csv", ext, mime, title, filename, ...b };
      if (input.addToLibrary !== false) { const li = fileLibraryItem(input, r, "file"); r.libraryItemId = li.id; r.libraryFolderId = li.parentId; }
      return r;
    }
    const wb = workbookFromTable(safeSheetName(table.name), table.header, table.rows.slice(1));
    const doc = createOfficeDoc({ kind: "sheet", title, content: wb, matterId: input.matterId, folderId: input.folderId, tags: input.tags, meta: docMeta });
    const bytes = exportXlsx(wb);
    const b = putBlob(bytes, mime, filename, { ...blobMeta, docId: doc.id });
    const r: RenderedFile = { format: "xlsx", ext, mime, title, filename, ...b, kind: "sheet", docId: doc.id, href: `/office/sheet/${doc.id}` };
    if (input.addToLibrary !== false) { const li = fileLibraryItem(input, r, "office"); r.libraryItemId = li.id; r.libraryFolderId = li.parentId; }
    return r;
  }

  if (!markdown) throw new Error(`Nothing to write: ${input.format} output needs Markdown content.`);

  if (input.format === "md") {
    const body = markdown.startsWith("#") ? markdown : `# ${title}\n\n${markdown}`;
    const b = putBlob(new TextEncoder().encode(body), mime, filename, blobMeta);
    const r: RenderedFile = { format: "md", ext, mime, title, filename, ...b };
    if (input.addToLibrary !== false) { const li = fileLibraryItem({ ...input, markdown: body, description }, r, "file"); r.libraryItemId = li.id; r.libraryFolderId = li.parentId; }
    return r;
  }

  if (input.format === "docx") {
    const pm = markdownToDoc(markdown, markdown.startsWith("#") ? {} : { title }) as PMNode;
    const doc = createOfficeDoc({ kind: "word", title, content: pm, matterId: input.matterId, folderId: input.folderId, tags: input.tags, meta: docMeta });
    const buf = await exportDocx(ensureBlockIds(pm), { title, changes: "accepted" });
    const b = putBlob(new Uint8Array(buf), mime, filename, { ...blobMeta, docId: doc.id });
    const r: RenderedFile = { format: "docx", ext, mime, title, filename, ...b, kind: "word", docId: doc.id, href: `/office/word/${doc.id}` };
    if (input.addToLibrary !== false) { const li = fileLibraryItem(input, r, "office"); r.libraryItemId = li.id; r.libraryFolderId = li.parentId; }
    return r;
  }

  if (input.format === "pptx") {
    const outline = markdown.startsWith("#") ? markdown : `# ${title}\n\n${markdown}`;
    const deck = deckFromOutline(outline);
    const doc = createOfficeDoc({ kind: "slides", title, content: deck, matterId: input.matterId, folderId: input.folderId, tags: input.tags, meta: docMeta });
    const buf = await exportPptx(deck, { title });
    const b = putBlob(new Uint8Array(buf), mime, filename, { ...blobMeta, docId: doc.id });
    const r: RenderedFile = { format: "pptx", ext, mime, title, filename, ...b, kind: "slides", docId: doc.id, href: `/office/slides/${doc.id}` };
    if (input.addToLibrary !== false) { const li = fileLibraryItem(input, r, "office"); r.libraryItemId = li.id; r.libraryFolderId = li.parentId; }
    return r;
  }

  // pdf
  const spec = markdownToDocSpec(markdown, title, { author: WORKFLOW_CURRENT_USER.name });
  const bytes = await generatePdf(spec);
  const b = putBlob(bytes, mime, filename, blobMeta);
  const r: RenderedFile = { format: "pdf", ext, mime, title, filename, ...b };
  if (input.addToLibrary !== false) {
    const created = await createFromBlob(b.blobId, { matterId: input.matterId, title, folderId: input.folderId || (input.matterId ? matterFolderId(input.matterId) : LIBRARY_FOLDERS.myFiles) });
    r.kind = "pdf"; r.docId = created.doc.id; r.href = created.url;
    const item = db().library.findOne((i) => i.officeDocId === created.doc.id);
    if (item) { db().library.update(item.id, (cur) => ({ ...cur, tags: input.tags ?? cur.tags, matterId: input.matterId ?? cur.matterId, description: description ?? cur.description, sharedWith: ["matter-team"] })); r.libraryItemId = item.id; r.libraryFolderId = item.parentId ?? undefined; }
  }
  return r;
}
