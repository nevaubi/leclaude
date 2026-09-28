/**
 * Citation markers in research answers: "[n]" or a pinpoint "[n ¶k]" ("[n, ¶k]", "[n ¶¶k-m]"),
 * where n is the source number and k the 1-based paragraph in `splitParagraphs(text)`.
 * One grammar shared by the engine, the renderer and the exports. Pure and client-safe.
 */

export const CITE_MARKER_SOURCE = String.raw`\[(\d{1,2})(?:,?\s*¶{1,2}\s*(\d{1,4})(?:\s*[-–]\s*\d{1,4})?)?\]`;

export function citeMarkerRe(): RegExp {
  return new RegExp(CITE_MARKER_SOURCE, "g");
}

export interface CiteMarker {
  n: number;
  paragraph?: number;
  index: number;
  raw: string;
}

export function parseCiteMarkers(text: string): CiteMarker[] {
  const out: CiteMarker[] = [];
  for (const m of (text ?? "").matchAll(citeMarkerRe())) out.push({ n: Number(m[1]), paragraph: m[2] ? Number(m[2]) : undefined, index: m.index ?? 0, raw: m[0] });
  return out;
}

/** Source numbers cited anywhere in the text (plain or pinpoint markers). */
export function citedNumbers(text: string): Set<number> {
  return new Set(parseCiteMarkers(text).map((m) => m.n));
}

/** True when `tail` (a streaming window) contains a marker for a number in 1..max. */
export function hasCiteMarker(tail: string, max: number): boolean {
  return parseCiteMarkers(tail).some((m) => m.n >= 1 && m.n <= max);
}
