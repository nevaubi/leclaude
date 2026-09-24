/**
 * Agent snapshot for the slides editor: the deck plus selection, comments and
 * matter context. Built on the client when a message is sent; the server
 * tools mutate `snapshot.deck` as they propose edits so later reads see the
 * new state.
 */
import type { OfficeScope } from "@/modules/office/shared/types";
import { deckStats, estimateTextFit, normalizeDeck, plainText, slideBodyText, slideTitle, type DeckContent, type DeckElement, type DeckSlide } from "./model";

export interface SlidesSnapshot {
  title: string;
  deck: DeckContent;
  selection?: { slideId: string | null; elementIds: string[] } | null;
  comments?: { id: string; anchor: string; body: string; author: string; resolved?: boolean }[];
  matterId?: string | null;
  templateId?: string | null;
}

export function buildSnapshot(deck: DeckContent, opts: { title: string; selection?: SlidesSnapshot["selection"]; comments?: SlidesSnapshot["comments"]; matterId?: string | null; templateId?: string | null }): SlidesSnapshot {
  return { title: opts.title, deck, selection: opts.selection ?? null, comments: opts.comments, matterId: opts.matterId ?? null, templateId: opts.templateId ?? null };
}

export function parseSnapshot(raw: unknown): SlidesSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("snapshot must be an object");
  const s = raw as Partial<SlidesSnapshot>;
  if (!s.deck || typeof s.deck !== "object") throw new Error("snapshot.deck is required");
  const deck = normalizeDeck(s.deck);
  return { title: String(s.title ?? "Untitled deck"), deck, selection: s.selection ?? null, comments: Array.isArray(s.comments) ? s.comments : undefined, matterId: s.matterId ?? null, templateId: s.templateId ?? null };
}

export function elementLabel(e: DeckElement): string {
  const pos = `(${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.w)}×${Math.round(e.h)})`;
  switch (e.type) {
    case "text": return `${e.id} text${e.role ? ` role=${e.role}` : ""} ${pos} ${e.style.fontSize ?? 18}pt: "${truncate(plainText(e.text).replace(/\n/g, " ⏎ "), 320)}"`;
    case "image": return `${e.id} image${e.role ? ` role=${e.role}` : ""} ${pos} src=${e.src ? truncate(e.src, 60) : "(none)"}${e.alt ? ` alt="${truncate(e.alt, 60)}"` : ""}`;
    case "shape": return `${e.id} shape:${e.shape ?? "rect"}${e.role ? ` role=${e.role}` : ""} ${pos}`;
    case "line": return `${e.id} line ${pos}`;
    case "table": return `${e.id} table ${pos} ${e.table?.header.length ?? 0} cols × ${e.table?.rows.length ?? 0} rows; header: ${e.table?.header.join(" | ")}`;
    case "chart": return `${e.id} chart:${e.chart?.type ?? "bar"} ${pos} categories=${e.chart?.categories.join(", ")}; series=${e.chart?.series.map((s) => s.name).join(", ")}`;
    default: return `${e.id} ${e.type} ${pos}`;
  }
}

/** One-line-per-slide outline, with element ids so the agent can target them. */
export function renderSlide(deck: DeckContent, slide: DeckSlide, index: number, opts: { elements?: boolean; notes?: boolean } = {}): string {
  const title = slideTitle(slide) || "(untitled)";
  const body = slideBodyText(slide);
  const head = `Slide ${index + 1} [${slide.id}] layout=${slide.layout}${slide.hidden ? " HIDDEN" : ""} — Title: ${truncate(title, 120)}`;
  const lines = [head];
  if (body) lines.push(`  Body: ${truncate(body.replace(/\n/g, " ⏎ "), 600)}`);
  if (opts.elements !== false) for (const e of [...slide.elements].sort((a, b) => a.z - b.z)) {
    if (e.role === "decor" || e.role === "footer" || e.role === "logo") continue;
    lines.push(`  · ${elementLabel(e)}`);
    if (e.type === "text" && e.text?.trim()) { const fit = estimateTextFit(e, deck.theme); if (fit.overflow) lines.push(`    ⚠ overflow: needs ~${fit.needed} lines, box fits ${fit.available}`); }
  }
  if (opts.notes !== false && slide.notes.trim()) lines.push(`  Notes: ${truncate(slide.notes.replace(/\n/g, " "), 400)}`);
  return lines.join("\n");
}

export function renderSnapshot(s: SlidesSnapshot, scope: OfficeScope | null): string {
  const d = s.deck;
  const stats = deckStats(d);
  const head = [
    `DECK "${s.title}" — ${stats.slides} slides (${stats.hidden} hidden), ${stats.words} words, ${stats.notes} slides with notes, ${stats.images} images, ${stats.charts} charts, ${stats.tables} tables.`,
    `Theme: ${d.theme.name} [${d.theme.id}] fonts=${d.theme.fonts.heading}/${d.theme.fonts.body} colors bg=${d.theme.colors.bg} fg=${d.theme.colors.fg} accent=${d.theme.colors.accent} accent2=${d.theme.colors.accent2} muted=${d.theme.colors.muted}.`,
    s.selection?.slideId ? `Selection: slide ${d.slides.findIndex((x) => x.id === s.selection?.slideId) + 1} [${s.selection.slideId}]${s.selection.elementIds.length ? `, elements ${s.selection.elementIds.join(", ")}` : ""}.` : "Selection: none.",
  ];
  const scoped = scope?.kind === "slide" && scope.ref ? d.slides.filter((x) => x.id === scope.ref) : d.slides;
  const full = scoped.length <= 40;
  const body = d.slides.map((slide, i) => (scoped.includes(slide) ? renderSlide(d, slide, i, { elements: full, notes: full }) : `Slide ${i + 1} [${slide.id}] layout=${slide.layout} — Title: ${truncate(slideTitle(slide) || "(untitled)", 80)}`));
  let text = [...head, "", ...body].join("\n");
  if (text.length > 30_000) text = text.slice(0, 30_000) + "\n…[snapshot truncated; use get_slide for details]";
  if (s.comments?.length) text += `\n\nCOMMENTS (${s.comments.length}): ` + s.comments.slice(0, 20).map((c) => `[${c.id}] ${c.anchor} ${c.author}: ${truncate(c.body, 160)}${c.resolved ? " (resolved)" : ""}`).join("; ");
  return text;
}

function truncate(t: string, n: number) { return t.length > n ? `${t.slice(0, n)}…` : t; }
