import "server-only";
import { blobs } from "@/lib/db";
import { sha256 } from "@/lib/integrity/hash";
import { SLIDE_W } from "./model";
import { readPptx } from "./ooxml/reader";
import { DEFAULT_SLIDE_CX, EMU_PER_INCH } from "./ooxml/package";

export { EMU_PER_INCH, DEFAULT_SLIDE_CX };

/** EMU → canvas px, scaling the source slide width onto the 1280 px canvas. */
export function emuToPx(emu: number, slideCx: number = DEFAULT_SLIDE_CX): number {
  return Math.round((emu * SLIDE_W) / (slideCx || DEFAULT_SLIDE_CX));
}

/** Font size in hundredths of a point → pt, scaled like the geometry. */
export function szToPt(sz: number, slideCx: number = DEFAULT_SLIDE_CX): number {
  const scale = (SLIDE_W / 96) / (slideCx / EMU_PER_INCH); // canvas inches / source inches
  return Math.max(6, Math.round((sz / 100) * scale * 10) / 10);
}

/**
 * Import a .pptx into the deck model with full fidelity metadata (see ooxml/reader.ts). Media become blobs; the
 * deck records the source package's sha256 so the export route can reuse the stored original (the import route
 * keeps it as `doc.meta.originalBlobId`) and rewrite only what changed.
 */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  const hash = sha256(bytes);
  const { title, deck, warnings } = await readPptx(bytes, filename, {
    sha256: hash,
    putMedia: (data, mime, name) => `/api/blobs/${blobs.put(data, mime, { name, meta: { source: "pptx-import", sha256: sha256(data) } }).id}`,
  });
  const pptx = deck.meta?.pptx;
  return { title, content: deck, meta: { imported: { slides: deck.slides.length, warnings: warnings.length, sourceWidthEmu: pptx?.slideSize.cx, sourceHeightEmu: pptx?.slideSize.cy, layouts: pptx?.layouts.length ?? 0, packageSha256: hash } } };
}
