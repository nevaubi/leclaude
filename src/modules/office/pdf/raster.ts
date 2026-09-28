import "server-only";
/**
 * Server-side page rasterization for the redaction fallback (constitution
 * §41): pdf.js renders the ORIGINAL source page in display orientation onto a
 * node canvas (pdf.js' own canvas factory), the redaction boxes are painted
 * opaque, and the PNG replaces the page content. Used only for pages whose
 * content stream cannot be edited safely; every use is reported per page.
 */
import type { PageRasterizer } from "./apply";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let lib: Promise<PdfJs> | null = null;
function pdfjs() { if (!lib) lib = import("pdfjs-dist/legacy/build/pdf.mjs"); return lib; }

interface NodeCanvas { toBuffer: (mime: string) => Buffer }
interface CanvasFactory { create: (w: number, h: number) => { canvas: NodeCanvas; context: CanvasRenderingContext2D }; destroy?: (x: unknown) => void }

/** Build a rasterizer bound to one source document. Scale 2 ≈ 144 dpi. */
export function makeRasterizer(source: Uint8Array, scale = 2): PageRasterizer {
  return async ({ sourcePage, boxes, rotation }) => {
    const pdf = await pdfjs();
    const task = pdf.getDocument({ data: new Uint8Array(source), verbosity: 0, useSystemFonts: true });
    const doc = await task.promise;
    try {
      const page = await doc.getPage(sourcePage);
      const vp = page.getViewport({ scale, rotation: ((rotation % 360) + 360) % 360 });
      const factory = (doc as unknown as { canvasFactory?: CanvasFactory }).canvasFactory;
      if (!factory) throw new Error("No server-side canvas is available for rasterization");
      const { canvas, context } = factory.create(Math.ceil(vp.width), Math.ceil(vp.height));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvasContext: context, viewport: vp, canvas: canvas as unknown as HTMLCanvasElement }).promise;
      for (const b of boxes) {
        const [x1, y1] = vp.convertToViewportPoint(b.rect.x, b.rect.y);
        const [x2, y2] = vp.convertToViewportPoint(b.rect.x + b.rect.w, b.rect.y + b.rect.h);
        context.fillStyle = b.color || "#111111";
        const left = Math.floor(Math.min(x1, x2)) - 1, top = Math.floor(Math.min(y1, y2)) - 1;
        context.fillRect(left, top, Math.ceil(Math.abs(x2 - x1)) + 3, Math.ceil(Math.abs(y2 - y1)) + 3);
      }
      const png = canvas.toBuffer("image/png");
      page.cleanup();
      return new Uint8Array(png);
    } finally {
      await task.destroy();
    }
  };
}
