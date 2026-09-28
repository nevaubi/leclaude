/**
 * Outline (bookmark) plumbing over pdf-lib: read the existing tree with page
 * targets, append editor bookmarks without destroying the document's own
 * outline, drop destinations that point at removed pages, and rebuild an
 * outline for a page subset (split/extract) or a concatenation (merge).
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFObject } from "pdf-lib";
import { pdfText } from "./content-stream";
import { setOutline, type OutlineSpec } from "./pdf-lib-utils";

export interface OutlineNode { title: string; /** 0-based page index, or null when unresolved. */ pageIndex: number | null; children: OutlineNode[] }

function lk(doc: PDFDocument, o: PDFObject | undefined) { return o instanceof PDFRef ? doc.context.lookup(o) : o; }

function nameTreeLookup(doc: PDFDocument, node: PDFObject | undefined, key: string, depth = 0): PDFObject | undefined {
  const d = lk(doc, node);
  if (!(d instanceof PDFDict) || depth > 12) return undefined;
  const names = lk(doc, d.get(PDFName.of("Names")));
  if (names instanceof PDFArray) {
    const arr = names.asArray();
    for (let i = 0; i + 1 < arr.length; i += 2) if (pdfText(lk(doc, arr[i])) === key) return lk(doc, arr[i + 1]);
  }
  const kids = lk(doc, d.get(PDFName.of("Kids")));
  if (kids instanceof PDFArray) for (const k of kids.asArray()) { const hit = nameTreeLookup(doc, k, key, depth + 1); if (hit) return hit; }
  return undefined;
}

/** Resolve an outline item's /Dest or /A GoTo to a page ref. */
export function destPageRef(doc: PDFDocument, item: PDFDict): PDFRef | null {
  let dest: PDFObject | undefined = lk(doc, item.get(PDFName.of("Dest")));
  if (!dest) {
    const a = lk(doc, item.get(PDFName.of("A")));
    if (a instanceof PDFDict) { const s = a.lookup(PDFName.of("S")); if (s instanceof PDFName && s.decodeText() === "GoTo") dest = lk(doc, a.get(PDFName.of("D"))); }
  }
  if (dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString) {
    const key = dest instanceof PDFName ? dest.decodeText() : dest.decodeText();
    const dests = lk(doc, doc.catalog.get(PDFName.of("Dests")));
    let hit: PDFObject | undefined = dests instanceof PDFDict ? lk(doc, dests.get(PDFName.of(key))) : undefined;
    if (!hit) { const names = lk(doc, doc.catalog.get(PDFName.of("Names"))); if (names instanceof PDFDict) hit = nameTreeLookup(doc, names.get(PDFName.of("Dests")), key); }
    if (hit instanceof PDFDict) hit = lk(doc, hit.get(PDFName.of("D")));
    dest = hit;
  }
  if (dest instanceof PDFArray) { const p = dest.get(0); if (p instanceof PDFRef) return p; }
  return null;
}

/** The document's outline tree with 0-based page indices. */
export function readOutlineTree(doc: PDFDocument): OutlineNode[] {
  const root = lk(doc, doc.catalog.get(PDFName.of("Outlines")));
  if (!(root instanceof PDFDict)) return [];
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const walk = (first: PDFObject | undefined, depth: number): OutlineNode[] => {
    const out: OutlineNode[] = [];
    let cur = lk(doc, first);
    let guard = 0;
    while (cur instanceof PDFDict && guard++ < 5000) {
      const ref = destPageRef(doc, cur);
      out.push({ title: pdfText(lk(doc, cur.get(PDFName.of("Title")))) ?? "", pageIndex: ref ? pageIndex.get(ref.toString()) ?? null : null, children: depth < 10 ? walk(cur.get(PDFName.of("First")), depth + 1) : [] });
      cur = lk(doc, cur.get(PDFName.of("Next")));
    }
    return out;
  };
  return walk(root.get(PDFName.of("First")), 0);
}

/**
 * Append items (1-based pages in the current page order) after the existing
 * top-level outline items. The existing items (and their actions, colors and
 * styles) are left untouched; only sibling links and counts are updated.
 */
export function appendOutline(doc: PDFDocument, items: OutlineSpec[]) {
  if (!items.length) return;
  const root = lk(doc, doc.catalog.get(PDFName.of("Outlines")));
  const lastRef = root instanceof PDFDict ? root.get(PDFName.of("Last")) : undefined;
  const last = lk(doc, lastRef);
  if (!(root instanceof PDFDict) || !(lastRef instanceof PDFRef) || !(last instanceof PDFDict)) { setOutline(doc, items); return; }
  const rootRef = doc.catalog.get(PDFName.of("Outlines"));
  if (!(rootRef instanceof PDFRef)) { setOutline(doc, items); return; }
  const ctx = doc.context;
  const pages = doc.getPages();
  const build = (list: OutlineSpec[], parent: PDFRef): { refs: PDFRef[]; count: number } => {
    const refs = list.map(() => ctx.nextRef());
    let total = 0;
    list.forEach((it, i) => {
      const page = pages[Math.min(Math.max(1, it.page), pages.length) - 1];
      const dict = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: parent, Dest: ctx.obj([page.ref, PDFName.of("XYZ"), PDFNull, PDFNumber.of(page.getHeight()), PDFNull]) });
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < list.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      total++;
      if (it.children?.length) {
        const sub = build(it.children, refs[i]);
        dict.set(PDFName.of("First"), sub.refs[0]);
        dict.set(PDFName.of("Last"), sub.refs[sub.refs.length - 1]);
        dict.set(PDFName.of("Count"), PDFNumber.of(sub.count));
        total += sub.count;
      }
      ctx.assign(refs[i], dict);
    });
    return { refs, count: total };
  };
  const added = build(items, rootRef);
  ctx.lookup(added.refs[0], PDFDict).set(PDFName.of("Prev"), lastRef);
  last.set(PDFName.of("Next"), added.refs[0]);
  root.set(PDFName.of("Last"), added.refs[added.refs.length - 1]);
  const cur = root.get(PDFName.of("Count"));
  const prev = cur instanceof PDFNumber ? cur.asNumber() : 0;
  root.set(PDFName.of("Count"), PDFNumber.of(prev >= 0 ? prev + added.count : prev));
}

/**
 * Remove the destination of outline items that point at pages no longer in
 * the document (never retarget them to another page); items without a target
 * and without children are unlinked.
 */
export function pruneOutlineDests(doc: PDFDocument, removedPageRefs: Set<string>): number {
  if (!removedPageRefs.size) return 0;
  const root = lk(doc, doc.catalog.get(PDFName.of("Outlines")));
  if (!(root instanceof PDFDict)) return 0;
  let changed = 0;
  const fix = (parent: PDFDict, depth: number) => {
    const items: PDFDict[] = [];
    const refs: PDFObject[] = [];
    let curRef: PDFObject | undefined = parent.get(PDFName.of("First"));
    let guard = 0;
    while (curRef && guard++ < 5000) {
      const cur = lk(doc, curRef);
      if (!(cur instanceof PDFDict)) break;
      if (depth < 10) fix(cur, depth + 1);
      const target = destPageRef(doc, cur);
      const dead = target && removedPageRefs.has(target.toString());
      if (dead) { cur.delete(PDFName.of("Dest")); cur.delete(PDFName.of("A")); changed++; }
      const hasKids = cur.get(PDFName.of("First")) !== undefined;
      if (!(dead && !hasKids)) { items.push(cur); refs.push(curRef); }
      curRef = cur.get(PDFName.of("Next"));
    }
    if (!items.length) { parent.delete(PDFName.of("First")); parent.delete(PDFName.of("Last")); parent.delete(PDFName.of("Count")); return; }
    items.forEach((it, i) => {
      if (i > 0) it.set(PDFName.of("Prev"), refs[i - 1]); else it.delete(PDFName.of("Prev"));
      if (i < items.length - 1) it.set(PDFName.of("Next"), refs[i + 1]); else it.delete(PDFName.of("Next"));
    });
    parent.set(PDFName.of("First"), refs[0]);
    parent.set(PDFName.of("Last"), refs[refs.length - 1]);
    if (parent.get(PDFName.of("Count")) instanceof PDFNumber || depth === 0) parent.set(PDFName.of("Count"), PDFNumber.of(items.length));
  };
  fix(root, 0);
  if (!root.get(PDFName.of("First"))) doc.catalog.delete(PDFName.of("Outlines"));
  void PDFNull;
  return changed;
}

/** Outline for a new document made of `pageIndices` (0-based, in the new order) of a source outline. */
export function remapOutline(nodes: OutlineNode[], pageIndices: number[]): OutlineSpec[] {
  const pos = new Map(pageIndices.map((p, i) => [p, i + 1]));
  const walk = (list: OutlineNode[]): OutlineSpec[] => {
    const out: OutlineSpec[] = [];
    for (const n of list) {
      const kids = walk(n.children);
      const page = n.pageIndex !== null ? pos.get(n.pageIndex) : undefined;
      if (page) out.push({ title: n.title, page, children: kids.length ? kids : undefined });
      else if (kids.length) out.push(...kids); // target not included: promote its children
    }
    return out;
  };
  return walk(nodes);
}
