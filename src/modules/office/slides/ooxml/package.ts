/**
 * OPC package helpers: relationships, content types, part paths, units and colors shared by the .pptx reader and
 * the package-preserving writer.
 */
import type JSZip from "jszip";
import { attr, frag, kids, mk, appendKid, removeKid, serializeDoc, parseXml, type XDoc, type XEl } from "./xml";

export const EMU_PER_INCH = 914400;
export const EMU_PER_PT = 12700;
/** Default PowerPoint 16:9 slide size. */
export const DEFAULT_SLIDE_CX = 12192000;
export const DEFAULT_SLIDE_CY = 6858000;

export const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  rels: "http://schemas.openxmlformats.org/package/2006/relationships",
};

export const REL = {
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  chart: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
};

export const CT = {
  slide: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
  notesSlide: "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
  notesMaster: "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  rels: "application/vnd.openxmlformats-package.relationships+xml",
};

export interface Rel { id: string; type: string; target: string; external?: boolean }

export function resolvePart(fromDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/");
}

export const dirOf = (part: string) => part.split("/").slice(0, -1).join("/");
export const baseOf = (part: string) => part.split("/").pop() ?? part;
export const relsPathOf = (part: string) => `${dirOf(part)}/_rels/${baseOf(part)}.rels`;

/** Relative target from one part to another ("ppt/slides/slide1.xml" → "ppt/media/image1.png" = "../media/image1.png"). */
export function relTarget(fromPart: string, toPart: string): string {
  const from = dirOf(fromPart).split("/").filter(Boolean);
  const to = toPart.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

export async function readText(zip: JSZip, part: string): Promise<string | null> {
  const f = zip.file(part);
  return f ? f.async("string") : null;
}

export async function readXmlPart(zip: JSZip, part: string): Promise<XDoc | null> {
  const t = await readText(zip, part);
  if (t === null) return null;
  return parseXml(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
}

/** Relationships of a part (target resolved to a package path unless external). */
export class RelSet {
  doc: XDoc;
  constructor(public part: string, doc?: XDoc) {
    this.doc = doc ?? parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.rels}"></Relationships>`);
  }
  static async load(zip: JSZip, part: string): Promise<RelSet> {
    const doc = await readXmlPart(zip, relsPathOf(part));
    return new RelSet(part, doc ?? undefined);
  }
  list(): Rel[] {
    return kids(this.doc.root, "Relationship").map((r) => {
      const external = attr(r, "TargetMode") === "External";
      const target = attr(r, "Target") ?? "";
      return { id: attr(r, "Id") ?? "", type: attr(r, "Type") ?? "", target: external ? target : resolvePart(dirOf(this.part), target), external };
    });
  }
  get(id: string): Rel | undefined { return this.list().find((r) => r.id === id); }
  byType(type: string): Rel[] { return this.list().filter((r) => r.type === type); }
  nextId(): string {
    const used = new Set(this.list().map((r) => r.id));
    let n = used.size + 1;
    while (used.has(`rId${n}`)) n++;
    return `rId${n}`;
  }
  add(type: string, targetPart: string, opts: { external?: boolean; id?: string } = {}): string {
    const id = opts.id ?? this.nextId();
    const target = opts.external ? targetPart : relTarget(this.part, targetPart);
    appendKid(this.doc.root, mk("Relationship", { Id: id, Type: type, Target: target, TargetMode: opts.external ? "External" : undefined }));
    return id;
  }
  remove(id: string) {
    const r = kids(this.doc.root, "Relationship").find((x) => attr(x, "Id") === id);
    if (r) removeKid(this.doc.root, r);
  }
  xml(): string { return serializeDoc(this.doc); }
  save(zip: JSZip) { zip.file(relsPathOf(this.part), this.xml()); }
}

/** [Content_Types].xml */
export class ContentTypes {
  constructor(public doc: XDoc) {}
  static async load(zip: JSZip): Promise<ContentTypes> {
    const doc = await readXmlPart(zip, "[Content_Types].xml");
    if (!doc) throw new Error("Missing [Content_Types].xml");
    return new ContentTypes(doc);
  }
  hasOverride(part: string) { return kids(this.doc.root, "Override").some((o) => attr(o, "PartName") === `/${part}`); }
  override(part: string, type: string) {
    if (this.hasOverride(part)) return;
    appendKid(this.doc.root, mk("Override", { PartName: `/${part}`, ContentType: type }));
  }
  removeOverride(part: string) {
    const o = kids(this.doc.root, "Override").find((x) => attr(x, "PartName") === `/${part}`);
    if (o) removeKid(this.doc.root, o);
  }
  ensureDefault(ext: string, type: string) {
    if (kids(this.doc.root, "Default").some((d) => (attr(d, "Extension") ?? "").toLowerCase() === ext.toLowerCase())) return;
    appendKid(this.doc.root, frag(`<Default Extension="${ext}" ContentType="${type}"/>`));
  }
  xml(): string { return serializeDoc(this.doc); }
}

export const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff", emf: "image/x-emf", wmf: "image/x-wmf" };
export const extOfMime = (mime: string) => ({ "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp", "image/bmp": "bmp" } as Record<string, string>)[mime.split(";")[0]] ?? "png";

/** Next unused "<dir>/<stem>N.<ext>" in the package. */
export function nextPartName(zip: JSZip, dir: string, stem: string, ext: string, reserved: Set<string> = new Set()): string {
  let n = 1;
  while (zip.file(`${dir}/${stem}${n}.${ext}`) || reserved.has(`${dir}/${stem}${n}.${ext}`)) n++;
  const name = `${dir}/${stem}${n}.${ext}`;
  reserved.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [parseInt(m.slice(0, 2), 16) || 0, parseInt(m.slice(2, 4), 16) || 0, parseInt(m.slice(4, 6), 16) || 0];
}
export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Apply DrawingML color transforms (lumMod/lumOff/tint/shade) to a hex color. */
export function applyColorMods(hex: string, colorEl: XEl | undefined): string {
  if (!colorEl) return hex;
  let rgb = hexToRgb(hex);
  for (const m of colorEl.kids) {
    if (m.t !== "el") continue;
    const val = Number(attr(m, "val") ?? 0) / 100000;
    if (m.name === "a:lumMod" || m.name === "a:lumOff") {
      const hsl = rgbToHsl(rgb);
      hsl[2] = m.name === "a:lumMod" ? hsl[2] * val : Math.min(1, hsl[2] + val);
      rgb = hslToRgb(hsl);
    } else if (m.name === "a:tint") rgb = rgb.map((c) => c + (255 - c) * (1 - val)) as [number, number, number];
    else if (m.name === "a:shade") rgb = rgb.map((c) => c * val) as [number, number, number];
  }
  return rgbToHex(rgb);
}
