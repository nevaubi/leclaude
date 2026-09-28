/**
 * Canonical form of editor nodes for "unchanged since import?" checks. Only semantic attributes count; defaults
 * the editor fills in (null attrs, textAlign "left", colspan 1…) and representation details (mark order, split
 * text nodes, link target/rel) are normalized away, so a document that went through the TipTap schema compares
 * equal to the importer's output when the user did not touch it.
 */
import type { PMNode } from "../doc-model";

const BLOCK_ATTRS = ["textAlign", "lineHeight", "spacingBefore", "spacingAfter", "indent", "pStyle", "styleId", "docx", "tocRef"];
const NODE_ATTRS: Record<string, string[]> = {
  paragraph: BLOCK_ATTRS,
  heading: [...BLOCK_ATTRS, "level"],
  bulletList: ["docx"], orderedList: ["start", "listStyle", "docx"], taskList: ["docx"], listItem: [], taskItem: ["checked"],
  table: ["docx"], tableRow: ["docx"], tableCell: ["colspan", "rowspan", "colwidth", "docx"], tableHeader: ["colspan", "rowspan", "colwidth", "docx"],
  image: ["src", "alt", "width", "height", "docx", "align", "mermaid"],
  pageBreak: ["section", "docx"],
  docxInline: ["kind", "xml", "rpr", "instr", "name", "bid", "image", "dirty", "simple"],
  hardBreak: [], codeBlock: ["language"], blockquote: [], horizontalRule: [],
};
const MARK_ATTRS: Record<string, string[]> = {
  link: ["href"], textStyle: ["color", "fontSize", "fontFamily"], highlight: ["color"],
  insertion: ["id", "author", "date"], deletion: ["id", "author", "date"], comment: ["id"],
  footnote: ["id", "text", "kind", "sourceId"], docxRun: ["rpr", "rStyle"],
};
const DEFAULTS: Record<string, Record<string, unknown>> = {
  orderedList: { start: 1, listStyle: "decimal" },
  tableCell: { colspan: 1, rowspan: 1 }, tableHeader: { colspan: 1, rowspan: 1 },
};

function empty(v: unknown) { return v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0); }

export function canonValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) { const x = (v as Record<string, unknown>)[k]; if (!empty(x)) out[k] = canonValue(x); }
    return out;
  }
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v)) return v; // keep strings as strings (ids)
  return v;
}

function canonAttrs(type: string, attrs: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const defs = DEFAULTS[type] ?? {};
  for (const k of keys) {
    let v = attrs?.[k];
    if (k === "textAlign" && v === "left") v = null;
    if (typeof v === "number" && !Number.isFinite(v)) v = null;
    if (k in defs && (v === defs[k] || (typeof defs[k] === "number" && Number(v) === defs[k]))) v = null;
    if (!empty(v)) out[k] = canonValue(typeof v === "string" && ["lineHeight", "spacingBefore", "spacingAfter", "indent", "level", "start", "width", "height", "colspan", "rowspan"].includes(k) && Number.isFinite(Number(v)) ? Number(v) : v);
  }
  return out;
}

function canonMarks(marks: PMNode["marks"]): unknown[] {
  const out: { type: string; attrs: Record<string, unknown> }[] = [];
  for (const m of marks ?? []) {
    const attrs = canonAttrs(m.type, m.attrs, MARK_ATTRS[m.type] ?? []);
    if (m.type === "textStyle" && !Object.keys(attrs).length) continue;
    out.push({ type: m.type, attrs });
  }
  return out.sort((a, b) => (a.type === b.type ? JSON.stringify(a.attrs).localeCompare(JSON.stringify(b.attrs)) : a.type.localeCompare(b.type)));
}

export function canonNode(n: PMNode): unknown {
  if (n.type === "text") return { t: n.text ?? "", m: canonMarks(n.marks) };
  const out: Record<string, unknown> = { type: n.type };
  const attrs = canonAttrs(n.type, n.attrs, NODE_ATTRS[n.type] ?? []);
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (n.content?.length) {
    const kids: unknown[] = [];
    for (const c of n.content) {
      if (c.type === "text" && !c.text) continue;
      const cc = canonNode(c) as { t?: string; m?: unknown[] };
      const last = kids[kids.length - 1] as { t?: string; m?: unknown[] } | undefined;
      if (cc.t !== undefined && last?.t !== undefined && JSON.stringify(last.m) === JSON.stringify(cc.m)) { last.t += cc.t; continue; }
      kids.push(cc);
    }
    if (kids.length) out.content = kids;
  }
  return out;
}

/** Stable string key of a node's canonical form. */
export function canonKey(n: PMNode): string { return JSON.stringify(canonNode(n)); }

export function hasTrackedMarks(n: PMNode): boolean {
  if (n.marks?.some((m) => m.type === "insertion" || m.type === "deletion")) return true;
  return (n.content ?? []).some(hasTrackedMarks);
}
