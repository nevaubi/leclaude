/**
 * Deterministic Excel formula parser (formula text → AST) and plain-language
 * rendering. Used by explain_formula and the formula audit; no model involved.
 */

export type FNode =
  | { k: "num"; v: number; raw: string }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: string }
  | { k: "ref"; text: string }
  | { k: "name"; name: string }
  | { k: "func"; name: string; args: FNode[] }
  | { k: "unary"; op: "-" | "+"; arg: FNode }
  | { k: "percent"; arg: FNode }
  | { k: "bin"; op: string; l: FNode; r: FNode }
  | { k: "array"; rows: FNode[][] };

type Tok = { t: "num" | "str" | "bool" | "err" | "ref" | "name" | "func" | "op" | "(" | ")" | "," | ";" | "{" | "}"; v: string };

const REF_RE = /^(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(?:\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![A-Za-z0-9_(])/;

export function lexFormula(src: string): Tok[] {
  const s = src.startsWith("=") ? src.slice(1) : src;
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, v = "";
      while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue; } break; } v += s[j]; j++; }
      out.push({ t: "str", v }); i = j + 1; continue;
    }
    if (ch === "#") { const m = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)/.exec(s.slice(i)); if (m) { out.push({ t: "err", v: m[0] }); i += m[0].length; continue; } }
    const rest = s.slice(i);
    const ref = REF_RE.exec(rest);
    if (ref && !/[A-Za-z0-9_.]/.test(s[i - 1] ?? "")) { out.push({ t: "ref", v: ref[0] }); i += ref[0].length; continue; }
    const num = /^\d+(\.\d*)?([Ee][+-]?\d+)?|^\.\d+([Ee][+-]?\d+)?/.exec(rest);
    if (num) { out.push({ t: "num", v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_\\][A-Za-z0-9_.]*/.exec(rest);
    if (id) {
      const after = s.slice(i + id[0].length);
      if (/^\s*\(/.test(after)) out.push({ t: "func", v: id[0].toUpperCase() });
      else if (/^(TRUE|FALSE)$/i.test(id[0])) out.push({ t: "bool", v: id[0].toUpperCase() });
      else out.push({ t: "name", v: id[0] });
      i += id[0].length; continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^&=<>%".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
    if (ch === "(" || ch === ")" || ch === "," || ch === ";" || ch === "{" || ch === "}") { out.push({ t: ch, v: ch }); i++; continue; }
    throw new Error(`Unexpected "${ch}" at position ${i + 1}`);
  }
  return out;
}

/** Parse a formula into an AST. Throws with a readable message on syntax errors. */
export function parseFormula(src: string): FNode {
  const toks = lexFormula(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: Tok["t"]) => { const k = next(); if (!k || k.t !== t) throw new Error(`Expected "${t}"${k ? ` but found "${k.v}"` : " at end"}`); return k; };
  const CMP = ["=", "<>", "<", ">", "<=", ">="];
  const expr = (): FNode => comparison();
  const comparison = (): FNode => { let l = concat(); while (peek()?.t === "op" && CMP.includes(peek()!.v)) { const op = next().v; l = { k: "bin", op, l, r: concat() }; } return l; };
  const concat = (): FNode => { let l = additive(); while (peek()?.t === "op" && peek()!.v === "&") { next(); l = { k: "bin", op: "&", l, r: additive() }; } return l; };
  const additive = (): FNode => { let l = mult(); while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) { const op = next().v; l = { k: "bin", op, l, r: mult() }; } return l; };
  const mult = (): FNode => { let l = power(); while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) { const op = next().v; l = { k: "bin", op, l, r: power() }; } return l; };
  const power = (): FNode => { let l = unary(); while (peek()?.t === "op" && peek()!.v === "^") { next(); l = { k: "bin", op: "^", l, r: unary() }; } return l; };
  const unary = (): FNode => {
    if (peek()?.t === "op" && (peek()!.v === "-" || peek()!.v === "+")) { const op = next().v as "-" | "+"; return { k: "unary", op, arg: unary() }; }
    let n = primary();
    while (peek()?.t === "op" && peek()!.v === "%") { next(); n = { k: "percent", arg: n }; }
    return n;
  };
  const primary = (): FNode => {
    const t = next();
    if (!t) throw new Error("Unexpected end of formula");
    switch (t.t) {
      case "num": return { k: "num", v: Number(t.v), raw: t.v };
      case "str": return { k: "str", v: t.v };
      case "bool": return { k: "bool", v: t.v === "TRUE" };
      case "err": return { k: "err", v: t.v };
      case "ref": return { k: "ref", text: t.v };
      case "name": return { k: "name", name: t.v };
      case "(": { const e = expr(); expect(")"); return e; }
      case "{": {
        const rows: FNode[][] = [[]];
        while (peek() && peek()!.t !== "}") {
          rows[rows.length - 1].push(unary());
          if (peek()?.t === ",") next();
          else if (peek()?.t === ";") { next(); rows.push([]); }
        }
        expect("}");
        return { k: "array", rows };
      }
      case "func": {
        expect("(");
        const args: FNode[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            if (peek()?.t === "," ) { args.push({ k: "str", v: "" }); next(); continue; }
            args.push(expr());
            if (peek()?.t === ",") { next(); if (peek()?.t === ")") { args.push({ k: "str", v: "" }); break; } continue; }
            break;
          }
        }
        expect(")");
        return { k: "func", name: t.v.replace(/^_XLFN\.(_XLWS\.)?/, ""), args };
      }
      default: throw new Error(`Unexpected "${t.v}"`);
    }
  };
  const root = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}" after the end of the expression`);
  return root;
}

export function walk(n: FNode, fn: (n: FNode) => void) {
  fn(n);
  switch (n.k) {
    case "func": n.args.forEach((a) => walk(a, fn)); break;
    case "unary": case "percent": walk(n.arg, fn); break;
    case "bin": walk(n.l, fn); walk(n.r, fn); break;
    case "array": n.rows.flat().forEach((a) => walk(a, fn)); break;
  }
}

/** Collected facts about a formula. */
export function formulaFacts(src: string): { functions: string[]; refs: string[]; names: string[]; constants: { value: number; raw: string }[] } {
  const ast = parseFormula(src);
  const functions = new Set<string>(), refs: string[] = [], names = new Set<string>(), constants: { value: number; raw: string }[] = [];
  walk(ast, (n) => {
    if (n.k === "func") functions.add(n.name);
    else if (n.k === "ref") refs.push(n.text);
    else if (n.k === "name") names.add(n.name);
    else if (n.k === "num") constants.push({ value: n.v, raw: n.raw });
  });
  return { functions: [...functions], refs, names: [...names], constants };
}

export interface ExplainContext {
  /** Describe a reference (A1, range, or name) — e.g. "B4 (Total fees = $19,745.00)". */
  describeRef: (text: string) => string;
}

const OPS: Record<string, string> = { "+": "plus", "-": "minus", "*": "times", "/": "divided by", "^": "to the power of", "&": "joined with", "=": "equals", "<>": "is not equal to", "<": "is less than", ">": "is greater than", "<=": "is at most", ">=": "is at least" };

function criteria(n: FNode, ctx: ExplainContext): string {
  if (n.k === "str") { const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(n.v); if (m) return `${OPS[m[1]] ?? m[1]} ${m[2]}`; return `equals "${n.v}"`; }
  return `equals ${say(n, ctx)}`;
}

/** Plain-language rendering of an AST. */
export function say(n: FNode, ctx: ExplainContext): string {
  const a = (i: number) => (n.k === "func" && n.args[i] ? say(n.args[i], ctx) : "");
  switch (n.k) {
    case "num": return n.raw;
    case "str": return `"${n.v}"`;
    case "bool": return n.v ? "TRUE" : "FALSE";
    case "err": return `the error ${n.v}`;
    case "ref": return ctx.describeRef(n.text);
    case "name": return ctx.describeRef(n.name);
    case "unary": return n.op === "-" ? `negative ${say(n.arg, ctx)}` : say(n.arg, ctx);
    case "percent": return `${say(n.arg, ctx)} percent`;
    case "array": return `the list {${n.rows.map((r) => r.map((x) => say(x, ctx)).join(", ")).join("; ")}}`;
    case "bin": return `(${say(n.l, ctx)} ${OPS[n.op] ?? n.op} ${say(n.r, ctx)})`;
    case "func": {
      const args = n.args;
      const list = () => args.map((x) => say(x, ctx)).join(", ");
      const pairs = (from: number) => { const out: string[] = []; for (let i = from; i + 1 < args.length; i += 2) out.push(`${say(args[i], ctx)} ${criteria(args[i + 1], ctx)}`); return out.join(" and "); };
      switch (n.name) {
        case "SUM": return `the sum of ${list()}`;
        case "AVERAGE": return `the average of ${list()}`;
        case "MIN": return `the smallest of ${list()}`;
        case "MAX": return `the largest of ${list()}`;
        case "COUNT": return `the number of numeric cells in ${list()}`;
        case "COUNTA": return `the number of non-empty cells in ${list()}`;
        case "COUNTBLANK": return `the number of blank cells in ${list()}`;
        case "PRODUCT": return `the product of ${list()}`;
        case "SUMPRODUCT": return `the sum of the element-wise products of ${list()}`;
        case "ABS": return `the absolute value of ${a(0)}`;
        case "ROUND": return `${a(0)} rounded to ${a(1)} decimal place(s)`;
        case "ROUNDUP": return `${a(0)} rounded up to ${a(1)} decimal place(s)`;
        case "ROUNDDOWN": return `${a(0)} rounded down to ${a(1)} decimal place(s)`;
        case "IF": return `if ${a(0)} then ${a(1) || "TRUE"}, otherwise ${args[2] ? a(2) : "FALSE"}`;
        case "IFS": { const out: string[] = []; for (let i = 0; i + 1 < args.length; i += 2) out.push(`if ${say(args[i], ctx)} then ${say(args[i + 1], ctx)}`); return out.join("; else "); }
        case "IFERROR": return `${a(0)}, or ${a(1)} if that results in an error`;
        case "IFNA": return `${a(0)}, or ${a(1)} if that is #N/A`;
        case "AND": return `all of (${args.map((x) => say(x, ctx)).join("; ")}) are true`;
        case "OR": return `any of (${args.map((x) => say(x, ctx)).join("; ")}) is true`;
        case "NOT": return `not ${a(0)}`;
        case "SUMIF": return `the sum of ${args[2] ? a(2) : a(0)} where ${a(0)} ${criteria(args[1], ctx)}`;
        case "SUMIFS": return `the sum of ${a(0)} where ${pairs(1)}`;
        case "COUNTIF": return `the number of cells in ${a(0)} that ${criteria(args[1], ctx)}`;
        case "COUNTIFS": return `the number of rows where ${pairs(0)}`;
        case "AVERAGEIFS": return `the average of ${a(0)} where ${pairs(1)}`;
        case "MAXIFS": return `the largest of ${a(0)} where ${pairs(1)}`;
        case "MINIFS": return `the smallest of ${a(0)} where ${pairs(1)}`;
        case "VLOOKUP": {
          const x = args[3];
          const exact = Boolean(x && ((x.k === "bool" && !x.v) || (x.k === "num" && x.v === 0)));
          return `the value in column ${a(2)} of ${a(1)} on the row whose first column matches ${a(0)}${exact ? " (exact match)" : " (approximate match — the first column must be sorted)"}`;
        }
        case "HLOOKUP": return `the value in row ${a(2)} of ${a(1)} in the column whose first row matches ${a(0)}`;
        case "XLOOKUP": return `the value from ${a(2)} on the row where ${a(1)} equals ${a(0)}${args[3] ? `, or ${a(3)} if there is no match` : " (#N/A if there is no match)"}`;
        case "INDEX": return `the value at row ${a(1)}${args[2] ? `, column ${a(2)}` : ""} of ${a(0)}`;
        case "MATCH": return `the position of ${a(0)} within ${a(1)}${args[2] && say(args[2], ctx) === "0" ? " (exact match)" : ""}`;
        case "XMATCH": return `the position of ${a(0)} within ${a(1)}`;
        case "TODAY": return "today's date";
        case "NOW": return "the current date and time";
        case "DATE": return `the date ${a(0)}-${a(1)}-${a(2)} (year-month-day)`;
        case "EDATE": return `the date ${a(1)} month(s) after ${a(0)}`;
        case "EOMONTH": return `the last day of the month ${a(1)} month(s) after ${a(0)}`;
        case "WORKDAY": return `the date ${a(1)} business day(s) after ${a(0)}${args[2] ? `, skipping holidays in ${a(2)}` : ""}`;
        case "NETWORKDAYS": return `the number of business days from ${a(0)} to ${a(1)}${args[2] ? `, excluding holidays in ${a(2)}` : ""}`;
        case "DATEDIF": return `the difference between ${a(0)} and ${a(1)} in unit ${a(2)}`;
        case "DAYS": return `the number of days from ${a(1)} to ${a(0)}`;
        case "YEARFRAC": return `the fraction of a year between ${a(0)} and ${a(1)}${args[2] ? ` (day-count basis ${a(2)})` : ""}`;
        case "YEAR": return `the year of ${a(0)}`;
        case "MONTH": return `the month of ${a(0)}`;
        case "DAY": return `the day of the month of ${a(0)}`;
        case "TEXT": return `${a(0)} formatted as ${a(1)}`;
        case "CONCAT": case "CONCATENATE": return `the text ${args.map((x) => say(x, ctx)).join(" + ")}`;
        case "TEXTJOIN": return `the values of ${args.slice(2).map((x) => say(x, ctx)).join(", ")} joined with ${a(0)}`;
        case "PV": return `the present value of payments ${a(2)} over ${a(1)} periods at rate ${a(0)}`;
        case "FV": return `the future value of payments ${a(2)} over ${a(1)} periods at rate ${a(0)}`;
        case "NPV": return `the net present value at rate ${a(0)} of ${args.slice(1).map((x) => say(x, ctx)).join(", ")}`;
        case "PMT": return `the payment for a loan of ${a(2)} over ${a(1)} periods at rate ${a(0)}`;
        default: return `${n.name}(${list()})`;
      }
    }
  }
}
