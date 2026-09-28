/**
 * DrawingML theme (ppt/theme/themeN.xml): read the color and font schemes into a DeckTheme, and patch them back
 * when the user restyles an imported deck. Scheme slots map to the app's theme tokens:
 *   dk1→fg, lt1→bg, accent1→accent, accent2→accent2, dk2→muted, lt2→surface.
 */
import type { DeckTheme } from "../model";
import { attr, kid, mk, path, replaceKid, type XDoc, type XEl } from "./xml";

export const SCHEME_SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"] as const;

export interface ParsedTheme { name: string; scheme: Record<string, string>; fonts: { major: string; minor: string } }

function slotColor(slot: XEl | undefined): string | undefined {
  const srgb = kid(slot, "a:srgbClr");
  if (srgb) return `#${(attr(srgb, "val") ?? "000000").toUpperCase()}`;
  const sys = kid(slot, "a:sysClr");
  if (sys) return `#${(attr(sys, "lastClr") ?? (attr(sys, "val") === "window" ? "FFFFFF" : "000000")).toUpperCase()}`;
  return undefined;
}

export function parseTheme(doc: XDoc | null): ParsedTheme {
  const scheme: Record<string, string> = {};
  const els = path(doc?.root, "a:themeElements");
  const clr = kid(els, "a:clrScheme");
  for (const s of SCHEME_SLOTS) { const c = slotColor(kid(clr, `a:${s}`)); if (c) scheme[s] = c; }
  const fs = kid(els, "a:fontScheme");
  const major = attr(path(fs, "a:majorFont", "a:latin"), "typeface") || "Calibri Light";
  const minor = attr(path(fs, "a:minorFont", "a:latin"), "typeface") || "Calibri";
  return { name: attr(doc?.root, "name") ?? "Imported theme", scheme: { dk1: "#000000", lt1: "#FFFFFF", dk2: "#44546A", lt2: "#E7E6E6", accent1: "#4472C4", accent2: "#ED7D31", ...scheme }, fonts: { major, minor } };
}

export function deckThemeFromScheme(t: ParsedTheme, id: string): DeckTheme {
  const s = t.scheme;
  return {
    id,
    name: t.name,
    fonts: { heading: t.fonts.major, body: t.fonts.minor },
    colors: { bg: s.lt1, fg: s.dk1, accent: s.accent1, accent2: s.accent2, muted: s.dk2, surface: s.lt2 },
    titleBg: s.lt1,
    titleFg: s.dk1,
  };
}

/** Rewrite the scheme slots and fonts of a theme part from a DeckTheme (other slots and effects untouched). */
export function patchTheme(doc: XDoc, theme: DeckTheme) {
  const els = path(doc.root, "a:themeElements");
  const clr = kid(els, "a:clrScheme");
  const hex = (v: string | undefined) => (v ?? "").replace("#", "").toUpperCase().slice(0, 6);
  const set: Record<string, string | undefined> = { dk1: theme.colors.fg, lt1: theme.colors.bg, accent1: theme.colors.accent, accent2: theme.colors.accent2, dk2: theme.colors.muted, lt2: theme.colors.surface };
  if (clr) for (const [slot, value] of Object.entries(set)) {
    if (!value || !/^#?[0-9a-f]{6}$/i.test(value)) continue;
    const cur = kid(clr, `a:${slot}`);
    const curHex = slotColor(cur)?.replace("#", "");
    if (curHex === hex(value)) continue;
    const next = mk(`a:${slot}`, {}, [mk("a:srgbClr", { val: hex(value) })]);
    if (cur) replaceKid(clr, cur, next);
  }
  const fs = kid(els, "a:fontScheme");
  const setFont = (which: "a:majorFont" | "a:minorFont", face: string) => {
    const latin = path(fs, which, "a:latin");
    if (latin && attr(latin, "typeface") !== face) { const i = latin.attrs.findIndex((a) => a.n === "typeface"); if (i >= 0) latin.attrs[i].v = face; else latin.attrs.push({ n: "typeface", v: face }); latin.dirty = true; }
  };
  setFont("a:majorFont", theme.fonts.heading);
  setFont("a:minorFont", theme.fonts.body);
}

/** Map a scheme color name (after the master's clrMap) to an app theme token when one corresponds. */
export function schemeToToken(slot: string): string | undefined {
  return ({ dk1: "fg", lt1: "bg", accent1: "accent", accent2: "accent2", dk2: "muted", lt2: "surface" } as Record<string, string>)[slot];
}

/** Token → scheme name used when writing theme-aware colors into an imported package. */
export function tokenToScheme(token: string): string | undefined {
  return ({ fg: "tx1", bg: "bg1", accent: "accent1", accent2: "accent2", muted: "tx2", surface: "bg2" } as Record<string, string>)[token];
}
