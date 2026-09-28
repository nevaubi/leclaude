/**
 * Deterministic deck builders and checks used by the slides agent (isomorphic, no model calls):
 *  - outlineToSlides: a loose outline (markdown headings / numbered lines / bullets) → slides with layout choices;
 *  - documentOutline: a Word document (TipTap JSON) or markdown memo → outline (headings → slides, text → bullets);
 *  - timelineSlide / exhibitSlide: matter chronology and Bates exhibit callouts with source references;
 *  - checkConsistency: font/size/alignment/position outliers, overflow and density issues across the deck;
 *  - fitTextPlan: grow the box into free space, else shrink the font to a floor, else ask for condensing.
 */
import { buildSlide, type SlideContent, type TimelineItem } from "./layouts";
import {
  SLIDE_H, SLIDE_W, bulletLines, estimateTextFit, fitFontSize, makeElement, parseMarkdownLite, plainText, slideTitle, wordCount,
  type DeckContent, type DeckElement, type DeckSlide, type DeckTheme, type SlideLayout,
} from "./model";

// ---------------------------------------------------------------------------
// Outline → slides
// ---------------------------------------------------------------------------

export interface OutlineSlidePlan { title: string; lines: string[]; layout: SlideLayout; reason: string; content: SlideContent }

const DATE_RE = /^\**\s*((?:\d{4}(?:[-/.]\d{1,2}(?:[-/.]\d{1,2})?)?)|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?:\d{1,2},\s*)?\d{4})|(?:Q[1-4]\s+\d{4}))\b/i;
const PAIR_RE = /^(pros?|cons?|ours?|theirs?|plaintiffs?|defen[cs]e|defendants?|left|right|before|after|strengths?|weaknesses?|risks?|recommendations?|for|against)\s*:?\s*$/i;

/** Split an outline into title + lines blocks: "#"/"##" headings, or top-level numbered/unindented lines followed by bullets. */
export function splitOutline(outline: string): { title: string; lines: string[] }[] {
  const raw = outline.replace(/\r\n/g, "\n").split("\n");
  const blocks: { title: string; lines: string[] }[] = [];
  const hasHeadings = raw.some((l) => /^#{1,3}\s+/.test(l));
  for (const line of raw) {
    if (!line.trim()) continue;
    const heading = hasHeadings ? /^#{1,3}\s+(.*)$/.exec(line) : /^(?:\d+[.)]\s+|[A-Z][.)]\s+|(?=\S))(?!\s*[-*•])(.+)$/.exec(line);
    const isTop = hasHeadings ? Boolean(heading) : !/^\s/.test(line) && !/^[-*•]\s/.test(line);
    if (isTop && heading) { blocks.push({ title: (heading[1] ?? line).trim(), lines: [] }); continue; }
    if (!blocks.length) blocks.push({ title: line.replace(/^[-*•]\s+/, "").trim(), lines: [] });
    else blocks[blocks.length - 1].lines.push(line);
  }
  return blocks;
}

/** Choose a layout for one outline block and build its content. Deterministic, with the reason recorded. */
export function planSlide(title: string, lines: string[], index: number): OutlineSlidePlan {
  const items = lines.map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);
  const topItems = lines.filter((l) => !/^\s{2,}/.test(l)).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);
  const body = lines.map((l) => { const m = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l); if (!m) return `- ${l.trim()}`; return `${"  ".repeat(Math.min(3, Math.floor(m[1].length / 2)))}- ${m[2]}`; }).join("\n");
  const base: SlideContent = { title };
  const plan = (layout: SlideLayout, reason: string, content: SlideContent): OutlineSlidePlan => ({ title, lines, layout, reason, content: { ...base, ...content } });

  const table = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  if (table.length >= 2) return plan("table", "pipe table", { table: { header: table[0], rows: table.slice(1).map((r) => table[0].map((_, i) => r[i] ?? "")) } });
  const nums = topItems.map((l) => /^(.+?)\s*[:=]\s*\$?\s*(-?[\d,.]+)\s*(%|[kmb]|million|billion)?\s*$/i.exec(l));
  if (topItems.length >= 2 && nums.every(Boolean)) {
    const unit = /\$/.test(lines.join(" ")) ? "$" : nums.some((m) => m?.[3] === "%") ? "%" : undefined;
    return plan("chart", "every line is label: number", { chart: { type: nums.length > 6 ? "line" : "bar", categories: nums.map((m) => m![1].trim()), series: [{ name: title, values: nums.map((m) => Number(m![2].replace(/,/g, "")) || 0) }], unit, showValues: true } });
  }
  if (index === 0 && items.length <= 2 && items.every((l) => wordCount(l) <= 14)) return plan("title", "opening slide", { subtitle: items[0], date: items[1] });
  if (/^(agenda|roadmap|overview|contents|today|outline)\b/i.test(title) && items.length) return plan("agenda", "agenda heading", { agenda: topItems, body });
  const quoted = items.length <= 2 && items[0] && /^["“].{20,}["”]$/.test(items[0]);
  if (quoted) return plan("quote", "quoted statement", { quote: items[0].replace(/^["“]|["”]$/g, ""), attribution: items[1]?.replace(/^[—–-]\s*/, "") });
  const dated = topItems.filter((l) => DATE_RE.test(l));
  if (topItems.length >= 3 && dated.length / topItems.length >= 0.6) return plan("timeline", "dated events", { timeline: topItems.slice(0, 8).map((l) => datedItem(l)) });
  // two labelled groups → comparison
  const groups: { head: string; items: string[] }[] = [];
  for (const l of lines) {
    const t = l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!/^\s{2,}/.test(l) && PAIR_RE.test(t.replace(/\*\*/g, ""))) groups.push({ head: t.replace(/[:*]/g, "").trim(), items: [] });
    else if (groups.length) groups[groups.length - 1].items.push(`- ${t}`);
  }
  if (groups.length === 2 && groups.every((g) => g.items.length)) return plan("comparison", "two labelled groups", { leftTitle: groups[0].head, left: groups[0].items.join("\n"), rightTitle: groups[1].head, right: groups[1].items.join("\n") });
  if (/\b(vs\.?|versus)\b/i.test(title) && topItems.length >= 2) { const half = Math.ceil(topItems.length / 2); const [l, r] = title.split(/\b(?:vs\.?|versus)\b/i).map((s) => s.trim()); return plan("comparison", "versus title", { leftTitle: l || "A", rightTitle: r || "B", left: topItems.slice(0, half).map((x) => `- ${x}`).join("\n"), right: topItems.slice(half).map((x) => `- ${x}`).join("\n") }); }
  if (!items.length) return plan("section", "heading without content", { subtitle: undefined });
  if (topItems.length > 7) { const half = Math.ceil(topItems.length / 2); return plan("two_column", "more than 7 bullets", { left: topItems.slice(0, half).map((x) => `- ${x}`).join("\n"), right: topItems.slice(half).map((x) => `- ${x}`).join("\n") }); }
  return plan("bullets", "bullets", { body });
}

function datedItem(line: string): TimelineItem {
  const m = DATE_RE.exec(line);
  if (!m) return { date: "", label: line };
  const rest = line.slice(m[0].length).replace(/^[\s*]*[—–:,-]?\s*/, "");
  const [label, ...detail] = rest.split(/\s+[—–]\s+/);
  return { date: m[1], label: label.trim(), detail: detail.join(" — ") || undefined };
}

export function outlineToSlides(outline: string, theme: DeckTheme): { slides: DeckSlide[]; plans: OutlineSlidePlan[] } {
  const plans = splitOutline(outline).map((b, i) => planSlide(b.title, b.lines, i));
  const slides = plans.map((p, i) => buildSlide(p.layout, p.content, theme, { slideNumber: i + 1 }));
  return { slides, plans };
}

// ---------------------------------------------------------------------------
// Documents → outline
// ---------------------------------------------------------------------------

interface TipNode { type?: string; attrs?: Record<string, unknown>; content?: TipNode[]; text?: string; marks?: { type: string }[] }

const firstSentence = (t: string, maxWords = 24) => {
  const s = (t.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t).trim();
  const words = s.split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : s;
};

function tipText(n: TipNode): string { return n.text ?? (n.content ?? []).map(tipText).join(n.type === "paragraph" ? "" : " "); }

/**
 * Word document (TipTap JSON) or markdown → outline markdown. Headings (levels 1–2) start slides; list items become
 * bullets verbatim; paragraphs contribute their first sentence (quoted from the source, never paraphrased).
 */
export function documentOutline(input: { tiptap?: unknown; markdown?: string; title?: string }, opts: { maxBulletsPerSlide?: number } = {}): string {
  const max = opts.maxBulletsPerSlide ?? 5;
  const sections: { title: string; bullets: string[] }[] = [];
  const push = (title: string) => sections.push({ title, bullets: [] });
  const add = (b: string) => { if (!sections.length) push(input.title ?? "Overview"); const cur = sections[sections.length - 1]; if (cur.bullets.length < max && b.trim()) cur.bullets.push(b.trim()); };
  if (input.tiptap && typeof input.tiptap === "object") {
    const walk = (n: TipNode) => {
      if (n.type === "heading" && Number(n.attrs?.level ?? 1) <= 2) { push(tipText(n).trim() || "Section"); return; }
      if (n.type === "listItem") { add(firstSentence(tipText(n).trim(), 20)); return; }
      if (n.type === "paragraph") { const t = tipText(n).trim(); if (t) add(firstSentence(t)); return; }
      if (n.type === "table") return;
      for (const c of n.content ?? []) walk(c);
    };
    walk(input.tiptap as TipNode);
  } else if (input.markdown) {
    for (const line of input.markdown.replace(/\r\n/g, "\n").split("\n")) {
      const h = /^#{1,2}\s+(.*)$/.exec(line);
      if (h) { push(h[1].trim()); continue; }
      if (/^#{3,}\s+/.test(line)) { add(`**${line.replace(/^#+\s+/, "").trim()}**`); continue; }
      const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) { add(firstSentence(li[1], 20)); continue; }
      if (line.trim()) add(firstSentence(line.trim()));
    }
  }
  const title = input.title ?? sections[0]?.title ?? "Presentation";
  const out = [`# ${title}`, sections.length ? `- ${sections.length} sections` : ""];
  for (const s of sections.filter((x) => x.title !== title || x.bullets.length)) { out.push("", `# ${s.title}`); for (const b of s.bullets) out.push(`- ${b}`); }
  return out.filter((l, i) => l || i > 1).join("\n");
}

// ---------------------------------------------------------------------------
// Matter chronology and exhibits
// ---------------------------------------------------------------------------

export interface TimelineEventInput { id: string; date: string; title: string; significance?: number; verified?: boolean; disputed?: boolean; sources: { kind: string; id?: string; bates?: string; cite?: string }[] }

export function eventCite(e: TimelineEventInput): string | undefined {
  const s = e.sources.find((x) => x.bates) ?? e.sources.find((x) => x.cite);
  return s?.bates ?? s?.cite;
}

/** Pick up to `max` events (highest significance, then chronological) and build a timeline slide with cites. */
export function timelineSlide(events: TimelineEventInput[], theme: DeckTheme, opts: { title?: string; max?: number; from?: string; to?: string; slideNumber?: number } = {}): { slide: DeckSlide; used: TimelineEventInput[]; unverified: string[] } {
  const max = Math.max(2, Math.min(8, opts.max ?? 6));
  const inRange = events.filter((e) => (!opts.from || e.date >= opts.from) && (!opts.to || e.date <= opts.to));
  const chosen = [...inRange].sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0) || a.date.localeCompare(b.date)).slice(0, max).sort((a, b) => a.date.localeCompare(b.date));
  const unverified = chosen.filter((e) => !e.verified || !eventCite(e)).map((e) => e.id);
  const items: TimelineItem[] = chosen.map((e) => {
    const cite = eventCite(e);
    return { date: e.date.slice(0, e.date.length >= 10 ? 10 : 7), label: e.title, detail: `${cite ?? "no source"}${!e.verified || !cite ? " [VERIFY]" : ""}${e.disputed ? " (disputed)" : ""}` };
  });
  const title = opts.title ?? "Chronology";
  const slide = buildSlide("timeline", { title, timeline: items, caption: `Sources: matter chronology (${chosen.length} of ${inRange.length} events; highest significance)` }, theme, { slideNumber: opts.slideNumber });
  slide.notes = chosen.map((e) => `${e.date} — ${e.title}: ${e.sources.map((s) => s.bates ?? s.cite ?? s.kind).join("; ") || "no source"}${e.verified ? "" : " [VERIFY]"}`).join("\n");
  return { slide, used: chosen, unverified };
}

export interface ExhibitDoc { id: string; bates: string; batesEnd?: string; date: string; custodianName?: string; type?: string; subject: string; text?: string; aiSummary?: string }

const normWs = (s: string) => s.replace(/[\s ]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();

/** Verify a quote appears verbatim (whitespace/quote-style-insensitive) in the document text. */
export function quoteInDocument(quote: string, text: string | undefined): boolean {
  if (!quote.trim() || !text) return false;
  return normWs(text).includes(normWs(quote.replace(/^["“]|["”]$/g, "")));
}

/** Exhibit callout: title, Bates badge, metadata, verified quote (or labelled summary) and a source caption. */
export function exhibitSlide(doc: ExhibitDoc, theme: DeckTheme, opts: { title?: string; quote?: string; exhibitLabel?: string; slideNumber?: number } = {}): { slide: DeckSlide; quoteVerified: boolean } {
  const range = doc.batesEnd && doc.batesEnd !== doc.bates ? `${doc.bates}–${doc.batesEnd}` : doc.bates;
  const title = opts.title ?? `${opts.exhibitLabel ? `${opts.exhibitLabel}: ` : ""}${doc.subject}`;
  const slide = buildSlide("blank", {}, theme, { slideNumber: opts.slideNumber });
  slide.layout = "blank";
  let z = 0;
  const add = (e: Partial<DeckElement> & { type: DeckElement["type"] }) => { const el = makeElement({ z: z++, ...e }); slide.elements.push(el); return el; };
  slide.elements = [];
  const t = add({ type: "text", role: "title", text: title, x: 72, y: 48, w: 1136, h: 92, style: { fontFamily: "heading", fontSize: 32, bold: true, color: "fg", valign: "middle", padding: 8, lineHeight: 1.1 }, name: "Title" });
  t.style.fontSize = fitFontSize(t, theme, 32, 22);
  add({ type: "shape", shape: "rect", role: "decor", x: 72, y: 172, w: 300, h: 64, text: `**${range}**`, style: { fill: "accent", color: "bg", fontSize: 20, align: "center", valign: "middle", radius: 6 }, name: "Bates badge" });
  const metaLines = [`- **Date:** ${doc.date}`, doc.custodianName ? `- **Custodian:** ${doc.custodianName}` : "", doc.type ? `- **Type:** ${doc.type}` : ""].filter(Boolean).join("\n");
  add({ type: "text", role: "left", text: metaLines, x: 72, y: 260, w: 300, h: 300, style: { fontSize: 16, color: "fg", valign: "top", padding: 8, lineHeight: 1.3 }, name: "Exhibit details" });
  const quoteVerified = Boolean(opts.quote && quoteInDocument(opts.quote, doc.text));
  const quoteText = opts.quote ? `“${opts.quote.replace(/^["“]|["”]$/g, "")}”${quoteVerified ? "" : " [VERIFY — not found in the document text]"}` : doc.aiSummary ? `*Summary (AI, not a quote):* ${doc.aiSummary}` : "";
  if (quoteText) {
    add({ type: "shape", shape: "rect", role: "decor", x: 404, y: 172, w: 6, h: 388, style: { fill: "accent2" }, name: "Quote rule" });
    const q = add({ type: "text", role: "quote", text: quoteText, x: 428, y: 172, w: 780, h: 388, style: { fontFamily: "heading", fontSize: 24, italic: Boolean(opts.quote), color: "fg", valign: "middle", padding: 8, lineHeight: 1.3 }, name: "Exhibit quote" });
    q.style.fontSize = fitFontSize(q, theme, 24, 14);
  }
  add({ type: "text", role: "caption", text: `Source: ${range} · ${doc.subject} · ${doc.date}${doc.custodianName ? ` · ${doc.custodianName}` : ""}`, x: 72, y: 600, w: 1136, h: 36, style: { fontSize: 12, color: "muted", valign: "middle", padding: 4 }, name: "Source reference" });
  slide.notes = `Exhibit ${range} (${doc.subject}, ${doc.date}).${opts.quote ? ` Quote ${quoteVerified ? "verified against the document text" : "NOT found in the document text — verify before presenting"}.` : ""}`;
  return { slide, quoteVerified };
}

// ---------------------------------------------------------------------------
// Consistency and fit
// ---------------------------------------------------------------------------

export interface ConsistencyIssue { kind: "font_size" | "font_family" | "alignment" | "position" | "overflow" | "density" | "out_of_bounds" | "missing_title" | "empty_placeholder"; slide: number; slide_id: string; element_id?: string; detail: string; expected?: string | number; actual?: string | number }

function mode<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined, n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

/** Deterministic deck lint: outliers against the deck's dominant title/body style, overflow, density and bounds. */
export function checkConsistency(deck: DeckContent, opts: { maxBullets?: number; maxWordsPerBullet?: number } = {}): { issues: ConsistencyIssue[]; norms: Record<string, unknown> } {
  const maxBullets = opts.maxBullets ?? 6, maxWords = opts.maxWordsPerBullet ?? 12;
  const issues: ConsistencyIssue[] = [];
  const texts = (role: string) => deck.slides.flatMap((s, i) => s.hidden ? [] : s.elements.filter((e) => e.type === "text" && e.role === role && e.text?.trim()).map((e) => ({ s, i, e })));
  const titles = texts("title").filter((x) => x.s.layout !== "title" && x.s.layout !== "section");
  const bodies = texts("body");
  const norms = {
    titleSize: mode(titles.map((x) => x.e.style.fontSize ?? 18)),
    titleFont: mode(titles.map((x) => x.e.style.fontFamily ?? "body")),
    titleAlign: mode(titles.map((x) => x.e.style.align ?? "left")),
    titleY: mode(titles.map((x) => Math.round(x.e.y / 8) * 8)),
    titleX: mode(titles.map((x) => Math.round(x.e.x / 8) * 8)),
    bodySize: mode(bodies.map((x) => x.e.style.fontSize ?? 18)),
    bodyFont: mode(bodies.map((x) => x.e.style.fontFamily ?? "body")),
  };
  if (titles.length >= 3) for (const { s, i, e } of titles) {
    const size = e.style.fontSize ?? 18;
    if (norms.titleSize && Math.abs(size - norms.titleSize) >= 4) issues.push({ kind: "font_size", slide: i + 1, slide_id: s.id, element_id: e.id, detail: "Title size differs from the deck's other titles", expected: norms.titleSize, actual: size });
    if ((e.style.fontFamily ?? "body") !== norms.titleFont) issues.push({ kind: "font_family", slide: i + 1, slide_id: s.id, element_id: e.id, detail: "Title font differs from the deck's other titles", expected: norms.titleFont, actual: e.style.fontFamily ?? "body" });
    if ((e.style.align ?? "left") !== norms.titleAlign) issues.push({ kind: "alignment", slide: i + 1, slide_id: s.id, element_id: e.id, detail: "Title alignment differs", expected: norms.titleAlign, actual: e.style.align ?? "left" });
    if (norms.titleY !== undefined && Math.abs(e.y - norms.titleY) > 24) issues.push({ kind: "position", slide: i + 1, slide_id: s.id, element_id: e.id, detail: "Title sits at a different height than on other slides", expected: norms.titleY, actual: Math.round(e.y) });
    if (norms.titleX !== undefined && Math.abs(e.x - norms.titleX) > 24) issues.push({ kind: "position", slide: i + 1, slide_id: s.id, element_id: e.id, detail: "Title is horizontally offset from other slides", expected: norms.titleX, actual: Math.round(e.x) });
  }
  if (bodies.length >= 3) for (const { s, i, e } of bodies) {
    const size = e.style.fontSize ?? 18;
    if (norms.bodySize && Math.abs(size - norms.bodySize) >= 4) issues.push({ kind: "font_size", slide: i + 1, slide_id: s.id, element_id: e.id, detail: "Body size differs from the deck's other body text", expected: norms.bodySize, actual: size });
    if ((e.style.fontFamily ?? "body") !== norms.bodyFont) issues.push({ kind: "font_family", slide: i + 1, slide_id: s.id, element_id: e.id, detail: "Body font differs from the deck's other body text", expected: norms.bodyFont, actual: e.style.fontFamily ?? "body" });
  }
  deck.slides.forEach((s, i) => {
    if (s.hidden) return;
    if (s.layout !== "blank" && !slideTitle(s)) issues.push({ kind: "missing_title", slide: i + 1, slide_id: s.id, detail: "Slide has no title" });
    for (const e of s.elements) {
      if (e.x < -2 || e.y < -2 || e.x + e.w > SLIDE_W + 2 || e.y + e.h > SLIDE_H + 2) issues.push({ kind: "out_of_bounds", slide: i + 1, slide_id: s.id, element_id: e.id, detail: `${e.role ?? e.type} extends past the slide edge` });
      if (e.type !== "text" && e.type !== "shape") continue;
      if (!e.text?.trim()) { if (e.type === "text" && e.ooxml?.ph && (e.role === "title" || e.role === "body")) issues.push({ kind: "empty_placeholder", slide: i + 1, slide_id: s.id, element_id: e.id, detail: `Empty ${e.role} placeholder` }); continue; }
      const fit = estimateTextFit(e, deck.theme);
      if (fit.overflow) issues.push({ kind: "overflow", slide: i + 1, slide_id: s.id, element_id: e.id, detail: `Text needs ~${fit.needed} lines; the box fits ${fit.available}`, expected: fit.available, actual: fit.needed });
      if (e.role === "body" || e.role === "left" || e.role === "right") {
        const bl = bulletLines(e.text);
        if (bl.length > maxBullets) issues.push({ kind: "density", slide: i + 1, slide_id: s.id, element_id: e.id, detail: `${bl.length} bullets (limit ${maxBullets})`, expected: maxBullets, actual: bl.length });
        const long = bl.filter((b) => b.split(/\s+/).length > maxWords);
        if (long.length) issues.push({ kind: "density", slide: i + 1, slide_id: s.id, element_id: e.id, detail: `${long.length} bullet(s) over ${maxWords} words`, expected: maxWords, actual: Math.max(...long.map((b) => b.split(/\s+/).length)) });
      }
    }
  });
  return { issues, norms };
}

export interface FitPlan { action: "none" | "grow" | "shrink" | "grow_and_shrink" | "condense"; patch: Partial<DeckElement>; before: { needed: number; available: number }; after: { needed: number; available: number }; minFont: number }

/**
 * Deterministic text fit for one element: first grow the box downward into free space (not past the footer zone or
 * the next element below), then shrink the font to a floor (titles 24 pt, body 14 pt); if it still overflows the
 * text must be condensed (a model rewrite) — never cut.
 */
export function fitTextPlan(slide: DeckSlide, e: DeckElement, theme: DeckTheme, opts: { minFont?: number; allowGrow?: boolean; allowShrink?: boolean } = {}): FitPlan {
  const before = estimateTextFit(e, theme);
  const minFont = opts.minFont ?? (e.role === "title" ? 24 : 14);
  if (!before.overflow) return { action: "none", patch: {}, before, after: before, minFont };
  let cur: DeckElement = { ...e, style: { ...e.style } };
  const patch: Partial<DeckElement> = {};
  let grew = false, shrank = false;
  if (opts.allowGrow !== false && !e.rotation) {
    const below = slide.elements.filter((o) => o.id !== e.id && o.role !== "decor" && o.y >= e.y + e.h - 2 && o.x < e.x + e.w && o.x + o.w > e.x).map((o) => o.y);
    const floor = Math.min(SLIDE_H - 56, ...below) - 8;
    const room = floor - (e.y + e.h);
    if (room > 4) {
      const need = before.neededPx - before.availablePx + 2;
      const add = Math.min(room, Math.max(0, Math.ceil(need)));
      if (add > 0) { cur = { ...cur, h: Math.round(cur.h + add) }; patch.h = cur.h; grew = true; }
    }
  }
  if (estimateTextFit(cur, theme).overflow && opts.allowShrink !== false) {
    const size = fitFontSize(cur, theme, cur.style.fontSize ?? 18, minFont);
    if (size < (cur.style.fontSize ?? 18)) { cur = { ...cur, style: { ...cur.style, fontSize: size } }; patch.style = { ...e.style, fontSize: size }; shrank = true; }
  }
  const after = estimateTextFit(cur, theme);
  const action: FitPlan["action"] = after.overflow ? "condense" : grew && shrank ? "grow_and_shrink" : grew ? "grow" : "shrink";
  return { action, patch, before, after, minFont };
}

export function linesOf(text: string | undefined): number { return parseMarkdownLite(text).length; }
export { plainText };
