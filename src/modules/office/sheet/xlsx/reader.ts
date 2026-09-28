/**
 * Direct OOXML (.xlsx/.xlsm) reader → Workbook model. Reads workbook/sheet
 * structure, shared and inline strings, formulas (shared formulas expanded,
 * array formulas kept), cached values, number formats and styles, column
 * widths / row heights / hidden state, merges, freeze panes and selection,
 * sheet order / visibility / tab colour, defined names (workbook and sheet
 * scope), data validation, conditional formatting, hyperlinks, notes,
 * autofilter, print settings and basic charts. Records an XlsxSource so the
 * writer can rewrite only what changed.
 */
import { colToLetter, letterToCol, normalizeRange, parseA1, parseRange, rangeToA1, shiftFormula, toA1 } from "../a1";
import { serialToISO } from "../format";
import { hashValue, sheetFingerprint, workbookFingerprint } from "../hash";
import {
  createSheet, DEFAULT_COL_WIDTH, DEFAULT_PAGE_SETUP, DEFAULT_ROW_HEIGHT, styleKey,
  type Cell, type CellStyle, type CFOperator, type CFRule, type CFStop, type ConditionalFormat, type DataValidation, type ExtraName, type FilterCriteria,
  type Hyperlink, type PageSetup, type Sheet, type SheetChart, type SheetPageSetup, type Workbook, type XlsxSource,
} from "../model";
import { anchorToPx, parseChartXml, type Anchor } from "./charts";
import { entryText, readZip, type ZipEntry } from "./zip";
import { isDateOnlyFormat, parseStyles, parseTheme, resolveColor } from "./styles";
import { attrs, child, children, parseXml, splitTopLevel, text, unescExcel, type XNode } from "./xml";

export const REL = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  worksheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  sharedStrings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  drawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
  chart: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  vmlDrawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  calcChain: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain",
  vbaProject: "http://schemas.microsoft.com/office/2006/relationships/vbaProject",
  coreProps: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extendedProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
};

export interface Rel { id: string; type: string; target: string; external: boolean }

/** Resolve a relationship target against the directory of the part that owns the rels. */
export function resolveTarget(ownerPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = ownerPart.includes("/") ? ownerPart.slice(0, ownerPart.lastIndexOf("/") + 1) : "";
  const parts = (base + target).split("/");
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); }
  return out.join("/");
}

export function relsPathFor(part: string): string {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

export function parseRels(xml: string | undefined, ownerPart: string): Rel[] {
  if (!xml) return [];
  return children(child(parseXml(xml), "Relationships"), "Relationship").map((r) => {
    const a = attrs(r);
    const external = a.TargetMode === "External";
    return { id: a.Id, type: a.Type, target: external ? a.Target : resolveTarget(ownerPart, a.Target), external };
  });
}

export class Package {
  readonly entries: Map<string, ZipEntry>;
  private textCache = new Map<string, string>();
  constructor(bytes: Uint8Array) { this.entries = readZip(bytes); }
  has(name: string) { return this.entries.has(name); }
  text(name: string): string | undefined {
    if (this.textCache.has(name)) return this.textCache.get(name);
    const e = this.entries.get(name);
    if (!e) return undefined;
    const t = entryText(e).replace(/^﻿/, "");
    this.textCache.set(name, t);
    return t;
  }
  rels(part: string): Rel[] { return parseRels(this.text(relsPathFor(part)), part); }
}

/** Excel column width (characters, with padding) ⇄ pixels for the default Calibri 11 (max digit width 7px). */
export const widthToPx = (w: number) => Math.round(w * 7);
export const pxToWidth = (px: number) => Math.round((px / 7) * 256) / 256;
export const ptToPx = (pt: number) => Math.round((pt * 4) / 3);
export const pxToPt = (px: number) => Math.round(px * 0.75 * 100) / 100;

const PAPER_BY_ID: Record<number, PageSetup["paper"]> = { 1: "letter", 5: "legal", 9: "a4", 3: "tabloid" };

/** Excel header/footer codes ⇄ the app's tokens. Only a centre-section-only string without font codes is converted. */
export function headerFromExcel(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const body = s.startsWith("&C") ? s.slice(2) : s;
  if (/&[LR"]|&\d/.test(body)) return s;
  return body.replace(/&P/g, "&[Page]").replace(/&N/g, "&[Pages]").replace(/&D/g, "&[Date]").replace(/&T/g, "&[Time]").replace(/&F/g, "&[Title]").replace(/&A/g, "&[Sheet]");
}
export function headerToExcel(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (/&[LCR"]|&\d/.test(s.replace(/&\[[A-Za-z]+\]/g, ""))) return s;
  return `&C${s.replace(/&\[Page\]/g, "&P").replace(/&\[Pages\]/g, "&N").replace(/&\[Date\]/g, "&D").replace(/&\[Time\]/g, "&T").replace(/&\[Title\]/g, "&F").replace(/&\[Sheet\]/g, "&A")}`;
}

/** File formula → model formula body (_xlfn./_xlws. future-function prefixes removed). */
export function fromFileFormula(f: string): string {
  return f.replace(/_xlfn\._xlws\.|_xlfn\.|_xlws\./g, "");
}

function bool(v: string | undefined): boolean { return v === "1" || v === "true"; }

function siText(si: XNode): string {
  const t = child(si, "t");
  const runs = children(si, "r");
  if (runs.length) return unescExcel(runs.map((r) => text(child(r, "t"))).join(""));
  return unescExcel(text(t));
}

const ERRORS = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!"]);

/** Split "A1:B2 D4" style sqrefs. */
function sqrefParts(sqref: string | undefined): string[] {
  return (sqref ?? "").trim().split(/\s+/).filter(Boolean);
}

function stripAbs(ref: string): string { return ref.replace(/\$/g, ""); }

const CELLIS_SIMPLE: Partial<Record<string, "gt" | "lt" | "eq">> = { greaterThan: "gt", lessThan: "lt", equal: "eq" };

function numericConst(f: string | undefined): number | null {
  if (f === undefined) return null;
  const t = f.trim();
  return /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(t) ? Number(t) : null;
}

/** Recognize the expression this writer emits for the app's dueBefore rule. */
function dueBeforeFromExpression(f: string): CFRule | null {
  const m = /^AND\(ISNUMBER\((\$?[A-Z]{1,3}\$?\d+)\),\1<(TODAY\(\)|DATE\((\d{4}),(\d{1,2}),(\d{1,2})\))(?:([+-]\d+))?\)$/.exec(f.replace(/\s+/g, ""));
  if (!m) return null;
  const date = m[2] === "TODAY()" ? "today" : `${m[3]}-${m[4].padStart(2, "0")}-${m[5].padStart(2, "0")}`;
  const days = m[6] ? Number(m[6]) : undefined;
  return days ? { kind: "dueBefore", date, days } : { kind: "dueBefore", date };
}

function parseCfRule(rule: XNode, rawXml: string, theme: string[]): CFRule {
  const a = attrs(rule);
  const formulas = children(rule, "formula").map((f) => fromFileFormula(text(f)));
  switch (a.type) {
    case "cellIs": {
      const op = a.operator as CFOperator;
      const simple = CELLIS_SIMPLE[op];
      const n0 = numericConst(formulas[0]);
      if (simple && formulas.length === 1) {
        if (n0 !== null) return simple === "eq" ? { kind: "eq", value: n0 } : { kind: simple, value: n0 };
        const q = /^"((?:[^"]|"")*)"$/.exec(formulas[0].trim());
        if (simple === "eq" && q) return { kind: "eq", value: q[1].replace(/""/g, '"') };
      }
      if (op === "between" && formulas.length === 2) { const n1 = numericConst(formulas[1]); if (n0 !== null && n1 !== null) return { kind: "between", min: n0, max: n1 }; }
      return { kind: "cellIs", operator: op, formulas };
    }
    case "containsText": if (a.operator === "containsText" && a.text !== undefined) return { kind: "contains", text: a.text }; break;
    case "containsBlanks": return { kind: "blank" };
    case "duplicateValues": return { kind: "duplicate" };
    case "top10": if (!bool(a.percent)) return bool(a.bottom) ? { kind: "top", count: Number(a.rank ?? 10), bottom: true } : { kind: "top", count: Number(a.rank ?? 10) }; break;
    case "expression": { if (formulas[0] === undefined) break; return dueBeforeFromExpression(formulas[0]) ?? { kind: "expression", formula: formulas[0] }; }
    case "colorScale": {
      const cs = child(rule, "colorScale");
      const cfvos = children(cs, "cfvo"), colors = children(cs, "color");
      if (!cfvos.length || cfvos.length !== colors.length) break;
      const stops: CFStop[] = cfvos.map((c, i) => { const ca = attrs(c); const s: CFStop = { type: ca.type as CFStop["type"], color: resolveColor(colors[i], theme) ?? "#FFFFFF" }; if (ca.val !== undefined) s.value = ca.val; return s; });
      return { kind: "colorScale", stops };
    }
    case "dataBar": {
      const db = child(rule, "dataBar");
      const cfvos = children(db, "cfvo");
      const color = resolveColor(children(db, "color")[0], theme) ?? "#638EC6";
      const stop = (c?: XNode) => { if (!c) return undefined; const ca = attrs(c); return ca.val !== undefined ? { type: ca.type as CFStop["type"], value: ca.val } : { type: ca.type as CFStop["type"] }; };
      const out: CFRule = { kind: "dataBar", color };
      const mn = stop(cfvos[0]), mx = stop(cfvos[1]);
      if (mn && mn.type !== "min") out.min = mn;
      if (mx && mx.type !== "max") out.max = mx;
      return out;
    }
  }
  return { kind: "raw", xml: rawXml };
}

function parseValidation(dv: XNode): DataValidation[] {
  const a = attrs(dv);
  const f1 = text(child(dv, "formula1")).trim() || undefined;
  const f2 = text(child(dv, "formula2")).trim() || undefined;
  const type = a.type ?? "none";
  if (type === "none") return [];
  const base: Omit<DataValidation, "id" | "range"> = { kind: "custom" };
  const op = (a.operator ?? "between") as NonNullable<DataValidation["operator"]>;
  if (type === "list") {
    base.kind = "list";
    const lit = f1 && /^"(.*)"$/s.exec(f1);
    if (lit) base.list = lit[1].split(",").map((s) => s.trim());
    else if (f1) base.listSource = f1;
  } else if (type === "decimal" || type === "date") {
    const n1 = numericConst(f1), n2 = numericConst(f2);
    const kind = type === "decimal" ? "number" : "date";
    if (op === "between" && n1 !== null && n2 !== null) { base.kind = kind; base.min = n1; base.max = n2; }
    else if (op === "greaterThanOrEqual" && n1 !== null) { base.kind = kind; base.min = n1; }
    else if (op === "lessThanOrEqual" && n1 !== null) { base.kind = kind; base.max = n1; }
    else { base.kind = type === "decimal" ? "decimal" : "date"; base.operator = op; if (f1) base.formula1 = f1; if (f2) base.formula2 = f2; }
  } else {
    base.kind = type as DataValidation["kind"];
    if (type !== "custom") base.operator = op;
    if (f1) base.formula1 = f1;
    if (f2) base.formula2 = f2;
  }
  if (bool(a.allowBlank)) base.allowBlank = true;
  if (a.prompt) base.message = a.prompt;
  if (a.promptTitle) base.promptTitle = a.promptTitle;
  if (a.error) base.error = a.error;
  if (a.errorTitle) base.errorTitle = a.errorTitle;
  if (a.errorStyle && a.errorStyle !== "stop") base.errorStyle = a.errorStyle as DataValidation["errorStyle"];
  if (bool(a.showDropDown)) base.hideDropDown = true;
  return sqrefParts(a.sqref).map((r, i) => ({ id: `dv_${hashValue([a.sqref, i, f1]).slice(0, 8)}`, range: stripAbs(r), ...base }));
}

function parseFilter(af: XNode): { range: string; criteria: Record<string, FilterCriteria> } | null {
  const ref = attrs(af).ref;
  if (!ref) return null;
  let start = 0;
  try { start = normalizeRange(parseRange(stripAbs(ref))).start.col; } catch { return null; }
  const criteria: Record<string, FilterCriteria> = {};
  for (const fc of children(af, "filterColumn")) {
    const col = colToLetter(start + Number(attrs(fc).colId ?? 0));
    const filters = child(fc, "filters");
    const custom = child(fc, "customFilters");
    if (filters) {
      const values = children(filters, "filter").map((f) => attrs(f).val ?? "");
      if (bool(attrs(filters).blank)) values.push("");
      criteria[col] = { values };
    } else if (custom) {
      const cf = children(custom, "customFilter")[0];
      if (!cf) continue;
      const ca = attrs(cf);
      const val = ca.val ?? "";
      const OPS: Record<string, FilterCriteria["condition"] extends infer C ? C extends { op: infer O } ? O : never : never> = { equal: "eq", notEqual: "neq", greaterThan: "gt", lessThan: "lt", greaterThanOrEqual: "gte", lessThanOrEqual: "lte" };
      let op = OPS[ca.operator ?? "equal"] ?? "eq";
      let value: string | number = val;
      if (op === "eq" && /^\*.*\*$/.test(val)) { op = "contains"; value = val.slice(1, -1); }
      else if (op === "neq" && /^\*.*\*$/.test(val)) { op = "notContains"; value = val.slice(1, -1); }
      else if (op === "eq" && /^[^*]+\*$/.test(val)) { op = "startsWith"; value = val.slice(0, -1); }
      else if (op === "neq" && val === " ") { op = "notBlank"; value = ""; }
      else if (numericConst(val) !== null) value = Number(val);
      criteria[col] = { condition: op === "notBlank" ? { op } : { op, value } };
    }
  }
  return { range: stripAbs(ref), criteria };
}

export interface ReadOptions { sha256?: string }

/** Read an .xlsx/.xlsm package into the workbook model. Throws on non-OOXML input. */
export function readXlsx(bytes: Uint8Array, opts: ReadOptions = {}): Workbook {
  const pkg = new Package(bytes);
  const rootRels = pkg.rels("");
  const wbPart = rootRels.find((r) => r.type === REL.officeDocument)?.target ?? "xl/workbook.xml";
  const wbXml = pkg.text(wbPart);
  if (!wbXml) throw new Error("Not an Excel workbook (no workbook part)");
  const wbRels = pkg.rels(wbPart);
  const theme = parseTheme(pkg.text(wbRels.find((r) => r.type === REL.theme)?.target ?? ""));
  const parsedStyles = parseStyles(pkg.text(wbRels.find((r) => r.type === REL.styles)?.target ?? ""), theme);
  const sstXml = pkg.text(wbRels.find((r) => r.type === REL.sharedStrings)?.target ?? "");
  const sst: string[] = sstXml ? children(child(parseXml(sstXml), "sst"), "si").map(siText) : [];
  const wbDoc = child(parseXml(wbXml), "workbook");
  const date1904 = bool(attrs(child(wbDoc, "workbookPr")).date1904);
  const dateOffset = date1904 ? 1462 : 0;

  const styles: Workbook["styles"] = {};
  const styleXf: XlsxSource["styleXf"] = {};
  const styleIdForXf = (xf: number | undefined): string | undefined => {
    if (xf === undefined || !Number.isFinite(xf) || xf <= 0) return undefined;
    const id = `x${xf}`;
    if (!styles[id]) {
      const st: CellStyle = { ...(parsedStyles.xfs[xf] ?? {}) };
      styles[id] = st;
      styleXf[id] = { xf, key: styleKey(st) };
    }
    return id;
  };

  const sheetsIn = children(child(wbDoc, "sheets"), "sheet");
  const sheets: Sheet[] = [];
  const source: XlsxSource = { sha256: opts.sha256 ?? "", sheets: {}, styleXf, workbookFp: "" };
  if (date1904) source.date1904 = true;

  for (const [i, sh] of sheetsIn.entries()) {
    const a = attrs(sh);
    const rel = wbRels.find((r) => r.id === a.id);
    const part = rel?.target;
    const sheet = createSheet(a.name ?? `Sheet${i + 1}`, { id: `sh_${i + 1}` });
    if (a.state === "hidden") sheet.hidden = true;
    if (a.state === "veryHidden") { sheet.hidden = true; sheet.veryHidden = true; }
    const xml = part ? pkg.text(part) : undefined;
    if (part && xml && rel?.type === REL.worksheet) {
      readWorksheet(pkg, part, xml, sheet, { sst, parsedStyles, theme, styleIdForXf, dateOffset });
      source.sheets[sheet.id] = { part, fp: "" };
    } else if (part) {
      // chartsheets / dialog sheets: kept in the package, shown as an empty placeholder sheet
      source.sheets[sheet.id] = { part, fp: "" };
    }
    sheets.push(sheet);
  }
  if (!sheets.length) sheets.push(createSheet("Sheet1", { id: "sh_1" }));

  // defined names
  const namedRanges: Record<string, string> = {};
  const extraNames: ExtraName[] = [];
  const printInfo: Record<number, SheetPageSetup> = {};
  for (const dn of children(child(wbDoc, "definedNames"), "definedName")) {
    const a = attrs(dn);
    const name = a.name ?? "";
    const value = text(dn).trim();
    const local = a.localSheetId !== undefined ? Number(a.localSheetId) : undefined;
    const sheet = local !== undefined ? sheets[local] : undefined;
    if (name === "_xlnm._FilterDatabase") continue;
    if (name === "_xlnm.Print_Area" && sheet) { const ref = value.split(",")[0]; (printInfo[local!] ??= {}).printArea = stripAbs(ref.includes("!") ? ref.slice(ref.lastIndexOf("!") + 1) : ref); continue; }
    if (name === "_xlnm.Print_Titles" && sheet) {
      for (const part of value.split(",")) {
        const body = stripAbs(part.includes("!") ? part.slice(part.lastIndexOf("!") + 1) : part);
        const rows = /^(\d+):(\d+)$/.exec(body);
        const cols = /^([A-Z]+):([A-Z]+)$/.exec(body);
        if (rows && rows[1] === "1") (printInfo[local!] ??= {}).repeatHeaderRows = Number(rows[2]);
        else if (cols) (printInfo[local!] ??= {}).repeatCols = body;
      }
      continue;
    }
    const plainRef = /^(?:'(?:[^']|'')+'|[A-Za-z0-9_.]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/.test(value);
    if (plainRef && !bool(a.hidden) && !name.startsWith("_xlnm.") && !a.comment) {
      if (sheet) (sheet.localNames ??= {})[name] = stripAbs(value);
      else namedRanges[name] = stripAbs(value);
      continue;
    }
    const extra: ExtraName = { name, value };
    if (sheet) extra.sheet = sheet.name;
    if (bool(a.hidden)) extra.hidden = true;
    if (a.comment) extra.comment = a.comment;
    extraNames.push(extra);
  }

  // print settings: workbook default from the first sheet, per-sheet overrides only where different
  const sheetSetups = sheets.map((s, i) => ({ ...(s.pageSetup ?? {}), ...(printInfo[i] ?? {}) }));
  const base: PageSetup = { ...DEFAULT_PAGE_SETUP, ...sheetSetups[0], margins: { ...DEFAULT_PAGE_SETUP.margins, ...(sheetSetups[0]?.margins ?? {}) } };
  if (!sheetSetups[0]?.repeatHeaderRows) delete base.repeatHeaderRows;
  if (!sheetSetups[0]?.header) delete base.header;
  if (!sheetSetups[0]?.footer) delete base.footer;
  sheets.forEach((s, i) => {
    const eff = sheetSetups[i];
    const diff: SheetPageSetup = {};
    for (const [k, v] of Object.entries(eff) as [keyof PageSetup, unknown][]) {
      if (JSON.stringify(v) !== JSON.stringify(base[k])) (diff as Record<string, unknown>)[k] = v;
    }
    for (const k of ["repeatHeaderRows", "header", "footer", "printArea", "repeatCols"] as const) if (base[k] !== undefined && eff[k] === undefined && i > 0) (diff as Record<string, unknown>)[k] = null;
    if (Object.keys(diff).length) s.pageSetup = diff; else delete s.pageSetup;
  });

  const bookView = children(child(wbDoc, "bookViews"), "workbookView")[0] ?? child(child(wbDoc, "bookViews"), "workbookView");
  const activeTab = Number(attrs(bookView).activeTab ?? 0);
  const wb: Workbook = { version: 1, activeSheet: Math.min(Math.max(0, activeTab), sheets.length - 1), sheets, styles, namedRanges, pageSetup: base };
  if (extraNames.length) wb.extraNames = extraNames;
  for (const s of sheets) if (source.sheets[s.id]) source.sheets[s.id].fp = sheetFingerprint(wb, s);
  source.workbookFp = workbookFingerprint(wb);
  wb.xlsxSource = source;
  return wb;
}

interface SheetCtx {
  sst: string[];
  parsedStyles: ReturnType<typeof parseStyles>;
  theme: string[];
  styleIdForXf: (xf: number | undefined) => string | undefined;
  dateOffset: number;
}

function readWorksheet(pkg: Package, part: string, xml: string, sheet: Sheet, ctx: SheetCtx) {
  const rels = pkg.rels(part);
  const top = splitTopLevel(xml);
  const doc = child(parseXml(xml), "worksheet") ?? {};

  // sheetPr
  const pr = child(doc, "sheetPr");
  const tab = resolveColor(child(pr, "tabColor"), ctx.theme);
  if (tab) sheet.color = tab;
  const fitToPage = bool(attrs(child(pr, "pageSetUpPr")).fitToPage);

  // default sizes
  const fmt = attrs(child(doc, "sheetFormatPr"));
  if (fmt.defaultRowHeight) { const px = ptToPx(Number(fmt.defaultRowHeight)); if (px !== DEFAULT_ROW_HEIGHT) sheet.defaultRowHeight = px; }
  const defColPx = fmt.defaultColWidth ? widthToPx(Number(fmt.defaultColWidth)) : Math.ceil((Number(fmt.baseColWidth ?? 8) * 7 + 5) / 8) * 8;
  if (defColPx !== DEFAULT_COL_WIDTH) sheet.defaultColWidth = defColPx;

  // views
  const view = children(child(doc, "sheetViews"), "sheetView")[0];
  if (view) {
    const va = attrs(view);
    const v: NonNullable<Sheet["view"]> = {};
    if (va.showGridLines === "0" || va.showGridLines === "false") v.showGridLines = false;
    if (va.zoomScale && va.zoomScale !== "100") v.zoom = Number(va.zoomScale);
    if (bool(va.rightToLeft)) v.rightToLeft = true;
    if (Object.keys(v).length) sheet.view = v;
    const pane = attrs(child(view, "pane"));
    if (pane.state === "frozen" || pane.state === "frozenSplit") sheet.freeze = { rows: Number(pane.ySplit ?? 0), cols: Number(pane.xSplit ?? 0) };
    const sels = children(view, "selection");
    const sel = sels.find((s) => attrs(s).pane === pane.activePane) ?? sels[sels.length - 1];
    if (sel) {
      const sa = attrs(sel);
      const activeCell = sa.activeCell ?? "A1", sqref = sa.sqref ?? activeCell;
      if (activeCell !== "A1" || sqref !== "A1") sheet.selection = { activeCell, sqref };
    }
  }

  // columns
  const MAX_COL_EXPAND = 1024;
  for (const c of children(child(doc, "cols"), "col")) {
    const a = attrs(c);
    const min = Number(a.min), max = Math.min(Number(a.max), MAX_COL_EXPAND);
    const width = a.width !== undefined ? widthToPx(Number(a.width)) : undefined;
    const sid = ctx.styleIdForXf(a.style !== undefined ? Number(a.style) : undefined);
    for (let i = min; i <= max; i++) {
      const L = colToLetter(i - 1);
      if (width !== undefined && (bool(a.customWidth) || width !== defColPx) && width > 0) sheet.colWidths[L] = width;
      if (bool(a.hidden)) (sheet.hiddenCols ??= []).push(L);
      if (sid) (sheet.colStyles ??= {})[L] = sid;
    }
  }

  // cells
  const shared = new Map<string, { f: string; row: number; col: number }>();
  const sheetData = child(doc, "sheetData");
  let rowIdx = -1;
  for (const row of children(sheetData, "row")) {
    const ra = attrs(row);
    rowIdx = ra.r ? Number(ra.r) - 1 : rowIdx + 1;
    if (ra.ht !== undefined) {
      const px = ptToPx(Number(ra.ht));
      if (px > 0 && (bool(ra.customHeight) || px !== (sheet.defaultRowHeight ?? DEFAULT_ROW_HEIGHT))) sheet.rowHeights[String(rowIdx + 1)] = px;
    }
    if (bool(ra.hidden)) (sheet.hiddenRows ??= []).push(rowIdx + 1);
    if (bool(ra.customFormat) && ra.s !== undefined) { const sid = ctx.styleIdForXf(Number(ra.s)); if (sid) (sheet.rowStyles ??= {})[String(rowIdx + 1)] = sid; }
    let colIdx = -1;
    for (const c of children(row, "c")) {
      const ca = attrs(c);
      let ref: string;
      if (ca.r) { const p = parseA1(ca.r); colIdx = p.col; ref = toA1(p.row, p.col); } else { colIdx += 1; ref = toA1(rowIdx, colIdx); }
      const cell: Cell = {};
      const xf = ca.s !== undefined ? Number(ca.s) : undefined;
      const sid = ctx.styleIdForXf(xf);
      if (sid) cell.s = sid;
      const fNode = child(c, "f");
      const vText = text(child(c, "v"));
      const t = ca.t ?? "n";
      if (fNode) {
        const fa = attrs(fNode);
        let ftext = text(fNode);
        const pos = parseA1(ref);
        if (fa.t === "shared" && fa.si !== undefined) {
          if (ftext.trim()) shared.set(fa.si, { f: ftext, row: pos.row, col: pos.col });
          else { const m = shared.get(fa.si); if (m) ftext = shiftFormula(`=${m.f}`, pos.row - m.row, pos.col - m.col).slice(1); }
        }
        if (ftext.trim()) {
          cell.f = `=${fromFileFormula(ftext)}`;
          if (fa.t === "array" && fa.ref) cell.ar = stripAbs(fa.ref);
        }
      }
      // value (for formula cells: the cached result)
      if (t === "s") { const idx = Number(vText); if (vText !== "" && ctx.sst[idx] !== undefined) { cell.v = ctx.sst[idx]; cell.t = "s"; } }
      else if (t === "inlineStr") { const is = child(c, "is"); const s = is ? siText(is) : ""; cell.v = s; cell.t = "s"; }
      else if (t === "str") { if (vText !== "" || cell.f) { cell.v = unescExcel(vText); if (!cell.f) cell.t = "s"; } }
      else if (t === "b") { if (vText !== "") { cell.v = vText === "1" || vText === "true"; if (!cell.f) cell.t = "b"; } }
      else if (t === "e") { if (vText !== "") { cell.v = vText; if (!cell.f) cell.t = ERRORS.has(vText) ? "e" : "s"; } }
      else if (t === "d") { if (vText) { cell.v = vText.slice(0, 10); if (!cell.f) cell.t = "d"; } }
      else if (vText !== "") {
        const n = Number(vText);
        if (Number.isFinite(n)) {
          const code = xf !== undefined ? ctx.parsedStyles.xfNumFmtCode[xf] : undefined;
          if (!cell.f && isDateOnlyFormat(code) && Number.isInteger(n) && n > 0) { cell.v = serialToISO(n + ctx.dateOffset); cell.t = "d"; }
          else { cell.v = n; if (!cell.f) cell.t = "n"; }
        }
      }
      if (cell.f && cell.t) delete cell.t;
      if (cell.f !== undefined || cell.v !== undefined || cell.s) sheet.cells[ref] = cell;
    }
  }

  // merges
  for (const m of children(child(doc, "mergeCells"), "mergeCell")) { const r = attrs(m).ref; if (r) sheet.merges.push(stripAbs(r)); }

  // autofilter
  const af = child(doc, "autoFilter");
  if (af) { const f = parseFilter(af); if (f) sheet.filters = f; }

  // conditional formatting (verbatim rule XML kept for rules the model does not interpret)
  const cfEls = top.children.filter((k) => k.local === "conditionalFormatting");
  const cfs: ConditionalFormat[] = [];
  cfEls.forEach((k, ci) => {
    const node = child(parseXml(k.xml), "conditionalFormatting");
    const sq = sqrefParts(attrs(node).sqref);
    const ruleXml = splitTopLevel(k.xml).children.filter((x) => x.local === "cfRule").map((x) => x.xml);
    children(node, "cfRule").forEach((rule, ri) => {
      const ra = attrs(rule);
      const parsed = parseCfRule(rule, ruleXml[ri] ?? "", ctx.theme);
      const style = ra.dxfId !== undefined ? { ...(ctx.parsedStyles.dxfs[Number(ra.dxfId)] ?? {}) } : {};
      sq.forEach((range, si) => {
        const cf: ConditionalFormat = { id: `cf_${ci}_${ri}_${si}`, range: stripAbs(range), rule: parsed, style };
        if (ra.priority) cf.priority = Number(ra.priority);
        if (bool(ra.stopIfTrue)) cf.stopIfTrue = true;
        cfs.push(cf);
      });
    });
  });
  sheet.conditionalFormats = cfs;

  // data validation
  const dvs: DataValidation[] = [];
  for (const dv of children(child(doc, "dataValidations"), "dataValidation")) dvs.push(...parseValidation(dv));
  sheet.validations = dvs;

  // hyperlinks
  const links: Hyperlink[] = [];
  for (const h of children(child(doc, "hyperlinks"), "hyperlink")) {
    const ha = attrs(h);
    const refs = sqrefParts(ha.ref);
    const rel = ha.id ? rels.find((r) => r.id === ha.id) : undefined;
    for (const ref of refs) {
      const l: Hyperlink = { ref: stripAbs(ref) };
      if (rel) l.target = rel.target;
      if (ha.location) l.location = ha.location;
      if (ha.tooltip) l.tooltip = ha.tooltip;
      if (ha.display) l.display = ha.display;
      links.push(l);
    }
  }
  if (links.length) sheet.hyperlinks = links;

  // print settings
  const ps: SheetPageSetup = {};
  const po = attrs(child(doc, "printOptions"));
  if (bool(po.gridLines)) ps.gridlines = true;
  if (bool(po.horizontalCentered)) ps.centerHorizontally = true;
  if (bool(po.verticalCentered)) ps.centerVertically = true;
  const pm = attrs(child(doc, "pageMargins"));
  if (pm.left !== undefined) {
    ps.margins = { top: Number(pm.top ?? 0.75), right: Number(pm.right ?? 0.7), bottom: Number(pm.bottom ?? 0.75), left: Number(pm.left ?? 0.7) };
    if (pm.header !== undefined && Number(pm.header) !== 0.3) ps.headerMargin = Number(pm.header);
    if (pm.footer !== undefined && Number(pm.footer) !== 0.3) ps.footerMargin = Number(pm.footer);
  }
  const pg = attrs(child(doc, "pageSetup"));
  if (pg.orientation === "landscape" || pg.orientation === "portrait") ps.orientation = pg.orientation;
  if (pg.paperSize) { const p = PAPER_BY_ID[Number(pg.paperSize)]; if (p) ps.paper = p; else ps.paperSize = Number(pg.paperSize); }
  if (pg.scale && pg.scale !== "100") ps.scale = Number(pg.scale);
  if (fitToPage) {
    ps.fitToPage = true;
    // the model's fitToPage alone means "one page wide" (fitToWidth 1, fitToHeight 0); other fits are explicit
    const fw = pg.fitToWidth !== undefined ? Number(pg.fitToWidth) : 1, fh = pg.fitToHeight !== undefined ? Number(pg.fitToHeight) : 1;
    if (!(fw === 1 && fh === 0)) { ps.fitToWidth = fw; ps.fitToHeight = fh; }
  }
  const hf = child(doc, "headerFooter");
  const oh = headerFromExcel(text(child(hf, "oddHeader")) || undefined);
  const of = headerFromExcel(text(child(hf, "oddFooter")) || undefined);
  if (oh) ps.header = oh;
  if (of) ps.footer = of;
  if (Object.keys(ps).length) sheet.pageSetup = ps;

  // charts
  const drawingRid = attrs(child(doc, "drawing")).id;
  const drawingRel = drawingRid ? rels.find((r) => r.id === drawingRid) : undefined;
  if (drawingRel && !drawingRel.external) readCharts(pkg, drawingRel.target, sheet);

  // notes
  const commentsRel = rels.find((r) => r.type === REL.comments);
  if (commentsRel) {
    const cx = pkg.text(commentsRel.target);
    if (cx) {
      const cdoc = child(parseXml(cx), "comments");
      const authors = children(child(cdoc, "authors"), "author").map((a) => text(a));
      const notes: NonNullable<Sheet["notes"]> = {};
      for (const cm of children(child(cdoc, "commentList"), "comment")) {
        const ca = attrs(cm);
        if (!ca.ref) continue;
        const note = { text: siText(child(cm, "text") ?? {}) } as { author?: string; text: string };
        const author = authors[Number(ca.authorId ?? 0)];
        if (author) note.author = author;
        notes[stripAbs(ca.ref)] = note;
      }
      if (Object.keys(notes).length) sheet.notes = notes;
    }
  }
}

function readCharts(pkg: Package, drawingPart: string, sheet: Sheet) {
  const xml = pkg.text(drawingPart);
  if (!xml) return;
  const rels = pkg.rels(drawingPart);
  const doc = child(parseXml(xml), "wsDr");
  const anchors = [...children(doc, "twoCellAnchor"), ...children(doc, "oneCellAnchor")];
  let n = 0;
  for (const an of anchors) {
    const chartRid = attrs(child(child(child(child(an, "graphicFrame"), "graphic"), "graphicData"), "chart")).id;
    if (!chartRid) continue;
    const rel = rels.find((r) => r.id === chartRid);
    if (!rel) continue;
    const cx = pkg.text(rel.target);
    if (!cx) continue;
    let parsed: ReturnType<typeof parseChartXml> = null;
    try { parsed = parseChartXml(cx, sheet.name); } catch { parsed = null; }
    const pt = (node: XNode | undefined) => ({ col: Number(text(child(node, "col")) || 0), colOff: Number(text(child(node, "colOff")) || 0), row: Number(text(child(node, "row")) || 0), rowOff: Number(text(child(node, "rowOff")) || 0) });
    const from = pt(child(an, "from"));
    let to = pt(child(an, "to"));
    if (!child(an, "to")) {
      const ext = attrs(child(an, "ext"));
      const w = Number(ext.cx ?? 4572000) / 9525, h = Number(ext.cy ?? 2743200) / 9525;
      to = { col: from.col, colOff: from.colOff + Math.round(w * 9525), row: from.row, rowOff: from.rowOff + Math.round(h * 9525) };
    }
    const anchor: Anchor = { from, to };
    const position = anchorToPx(sheet, anchor);
    const model: SheetChart = parsed
      ? { id: `ch_${sheet.id}_${n}`, ...parsed, position }
      : { id: `ch_${sheet.id}_${n}`, type: "bar", title: "(unsupported chart)", range: "A1", hasHeader: false, position };
    model.xlsx = { part: rel.target, fp: "" };
    model.xlsx.fp = chartFingerprint(model, sheet.name);
    sheet.charts.push(model);
    n++;
  }
}

/**
 * Fingerprint of a chart's model (without its provenance) and the name of the sheet it reads from — unchanged
 * charts keep their original part; a renamed sheet regenerates the chart so its series references stay valid.
 */
export function chartFingerprint(chart: SheetChart, sheetName: string): string {
  const { xlsx: _x, id: _id, ...rest } = chart;
  void _x; void _id;
  return hashValue({ rest, sheetName });
}

export { letterToCol, rangeToA1 };
