/**
 * Heading-, paragraph- and page-aware chunking for intel documents. Pure and
 * client-safe (no node imports) so the UI can preview chunk boundaries.
 *
 * Rules: ~1,200 characters per chunk with ~150 characters of overlap carried
 * from the previous chunk; paragraphs are never split unless a single
 * paragraph exceeds the size (then sentences are used); headings (markdown,
 * ALL-CAPS lines, "§ 705.3 Title", roman/letter outline lines) start a new
 * section and are recorded on every chunk beneath them; page markers of the
 * form "[Page 12]" (as our extractors emit) set `page` and are removed from
 * the chunk text.
 */
export interface TextChunk {
  idx: number;
  text: string;
  section?: string;
  page?: number;
  startChar: number;
  endChar: number;
}

export interface ChunkOptions {
  size?: number;
  overlap?: number;
  /** Hard cap on chunks per document (very large documents are truncated with a note). */
  maxChunks?: number;
}

const PAGE_RE = /^\s*\[Page (\d+)\]\s*$/;
const HEADING_RES = [
  /^#{1,6}\s+\S/, // markdown
  /^§\s?\d+[\w.\-()]*\s+\S/, // CFR-style section heading
  /^(?:[IVXLC]+|[A-Z]|\d{1,2})[.)]\s+[A-Z][^\n]{2,80}$/, // outline "II. Background", "A. Facts", "1) Scope"
  /^(?:ARTICLE|SECTION|RULE|PART|CHAPTER|TITLE|ORDER|BACKGROUND|DISCUSSION|CONCLUSION|ANALYSIS|FACTS|SUMMARY|SYLLABUS|HOLDING|OPINION)\b[^\n]{0,80}$/i,
];

export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 120) return false;
  if (HEADING_RES.some((r) => r.test(t))) return true;
  // ALL CAPS short lines with at least two letters and no terminal period-heavy prose.
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters.length <= 80 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/[.!?]$/.test(t) && t.split(/\s+/).length <= 12;
}

export function cleanHeading(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").slice(0, 120);
}

/** Normalize line endings and trailing whitespace; keeps paragraph breaks and page markers. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

interface Block { text: string; start: number; end: number; section?: string; page?: number; heading: boolean }

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let section: string | undefined;
  let page: number | undefined;
  let pos = 0;
  const paras = text.split(/\n{2,}/);
  for (const raw of paras) {
    const start = text.indexOf(raw, pos);
    const at = start >= 0 ? start : pos;
    pos = at + raw.length;
    const lines = raw.split("\n");
    let cursor = at;
    for (const line of lines) {
      const lineStart = text.indexOf(line, cursor) >= 0 ? text.indexOf(line, cursor) : cursor;
      cursor = lineStart + line.length;
      const pm = line.match(PAGE_RE);
      if (pm) { page = Number(pm[1]); continue; }
      if (!line.trim()) continue;
      if (isHeadingLine(line)) {
        section = cleanHeading(line);
        blocks.push({ text: line.trim(), start: lineStart, end: lineStart + line.length, section, page, heading: true });
        continue;
      }
      blocks.push({ text: line.trim(), start: lineStart, end: lineStart + line.length, section, page, heading: false });
    }
  }
  // Merge consecutive non-heading lines of the same paragraph back together (they were split by "\n").
  const merged: Block[] = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.heading && !b.heading && prev.page === b.page && prev.section === b.section && b.start - prev.end <= 1) {
      prev.text = `${prev.text} ${b.text}`;
      prev.end = b.end;
    } else merged.push({ ...b });
  }
  return merged;
}

function splitSentences(text: string, size: number): string[] {
  const parts = text.split(/(?<=[.!?;])\s+(?=[A-Z0-9"“(§])/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (p.length > size) {
      if (cur) { out.push(cur); cur = ""; }
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
      continue;
    }
    if ((cur + " " + p).trim().length > size && cur) { out.push(cur); cur = p; } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

function tailOverlap(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return "";
  const tail = text.slice(text.length - overlap);
  // start the overlap at a word boundary
  const i = tail.search(/\s/);
  return i >= 0 ? tail.slice(i + 1) : tail;
}

/** Chunk a document's text. Character offsets refer to the normalized text. */
export function chunkIntelText(input: string, opts: ChunkOptions = {}): TextChunk[] {
  const size = Math.max(200, opts.size ?? 1200);
  const overlap = Math.max(0, Math.min(opts.overlap ?? 150, Math.floor(size / 3)));
  const maxChunks = opts.maxChunks ?? 2000;
  const text = normalizeText(input);
  if (!text) return [];
  const blocks = splitBlocks(text);
  const chunks: TextChunk[] = [];
  let cur = "";
  let curStart = -1;
  let curEnd = -1;
  let curSection: string | undefined;
  let curPage: number | undefined;
  let carry = "";

  const flush = () => {
    const body = cur.trim();
    if (!body) return;
    chunks.push({ idx: chunks.length, text: body, section: curSection, page: curPage, startChar: curStart, endChar: curEnd });
    carry = tailOverlap(body, overlap);
    cur = "";
    curStart = -1;
    curEnd = -1;
  };

  const append = (piece: string, start: number, end: number, section: string | undefined, page: number | undefined) => {
    if (!cur) {
      cur = carry ? `${carry} ${piece}` : piece;
      curStart = start;
      curSection = section;
      curPage = page;
    } else cur = `${cur}\n${piece}`;
    curEnd = end;
  };

  for (const b of blocks) {
    if (chunks.length >= maxChunks) break;
    if (b.heading) {
      // A heading starts a new chunk unless the current one is still short.
      if (cur && cur.length > size * 0.5) flush();
      if (cur) { cur = `${cur}\n${b.text}`; curEnd = b.end; curSection = b.section; }
      else append(b.text, b.start, b.end, b.section, b.page);
      continue;
    }
    if (b.page !== undefined && curPage !== undefined && b.page !== curPage && cur.length > size * 0.6) flush();
    const pieces = b.text.length > size ? splitSentences(b.text, size - Math.min(overlap, 100)) : [b.text];
    let offset = b.start;
    for (const piece of pieces) {
      const pieceStart = pieces.length === 1 ? b.start : offset;
      const pieceEnd = pieces.length === 1 ? b.end : Math.min(b.end, pieceStart + piece.length);
      offset = pieceEnd + 1;
      if (cur && (cur.length + piece.length + 1) > size) flush();
      append(piece, pieceStart, pieceEnd, b.section, b.page);
      if (cur.length >= size) flush();
    }
  }
  flush();
  return chunks.slice(0, maxChunks);
}

/** Text used for keyword/vector indexing of a chunk: section title prepended for context. */
export function chunkIndexText(chunk: Pick<TextChunk, "text" | "section">, docTitle?: string): string {
  const head = [docTitle, chunk.section].filter(Boolean).join(" — ");
  return head ? `${head}\n${chunk.text}` : chunk.text;
}
