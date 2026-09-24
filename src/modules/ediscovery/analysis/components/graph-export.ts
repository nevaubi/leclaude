"use client";
/**
 * Export an on-screen SVG (the people graph, the timeline strip) as a
 * standalone SVG or PNG. Computed styles are inlined so CSS variables and
 * theme classes survive outside the page; the current background is painted
 * behind the drawing so dark-mode exports stay legible.
 */

const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-opacity", "opacity", "font-size", "font-family", "font-weight", "letter-spacing", "paint-order", "text-anchor", "dominant-baseline"] as const;

function inlineStyles(source: Element, target: Element) {
  const cs = window.getComputedStyle(source);
  const decl: string[] = [];
  for (const p of STYLE_PROPS) { const v = cs.getPropertyValue(p); if (v) decl.push(`${p}:${v}`); }
  if (decl.length) target.setAttribute("style", decl.join(";"));
  target.removeAttribute("class");
  const a = Array.from(source.children), b = Array.from(target.children);
  for (let i = 0; i < a.length && i < b.length; i++) inlineStyles(a[i], b[i]);
}

/** A self-contained SVG string of the element as currently rendered. */
export function serializeSvg(svg: SVGSVGElement, opts: { background?: string } = {}): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  const w = svg.clientWidth || Number(svg.getAttribute("width")) || 800;
  const h = svg.clientHeight || Number(svg.getAttribute("height")) || 600;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const bg = opts.background ?? window.getComputedStyle(document.body).backgroundColor;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", "100%"); rect.setAttribute("height", "100%"); rect.setAttribute("fill", bg);
  clone.insertBefore(rect, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadSvg(svg: SVGSVGElement, filename: string) {
  saveBlob(new Blob([serializeSvg(svg)], { type: "image/svg+xml;charset=utf-8" }), filename);
}

/** Rasterize at 2× for crisp slides and briefs. Resolves once the file has been handed to the browser. */
export function downloadPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  return new Promise((resolve, reject) => {
    const text = serializeSvg(svg);
    const w = (svg.clientWidth || 800) * scale, h = (svg.clientHeight || 600) * scale;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => { URL.revokeObjectURL(url); if (!blob) return reject(new Error("PNG encoding failed")); saveBlob(blob, filename); resolve(); }, "image/png");
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not rasterize the graph")); };
    img.src = url;
  });
}
