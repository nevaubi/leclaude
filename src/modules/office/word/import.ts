import "server-only";
import mammoth from "mammoth";
import { blobs } from "@/lib/db";
import { markdownToDoc } from "@/modules/office/shared/markdown-doc";
import { ensureBlockIds, docStats, type PMNode } from "./doc-model";
import { htmlToDoc } from "./html-import";
import { settingsForTemplate } from "./constants";

const STYLE_MAP = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => p.caption:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h3:fresh",
  "p[style-name='Caption'] => p.caption:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Block Text'] => blockquote > p:fresh",
  "p[style-name='List Paragraph'] => p:fresh",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em",
  "u => u",
  "strike => s",
  "b => strong",
  "i => em",
  "comment-reference => sup",
];

/**
 * Import a Word-editor file (.docx via mammoth, .html, .md, .txt) into the
 * TipTap content model. Embedded images are stored as blobs.
 */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const title = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported document";
  let doc: PMNode;
  const meta: Record<string, unknown> = { importedFrom: ext, settings: settingsForTemplate(null) };
  if (ext === "docx") {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      {
        styleMap: STYLE_MAP,
        includeDefaultStyleMap: true,
        convertImage: mammoth.images.imgElement(async (image) => {
          const data = await image.readAsBuffer();
          const rec = blobs.put(new Uint8Array(data), image.contentType || "image/png", { name: `import-${Date.now()}`, meta: { source: "docx-import", file: filename } });
          return { src: `/api/blobs/${rec.id}` };
        }),
      },
    );
    doc = htmlToDoc(result.value);
    meta.importMessages = result.messages.slice(0, 10).map((m) => `${m.type}: ${m.message}`);
  } else if (ext === "html" || ext === "htm") {
    doc = htmlToDoc(Buffer.from(bytes).toString("utf8"));
  } else if (ext === "md" || ext === "markdown") {
    doc = ensureBlockIds(markdownToDoc(Buffer.from(bytes).toString("utf8")));
  } else {
    const text = Buffer.from(bytes).toString("utf8");
    doc = ensureBlockIds(markdownToDoc(text.split(/\n{2,}|\r\n\r\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n\n")));
  }
  const stats = docStats(doc);
  meta.stats = { words: stats.words, paragraphs: stats.paragraphs };
  const firstHeading = firstHeadingText(doc);
  return { title: firstHeading && firstHeading.length < 120 && ext === "docx" ? firstHeading : title, content: doc, meta };
}

function firstHeadingText(doc: PMNode): string | null {
  for (const n of doc.content ?? []) {
    if (n.type === "heading") { const t = (n.content ?? []).map((c) => c.text ?? "").join("").trim(); if (t) return t; }
  }
  return null;
}
