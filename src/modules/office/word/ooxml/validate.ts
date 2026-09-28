/**
 * Structural validation of a .docx package: every XML part well-formed (fast-xml-parser), content types cover
 * every part, relationship targets exist, and document.xml references only existing relationships, styles,
 * numbering definitions, comments and notes; bookmarks pair up.
 */
import { XMLValidator } from "fast-xml-parser";
import JSZip from "jszip";
import { parseRels, relsPathFor, resolveTarget, stripBom } from "./package";
import { attr, descendants, kids, parseXml } from "./xml";

export interface DocxValidation { ok: boolean; errors: string[]; parts: number }

export async function validateDocx(bytes: Uint8Array): Promise<DocxValidation> {
  const errors: string[] = [];
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);
  const text = new Map<string, string>();
  for (const n of names) if (/\.(xml|rels)$/i.test(n)) text.set(n, stripBom(await zip.file(n)!.async("string")));
  for (const [n, t] of text) {
    const v = XMLValidator.validate(t);
    if (v !== true) errors.push(`${n}: not well-formed (${v.err.msg} at line ${v.err.line})`);
  }
  if (errors.length) return { ok: false, errors, parts: names.length };
  const ctXml = text.get("[Content_Types].xml");
  if (!ctXml) return { ok: false, errors: ["missing [Content_Types].xml"], parts: names.length };
  const ct = parseXml(ctXml).root;
  const defaults = new Set(kids(ct).filter((e) => e.name.endsWith("Default")).map((e) => (attr(e, "Extension") ?? "").toLowerCase()));
  const overrides = new Set(kids(ct).filter((e) => e.name.endsWith("Override")).map((e) => (attr(e, "PartName") ?? "").replace(/^\//, "")));
  for (const n of names) {
    if (n === "[Content_Types].xml") continue;
    const ext = n.split(".").pop()?.toLowerCase() ?? "";
    if (!overrides.has(n) && !defaults.has(ext)) errors.push(`${n}: no content type`);
  }
  for (const o of overrides) if (!names.includes(o)) errors.push(`content type override for missing part ${o}`);
  // relationships
  for (const n of names.filter((x) => x.endsWith(".rels"))) {
    const source = n === "_rels/.rels" ? "" : n.replace(/_rels\/([^/]+)\.rels$/, "$1");
    for (const r of parseRels(text.get(n) ?? null)) {
      if (r.external) continue;
      const target = resolveTarget(source, r.target);
      if (!names.includes(target)) errors.push(`${n}: ${r.id} targets missing part ${target}`);
    }
  }
  const pkgRels = parseRels(text.get("_rels/.rels") ?? null);
  const mainRel = pkgRels.find((r) => r.type.endsWith("/officeDocument"));
  const main = mainRel ? resolveTarget("", mainRel.target) : "word/document.xml";
  const docXml = text.get(main);
  if (!docXml) return { ok: false, errors: [...errors, `missing main part ${main}`], parts: names.length };
  const rels = parseRels(text.get(relsPathFor(main)) ?? null);
  const relIds = new Set(rels.map((r) => r.id));
  const related = (suffix: string) => { const r = rels.find((x) => x.type.endsWith(suffix) && !x.external); return r ? text.get(resolveTarget(main, r.target)) ?? null : null; };
  const { root } = parseXml(docXml);
  const all = (name: string) => descendants(root, name);
  const check = (xml: string, part: string, known: Set<string>) => {
    const { root: r } = parseXml(xml);
    const walk = (el: typeof r) => {
      for (const [k, v] of Object.entries(el.attrs)) if ((k === "r:id" || k === "r:embed" || k === "r:link") && !known.has(v)) errors.push(`${part}: <${el.name} ${k}="${v}"> has no relationship`);
      for (const c of el.children) if (c.kind === "el") walk(c);
    };
    walk(r);
  };
  check(docXml, main, relIds);
  for (const r of rels) {
    if (r.external || !/header|footer|footnotes|endnotes|comments/.test(r.type)) continue;
    const p = resolveTarget(main, r.target);
    const x = text.get(p);
    if (x) check(x, p, new Set(parseRels(text.get(relsPathFor(p)) ?? null).map((y) => y.id)));
  }
  const stylesXml = related("/styles");
  if (stylesXml) {
    const styleIds = new Set(descendants(parseXml(stylesXml).root, "w:style").map((s) => attr(s, "w:styleId") ?? ""));
    for (const tag of ["w:pStyle", "w:rStyle", "w:tblStyle"]) for (const e of all(tag)) { const v = attr(e, "w:val"); if (v && !styleIds.has(v)) errors.push(`${main}: ${tag} "${v}" is not defined in styles.xml`); }
  }
  const numberingXml = related("/numbering");
  const numIds = new Set(numberingXml ? kids(parseXml(numberingXml).root, "w:num").map((n) => attr(n, "w:numId") ?? "") : []);
  if (numberingXml) {
    const nroot = parseXml(numberingXml).root;
    const abstractIds = new Set(kids(nroot, "w:abstractNum").map((a) => attr(a, "w:abstractNumId") ?? ""));
    for (const n of kids(nroot, "w:num")) { const a = attr(kids(n, "w:abstractNumId")[0], "w:val"); if (a && !abstractIds.has(a)) errors.push(`numbering.xml: num ${attr(n, "w:numId")} references missing abstractNum ${a}`); }
    let seenNum = false;
    for (const c of kids(nroot)) { if (c.name === "w:num") seenNum = true; else if (c.name === "w:abstractNum" && seenNum) { errors.push("numbering.xml: w:abstractNum after w:num"); break; } }
  }
  for (const e of all("w:numId")) { const v = attr(e, "w:val"); if (v && v !== "0" && !numIds.has(v)) errors.push(`${main}: numId ${v} is not defined in numbering.xml`); }
  const idsIn = (xml: string | null, tag: string) => new Set(xml ? kids(parseXml(xml).root, tag).map((c) => attr(c, "w:id") ?? "") : []);
  const commentIds = idsIn(related("/comments"), "w:comment");
  for (const tag of ["w:commentReference", "w:commentRangeStart", "w:commentRangeEnd"]) for (const e of all(tag)) if (!commentIds.has(attr(e, "w:id") ?? "")) errors.push(`${main}: ${tag} ${attr(e, "w:id")} has no comment`);
  const fn = idsIn(related("/footnotes"), "w:footnote");
  for (const e of all("w:footnoteReference")) if (!fn.has(attr(e, "w:id") ?? "")) errors.push(`${main}: footnoteReference ${attr(e, "w:id")} has no footnote`);
  const en = idsIn(related("/endnotes"), "w:endnote");
  for (const e of all("w:endnoteReference")) if (!en.has(attr(e, "w:id") ?? "")) errors.push(`${main}: endnoteReference ${attr(e, "w:id")} has no endnote`);
  const starts = new Set(all("w:bookmarkStart").map((e) => attr(e, "w:id") ?? ""));
  const ends = new Set(all("w:bookmarkEnd").map((e) => attr(e, "w:id") ?? ""));
  for (const s of starts) if (!ends.has(s)) errors.push(`${main}: bookmarkStart ${s} has no bookmarkEnd`);
  const body = kids(root, "w:body")[0];
  const lastBody = body ? kids(body).pop() : undefined;
  if (lastBody && lastBody.name !== "w:sectPr") errors.push(`${main}: body does not end with w:sectPr`);
  for (const tc of all("w:tc")) { const last = kids(tc).filter((c) => c.name !== "w:tcPr").pop(); if (!last || last.name !== "w:p") errors.push(`${main}: table cell does not end with a paragraph`); }
  return { ok: errors.length === 0, errors, parts: names.length };
}
