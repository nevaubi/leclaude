/** Pure layout rules for the document viewer (unit-tested; no React). */

/** Viewer width at which the coding panel becomes a fixed right column instead of an overlay. */
export const CODING_COLUMN_MIN_WIDTH = 560;

/** Coding column width for a given viewer width: 240px in tight viewers, 272px when there is room. */
export function codingColumnWidth(viewerWidth: number): number {
  if (viewerWidth <= 0) return 272;
  return viewerWidth < 720 ? 240 : 272;
}
