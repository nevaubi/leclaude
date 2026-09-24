"use client";
/**
 * One page of the continuous viewer: pdf.js canvas, selectable text layer,
 * SVG annotation overlay (with move/resize for the selected annotation) and
 * the drawing interactions of the active tool.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { STAMP_PRESETS, type PdfAnnotation, type PdfPage, type PdfPoint, type PdfRect } from "./model";
import { cssRectToPdf, loadPdfjs, pointToPdf, rectToViewport, type PDFDocumentProxy, type PDFPageProxy, type PageViewport } from "./pdfjs";
import { CURRENT_USER, usePdfStore, type Tool } from "./store";
import { mergeLineRects } from "./text-search";

export interface PageViewProps {
  page: PdfPage;
  display: number;
  pdfDoc: PDFDocumentProxy | null;
  scale: number;
  width: number;
  height: number;
  onRequestText?: (display: number) => void;
  onOpenAnnotation?: (a: PdfAnnotation) => void;
}

const NOTE_PT = 20;
const DRAW_TOOLS: Tool[] = ["rect", "ellipse", "redaction", "link", "text", "freehand", "note", "stamp", "signature"];

/** A render that pdf.js cancelled (viewport changed, page unmounted) is expected; anything else is surfaced on the page and logged in development. */
function reportRenderFailure(e: unknown, display: number, setRenderError: (m: string | null) => void) {
  const name = (e as { name?: string } | null)?.name;
  if (name === "RenderingCancelledException") return;
  const message = e instanceof Error ? e.message : String(e);
  if (process.env.NODE_ENV !== "production") console.warn(`[pdf] page ${display} did not render: ${message}`);
  setRenderError(message);
}

export function PageView({ page, display, pdfDoc, scale, width, height, onOpenAnnotation }: PageViewProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const textRef = React.useRef<HTMLDivElement>(null);
  const [pdfPage, setPdfPage] = React.useState<PDFPageProxy | null>(null);
  const [viewport, setViewport] = React.useState<PageViewport | null>(null);
  const [rendered, setRendered] = React.useState(false);
  /** Set when pdf.js could not paint this page (a cancelled render is not an error); shown instead of an endless skeleton. */
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const tool = usePdfStore((s) => s.tool);
  const darkInvert = usePdfStore((s) => s.darkInvert);
  const annotations = usePdfStore((s) => s.model.annotations);
  const selectedId = usePdfStore((s) => s.selectedAnnotationId);
  const hits = usePdfStore((s) => s.search.hits);
  const hitIndex = usePdfStore((s) => s.search.index);
  const flash = usePdfStore((s) => s.flash);
  const store = usePdfStore;
  const [draft, setDraft] = React.useState<{ kind: "rect" | "path"; rect?: { left: number; top: number; width: number; height: number }; points?: { x: number; y: number }[] } | null>(null);
  const [drag, setDrag] = React.useState<{ id: string; mode: "move" | "resize"; startX: number; startY: number; orig: PdfAnnotation } | null>(null);
  const pageAnnotations = React.useMemo(() => annotations.filter((a) => a.page === page.index), [annotations, page.index]);
  const pageHits = React.useMemo(() => hits.map((h, i) => ({ ...h, i })).filter((h) => h.source === page.index), [hits, page.index]);

  // ---- pdf.js page + viewport --------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    if (!pdfDoc || page.blank) { setPdfPage(null); return; }
    pdfDoc.getPage(page.index).then((p) => { if (!cancelled) setPdfPage(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pdfDoc, page.index, page.blank]);

  React.useEffect(() => {
    if (!pdfPage) { setViewport(null); return; }
    setViewport(pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + page.rotation) % 360 }));
  }, [pdfPage, scale, page.rotation]);

  // ---- canvas render -------------------------------------------------------------------
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdfPage || !viewport || !canvas) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setRendered(false);
    setRenderError(null);
    let task: ReturnType<PDFPageProxy["render"]> | null = null;
    try {
      task = pdfPage.render({ canvas, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    } catch (e) {
      // pdf.js throws synchronously when the canvas is still owned by a cancelled task; the next viewport/page change retries.
      reportRenderFailure(e, display, setRenderError);
      return;
    }
    task.promise.then(() => { if (!cancelled) setRendered(true); }).catch((e: unknown) => { if (!cancelled) reportRenderFailure(e, display, setRenderError); });
    return () => { cancelled = true; try { task?.cancel(); } catch { /* ignore */ } };
  }, [pdfPage, viewport, display]);

  // ---- text layer -----------------------------------------------------------------------
  React.useEffect(() => {
    const container = textRef.current;
    if (!pdfPage || !viewport || !container) return;
    let cancelled = false;
    let layer: { cancel: () => void } | null = null;
    container.replaceChildren();
    container.style.setProperty("--scale-factor", String(viewport.scale));
    (async () => {
      const lib = await loadPdfjs();
      if (cancelled) return;
      const tc = await pdfPage.getTextContent();
      if (cancelled) return;
      const tl = new lib.TextLayer({ textContentSource: tc, container, viewport });
      layer = tl;
      await tl.render().catch((e: unknown) => { if (!cancelled && process.env.NODE_ENV !== "production") console.warn(`[pdf] text layer for page ${display} failed: ${e instanceof Error ? e.message : String(e)}`); });
    })();
    return () => { cancelled = true; layer?.cancel(); };
  }, [pdfPage, viewport, display]);

  // ---- text selection → store.selection / markups -------------------------------------
  const commitSelection = React.useCallback(() => {
    const vp = viewport, root = rootRef.current;
    if (!vp || !root) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { return; }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const bounds = root.getBoundingClientRect();
    const rects: PdfRect[] = [];
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < bounds.top || r.top > bounds.bottom) continue;
      rects.push(cssRectToPdf(vp, r.left - bounds.left, r.top - bounds.top, r.width, r.height));
    }
    const merged = mergeLineRects(rects);
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!merged.length || !text) return;
    const st = store.getState();
    if (st.tool === "highlight" || st.tool === "underline" || st.tool === "strikeout") {
      st.addAnnotation({ page: page.index, type: st.tool, rects: merged, quote: text.slice(0, 300) });
      sel.removeAllRanges();
      st.setSelection(null);
      return;
    }
    st.setSelection({ source: page.index, display, text, rects: merged });
  }, [viewport, page.index, display, store]);

  // ---- drawing --------------------------------------------------------------------------
  const cssPoint = (e: React.PointerEvent) => { const b = rootRef.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!viewport || e.button !== 0) return;
    const st = store.getState();
    const t = st.tool;
    if (!DRAW_TOOLS.includes(t)) return;
    e.preventDefault();
    const p = cssPoint(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (t === "note" || t === "stamp" || t === "signature") return; // placed on pointer up
    if (t === "freehand") { setDraft({ kind: "path", points: [p] }); return; }
    setDraft({ kind: "rect", rect: { left: p.x, top: p.y, width: 0, height: 0 }, points: [p] });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const p = cssPoint(e);
    if (draft.kind === "path") setDraft({ kind: "path", points: [...(draft.points ?? []), p] });
    else { const o = draft.points![0]; setDraft({ ...draft, rect: { left: Math.min(o.x, p.x), top: Math.min(o.y, p.y), width: Math.abs(p.x - o.x), height: Math.abs(p.y - o.y) } }); }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!viewport) return;
    const st = store.getState();
    const t = st.tool;
    const p = cssPoint(e);
    const vp = viewport;
    if (t === "note") { const pt = pointToPdf(vp, p.x, p.y); const a = st.addAnnotation({ page: page.index, type: "note", rects: [{ x: pt.x, y: pt.y - NOTE_PT, w: NOTE_PT, h: NOTE_PT }], text: "" }); st.setTool("select"); st.select(a.id); onOpenAnnotation?.(a); return; }
    if (t === "stamp") { const text = st.stampText || STAMP_PRESETS[0]; const w = Math.max(120, text.length * 12 + 30), h = 40; const pt = pointToPdf(vp, p.x, p.y); const a = st.addAnnotation({ page: page.index, type: "stamp", rects: [{ x: pt.x - w / 2, y: pt.y - h / 2, w, h }], text }); st.select(a.id); return; }
    if (t === "signature") { const img = st.signatureDataUrl; if (!img) return; const w = 180, h = 60; const pt = pointToPdf(vp, p.x, p.y); const a = st.addAnnotation({ page: page.index, type: "signature", rects: [{ x: pt.x - w / 2, y: pt.y - h / 2, w, h }], imageDataUrl: img }); st.select(a.id); return; }
    if (!draft) return;
    setDraft(null);
    if (draft.kind === "path") {
      const pts = draft.points ?? [];
      if (pts.length < 2) return;
      const path: PdfPoint[] = pts.map((q) => pointToPdf(vp, q.x, q.y));
      const xs = path.map((q) => q.x), ys = path.map((q) => q.y);
      const bbox: PdfRect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      st.addAnnotation({ page: page.index, type: "freehand", rects: [bbox], paths: [path], strokeWidth: st.strokeWidth });
      return;
    }
    const r = draft.rect!;
    if (r.width < 4 || r.height < 4) return;
    const rect = cssRectToPdf(vp, r.left, r.top, r.width, r.height);
    if (t === "rect" || t === "ellipse") { const a = st.addAnnotation({ page: page.index, type: t, rects: [rect], strokeWidth: st.strokeWidth }); st.select(a.id); }
    else if (t === "redaction") { const a = st.addAnnotation({ page: page.index, type: "redaction", rects: [rect], reason: st.redactionReason || undefined }); st.select(a.id); }
    else if (t === "link") { const a = st.addAnnotation({ page: page.index, type: "link", rects: [rect], href: "https://" }); st.setTool("select"); st.select(a.id); onOpenAnnotation?.(a); }
    else if (t === "text") { const a = st.addAnnotation({ page: page.index, type: "text", rects: [rect], text: "", fontSize: st.fontSize }); st.setTool("select"); st.select(a.id); onOpenAnnotation?.(a); }
  };

  // ---- move / resize the selected annotation -----------------------------------------------
  const startDrag = (e: React.PointerEvent, a: PdfAnnotation, mode: "move" | "resize") => {
    if (store.getState().tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    store.getState().select(a.id);
    store.getState().pushHistory();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: a.id, mode, startX: e.clientX, startY: e.clientY, orig: a });
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag || !viewport) return;
    const dxCss = e.clientX - drag.startX, dyCss = e.clientY - drag.startY;
    // css delta → pdf delta (respect rotation by converting two points)
    const p0 = pointToPdf(viewport, 0, 0), p1 = pointToPdf(viewport, dxCss, dyCss);
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const o = drag.orig;
    if (drag.mode === "move") store.getState().updateAnnotation(drag.id, { rects: o.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })), paths: o.paths?.map((pth) => pth.map((q) => ({ x: q.x + dx, y: q.y + dy }))) }, { history: false });
    else { const r = o.rects[0]; if (!r) return; const w = Math.max(8, r.w + dx), h = Math.max(8, r.h - dy); store.getState().updateAnnotation(drag.id, { rects: [{ x: r.x, y: r.y + r.h - h, w, h }] }, { history: false }); }
  };
  const endDrag = () => setDrag(null);

  const isDrawing = DRAW_TOOLS.includes(tool);
  const cursor = tool === "hand" ? "grab" : tool === "note" || tool === "stamp" || tool === "signature" ? "copy" : tool === "freehand" ? "crosshair" : isDrawing ? "crosshair" : "text";

  return (
    <div ref={rootRef} className={cn("pdf-page relative select-text bg-paper shadow-[var(--paper-shadow)]", darkInvert && "pdf-page-invert", page.blank && "pdf-page-blank")} style={{ width, height }} data-page={display} data-source={page.index}>
      {!page.blank && <canvas ref={canvasRef} className={cn("pdf-canvas absolute left-0 top-0", !rendered && "opacity-0")} aria-label={`Page ${display}`} />}
      {!rendered && !page.blank && !renderError && <div className="absolute inset-0 animate-pulse bg-muted/40" />}
      {renderError && !page.blank && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-muted-foreground" role="alert">
          <span>This page could not be rendered.<br /><span className="font-mono text-[10.5px] opacity-80">{renderError}</span></span>
        </div>
      )}
      {page.blank && <div className="absolute inset-0 flex items-center justify-center text-xs uppercase tracking-wider text-muted-foreground/60">Blank page</div>}
      <div ref={textRef} className={cn("textLayer absolute left-0 top-0", isDrawing || tool === "hand" ? "pointer-events-none" : "")} style={{ width, height }} onMouseUp={commitSelection} />
      {viewport && (
        <svg className="absolute left-0 top-0" width={width} height={height} style={{ pointerEvents: "none" }} aria-hidden>
          {pageHits.map((h) => h.match.rects.map((r, j) => { const c = rectToViewport(viewport, r); return <rect key={`${h.i}-${j}`} x={c.left - 1} y={c.top - 1} width={c.width + 2} height={c.height + 2} rx={2} className={cn("pdf-hit", h.i === hitIndex && "pdf-hit-current")} />; }))}
          {pageAnnotations.map((a) => (
            <AnnotationShape key={a.id} a={a} vp={viewport} scale={scale} selected={a.id === selectedId} flashing={flash?.id === a.id ? flash.nonce : 0} interactive={tool === "select"} onPointerDown={(e) => startDrag(e, a, "move")} onResizeDown={(e) => startDrag(e, a, "resize")} onDoubleClick={() => onOpenAnnotation?.(a)} onPointerMove={onDragMove} onPointerUp={endDrag} />
          ))}
          {draft?.kind === "rect" && draft.rect && (tool === "ellipse" ? <ellipse cx={draft.rect.left + draft.rect.width / 2} cy={draft.rect.top + draft.rect.height / 2} rx={draft.rect.width / 2} ry={draft.rect.height / 2} className="pdf-draft" /> : <rect x={draft.rect.left} y={draft.rect.top} width={draft.rect.width} height={draft.rect.height} className={cn("pdf-draft", tool === "redaction" && "pdf-draft-redaction")} />)}
          {draft?.kind === "path" && draft.points && <polyline points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={store.getState().color} strokeWidth={Math.max(1, store.getState().strokeWidth * scale)} strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      )}
      {(isDrawing || tool === "hand") && viewport && (
        <div className="absolute inset-0 touch-none" style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDraft(null)} />
      )}
      <div className="pointer-events-none absolute -bottom-5 left-0 right-0 text-center text-[10px] tabular text-muted-foreground">{display}</div>
    </div>
  );
}

function AnnotationShape({ a, vp, scale, selected, flashing, interactive, onPointerDown, onResizeDown, onDoubleClick, onPointerMove, onPointerUp }: { a: PdfAnnotation; vp: PageViewport; scale: number; selected: boolean; flashing: number; interactive: boolean; onPointerDown: (e: React.PointerEvent) => void; onResizeDown: (e: React.PointerEvent) => void; onDoubleClick: () => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: () => void }) {
  const rects = a.rects.map((r) => rectToViewport(vp, r));
  const first = rects[0];
  const pe = interactive ? "auto" : "none";
  const common = { style: { pointerEvents: pe as "auto" | "none", cursor: interactive ? "move" : undefined }, onPointerDown, onPointerMove, onPointerUp, onDoubleClick, className: cn("pdf-ann", selected && "pdf-ann-selected", flashing ? "pdf-ann-flash" : "", a.resolved && "pdf-ann-resolved") } as const;
  const bounds = first ? boundsOfCss(rects) : null;
  const handles = selected && bounds && interactive ? (
    <g>
      <rect x={bounds.left - 2} y={bounds.top - 2} width={bounds.width + 4} height={bounds.height + 4} fill="none" className="pdf-ann-outline" />
      {["rect", "ellipse", "text", "stamp", "signature", "redaction", "link"].includes(a.type) && <rect x={bounds.left + bounds.width - 5} y={bounds.top + bounds.height - 5} width={10} height={10} className="pdf-ann-handle" style={{ pointerEvents: "auto", cursor: "nwse-resize" }} onPointerDown={onResizeDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />}
    </g>
  ) : null;
  let body: React.ReactNode = null;
  switch (a.type) {
    case "highlight": body = rects.map((c, i) => <rect key={i} x={c.left} y={c.top} width={c.width} height={c.height} fill={a.color} opacity={a.opacity} style={{ mixBlendMode: "multiply" }} />); break;
    case "underline": body = rects.map((c, i) => <rect key={i} x={c.left} y={c.top + c.height - Math.max(1.5, 1.6 * scale)} width={c.width} height={Math.max(1.5, 1.6 * scale)} fill={a.color} opacity={a.opacity} />); break;
    case "strikeout": body = rects.map((c, i) => <rect key={i} x={c.left} y={c.top + c.height * 0.5 - Math.max(0.75, 0.8 * scale)} width={c.width} height={Math.max(1.5, 1.6 * scale)} fill={a.color} opacity={a.opacity} />); break;
    case "note": { if (!first) break; const s = NOTE_PT * scale; body = <g><rect x={first.left} y={first.top} width={s} height={s} rx={3 * scale} fill={a.color} stroke="rgba(0,0,0,.45)" strokeWidth={1} /><text x={first.left + s / 2} y={first.top + s * 0.72} textAnchor="middle" fontSize={s * 0.6} fontWeight={700} fill="rgba(0,0,0,.7)">…</text></g>; break; }
    case "text": { if (!first) break; body = <g><rect x={first.left} y={first.top} width={first.width} height={first.height} fill="rgba(255,255,255,.01)" stroke={selected ? "transparent" : "rgba(0,0,0,.12)"} strokeDasharray="3 2" /><foreignObject x={first.left} y={first.top} width={first.width} height={first.height}><div style={{ fontSize: (a.fontSize ?? 11) * scale, color: a.color, padding: 3 * scale, lineHeight: 1.25, fontFamily: "Helvetica, Arial, sans-serif", whiteSpace: "pre-wrap", overflow: "hidden", height: "100%", pointerEvents: "none" }}>{a.text || <span style={{ opacity: 0.4 }}>Text</span>}</div></foreignObject></g>; break; }
    case "rect": body = rects.map((c, i) => <rect key={i} x={c.left} y={c.top} width={c.width} height={c.height} fill="rgba(255,255,255,.01)" stroke={a.color} strokeWidth={(a.strokeWidth ?? 1.5) * scale} opacity={a.opacity} />); break;
    case "ellipse": body = rects.map((c, i) => <ellipse key={i} cx={c.left + c.width / 2} cy={c.top + c.height / 2} rx={c.width / 2} ry={c.height / 2} fill="rgba(255,255,255,.01)" stroke={a.color} strokeWidth={(a.strokeWidth ?? 1.5) * scale} opacity={a.opacity} />); break;
    case "freehand": body = <g>{(a.paths ?? []).map((p, i) => <polyline key={i} points={p.map((q) => { const [x, y] = vp.convertToViewportPoint(q.x, q.y); return `${x},${y}`; }).join(" ")} fill="none" stroke={a.color} strokeWidth={(a.strokeWidth ?? 1.8) * scale} strokeLinecap="round" strokeLinejoin="round" opacity={a.opacity} />)}{first && <rect x={first.left} y={first.top} width={first.width} height={first.height} fill="rgba(255,255,255,.01)" stroke="none" />}</g>; break;
    case "stamp": { if (!first) break; const text = (a.text ?? "STAMP").toUpperCase(); const fs = Math.min(first.height * 0.55, (first.width - 14 * scale) / Math.max(1, text.length * 0.62)); body = <g><rect x={first.left} y={first.top} width={first.width} height={first.height} rx={2} fill="rgba(255,255,255,.01)" stroke={a.color} strokeWidth={2 * scale} opacity={a.opacity} /><text x={first.left + first.width / 2} y={first.top + first.height / 2 + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={800} fontFamily="Helvetica, Arial, sans-serif" fill={a.color} opacity={a.opacity} letterSpacing={0.5}>{text}</text></g>; break; }
    case "redaction": body = rects.map((c, i) => <g key={i}><rect x={c.left - 0.5} y={c.top - 0.5} width={c.width + 1} height={c.height + 1} fill={a.color || "#111"} opacity={a.applied ? 1 : 0.92} />{!a.applied && <rect x={c.left - 0.5} y={c.top - 0.5} width={c.width + 1} height={c.height + 1} fill="none" className="pdf-redaction-pending" />}{a.reason && c.width > 40 * scale && c.height > 8 * scale && <text x={c.left + 2 * scale} y={c.top + c.height / 2 + 2.3 * scale} fontSize={Math.min(6.5 * scale, c.height * 0.7)} fill="#fff" fontFamily="Helvetica, Arial, sans-serif">{a.reason}</text>}</g>); break;
    case "link": body = rects.map((c, i) => <rect key={i} x={c.left} y={c.top} width={c.width} height={c.height} fill="rgba(37,99,235,.06)" stroke={a.color} strokeDasharray="4 2" strokeWidth={1} />); break;
    case "signature": { if (!first) break; body = <g><rect x={first.left} y={first.top} width={first.width} height={first.height} fill="rgba(255,255,255,.01)" stroke={selected ? "transparent" : "none"} />{a.imageDataUrl && <image href={a.imageDataUrl} x={first.left} y={first.top} width={first.width} height={first.height} preserveAspectRatio="xMidYMid meet" />}</g>; break; }
  }
  return <g {...common} data-annotation={a.id}><title>{`${a.type}${a.text ? `: ${a.text}` : a.quote ? `: “${a.quote}”` : ""} — ${a.author}`}</title>{body}{handles}</g>;
}

function boundsOfCss(rects: { left: number; top: number; width: number; height: number }[]) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const c of rects) { l = Math.min(l, c.left); t = Math.min(t, c.top); r = Math.max(r, c.left + c.width); b = Math.max(b, c.top + c.height); }
  return { left: l, top: t, width: r - l, height: b - t };
}

export const AUTHOR = CURRENT_USER;
