/**
 * OPC package access for .docx: every part's original bytes, content types and relationships.
 * Parts are kept as bytes so untouched parts can be written back byte-identical.
 */
import JSZip from "jszip";
import { attr, escAttr, kids, parseXml, XML_DECL, type XEl } from "./xml";

export interface Rel { id: string; type: string; target: string; external: boolean }

export const REL = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  settings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  fontTable: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable",
  webSettings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  commentsExtended: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
  footnotes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
  endnotes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes",
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  coreProps: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extendedProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
} as const;

export const CT = {
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  styles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  numbering: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  settings: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  fontTable: "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml",
  comments: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  footnotes: "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
  endnotes: "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
  footer: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
  header: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  core: "application/vnd.openxmlformats-package.core-properties+xml",
  app: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  rels: "application/vnd.openxmlformats-package.relationships+xml",
} as const;

export const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", emf: "image/x-emf", wmf: "image/x-wmf" };

export interface DocxPackage {
  files: Map<string, Uint8Array>;
  /** Main document part path, e.g. "word/document.xml". */
  mainPart: string;
  text(path: string): string | null;
  rels(partPath: string): Rel[];
  contentTypes: { defaults: Record<string, string>; overrides: Record<string, string> };
}

const dec = new TextDecoder("utf-8");

export function relsPathFor(partPath: string): string {
  const i = partPath.lastIndexOf("/");
  return i < 0 ? `_rels/${partPath}.rels` : `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`;
}

/** Resolve a relationship target relative to the source part. */
export function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = partPath.includes("/") ? partPath.slice(0, partPath.lastIndexOf("/")).split("/") : [];
  for (const seg of target.split("/")) {
    if (seg === "..") base.pop();
    else if (seg !== "." && seg !== "") base.push(seg);
  }
  return base.join("/");
}

export function parseRels(xml: string | null): Rel[] {
  if (!xml) return [];
  const { root } = parseXml(stripBom(xml));
  return kids(root).filter((e) => e.name.endsWith("Relationship")).map((e) => ({ id: attr(e, "Id") ?? "", type: attr(e, "Type") ?? "", target: attr(e, "Target") ?? "", external: attr(e, "TargetMode") === "External" }));
}

export function stripBom(s: string): string { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

export async function loadPackage(bytes: Uint8Array): Promise<DocxPackage> {
  const zip = await JSZip.loadAsync(bytes);
  const files = new Map<string, Uint8Array>();
  await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map(async (f) => { files.set(f.name, await f.async("uint8array")); }));
  const textCache = new Map<string, string | null>();
  const text = (path: string) => {
    if (textCache.has(path)) return textCache.get(path)!;
    const b = files.get(path);
    const t = b ? stripBom(dec.decode(b)) : null;
    textCache.set(path, t);
    return t;
  };
  const relsCache = new Map<string, Rel[]>();
  const rels = (partPath: string) => {
    if (!relsCache.has(partPath)) relsCache.set(partPath, parseRels(text(relsPathFor(partPath))));
    return relsCache.get(partPath)!;
  };
  const pkgRels = parseRels(text("_rels/.rels"));
  const main = pkgRels.find((r) => r.type === REL.officeDocument || r.type.endsWith("/officeDocument"));
  const mainPart = main ? resolveTarget("", main.target) : "word/document.xml";
  if (!files.has(mainPart)) throw new Error("Not a Word document: main document part is missing");
  const contentTypes = { defaults: {} as Record<string, string>, overrides: {} as Record<string, string> };
  const ctXml = text("[Content_Types].xml");
  if (ctXml) {
    const { root } = parseXml(ctXml);
    for (const e of kids(root)) {
      if (e.name.endsWith("Default")) contentTypes.defaults[(attr(e, "Extension") ?? "").toLowerCase()] = attr(e, "ContentType") ?? "";
      else if (e.name.endsWith("Override")) contentTypes.overrides[(attr(e, "PartName") ?? "").replace(/^\//, "")] = attr(e, "ContentType") ?? "";
    }
  }
  return { files, mainPart, text, rels, contentTypes };
}

/** Find the target part of the first relationship of a type from a source part. */
export function relatedPart(pkg: DocxPackage, fromPart: string, type: string): string | null {
  const r = pkg.rels(fromPart).find((x) => x.type === type && !x.external);
  return r ? resolveTarget(fromPart, r.target) : null;
}

export function serializeRels(rels: Rel[]): string {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${escAttr(r.id)}" Type="${escAttr(r.type)}" Target="${escAttr(r.target)}"${r.external ? ` TargetMode="External"` : ""}/>`).join("")}</Relationships>`;
}

export function serializeContentTypes(ct: { defaults: Record<string, string>; overrides: Record<string, string> }): string {
  const d = Object.entries(ct.defaults).map(([e, t]) => `<Default Extension="${escAttr(e)}" ContentType="${escAttr(t)}"/>`).join("");
  const o = Object.entries(ct.overrides).map(([p, t]) => `<Override PartName="/${escAttr(p)}" ContentType="${escAttr(t)}"/>`).join("");
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${d}${o}</Types>`;
}

export function nextRelId(rels: Rel[]): string {
  let max = 0;
  for (const r of rels) { const m = /^rId(\d+)$/.exec(r.id); if (m) max = Math.max(max, Number(m[1])); }
  return `rId${max + 1}`;
}

export type { XEl };
