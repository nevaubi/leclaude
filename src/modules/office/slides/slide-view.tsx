"use client";
/**
 * Pure slide renderer (inline styles only, so the same markup serves the
 * editor canvas, thumbnails, presenter mode, print-to-PDF and PNG capture).
 */
import * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { PT_TO_PX, SLIDE_H, SLIDE_W, fontStack, isDark, parseMarkdownLite, resolveColor, resolveFontFace, type ChartSpec, type DeckElement, type DeckSlide, type DeckTheme, type TextLine } from "./model";

export interface SlideViewProps {
  slide: DeckSlide;
  theme: DeckTheme;
  /** Element rendered invisibly (an in-place editor is drawn over it). */
  hideElementId?: string | null;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Skip charts (fast thumbnails while dragging). */
  lite?: boolean;
}

export const SlideView = React.memo(function SlideView({ slide, theme, hideElementId, id, className, style, lite }: SlideViewProps) {
  const bg = resolveColor(slide.background?.color, theme, theme.colors.bg);
  return (
    <div id={id} data-slide-id={slide.id} className={className} style={{ position: "relative", width: SLIDE_W, height: SLIDE_H, background: bg, overflow: "hidden", fontFamily: fontStack(theme.fonts.body), color: theme.colors.fg, ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {slide.background?.imageUrl && <img src={slide.background.imageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />}
      {[...slide.elements].sort((a, b) => a.z - b.z).map((e) => (
        <ElementView key={e.id} element={e} theme={theme} hidden={e.id === hideElementId} lite={lite} />
      ))}
    </div>
  );
});

export function elementBoxStyle(e: DeckElement, theme: DeckTheme, extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    position: "absolute",
    left: e.x,
    top: e.y,
    width: e.w,
    height: e.type === "line" ? Math.max(1, e.h) : e.h,
    transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
    transformOrigin: "center center",
    opacity: e.style.opacity ?? 1,
    boxSizing: "border-box",
    color: resolveColor(e.style.color, theme, theme.colors.fg),
    ...extra,
  };
}

export const ElementView = React.memo(function ElementView({ element: e, theme, hidden, lite }: { element: DeckElement; theme: DeckTheme; hidden?: boolean; lite?: boolean }) {
  const base = elementBoxStyle(e, theme, hidden ? { visibility: "hidden" } : {});
  switch (e.type) {
    case "text": return <div data-el-id={e.id} style={{ ...base, ...textBoxStyle(e, theme) }}><TextBlock element={e} theme={theme} /></div>;
    case "shape": return <ShapeView e={e} theme={theme} base={base} />;
    case "line": return <LineView e={e} theme={theme} base={base} />;
    case "image": return <ImageView e={e} theme={theme} base={base} />;
    case "table": return <div data-el-id={e.id} style={{ ...base, overflow: "hidden" }}><TableView e={e} theme={theme} /></div>;
    case "chart": return <div data-el-id={e.id} style={{ ...base, background: resolveColor(e.style.fill, theme, "transparent"), borderRadius: e.style.radius ?? 0, padding: e.style.padding ?? 12, overflow: "hidden" }}>{lite ? <ChartLite e={e} theme={theme} /> : <ChartView e={e} theme={theme} />}</div>;
    default: return null;
  }
});

export function textBoxStyle(e: DeckElement, theme: DeckTheme): React.CSSProperties {
  const st = e.style;
  const fill = resolveColor(st.fill, theme, "transparent");
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: st.valign === "middle" ? "center" : st.valign === "bottom" ? "flex-end" : "flex-start",
    padding: st.padding ?? 8,
    background: fill,
    border: st.stroke ? `${st.strokeWidth ?? 1}px solid ${resolveColor(st.stroke, theme, "#999")}` : undefined,
    borderRadius: st.radius ?? 0,
    fontFamily: fontStack(resolveFontFace(st.fontFamily, theme)),
    fontSize: (st.fontSize ?? 18) * PT_TO_PX,
    fontWeight: st.bold ? 700 : 400,
    fontStyle: st.italic ? "italic" : "normal",
    textDecoration: st.underline ? "underline" : undefined,
    lineHeight: st.lineHeight ?? 1.25,
    letterSpacing: st.letterSpacing ? `${st.letterSpacing}px` : undefined,
    textAlign: st.align ?? "left",
    color: resolveColor(st.color, theme, theme.colors.fg),
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "visible",
  };
}

/** Numbered lines restart per contiguous run at the same indent. */
export function numberLines(lines: TextLine[]): (number | null)[] {
  const counters: number[] = [];
  let prevKind: TextLine["kind"] | null = null;
  return lines.map((l) => {
    if (l.kind !== "number") { if (prevKind === "number") counters.length = 0; prevKind = l.kind; return null; }
    counters.length = l.indent + 1;
    counters[l.indent] = (counters[l.indent] ?? 0) + 1;
    prevKind = "number";
    return counters[l.indent];
  });
}

export function TextBlock({ element: e, theme }: { element: DeckElement; theme: DeckTheme }) {
  const lines = React.useMemo(() => parseMarkdownLite(e.text), [e.text]);
  const numbers = React.useMemo(() => numberLines(lines), [lines]);
  const accent = resolveColor("accent", theme, theme.colors.accent);
  return (
    <div style={{ width: "100%" }}>
      {lines.map((l, i) => {
        const marker = l.kind === "bullet" ? (l.indent % 2 === 0 ? "•" : "–") : l.kind === "number" ? `${numbers[i]}.` : null;
        return (
          <div key={i} style={{ display: "flex", paddingLeft: l.indent * 28, minHeight: "1em", justifyContent: e.style.align === "center" ? "center" : e.style.align === "right" ? "flex-end" : "flex-start" }}>
            {marker && <span style={{ flex: "none", width: l.kind === "number" ? "1.6em" : "1.1em", color: l.kind === "bullet" ? accent : undefined, textAlign: "left" }}>{marker}</span>}
            <span style={{ minWidth: 0 }}>{l.runs.map((r, j) => (r.bold || r.italic || r.underline ? <span key={j} style={{ fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? "italic" : undefined, textDecoration: r.underline ? "underline" : undefined }}>{r.text}</span> : <React.Fragment key={j}>{r.text}</React.Fragment>))}{l.runs.every((r) => !r.text) ? " " : null}</span>
          </div>
        );
      })}
    </div>
  );
}

function ShapeView({ e, theme, base }: { e: DeckElement; theme: DeckTheme; base: React.CSSProperties }) {
  const st = e.style;
  const fill = resolveColor(st.fill, theme, "transparent");
  const stroke = st.stroke ? resolveColor(st.stroke, theme, "#999") : undefined;
  const sw = st.strokeWidth ?? (stroke ? 1 : 0);
  const textStyle: React.CSSProperties = { ...textBoxStyle({ ...e, style: { ...st, fill: undefined, stroke: undefined } }, theme), position: "absolute", inset: 0, justifyContent: st.valign === "top" ? "flex-start" : st.valign === "bottom" ? "flex-end" : "center", textAlign: st.align ?? "center", color: resolveColor(st.color, theme, isDark(fill) ? "#FFFFFF" : theme.colors.fg) };
  if (e.shape === "arrow") {
    const w = Math.max(1, e.w), h = Math.max(1, e.h);
    const headW = Math.min(w * 0.35, h * 0.9);
    const shaft = h * 0.3;
    const points = `0,${shaft} ${w - headW},${shaft} ${w - headW},0 ${w},${h / 2} ${w - headW},${h} ${w - headW},${h - shaft} 0,${h - shaft}`;
    return (
      <div data-el-id={e.id} style={base}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}><polygon points={points} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" /></svg>
        {e.text?.trim() && <div style={{ ...textStyle, paddingRight: headW }}><TextBlock element={e} theme={theme} /></div>}
      </div>
    );
  }
  return (
    <div data-el-id={e.id} style={{ ...base, background: fill, border: stroke ? `${sw}px solid ${stroke}` : undefined, borderRadius: e.shape === "ellipse" ? "50%" : st.radius ?? 0 }}>
      {e.text?.trim() && <div style={textStyle}><TextBlock element={e} theme={theme} /></div>}
    </div>
  );
}

function LineView({ e, theme, base }: { e: DeckElement; theme: DeckTheme; base: React.CSSProperties }) {
  const st = e.style;
  const stroke = resolveColor(st.stroke ?? "muted", theme, "#999");
  const sw = st.strokeWidth ?? 2;
  const w = Math.max(1, e.w), h = Math.max(0, e.h);
  const up = st.lineDir === "up";
  const x1 = 0, y1 = up ? h : 0, x2 = w, y2 = up ? 0 : h;
  const mid = `m${e.id}`;
  return (
    <div data-el-id={e.id} style={{ ...base, height: Math.max(1, h) }}>
      <svg width={w} height={Math.max(1, h)} viewBox={`0 0 ${w} ${Math.max(1, h)}`} style={{ display: "block", overflow: "visible" }}>
        {st.arrowEnd && <defs><marker id={mid} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 z" fill={stroke} /></marker></defs>}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} strokeLinecap="round" markerEnd={st.arrowEnd ? `url(#${mid})` : undefined} />
      </svg>
    </div>
  );
}

function ImageView({ e, theme, base }: { e: DeckElement; theme: DeckTheme; base: React.CSSProperties }) {
  const st = e.style;
  const radius = st.radius ?? 0;
  if (!e.src) {
    return <div data-el-id={e.id} style={{ ...base, borderRadius: radius, border: `2px dashed ${resolveColor("muted", theme, "#999")}`, background: resolveColor(st.fill ?? "surface", theme, "#F3F4F6"), display: "flex", alignItems: "center", justifyContent: "center", color: resolveColor("muted", theme, "#666"), fontSize: 16 }}>{e.alt || "Image placeholder"}</div>;
  }
  return (
    <div data-el-id={e.id} style={{ ...base, borderRadius: radius, overflow: "hidden", background: resolveColor(st.fill, theme, "transparent"), border: st.stroke ? `${st.strokeWidth ?? 1}px solid ${resolveColor(st.stroke, theme, "#999")}` : undefined }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={e.src} alt={e.alt ?? ""} draggable={false} style={{ width: "100%", height: "100%", objectFit: st.fit ?? "contain", display: "block" }} />
    </div>
  );
}

function TableView({ e, theme }: { e: DeckElement; theme: DeckTheme }) {
  const t = e.table;
  if (!t) return null;
  const st = e.style;
  const fontSize = (st.fontSize ?? 14) * PT_TO_PX;
  const border = `1px solid color-mix(in srgb, ${resolveColor(st.stroke ?? "muted", theme, "#999")} 35%, transparent)`;
  const headerFill = resolveColor(st.headerFill ?? "accent", theme, theme.colors.accent);
  const headerColor = resolveColor(st.headerColor ?? "bg", theme, theme.colors.bg);
  const band = `color-mix(in srgb, ${resolveColor("surface", theme, "#F3F4F6")} 70%, transparent)`;
  const cols = Math.max(1, t.header.length);
  const widths = t.colWidths && t.colWidths.length === cols ? t.colWidths : Array.from({ length: cols }, () => 1 / cols);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontFamily: fontStack(resolveFontFace(st.fontFamily, theme)), fontSize, color: resolveColor(st.color, theme, theme.colors.fg), lineHeight: 1.25 }}>
      <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${(w / total) * 100}%` }} />)}</colgroup>
      <thead><tr>{t.header.map((h, i) => <th key={i} style={{ background: headerFill, color: headerColor, fontWeight: 700, textAlign: "left", padding: "8px 10px", border, verticalAlign: "middle" }}>{h}</th>)}</tr></thead>
      <tbody>
        {t.rows.map((r, ri) => (
          <tr key={ri} style={{ background: st.banded !== false && ri % 2 === 1 ? band : undefined }}>
            {Array.from({ length: cols }, (_, ci) => <td key={ci} style={{ padding: "7px 10px", border, verticalAlign: "top", overflowWrap: "anywhere" }}>{r[ci] ?? ""}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function chartPalette(theme: DeckTheme): string[] {
  return [theme.colors.accent, theme.colors.accent2, theme.colors.muted, "#5B8DEF", "#9BB0C9", "#C97B7B", "#7BC9A4", "#D9A66B"];
}

function chartData(c: ChartSpec) {
  return c.categories.map((name, i) => { const row: Record<string, string | number> = { name }; for (const s of c.series) row[s.name || "Series"] = Number(s.values[i]) || 0; return row; });
}

function formatValue(v: number, unit?: string) {
  const n = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit === "$" ? `$${n}` : unit === "%" ? `${n}%` : unit ? `${n} ${unit}` : n;
}

function ChartView({ e, theme }: { e: DeckElement; theme: DeckTheme }) {
  const c = e.chart;
  if (!c) return null;
  const pad = e.style.padding ?? 12;
  const titleH = c.title ? 30 : 0;
  const w = Math.max(60, e.w - pad * 2), h = Math.max(60, e.h - pad * 2 - titleH);
  const colors = chartPalette(theme);
  const fg = theme.colors.fg, muted = theme.colors.muted, grid = `color-mix(in srgb, ${muted} 30%, transparent)`;
  const font = fontStack(theme.fonts.body);
  const data = chartData(c);
  const legend = c.showLegend ?? (c.series.length > 1 || c.type === "pie");
  const tick = { fill: muted, fontSize: 12, fontFamily: font };
  const label = c.showValues ? { fill: muted, fontSize: 11, fontFamily: font } : undefined;
  const fmt = (v: unknown) => formatValue(Number(v), c.unit);
  const tooltipStyle = { contentStyle: { background: theme.colors.bg, border: `1px solid ${grid}`, borderRadius: 6, fontFamily: font, fontSize: 12, color: fg }, itemStyle: { color: fg }, labelStyle: { color: muted } };
  return (
    <div style={{ width: "100%", height: "100%", fontFamily: font }}>
      {c.title && <div style={{ height: titleH, fontSize: 18, fontWeight: 600, color: fg, fontFamily: fontStack(theme.fonts.heading), lineHeight: "30px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</div>}
      {c.type === "pie" ? (
        <PieChart width={w} height={h} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie data={c.categories.map((name, i) => ({ name, value: Number(c.series[0]?.values[i]) || 0 }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={Math.min(w, h) / 2 - (legend ? 36 : 12)} innerRadius={Math.min(w, h) / 7} paddingAngle={2} isAnimationActive={false} stroke={theme.colors.bg} label={c.showValues !== false ? ({ percent }) => `${Math.round((percent ?? 0) * 100)}%` : undefined} labelLine={false} fontSize={12} fontFamily={font}>
            {c.categories.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          {legend && <Legend wrapperStyle={{ fontSize: 12, color: muted }} />}
          <Tooltip formatter={fmt} {...tooltipStyle} />
        </PieChart>
      ) : c.type === "line" ? (
        <LineChart width={w} height={h} data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={tick} axisLine={{ stroke: grid }} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => formatValue(Number(v), c.unit)} />
          <Tooltip formatter={fmt} {...tooltipStyle} />
          {legend && <Legend wrapperStyle={{ fontSize: 12, color: muted }} />}
          {c.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name || "Series"} stroke={colors[i % colors.length]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 0, fill: colors[i % colors.length] }} isAnimationActive={false}>{label && <LabelList dataKey={s.name || "Series"} position="top" formatter={fmt} style={label} />}</Line>)}
        </LineChart>
      ) : (
        <BarChart width={w} height={h} data={data} margin={{ top: 16, right: 16, bottom: 4, left: 4 }} barCategoryGap="25%">
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={tick} axisLine={{ stroke: grid }} tickLine={false} interval={0} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => formatValue(Number(v), c.unit)} />
          <Tooltip formatter={fmt} cursor={{ fill: grid }} {...tooltipStyle} />
          {legend && <Legend wrapperStyle={{ fontSize: 12, color: muted }} />}
          {c.series.map((s, i) => <Bar key={s.name} dataKey={s.name || "Series"} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} isAnimationActive={false}>{label && <LabelList dataKey={s.name || "Series"} position="top" formatter={fmt} style={label} />}</Bar>)}
        </BarChart>
      )}
    </div>
  );
}

/** Tiny SVG stand-in for thumbnails while dragging. */
function ChartLite({ e, theme }: { e: DeckElement; theme: DeckTheme }) {
  const c = e.chart;
  if (!c) return null;
  const colors = chartPalette(theme);
  const values = c.series[0]?.values ?? [];
  const max = Math.max(1, ...values);
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none">
      {values.map((v, i) => { const bw = 100 / Math.max(1, values.length); const bh = (v / max) * 50; return <rect key={i} x={i * bw + bw * 0.2} y={55 - bh} width={bw * 0.6} height={bh} fill={colors[c.type === "pie" ? i % colors.length : 0]} />; })}
    </svg>
  );
}

/** A slide scaled to a given width (thumbnails, presenter, versions). */
export function ScaledSlide({ slide, theme, width, className, style, lite, hideElementId }: { slide: DeckSlide; theme: DeckTheme; width: number; className?: string; style?: React.CSSProperties; lite?: boolean; hideElementId?: string | null }) {
  const scale = width / SLIDE_W;
  return (
    <div className={className} style={{ width, height: Math.round(SLIDE_H * scale), overflow: "hidden", position: "relative", ...style }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: SLIDE_W, height: SLIDE_H, pointerEvents: "none" }}>
        <SlideView slide={slide} theme={theme} lite={lite} hideElementId={hideElementId} />
      </div>
    </div>
  );
}
