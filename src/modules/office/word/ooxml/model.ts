/**
 * Normalized structural model of a .docx package, independent of the editor mapping. Used by the fidelity tests
 * (original vs export → re-import) and for diagnostics. Numbering is compared by resolved format/label, not by
 * numId, and styles by id, so a renumbered-but-equivalent package compares equal.
 */
import { sha256Hex, NumberingState, notePlainText } from "./reader";
import { loadPackage, REL, relatedPart, resolveTarget, type DocxPackage } from "./package";
import { attr, descendants, isEl, kid, kids, onOff, parseXml, textContent, wval, type XEl } from "./xml";

export interface RunModel { text: string; b?: boolean; i?: boolean; u?: string; strike?: boolean; color?: string; sz?: number; font?: string; highlight?: string; caps?: boolean; smallCaps?: boolean; vert?: string; rStyle?: string; ins?: string; del?: string; link?: string }
export interface ParaModel {
  text: string;
  style: string | null;
  num: { ilvl: number; fmt: string; lvlText: string; label: string } | null;
  props: Record<string, string>;
  runs: RunModel[];
  fields: string[];
  bookmarks: string[];
  notes: string[];
  images: { cx: number; cy: number; sha: string }[];
  sectionBreak: boolean;
}
export interface TableModel { grid: number[]; rows: { header: boolean; cells: { text: string; gridSpan: number; vMerge: string | null; shd?: string }[] }[]; style: string | null }
export interface DocxModel {
  body: ({ kind: "p"; p: ParaModel } | { kind: "tbl"; t: TableModel })[];
  sections: { w: number; h: number; orient: string; margins: Record<string, string>; cols: string; type: string; titlePg: boolean; headers: Record<string, string>; footers: Record<string, string> }[];
  trackedChanges: { type: string; author: string; date: string; text: string }[];
  comments: { author: string; text: string; range: string; done: boolean }[];
  footnotes: string[];
  endnotes: string[];
  hyperlinks: { text: string; target: string }[];
  styles: { id: string; type: string; name: string }[];
}

export async function extractModel(bytes: Uint8Array): Promise<DocxModel> {
  const pkg = await loadPackage(bytes);
  const main = pkg.mainPart;
  const src = pkg.text(main)!;
  const { root } = parseXml(src);
  const body = kid(root, "w:body")!;
  const rels = pkg.rels(main);
  const numberingPart = relatedPart(pkg, main, REL.numbering);
  const numbering = readNum(numberingPart ? pkg.text(numberingPart) : null);
  const state = new NumberingState(numbering.abstracts, numbering.nums);
  const stylesPart = relatedPart(pkg, main, REL.styles);
  const styles = stylesPart && pkg.text(stylesPart) ? descendants(parseXml(pkg.text(stylesPart)!).root, "w:style").map((s) => ({ id: attr(s, "w:styleId") ?? "", type: attr(s, "w:type") ?? "", name: wval(kid(s, "w:name")) ?? "", numId: wval(kid(kid(kid(s, "w:pPr"), "w:numPr"), "w:numId")), ilvl: wval(kid(kid(kid(s, "w:pPr"), "w:numPr"), "w:ilvl")), basedOn: wval(kid(s, "w:basedOn")) })) : [];
  const styleNum = (id: string | null) => { let cur = styles.find((s) => s.id === id); const seen = new Set<string>(); while (cur && !seen.has(cur.id)) { if (cur.numId) return { numId: cur.numId, ilvl: Number(cur.ilvl ?? 0) }; seen.add(cur.id); cur = styles.find((s) => s.id === cur!.basedOn); } return null; };
  const tracked: DocxModel["trackedChanges"] = [];
  const hyperlinks: DocxModel["hyperlinks"] = [];
  const commentRanges = new Map<string, string>();
  const open = new Set<string>();
  const fnText = notes(pkg, main, REL.footnotes, "w:footnote");
  const enText = notes(pkg, main, REL.endnotes, "w:endnote");

  const para = (p: XEl): ParaModel => {
    const pPr = kid(p, "w:pPr");
    const style = wval(kid(pPr, "w:pStyle")) ?? null;
    const props: Record<string, string> = {};
    for (const c of kids(pPr)) {
      if (["w:pStyle", "w:numPr", "w:rPr", "w:sectPr"].includes(c.name)) continue;
      props[c.name] = JSON.stringify(Object.fromEntries(Object.entries(c.attrs).sort())) + kids(c).map((k) => `${k.name}${JSON.stringify(k.attrs)}`).join("");
    }
    let num: ParaModel["num"] = null;
    const numPr = kid(pPr, "w:numPr");
    const eff = numPr ? { numId: wval(kid(numPr, "w:numId")) ?? "0", ilvl: Number(wval(kid(numPr, "w:ilvl")) ?? 0) } : styleNum(style);
    if (eff && eff.numId !== "0" && numbering.nums.has(eff.numId)) {
      const n = state.next(eff.numId, eff.ilvl);
      num = { ilvl: eff.ilvl, fmt: n.level?.fmt ?? "", lvlText: n.level?.text ?? "", label: n.label };
    }
    const out: ParaModel = { text: "", style, num, props, runs: [], fields: [], bookmarks: [], notes: [], images: [], sectionBreak: Boolean(kid(pPr, "w:sectPr")) };
    let instr = "";
    let inInstr = false;
    const walk = (el: XEl, ctx: { ins?: string; del?: string; link?: string }) => {
      for (const c of el.children) {
        if (!isEl(c)) continue;
        switch (c.name) {
          case "w:pPr": break;
          case "w:hyperlink": {
            const rid = attr(c, "r:id");
            const target = rid ? rels.find((r) => r.id === rid)?.target ?? "" : `#${attr(c, "w:anchor") ?? ""}`;
            const before = out.text.length;
            walk(c, { ...ctx, link: target });
            hyperlinks.push({ text: out.text.slice(before), target });
            break;
          }
          case "w:ins": case "w:moveTo": { const before = out.text.length; walk(c, { ...ctx, ins: attr(c, "w:author") }); tracked.push({ type: "ins", author: attr(c, "w:author") ?? "", date: attr(c, "w:date") ?? "", text: out.text.slice(before) }); break; }
          case "w:del": case "w:moveFrom": { const before = out.text.length; walk(c, { ...ctx, del: attr(c, "w:author") }); tracked.push({ type: "del", author: attr(c, "w:author") ?? "", date: attr(c, "w:date") ?? "", text: out.text.slice(before) }); break; }
          case "w:fldSimple": out.fields.push((attr(c, "w:instr") ?? "").trim().replace(/\s+/g, " ")); walk(c, ctx); break;
          case "w:bookmarkStart": { const n = attr(c, "w:name") ?? ""; if (n && n !== "_GoBack") out.bookmarks.push(n); break; }
          case "w:commentRangeStart": open.add(attr(c, "w:id") ?? ""); break;
          case "w:commentRangeEnd": open.delete(attr(c, "w:id") ?? ""); break;
          case "w:r": {
            const rPr = kid(c, "w:rPr");
            const run: RunModel = { text: "" };
            const b = onOff(kid(rPr, "w:b")); if (b) run.b = true;
            const i = onOff(kid(rPr, "w:i")); if (i) run.i = true;
            const u = wval(kid(rPr, "w:u")); if (u && u !== "none") run.u = u;
            if (onOff(kid(rPr, "w:strike")) || onOff(kid(rPr, "w:dstrike"))) run.strike = true;
            const color = wval(kid(rPr, "w:color")); if (color && color !== "auto") run.color = color.toUpperCase();
            const sz = wval(kid(rPr, "w:sz")); if (sz) run.sz = Number(sz);
            const f = kid(rPr, "w:rFonts"); const font = f ? (attr(f, "w:ascii") ?? attr(f, "w:hAnsi")) : undefined; if (font) run.font = font;
            const hl = wval(kid(rPr, "w:highlight")); if (hl && hl !== "none") run.highlight = hl;
            if (onOff(kid(rPr, "w:caps"))) run.caps = true;
            if (onOff(kid(rPr, "w:smallCaps"))) run.smallCaps = true;
            const va = wval(kid(rPr, "w:vertAlign")); if (va && va !== "baseline") run.vert = va;
            const rs = wval(kid(rPr, "w:rStyle")); if (rs) run.rStyle = rs;
            if (ctx.ins) run.ins = ctx.ins;
            if (ctx.del) run.del = ctx.del;
            if (ctx.link) run.link = ctx.link;
            for (const k of c.children) {
              if (!isEl(k)) continue;
              if (k.name === "w:fldChar") { const t = attr(k, "w:fldCharType"); if (t === "begin") { inInstr = true; instr = ""; } else if (t === "separate" || t === "end") { if (inInstr) out.fields.push(instr.trim().replace(/\s+/g, " ")); inInstr = false; } }
              else if (k.name === "w:instrText") instr += textContent(k);
              else if (k.name === "w:t" || k.name === "w:delText") run.text += textContent(k);
              else if (k.name === "w:tab") run.text += "\t";
              else if (k.name === "w:br") run.text += attr(k, "w:type") === "page" ? "\f" : "\n";
              else if (k.name === "w:footnoteReference") out.notes.push(`fn:${fnText.get(attr(k, "w:id") ?? "") ?? "?"}`);
              else if (k.name === "w:endnoteReference") out.notes.push(`en:${enText.get(attr(k, "w:id") ?? "") ?? "?"}`);
              else if (k.name === "w:drawing") {
                const ext = descendants(k, "wp:extent")[0];
                const blip = descendants(k, "a:blip")[0];
                const rid = blip ? attr(blip, "r:embed") : undefined;
                const rel = rid ? rels.find((r) => r.id === rid) : undefined;
                const bytes = rel ? pkg.files.get(resolveTarget(main, rel.target)) : undefined;
                out.images.push({ cx: Number(attr(ext, "cx") ?? 0), cy: Number(attr(ext, "cy") ?? 0), sha: bytes ? sha256Hex(bytes).slice(0, 16) : "" });
              }
            }
            out.text += run.text;
            for (const id of open) commentRanges.set(id, (commentRanges.get(id) ?? "") + run.text);
            if (run.text) {
              const last = out.runs[out.runs.length - 1];
              const key = (r: RunModel) => JSON.stringify({ ...r, text: "" });
              if (last && key(last) === key(run)) last.text += run.text; else out.runs.push(run);
            }
            break;
          }
          case "w:sdt": walk(kid(c, "w:sdtContent") ?? c, ctx); break;
          case "w:smartTag": case "w:customXml": case "w:dir": case "w:bdo": walk(c, ctx); break;
        }
      }
    };
    walk(p, {});
    return out;
  };

  const table = (t: XEl): TableModel => ({
    grid: kids(kid(t, "w:tblGrid"), "w:gridCol").map((g) => Number(attr(g, "w:w") ?? 0)),
    style: wval(kid(kid(t, "w:tblPr"), "w:tblStyle")) ?? null,
    rows: kids(t, "w:tr").map((tr) => ({
      header: onOff(kid(kid(tr, "w:trPr"), "w:tblHeader")) ?? false,
      cells: kids(tr, "w:tc").map((tc) => {
        const tcPr = kid(tc, "w:tcPr");
        const vm = kid(tcPr, "w:vMerge");
        const shd = attr(kid(tcPr, "w:shd"), "w:fill");
        return { text: descendants(tc, "w:p").map((p) => para(p).text).join("\n"), gridSpan: Number(wval(kid(tcPr, "w:gridSpan")) ?? 1), vMerge: vm ? (wval(vm) ?? "continue") : null, ...(shd && shd !== "auto" ? { shd: shd.toUpperCase() } : {}) };
      }),
    })),
  });

  const out: DocxModel["body"] = [];
  const sectEls: XEl[] = [];
  const walkBody = (els: XEl[]) => {
    for (const el of els) {
      if (el.name === "w:p") { out.push({ kind: "p", p: para(el) }); const s = kid(kid(el, "w:pPr"), "w:sectPr"); if (s) sectEls.push(s); }
      else if (el.name === "w:tbl") out.push({ kind: "tbl", t: table(el) });
      else if (el.name === "w:sdt") walkBody(kids(kid(el, "w:sdtContent")));
      else if (el.name === "w:customXml") walkBody(kids(el));
      else if (el.name === "w:sectPr") sectEls.push(el);
    }
  };
  walkBody(kids(body));
  const hf = (rid: string | undefined) => {
    const r = rid ? rels.find((x) => x.id === rid) : undefined;
    const x = r ? pkg.text(resolveTarget(main, r.target)) : null;
    return x ? descendants(parseXml(x).root, "w:t").map(textContent).join("") : "";
  };
  const sections = sectEls.map((s) => {
    const pgSz = kid(s, "w:pgSz"), pgMar = kid(s, "w:pgMar");
    const headers: Record<string, string> = {}, footers: Record<string, string> = {};
    for (const r of kids(s, "w:headerReference")) headers[attr(r, "w:type") ?? "default"] = hf(attr(r, "r:id"));
    for (const r of kids(s, "w:footerReference")) footers[attr(r, "w:type") ?? "default"] = hf(attr(r, "r:id"));
    return { w: Number(attr(pgSz, "w:w") ?? 0), h: Number(attr(pgSz, "w:h") ?? 0), orient: attr(pgSz, "w:orient") ?? "portrait", margins: Object.fromEntries(Object.entries(pgMar?.attrs ?? {}).sort()), cols: JSON.stringify(kid(s, "w:cols")?.attrs ?? {}), type: wval(kid(s, "w:type")) ?? "nextPage", titlePg: Boolean(kid(s, "w:titlePg")), headers, footers };
  });
  const comments: DocxModel["comments"] = [];
  const cPart = relatedPart(pkg, main, REL.comments);
  const extPart = relatedPart(pkg, main, REL.commentsExtended);
  const done = new Set<string>();
  if (extPart && pkg.text(extPart)) for (const e of kids(parseXml(pkg.text(extPart)!).root)) if (attr(e, "w15:done") === "1") done.add(attr(e, "w15:paraId") ?? "");
  if (cPart && pkg.text(cPart)) {
    for (const c of kids(parseXml(pkg.text(cPart)!).root, "w:comment")) {
      const ps = descendants(c, "w:p");
      const pid = ps.length ? attr(ps[ps.length - 1], "w14:paraId") : undefined;
      comments.push({ author: attr(c, "w:author") ?? "", text: notePlainText(c), range: commentRanges.get(attr(c, "w:id") ?? "") ?? "", done: pid ? done.has(pid) : false });
    }
  }
  return {
    body: out, sections, trackedChanges: tracked, comments,
    footnotes: Array.from(fnText.values()), endnotes: Array.from(enText.values()),
    hyperlinks, styles: styles.map((s) => ({ id: s.id, type: s.type, name: s.name })),
  };
}

function notes(pkg: DocxPackage, main: string, type: string, tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const p = relatedPart(pkg, main, type);
  const x = p ? pkg.text(p) : null;
  if (!x) return out;
  for (const n of kids(parseXml(x).root, tag)) { const t = attr(n, "w:type"); if (t && t !== "normal") continue; out.set(attr(n, "w:id") ?? "", notePlainText(n)); }
  return out;
}

function readNum(xml: string | null) {
  // Re-use the reader's numbering structures through a light local parse.
  const abstracts = new Map<string, { id: string; levels: Map<number, { ilvl: number; start: number; fmt: string; text: string; isLgl: boolean }> }>();
  const nums = new Map<string, { numId: string; abstractId: string; overrides: Map<number, { start?: number }> }>();
  if (!xml) return { abstracts, nums };
  const { root } = parseXml(xml);
  for (const a of kids(root, "w:abstractNum")) {
    const levels = new Map<number, { ilvl: number; start: number; fmt: string; text: string; isLgl: boolean }>();
    for (const l of kids(a, "w:lvl")) levels.set(Number(attr(l, "w:ilvl") ?? 0), { ilvl: Number(attr(l, "w:ilvl") ?? 0), start: Number(wval(kid(l, "w:start")) ?? 1), fmt: wval(kid(l, "w:numFmt")) ?? "decimal", text: wval(kid(l, "w:lvlText")) ?? "", isLgl: Boolean(kid(l, "w:isLgl")) });
    abstracts.set(attr(a, "w:abstractNumId") ?? "", { id: attr(a, "w:abstractNumId") ?? "", levels });
  }
  for (const n of kids(root, "w:num")) {
    const overrides = new Map<number, { start?: number }>();
    for (const o of kids(n, "w:lvlOverride")) { const so = wval(kid(o, "w:startOverride")); overrides.set(Number(attr(o, "w:ilvl") ?? 0), { start: so != null ? Number(so) : undefined }); }
    nums.set(attr(n, "w:numId") ?? "", { numId: attr(n, "w:numId") ?? "", abstractId: wval(kid(n, "w:abstractNumId")) ?? "", overrides });
  }
  return { abstracts, nums };
}
