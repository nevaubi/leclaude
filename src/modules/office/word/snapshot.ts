/**
 * The Word agent's snapshot: a flat, numbered listing of leaf blocks with ids,
 * section structure, selection, tracked-change state and stats. Built on the
 * client (lazily, when a message is sent) and consumed by the server tools,
 * which mutate it as they propose edits so subsequent reads see the new state.
 */
import type { OfficeScope } from "@/modules/office/shared/types";
import { docStats, estimatePages, flattenBlocks, type DocBlock, type DocSection, type DocStats, type PMNode } from "./doc-model";

export interface SnapshotBlock extends DocBlock {}

export interface WordSnapshot {
  title: string;
  blocks: SnapshotBlock[];
  sections: DocSection[];
  selection?: { text: string; blockIds: string[] } | null;
  trackChangesOn: boolean;
  stats: DocStats & { pages: number };
  page?: { size: string; margins: string; orientation: string };
  comments?: { id: string; anchor: string; body: string; author: string; resolved?: boolean; quote?: string }[];
  matterId?: string | null;
  templateId?: string | null;
}

export interface BuildSnapshotOptions {
  title: string;
  selection?: { text: string; blockIds: string[] } | null;
  trackChangesOn?: boolean;
  page?: WordSnapshot["page"];
  comments?: WordSnapshot["comments"];
  matterId?: string | null;
  templateId?: string | null;
}

export function buildSnapshot(doc: PMNode, opts: BuildSnapshotOptions): WordSnapshot {
  const { blocks, sections } = flattenBlocks(doc);
  const stats = docStats(doc);
  return {
    title: opts.title,
    blocks,
    sections,
    selection: opts.selection ?? null,
    trackChangesOn: Boolean(opts.trackChangesOn),
    stats: { ...stats, pages: estimatePages(stats) },
    page: opts.page,
    comments: opts.comments,
    matterId: opts.matterId ?? null,
    templateId: opts.templateId ?? null,
  };
}

export function parseSnapshot(raw: unknown): WordSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("snapshot must be an object");
  const s = raw as Partial<WordSnapshot>;
  if (!Array.isArray(s.blocks)) throw new Error("snapshot.blocks must be an array");
  const blocks: SnapshotBlock[] = s.blocks.map((b, i) => ({
    id: String((b as SnapshotBlock).id ?? ""),
    index: Number((b as SnapshotBlock).index ?? i + 1),
    type: ((b as SnapshotBlock).type ?? "paragraph") as SnapshotBlock["type"],
    level: (b as SnapshotBlock).level,
    pStyle: (b as SnapshotBlock).pStyle,
    align: (b as SnapshotBlock).align,
    text: String((b as SnapshotBlock).text ?? ""),
    rawText: (b as SnapshotBlock).rawText,
    section: (b as SnapshotBlock).section,
    listInfo: (b as SnapshotBlock).listInfo,
    table: (b as SnapshotBlock).table,
    wordCount: Number((b as SnapshotBlock).wordCount ?? 0),
    marks: (b as SnapshotBlock).marks,
    comments: Number((b as SnapshotBlock).comments ?? 0),
    footnotes: (b as SnapshotBlock).footnotes,
    tracked: (b as SnapshotBlock).tracked,
    image: (b as SnapshotBlock).image,
  }));
  if (blocks.some((b) => !b.id)) throw new Error("every snapshot block needs an id");
  const sections = Array.isArray(s.sections) ? s.sections : deriveSections(blocks);
  const stats = (s.stats ?? {}) as Partial<WordSnapshot["stats"]>;
  return {
    title: String(s.title ?? "Untitled document"),
    blocks,
    sections,
    selection: s.selection ?? null,
    trackChangesOn: Boolean(s.trackChangesOn),
    stats: { words: 0, characters: 0, paragraphs: 0, headings: 0, tables: 0, images: 0, lists: 0, footnotes: 0, comments: 0, insertions: 0, deletions: 0, pageBreaks: 0, pages: 1, ...stats },
    page: s.page,
    comments: Array.isArray(s.comments) ? s.comments : undefined,
    matterId: s.matterId ?? null,
    templateId: s.templateId ?? null,
  };
}

/** Recompute indices and sections after structural changes. */
export function reindexSnapshot(s: WordSnapshot) {
  let section: string | undefined;
  s.blocks.forEach((b, i) => {
    b.index = i + 1;
    if (b.type === "heading") { section = b.id; b.section = b.id; } else b.section = section;
  });
  s.sections = deriveSections(s.blocks);
  s.stats.words = s.blocks.reduce((n, b) => n + b.wordCount, 0);
  s.stats.paragraphs = s.blocks.filter((b) => b.type === "paragraph").length;
  s.stats.headings = s.blocks.filter((b) => b.type === "heading").length;
}

export function deriveSections(blocks: SnapshotBlock[]): DocSection[] {
  const out: DocSection[] = [];
  let cur: DocSection | null = null;
  for (const b of blocks) {
    if (b.type === "heading") {
      if (cur) { cur.end = b.index - 1; cur.blockCount = cur.end - cur.start; }
      cur = { id: b.id, title: b.text, level: b.level ?? 1, index: b.index, wordCount: 0, blockCount: 0, start: b.index, end: b.index };
      out.push(cur);
    } else if (cur) cur.wordCount += b.wordCount;
  }
  if (cur) { cur.end = blocks.length; cur.blockCount = cur.end - cur.start; }
  return out;
}

/** Blocks belonging to a section (heading + everything until the next heading of the same or higher level). */
export function sectionBlocks(s: WordSnapshot, headingId: string): SnapshotBlock[] {
  const start = s.blocks.findIndex((b) => b.id === headingId);
  if (start < 0) return [];
  const level = s.blocks[start].level ?? 1;
  const out = [s.blocks[start]];
  for (let i = start + 1; i < s.blocks.length; i++) {
    const b = s.blocks[i];
    if (b.type === "heading" && (b.level ?? 1) <= level) break;
    out.push(b);
  }
  return out;
}

const LIST_LABEL: Record<string, string> = { bullet: "•", ordered: "#", legal: "§", outline: "outline", alpha: "(a)", roman: "(i)", task: "☐" };

export function describeBlock(b: SnapshotBlock): string {
  if (b.type === "heading") return `Heading ${b.level ?? 1}${b.pStyle === "title" ? " · Title" : ""}`;
  if (b.type === "image") return `Image${b.image?.alt ? ` "${b.image.alt}"` : ""}`;
  if (b.type === "pageBreak") return "Page break";
  if (b.type === "horizontalRule") return "Rule";
  if (b.type === "codeBlock") return "Code";
  const parts: string[] = [];
  if (b.pStyle) parts.push(b.pStyle === "caption" ? "Caption" : b.pStyle === "title" ? "Title" : b.pStyle);
  if (b.listInfo) parts.push(`${LIST_LABEL[b.listInfo.kind] ?? b.listInfo.kind} L${b.listInfo.depth}#${b.listInfo.position}`);
  if (b.table) parts.push(`${b.table.header ? "th" : "td"} ${b.table.row},${b.table.col}`);
  if (b.align) parts.push(b.align);
  return parts.length ? parts.join(" ") : "Body";
}

function line(b: SnapshotBlock, maxChars: number): string {
  const flags: string[] = [];
  if (b.comments) flags.push(`${b.comments} comment${b.comments > 1 ? "s" : ""}`);
  if (b.tracked) flags.push(`tracked +${b.tracked.insertions}/−${b.tracked.deletions}`);
  if (b.footnotes) flags.push(`${b.footnotes} fn`);
  if (b.marks?.length) flags.push(b.marks.slice(0, 3).join("; "));
  const text = b.text.length > maxChars ? `${b.text.slice(0, maxChars)}… [${b.wordCount} words]` : b.text;
  return `¶${b.index} [id:${b.id}] (${describeBlock(b)})${flags.length ? ` {${flags.join(" | ")}}` : ""} ${text}`;
}

/**
 * Compact listing for the prompt. Full text for the scoped region; for very
 * long documents outside the scope only the outline is printed. Kept under
 * ~35k characters.
 */
export function renderSnapshot(s: WordSnapshot, scope: OfficeScope | null, budget = 35_000): string {
  const header = [
    `Title: ${s.title}`,
    `Stats: ${s.stats.words} words · ${s.blocks.length} blocks · ${s.sections.length} sections · ~${s.stats.pages} pages · tables ${s.stats.tables} · images ${s.stats.images} · footnotes ${s.stats.footnotes} · comments ${s.stats.comments}`,
    `Track changes: ${s.trackChangesOn ? "ON (edits will be tracked)" : "OFF"}${s.stats.insertions + s.stats.deletions ? ` · pending: ${s.stats.insertions} insertions, ${s.stats.deletions} deletions` : ""}`,
    s.page ? `Page: ${s.page.size} · ${s.page.orientation} · margins ${s.page.margins}` : "",
    s.selection?.text ? `Selection: "${s.selection.text.slice(0, 600)}" (blocks ${s.selection.blockIds.join(", ")})` : "",
  ].filter(Boolean);

  // Decide which blocks get full text.
  let focusIds: Set<string> | null = null;
  if (scope && scope.kind === "section" && scope.ref) focusIds = new Set(sectionBlocks(s, scope.ref).map((b) => b.id));
  else if (scope && scope.kind === "paragraph" && scope.ref) focusIds = new Set([scope.ref]);
  else if (scope && scope.kind === "selection" && s.selection?.blockIds?.length) focusIds = new Set(s.selection.blockIds);

  const outlineLine = (sec: DocSection) => `${"  ".repeat(Math.max(0, sec.level - 1))}¶${sec.index} [id:${sec.id}] H${sec.level} ${sec.title.slice(0, 120)} (${sec.wordCount} words, ${sec.blockCount} blocks)`;
  let outline: string[];
  if (!s.sections.length) outline = ["Outline: (no headings)"];
  else {
    const lines = s.sections.map(outlineLine);
    const outlineBudget = Math.floor(budget * 0.25);
    if (lines.join("\n").length <= outlineBudget) outline = ["Outline:", ...lines];
    else {
      // Keep the sections nearest the focus (or the first ones) and summarize the rest.
      const focusIdx = focusIds ? s.sections.findIndex((sec) => focusIds!.has(sec.id)) : 0;
      const center = Math.max(0, focusIdx);
      const keep: number[] = [];
      let used = 0;
      for (let d = 0; d < s.sections.length && used < outlineBudget; d++) {
        for (const i of d === 0 ? [center] : [center - d, center + d]) { if (i >= 0 && i < s.sections.length && !keep.includes(i) && used < outlineBudget) { keep.push(i); used += lines[i].length + 1; } }
      }
      keep.sort((a, b) => a - b);
      outline = [`Outline (${s.sections.length} sections; ${s.sections.length - keep.length} omitted — use get_outline for all):`];
      let prev = -1;
      for (const i of keep) { if (i !== prev + 1) outline.push(`  … ${i - prev - 1} section${i - prev - 1 > 1 ? "s" : ""} omitted`); outline.push(lines[i]); prev = i; }
      if (prev < s.sections.length - 1) outline.push(`  … ${s.sections.length - 1 - prev} more sections`);
    }
  }

  const fixed = [...header, "", ...outline, ""].join("\n");
  const fullText = s.blocks.map((b) => line(b, 1200)).join("\n");
  if (fixed.length + fullText.length + 20 <= budget) return `${fixed}Blocks:\n${fullText}`;

  // Over budget: full text in focus (or the first part of the document), short previews elsewhere, then a hard cap.
  const remaining = Math.max(2000, budget - fixed.length - 200);
  const focusChars = focusIds ? s.blocks.filter((b) => focusIds!.has(b.id)).reduce((n, b) => n + Math.min(b.text.length, 1200) + 60, 0) : 0;
  const perBlock = Math.max(0, remaining - focusChars) / Math.max(1, s.blocks.length - (focusIds?.size ?? 0));
  const previewChars = Math.max(0, Math.min(160, Math.floor(perBlock) - 50));
  const lines: string[] = [];
  let used = 0;
  for (const b of s.blocks) {
    let l: string;
    if (focusIds?.has(b.id)) l = line(b, 1200);
    else if (!focusIds && used < remaining * 0.6) l = line(b, 500);
    else if (previewChars >= 24) l = line(b, previewChars);
    else l = `¶${b.index} [id:${b.id}] (${describeBlock(b)}) ${b.wordCount}w`;
    lines.push(l);
    used += l.length + 1;
    if (used > remaining) { lines.push(`… ${s.blocks.length - lines.length} more blocks omitted (use get_paragraphs / get_section)`); break; }
  }
  const body = lines.join("\n");
  return `${fixed}Blocks (text truncated outside scope; use get_paragraphs/get_section for full text):\n${body}`;
}
