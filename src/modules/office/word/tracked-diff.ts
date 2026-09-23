/**
 * Word-level tracked-change diff between two inline contents. Produces a new
 * inline content array where removed words carry a `deletion` mark and added
 * words an `insertion` mark; unchanged words keep their original marks.
 */
import { diffWordsWithSpace } from "diff";
import { addMarkToInline, cloneNode, normalizeInline, sliceSpans, spansText, toSpans, type ChangeMarkAttrs, type PMNode } from "./doc-model";

export interface TrackedDiffOptions {
  change: ChangeMarkAttrs;
  /** When false, returns the new content as-is (no marks). */
  track?: boolean;
}

export function buildTrackedInline(oldContent: PMNode[] | undefined, newContent: PMNode[] | undefined, opts: TrackedDiffOptions): PMNode[] {
  const next = normalizeInline(cloneNode(newContent ?? []));
  if (opts.track === false) return next;
  const oldSpans = toSpans(oldContent);
  const newSpans = toSpans(next);
  const oldText = spansText(oldSpans);
  const newText = spansText(newSpans);
  if (oldText === newText) return next.length ? next : normalizeInline(cloneNode(oldContent ?? []));

  const parts = diffWordsWithSpace(oldText, newText);
  const out: PMNode[] = [];
  let oldPos = 0, newPos = 0;
  const ins = { type: "insertion", attrs: { ...opts.change } };
  const del = { type: "deletion", attrs: { ...opts.change } };
  for (const p of parts) {
    const len = p.value.length;
    if (p.added) {
      const seg = sliceSpans(newSpans, newPos, newPos + len);
      out.push(...addMarkToInline(seg, ins, { remove: ["deletion"] }));
      newPos += len;
    } else if (p.removed) {
      const seg = sliceSpans(oldSpans, oldPos, oldPos + len);
      // Text that was itself a pending insertion is simply dropped (true delete).
      for (const n of seg) {
        if (n.type === "text" && n.marks?.some((m) => m.type === "insertion")) continue;
        out.push(...addMarkToInline([n], del));
      }
      oldPos += len;
    } else {
      out.push(...sliceSpans(oldSpans, oldPos, oldPos + len));
      oldPos += len; newPos += len;
    }
  }
  return normalizeInline(out);
}

/** Mark every text node in a block tree as an insertion (structural inserts). */
export function markBlocksInserted(blocks: PMNode[], change: ChangeMarkAttrs): PMNode[] {
  const ins = { type: "insertion", attrs: { ...change } };
  const walk = (n: PMNode): PMNode => {
    if (n.type === "text") return addMarkToInline([n], ins, { remove: ["deletion"] })[0];
    return { ...n, content: n.content?.map(walk) };
  };
  return blocks.map(walk);
}

/** Mark every text node in a block tree as a deletion. */
export function markBlocksDeleted(blocks: PMNode[], change: ChangeMarkAttrs): PMNode[] {
  const del = { type: "deletion", attrs: { ...change } };
  const walk = (n: PMNode): PMNode => {
    if (n.type === "text") return n.marks?.some((m) => m.type === "insertion") ? { ...n, text: "" } : addMarkToInline([n], del)[0];
    return { ...n, content: n.content?.map(walk).filter((c) => !(c.type === "text" && !c.text)) };
  };
  return blocks.map(walk);
}

/** Accept every tracked change in a JSON tree: deletions removed, insertion marks stripped. */
export function acceptAllChanges(doc: PMNode): PMNode {
  const walk = (n: PMNode): PMNode | null => {
    if (n.type === "text") {
      if (n.marks?.some((m) => m.type === "deletion")) return null;
      const marks = (n.marks ?? []).filter((m) => m.type !== "insertion");
      return { ...n, ...(marks.length ? { marks } : { marks: undefined }) };
    }
    const content = n.content?.map(walk).filter((c): c is PMNode => c !== null);
    return { ...n, ...(content ? { content } : {}) };
  };
  return walk(doc) as PMNode;
}

/** Reject every tracked change: insertions removed, deletion marks stripped. */
export function rejectAllChanges(doc: PMNode): PMNode {
  const walk = (n: PMNode): PMNode | null => {
    if (n.type === "text") {
      if (n.marks?.some((m) => m.type === "insertion")) return null;
      const marks = (n.marks ?? []).filter((m) => m.type !== "deletion");
      return { ...n, ...(marks.length ? { marks } : { marks: undefined }) };
    }
    const content = n.content?.map(walk).filter((c): c is PMNode => c !== null);
    return { ...n, ...(content ? { content } : {}) };
  };
  return walk(doc) as PMNode;
}
