import "server-only";
import { modelFromBytes } from "./service";

/**
 * Import a .pdf into the PDF editor's content model: stores the original
 * bytes as the source blob, reads page sizes with pdf-lib and extracts the
 * text index, outline and AcroForm fields with pdf.js. The shared
 * /api/office/import route calls this.
 */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  if (!bytes.byteLength) throw new Error("Empty file");
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (!head.startsWith("%PDF")) throw new Error(`${filename} is not a PDF file`);
  const { model, extraction } = await modelFromBytes(bytes, { name: filename });
  const title = (extraction.meta.title && extraction.meta.title.length < 160 ? extraction.meta.title : "") || filename.replace(/\.pdf$/i, "");
  model.meta.title = title;
  return { title, content: model, meta: { pages: model.pageCount, hasForm: model.meta.hasForm, producer: extraction.meta.producer, textChars: extraction.pages.reduce((n, p) => n + p.text.length, 0) } };
}
