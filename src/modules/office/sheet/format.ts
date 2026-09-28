/**
 * Display formatting for cell values (Excel-style number formats) and
 * Excel serial-date conversion (1900 date system, epoch 1899-12-30).
 */
import type { CellStyle, CellValue, NumFmt } from "./model";

const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function serialToDate(serial: number): Date {
  return new Date(EPOCH_MS + Math.round(serial * DAY_MS));
}

export function dateToSerial(d: Date): number {
  return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH_MS) / DAY_MS;
}

export function isoToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EPOCH_MS) / DAY_MS;
}

export function serialToISO(serial: number): string {
  return serialToDate(serial).toISOString().slice(0, 10);
}

export function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const f = fmt.toLowerCase();
  return /(yy|mm+|dd?|mmm)/.test(f) && !/[#0]/.test(f);
}

/** Format a Date with an Excel-ish pattern (yyyy, yy, mmmm, mmm, mm, m, dddd, ddd, dd, d). */
export function formatDatePattern(d: Date, pattern: string): string {
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate();
  const dow = d.getUTCDay();
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return pattern.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (tok) => {
    switch (tok.toLowerCase()) {
      case "yyyy": return String(y);
      case "yy": return String(y).slice(-2);
      case "mmmm": return MONTHS_LONG[mo];
      case "mmm": return MONTHS[mo];
      case "mm": return String(mo + 1).padStart(2, "0");
      case "m": return String(mo + 1);
      case "dddd": return DAYS[dow];
      case "ddd": return DAYS[dow].slice(0, 3);
      case "dd": return String(day).padStart(2, "0");
      case "d": return String(day);
      default: return tok;
    }
  });
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Strip Excel format decorations that do not change the digits: [Red]/[<0] tags, _x padding, *x fill; keep quoted literals and escaped chars. */
function cleanSection(section: string): { core: string; prefix: string; suffix: string } {
  let s = section.replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, '"$1"').replace(/\[[^\]]*\]/g, "").replace(/_./g, "").replace(/\*./g, "");
  // literal text: "..." or \x
  const lit = (t: string) => t.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");
  const first = s.search(/[#0?]/);
  if (first < 0) return { core: s, prefix: "", suffix: "" };
  let last = -1;
  for (let i = s.length - 1; i >= 0; i--) if (/[#0?%]/.test(s[i])) { last = i; break; }
  const prefix = lit(s.slice(0, first));
  const suffix = lit(s.slice(last + 1));
  s = s.slice(first, last + 1);
  return { core: s, prefix, suffix };
}

function formatNumberSection(n: number, rawSection: string): string {
  const cleaned = cleanSection(rawSection);
  if (cleaned.prefix || cleaned.suffix || rawSection !== cleaned.core) {
    const hasParens = /\(/.test(cleaned.prefix) && /\)/.test(cleaned.suffix);
    const prefix = cleaned.prefix.replace(/[()]/g, "").trim();
    const suffix = cleaned.suffix.replace(/[()]/g, "").trim();
    const core = cleaned.core.replace(/\$/g, "");
    const inner = !/[#0]/.test(core) && n === 0 ? "" : formatNumberSection(n, core.replace(/\?/g, "#"));
    const body = inner.startsWith("-") ? inner.slice(1) : inner;
    const out = `${prefix}${body}${suffix && !suffix.startsWith("%") ? ` ${suffix}`.replace(/^ (?=[%)])/, "") : suffix}`;
    if (hasParens) return `(${out})`;
    return inner.startsWith("-") ? `-${out}` : out;
  }
  const section = rawSection;
  // Detect features of the section
  const percent = section.includes("%");
  const hasComma = /#,#|0,0/.test(section);
  const currency = /^[^#0]*\$/.test(section) || section.includes("$") ? "$" : "";
  const decMatch = /[#0]\.([0#]+)/.exec(section);
  const decimals = decMatch ? decMatch[1].length : 0;
  const parens = section.includes("(") && section.includes(")");
  let v = percent ? n * 100 : n;
  const neg = v < 0;
  v = Math.abs(v);
  const fixed = v.toFixed(decimals);
  const [i, d] = fixed.split(".");
  let body = hasComma ? groupThousands(i) : i;
  if (d !== undefined) body += `.${d}`;
  if (percent) body += "%";
  let out = `${currency}${body}`;
  if (neg) out = parens ? `(${out})` : `-${out}`;
  return out;
}

export function formatGeneral(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e11 || (abs < 1e-6 && abs > 0)) return n.toExponential(5).replace(/\.?0+e/, "e");
  let s = n.toPrecision(10);
  if (s.includes("e")) return s;
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return s;
}

/** Format a number with an Excel-style format string. */
export function formatNumber(n: number, fmt: NumFmt | undefined): string {
  if (!fmt || fmt === "General") return formatGeneral(n);
  if (fmt === "text" || fmt === "@") return String(n);
  if (isDateFormat(fmt)) return formatDatePattern(serialToDate(n), fmt);
  const sections = splitSections(fmt);
  if (sections.length > 1) {
    if (n < 0 && sections[1]) {
      const sec = sections[1];
      const body = formatNumberSection(-n, sec);
      if (body.startsWith("(")) return body;
      const bare = sec.replace(/"[^"]*"|\[[^\]]*\]|_.|\*./g, "");
      return bare.includes("(") && bare.includes(")") ? `(${body})` : body;
    }
    if (n === 0 && sections[2]) {
      const zero = sections[2];
      if (!/[#0?]/.test(zero)) return cleanSection(zero).core.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").trim() || "0";
      return formatNumberSection(0, zero);
    }
    return formatNumberSection(n, sections[0]);
  }
  return formatNumberSection(n, fmt);
}

/** Split a format into its ;-sections, ignoring semicolons inside quotes. */
function splitSections(fmt: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of fmt) { if (ch === '"') q = !q; if (ch === ";" && !q) { out.push(cur); cur = ""; } else cur += ch; }
  out.push(cur);
  return out;
}

export interface Formatted { text: string; align: "left" | "right" | "center"; isError?: boolean; isNumber?: boolean }

/** Screen alignment for an OOXML horizontal alignment (justify/fill/distributed render left; centerContinuous centers). */
function hAlign(style: CellStyle | undefined): Formatted["align"] | undefined {
  const a = style?.align;
  if (!a) return undefined;
  if (a === "center" || a === "centerContinuous") return "center";
  if (a === "right") return "right";
  return "left";
}

/** Format any cell value for display. `computed` is the value shown for formula cells. */
export function formatValue(value: CellValue | undefined, style: CellStyle | undefined, type?: string): Formatted {
  if (value === undefined || value === null || value === "") return { text: "", align: hAlign(style) ?? "left" };
  const numFmt = style?.numFmt;
  if (typeof value === "string" && /^#(REF!|DIV\/0!|NAME\?|VALUE!|NUM!|N\/A|NULL!|CYCLE!|ERROR!|SPILL!)$/.test(value)) return { text: value, align: hAlign(style) ?? "center", isError: true };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", align: hAlign(style) ?? "center" };
  if (typeof value === "number") {
    if (numFmt === "text") return { text: String(value), align: hAlign(style) ?? "left" };
    return { text: formatNumber(value, numFmt), align: hAlign(style) ?? "right", isNumber: true };
  }
  // strings
  if (type === "d" || (isDateFormat(numFmt) && /^\d{4}-\d{2}-\d{2}/.test(value))) {
    const serial = isoToSerial(value);
    if (serial !== null) return { text: formatDatePattern(serialToDate(serial), numFmt && isDateFormat(numFmt) ? numFmt : "mmm d, yyyy"), align: hAlign(style) ?? "right" };
  }
  if (numFmt && numFmt !== "General" && numFmt !== "text" && !isDateFormat(numFmt)) {
    const num = Number(value);
    if (value.trim() !== "" && Number.isFinite(num)) return { text: formatNumber(num, numFmt), align: hAlign(style) ?? "right", isNumber: true };
  }
  return { text: value, align: hAlign(style) ?? "left" };
}

/** Numeric interpretation of a value for stats/charts (dates → serial). */
export function toNumber(value: CellValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isoToSerial(value);
    const t = value.replace(/[$,%\s]/g, "");
    if (t === "" || value.trim().startsWith("#")) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return value.includes("%") ? n / 100 : n;
  }
  return null;
}
