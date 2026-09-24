/**
 * PPTX export with pptxgenjs: every element type (text with markdown-lite
 * runs and bullets, shapes, lines, images, tables, native charts), speaker
 * notes, hidden slides, theme fonts/colors, on a 13.333"×7.5" (16:9) page that
 * maps 1:1 to the 1280×720 px canvas at 96 dpi (1 pt font = 1 pt).
 */
import PptxGenJS from "pptxgenjs";
import { hexForExport, parseMarkdownLite, plainText, resolveFontFace, type ChartSpec, type DeckContent, type DeckElement, type DeckSlide, type DeckTheme } from "./model";

export interface ExportOptions {
  title: string;
  author?: string;
  /** Resolve an image src to a data URL ("data:image/png;base64,…"). */
  fetchImage?: (src: string) => Promise<string | null>;
  includeHidden?: boolean;
  includeNotes?: boolean;
}

export const PAGE_W_IN = 13.333;
export const PAGE_H_IN = 7.5;
export const PX_PER_IN = 96;
export const inch = (px: number) => Math.round((px / PX_PER_IN) * 1000) / 1000;

type TextProps = PptxGenJS.TextProps;
type TextOpts = PptxGenJS.TextPropsOptions;

function textRuns(text: string | undefined, theme: DeckTheme, base: { color: string; bold?: boolean; italic?: boolean; underline?: boolean }): TextProps[] {
  const lines = parseMarkdownLite(text);
  const out: TextProps[] = [];
  lines.forEach((line, li) => {
    const runs = line.runs.length ? line.runs : [{ text: "" }];
    runs.forEach((r, ri) => {
      const options: TextOpts = { bold: base.bold || r.bold || undefined, italic: base.italic || r.italic || undefined, underline: base.underline || r.underline ? { style: "sng" } : undefined, color: base.color };
      if (ri === 0) {
        if (line.kind === "bullet") options.bullet = { indent: 18 };
        else if (line.kind === "number") options.bullet = { type: "number", indent: 22 };
        if (line.indent) options.indentLevel = line.indent;
      }
      if (ri === runs.length - 1 && li < lines.length - 1) options.breakLine = true;
      out.push({ text: r.text, options });
    });
  });
  void theme;
  return out.length ? out : [{ text: "" }];
}

function chartColors(theme: DeckTheme): string[] {
  return [theme.colors.accent, theme.colors.accent2, theme.colors.muted, "#5B8DEF", "#9BB0C9", "#C97B7B", "#7BC9A4"].map((c) => hexForExport(c, theme, "888888"));
}

async function addElement(pptx: PptxGenJS, slide: PptxGenJS.Slide, e: DeckElement, theme: DeckTheme, opts: ExportOptions) {
  const pos = { x: inch(e.x), y: inch(e.y), w: inch(Math.max(4, e.w)), h: inch(Math.max(4, e.h)) };
  const st = e.style;
  const opacity = st.opacity ?? 1;
  const transparency = opacity < 1 ? Math.round((1 - opacity) * 100) : undefined;
  const fontFace = resolveFontFace(st.fontFamily, theme);
  const color = hexForExport(st.color, theme, hexForExport("fg", theme));
  switch (e.type) {
    case "text": {
      const fillHex = st.fill ? hexForExport(st.fill, theme, "") : "";
      const options: TextOpts = {
        ...pos, fontFace, fontSize: st.fontSize ?? 18, color, align: st.align ?? "left", valign: st.valign ?? "top", margin: (st.padding ?? 8) * 0.75, rotate: e.rotation || undefined,
        lineSpacingMultiple: st.lineHeight ?? 1.2, paraSpaceAfter: 2, wrap: true, charSpacing: st.letterSpacing ? st.letterSpacing * 0.75 : undefined, transparency,
        fill: fillHex ? { color: fillHex } : undefined, line: st.stroke ? { color: hexForExport(st.stroke, theme, "999999"), width: st.strokeWidth ?? 1 } : undefined, rectRadius: st.radius && fillHex ? inch(Math.min(st.radius, Math.min(e.w, e.h) / 2)) : undefined, shape: st.radius && fillHex ? pptx.ShapeType.roundRect : undefined,
      };
      slide.addText(textRuns(e.text, theme, { color, bold: st.bold, italic: st.italic, underline: st.underline }), options);
      return;
    }
    case "shape": {
      const fill = st.fill ? { color: hexForExport(st.fill, theme, "CCCCCC"), transparency } : { type: "none" as const };
      const line = st.stroke ? { color: hexForExport(st.stroke, theme, "999999"), width: st.strokeWidth ?? 1 } : { type: "none" as const };
      const shapeName = e.shape === "ellipse" ? pptx.ShapeType.ellipse : e.shape === "arrow" ? pptx.ShapeType.rightArrow : st.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
      const common = { ...pos, fill, line, rotate: e.rotation || undefined, rectRadius: st.radius && e.shape === "rect" ? inch(Math.min(st.radius, Math.min(e.w, e.h) / 2)) : undefined };
      if (e.text?.trim()) slide.addText(textRuns(e.text, theme, { color, bold: st.bold, italic: st.italic }), { ...common, shape: shapeName, fontFace, fontSize: st.fontSize ?? 16, align: st.align ?? "center", valign: st.valign ?? "middle", margin: (st.padding ?? 6) * 0.75 });
      else slide.addShape(shapeName, common);
      return;
    }
    case "line": {
      const h = Math.max(0, e.h);
      slide.addShape(pptx.ShapeType.line, { x: inch(e.x), y: inch(e.y), w: inch(Math.max(1, e.w)), h: inch(h), line: { color: hexForExport(st.stroke ?? "muted", theme, "999999"), width: st.strokeWidth ?? 2, endArrowType: st.arrowEnd ? "triangle" : undefined, transparency }, flipV: st.lineDir === "up" && h > 0 ? true : undefined, rotate: e.rotation || undefined });
      return;
    }
    case "image": {
      if (!e.src) return;
      const data = opts.fetchImage ? await opts.fetchImage(e.src) : null;
      if (!data) {
        slide.addShape(pptx.ShapeType.rect, { ...pos, fill: { color: hexForExport("surface", theme, "EEEEEE") }, line: { color: hexForExport("muted", theme, "999999"), width: 0.75, dashType: "dash" } });
        slide.addText(`[image unavailable: ${e.alt ?? e.src}]`, { ...pos, fontSize: 10, color: hexForExport("muted", theme), align: "center", valign: "middle" });
        return;
      }
      const fit = st.fit ?? "contain";
      slide.addImage({ data, ...pos, rotate: e.rotation || undefined, altText: e.alt, transparency, sizing: fit === "fill" ? undefined : { type: fit, w: pos.w, h: pos.h }, rounding: false });
      return;
    }
    case "table": {
      if (!e.table) return;
      const t = e.table;
      const cols = Math.max(1, t.header.length);
      const fractions = t.colWidths && t.colWidths.length === cols ? t.colWidths : Array.from({ length: cols }, () => 1 / cols);
      const total = fractions.reduce((a, b) => a + b, 0) || 1;
      const colW = fractions.map((f) => Math.round((pos.w * f) / total * 1000) / 1000);
      const fontSize = st.fontSize ?? 14;
      const border: PptxGenJS.BorderProps = { type: "solid", pt: 0.75, color: hexForExport(st.stroke ?? "muted", theme, "AAAAAA") };
      const headerFill = hexForExport(st.headerFill ?? "accent", theme);
      const headerColor = hexForExport(st.headerColor ?? "bg", theme);
      const bandFill = hexForExport("surface", theme, "F3F4F6");
      const rows: PptxGenJS.TableRow[] = [
        t.header.map((h) => ({ text: h, options: { bold: true, color: headerColor, fill: { color: headerFill }, fontSize, fontFace, border, valign: "middle" as const, margin: 4 } })),
        ...t.rows.map((r, ri) => Array.from({ length: cols }, (_, ci) => ({ text: r[ci] ?? "", options: { color, fontSize, fontFace, border, fill: st.banded !== false && ri % 2 === 1 ? { color: bandFill } : undefined, valign: "top" as const, margin: 4 } }))),
      ];
      const rowH = Math.min(pos.h / rows.length, inch(44));
      slide.addTable(rows, { x: pos.x, y: pos.y, w: pos.w, colW, rowH, fontFace, fontSize, autoPage: false });
      return;
    }
    case "chart": {
      if (!e.chart) return;
      addChart(pptx, slide, e.chart, pos, theme, fontFace, st);
      return;
    }
  }
}

function addChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, chart: ChartSpec, pos: { x: number; y: number; w: number; h: number }, theme: DeckTheme, fontFace: string, st: DeckElement["style"]) {
  const fg = hexForExport("fg", theme);
  const muted = hexForExport("muted", theme, "888888");
  const type = chart.type === "pie" ? pptx.ChartType.pie : chart.type === "line" ? pptx.ChartType.line : pptx.ChartType.bar;
  const data = (chart.type === "pie" ? chart.series.slice(0, 1) : chart.series).map((s) => ({ name: s.name, labels: chart.categories, values: chart.categories.map((_, i) => Number(s.values[i]) || 0) }));
  const surface = st.fill ? hexForExport(st.fill, theme, "") : "";
  const options: PptxGenJS.IChartOpts = {
    ...pos,
    chartColors: chart.type === "pie" ? chartColors(theme) : chartColors(theme).slice(0, Math.max(1, data.length)),
    showLegend: chart.showLegend ?? (data.length > 1 || chart.type === "pie"), legendPos: "b", legendColor: muted, legendFontFace: fontFace, legendFontSize: 10,
    showTitle: Boolean(chart.title), title: chart.title, titleColor: fg, titleFontFace: fontFace, titleFontSize: 14,
    catAxisLabelColor: muted, catAxisLabelFontFace: fontFace, catAxisLabelFontSize: 10, valAxisLabelColor: muted, valAxisLabelFontFace: fontFace, valAxisLabelFontSize: 10,
    valGridLine: { color: hexForExport("surface", theme, "EEEEEE"), style: "solid", size: 0.5 }, catGridLine: { style: "none" },
    showValue: chart.showValues ?? false, dataLabelColor: chart.type === "pie" ? hexForExport("bg", theme) : muted, dataLabelFontFace: fontFace, dataLabelFontSize: 10, dataLabelFormatCode: chart.unit === "$" ? "$#,##0" : chart.unit === "%" ? "0.0\"%\"" : "#,##0.##",
    showPercent: chart.type === "pie" ? Boolean(chart.showValues ?? true) : undefined,
    barDir: "col", barGapWidthPct: 60, lineDataSymbol: "circle", lineDataSymbolSize: 6, lineSize: 2,
    chartArea: surface ? { fill: { color: surface }, roundedCorners: true } : undefined, plotArea: { fill: { color: surface || hexForExport("bg", theme, "FFFFFF") } },
  };
  slide.addChart(type, data, options);
}

export async function exportPptx(deck: DeckContent, opts: ExportOptions): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LECLAUDE_WIDE", width: PAGE_W_IN, height: PAGE_H_IN });
  pptx.layout = "LECLAUDE_WIDE";
  pptx.title = opts.title;
  pptx.author = opts.author ?? "Seeger Weiss LLP";
  pptx.company = "Seeger Weiss LLP";
  pptx.theme = { headFontFace: deck.theme.fonts.heading, bodyFontFace: deck.theme.fonts.body };
  const theme = deck.theme;
  for (const s of deck.slides) {
    if (s.hidden && opts.includeHidden === false) continue;
    const slide = pptx.addSlide();
    const bgColor = hexForExport(s.background?.color ?? "bg", theme, "FFFFFF");
    if (s.background?.imageUrl && opts.fetchImage) {
      const data = await opts.fetchImage(s.background.imageUrl);
      slide.background = data ? { data } : { color: bgColor };
    } else slide.background = { color: bgColor };
    if (s.hidden) slide.hidden = true;
    for (const e of [...s.elements].sort((a, b) => a.z - b.z)) {
      try { await addElement(pptx, slide, e, theme, opts); } catch (err) { console.warn("[slides export] element skipped", e.id, (err as Error).message); }
    }
    if (opts.includeNotes !== false && s.notes.trim()) slide.addNotes(s.notes);
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof Uint8Array) return Buffer.from(out);
  if (out instanceof ArrayBuffer) return Buffer.from(new Uint8Array(out));
  if (typeof out === "string") return Buffer.from(out, "base64");
  return Buffer.from(await (out as Blob).arrayBuffer());
}

/** Plain-text export (outline with notes), handy for a quick share. */
export function exportOutlineText(deck: DeckContent, title: string): string {
  const lines: string[] = [title, "=".repeat(Math.min(60, title.length)), ""];
  deck.slides.forEach((s: DeckSlide, i) => {
    const texts = [...s.elements].filter((e) => e.type === "text" && e.text?.trim() && e.role !== "footer" && e.role !== "logo" && e.role !== "decor").sort((a, b) => a.y - b.y);
    lines.push(`Slide ${i + 1}${s.hidden ? " (hidden)" : ""}`);
    for (const t of texts) lines.push(plainText(t.text));
    for (const e of s.elements) if (e.type === "table" && e.table) { lines.push(e.table.header.join(" | ")); for (const r of e.table.rows) lines.push(r.join(" | ")); }
    if (s.notes.trim()) lines.push(`Notes: ${s.notes.trim()}`);
    lines.push("");
  });
  return lines.join("\n");
}
