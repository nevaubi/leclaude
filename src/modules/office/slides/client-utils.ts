"use client";
/** Browser-only helpers: downloads, PPTX export call, PNG capture, blob upload, debounce. */
import type { DeckContent } from "./model";

export async function uploadBlob(blob: Blob, name: string): Promise<{ url: string; id: string }> {
  const form = new FormData();
  form.append("file", new File([blob], name, { type: blob.type || "application/octet-stream" }));
  const res = await fetch("/api/blobs", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return (await res.json()) as { url: string; id: string };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(title: string) { return title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "deck"; }

export async function downloadPptx(body: { docId?: string; content: DeckContent; title: string; includeHidden?: boolean }) {
  const res = await fetch("/api/office/slides/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, format: "pptx" }) });
  if (!res.ok) { const j = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }; throw new Error(j.error ?? res.statusText); }
  downloadBlob(await res.blob(), `${safeFilename(body.title)}.pptx`);
}

export async function downloadOutline(body: { docId?: string; content: DeckContent; title: string }) {
  const res = await fetch("/api/office/slides/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, format: "txt" }) });
  if (!res.ok) throw new Error(res.statusText);
  downloadBlob(await res.blob(), `${safeFilename(body.title)}.txt`);
}

async function inlineImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute("src") ?? "";
    if (!src || src.startsWith("data:")) return;
    try {
      const r = await fetch(src);
      const b = await r.blob();
      const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
      img.setAttribute("src", dataUrl);
    } catch { img.removeAttribute("src"); }
  }));
}

/** Rasterize a rendered slide element (1280×720 DOM node) to a PNG blob via SVG foreignObject. */
export async function slideNodeToPng(node: HTMLElement, scale = 2): Promise<Blob> {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.transform = "none";
  clone.querySelectorAll("[data-overlay]").forEach((n) => n.remove());
  await inlineImages(clone);
  const w = 1280, h = 720;
  const html = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px">${html}</div></foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Could not rasterize the slide (fonts or cross-origin images)")); img.src = url; });
  const canvas = document.createElement("canvas");
  canvas.width = w * scale; canvas.height = h * scale;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Canvas unavailable");
  cx.scale(scale, scale);
  cx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("PNG encoding failed");
  return blob;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const d = ((...args: Parameters<T>) => { if (timer) clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }) as T & { cancel: () => void };
  d.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return d;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
}

export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => { const img = new Image(); img.onload = () => res({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 }); img.onerror = () => res({ w: 800, h: 600 }); img.src = src; });
}
