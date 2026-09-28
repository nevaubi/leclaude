/**
 * Spreadsheet agent: every tool, mode toolsets (Ask has no edit tools), stale-proposal rejection, the
 * deterministic audit / explain / trace / date math, and live-formula builders (summaries, lookups, interest).
 */
import { describe, expect, it } from "vitest";
import type { EditProposal } from "@/modules/office/shared/types";
import type { OfficeAgentContext } from "@/modules/office/shared/route-factory";
import { computeWorkbook, SheetEngine } from "@/modules/office/sheet/engine";
import { emptyWorkbook, type Workbook } from "@/modules/office/sheet/model";
import { applyOp, type SheetOp } from "@/modules/office/sheet/ops";
import { buildSnapshot, renderSnapshot, type SheetSnapshot } from "@/modules/office/sheet/snapshot";
import { sheetAgentTools, toolAccess } from "@/modules/office/sheet/agent-tools";
import { routeSheetRequest, SHEET_INSTRUCTIONS } from "@/modules/office/sheet/agent";
import { applyChecked, proposalBase, staleReason, type ProposalBase } from "@/modules/office/sheet/proposal-base";
import { auditFormulas, dateMath, interestPeriods, usFederalHolidays } from "@/modules/office/sheet/analysis";
import { parseFormula } from "@/modules/office/sheet/formula-ast";
import { conditionalStyles } from "@/modules/office/sheet/cell-render";

function wbWith(ops: SheetOp[], base: Workbook = emptyWorkbook()): Workbook { return ops.reduce((wb, op) => applyOp(wb, op), base); }

function makeCtx(wb: Workbook, mode: OfficeAgentContext<SheetSnapshot>["mode"] = "draft") {
  const proposals: EditProposal[] = [];
  const snapshot = buildSnapshot(wb, computeWorkbook(wb), { title: "Test workbook" });
  const ctx: OfficeAgentContext<SheetSnapshot> = {
    mode, scope: null, research: false, snapshot, matter: null, docTitle: "Test workbook", context: {}, proposals, findings: [],
    emit: () => {},
    propose: (p) => { const full: EditProposal = { id: `p${proposals.length + 1}`, status: "pending", ...p }; proposals.push(full); return full; },
    finding: (f) => ({ id: "f", ...f }),
  };
  return { ctx, proposals, snapshot, tools: sheetAgentTools(ctx) };
}

function call(tools: ReturnType<typeof sheetAgentTools>, name: string, args: Record<string, unknown> = {}) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return (t.execute as (a: unknown, c: unknown) => unknown)(args, { emit: () => {}, state: {} }) as Record<string, unknown> & { verify?: { results?: { ref: string; value: unknown }[]; newErrors?: unknown[]; circular?: boolean } };
}

const LEDGER = () => wbWith([
  { type: "build_table", anchor: "A1", headers: ["Category", "Vendor", "Amount", "Date"], rows: [
    ["Experts", "Acme Forensics", 18500, "2026-01-12"], ["Filing", "Clerk", 405, "2026-01-15"], ["Experts", "Delta Econ", 22000, "2026-02-03"],
    ["Depositions", "Veritext", 3120.5, "2026-02-10"], ["Filing", "Clerk", 52, "2026-03-01"], ["Depositions", "Esquire", 2890, "2026-03-09"],
  ] },
]);

describe("modes", () => {
  it("Ask mode exposes only read tools; Review adds comments and non-destructive suggestions; Draft has everything", () => {
    const draft = makeCtx(LEDGER(), "draft").tools.map((t) => t.name);
    const review = makeCtx(LEDGER(), "review").tools.map((t) => t.name);
    const ask = makeCtx(LEDGER(), "ask").tools.map((t) => t.name);
    for (const n of ["write_range", "set_style", "merge_cells", "unmerge_cells", "insert_rows", "delete_cols", "sort_range", "add_filter", "clear_filter", "create_named_range", "set_data_validation", "add_conditional_format", "set_freeze_panes", "create_chart", "summarize_table", "lookup_join", "damages_schedule", "hide_rows_cols", "audit_formulas", "explain_formula", "trace_precedents", "trace_dependents", "date_math", "evaluate_formula", "get_workbook_summary"]) expect(draft).toContain(n);
    expect(ask.every((n) => toolAccess(n) === "read")).toBe(true);
    for (const n of ["set_cells", "write_range", "add_comment", "delete_rows", "create_chart", "set_style", "summarize_table"]) expect(ask).not.toContain(n);
    for (const n of ["get_range", "audit_formulas", "explain_formula", "trace_precedents", "trace_dependents", "evaluate_formula", "date_math"]) expect(ask).toContain(n);
    expect(review).toContain("add_comment");
    expect(review).toContain("set_cells");
    for (const n of ["delete_rows", "insert_cols", "sort_range", "clear_range", "build_table", "summarize_table", "add_sheet"]) expect(review).not.toContain(n);
    expect(draft.length).toBeGreaterThan(review.length);
    expect(review.length).toBeGreaterThan(ask.length);
  });

  it("review-mode edits are marked as suggestions", () => {
    const { tools, proposals } = makeCtx(LEDGER(), "review");
    call(tools, "set_number_format", { range: "C2:C7", numFmt: "$#,##0.00" });
    expect(proposals[0].title).toMatch(/^Suggested: /);
    expect((proposals[0].payload as { suggestion?: boolean }).suggestion).toBe(true);
  });

  it("instructions are static and requests are routed deterministically", () => {
    expect(SHEET_INSTRUCTIONS).not.toMatch(/\$\{/);
    expect(SHEET_INSTRUCTIONS).toContain("NUMBERS ARE COMPUTED, NEVER GUESSED");
    expect(routeSheetRequest("Bold row 1", "draft")).toMatchObject({ fast: true, reasoningEffort: "low" });
    expect(routeSheetRequest("Build a damages model with prejudgment interest", "draft")).toMatchObject({ fast: false, reasoningEffort: "high" });
    expect(routeSheetRequest("check it", "review").fast).toBe(false);
  });
});

describe("stale proposals", () => {
  it("rejects a proposal whose target the user changed, applies ones whose target is untouched", () => {
    const wb = LEDGER();
    const { tools, proposals } = makeCtx(wb);
    call(tools, "set_cells", { cells: [{ ref: "C2", value: 19000 }] });
    call(tools, "set_style", { range: "A1:D1", style: { italic: true } });
    const items = proposals.map((p) => ({ id: p.id, op: (p.payload as { op: SheetOp }).op, base: (p.payload as { base: ProposalBase[] }).base }));
    expect(items[0].base[0]).toMatchObject({ range: "C2" });
    // the user edits C2 in the grid before applying
    const userEdited = applyOp(wb, { type: "set_cells", sheet: "sh_1", cells: [{ ref: "C2", value: 17500 }] });
    const r = applyChecked(userEdited, items);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ id: "p1", stale: true });
    expect(r.failed[0].error).toMatch(/Stale proposal: Sheet1!C2 changed/);
    expect(r.applied.map((a) => a.id)).toEqual(["p2"]);
    expect(r.workbook.sheets[0].cells.C2.v).toBe(17500); // never overwritten
    // untouched workbook: everything applies and reproduces the server state
    const clean = applyChecked(wb, items);
    expect(clean.failed).toEqual([]);
    expect(clean.workbook.sheets[0].cells.C2.v).toBe(19000);
  });

  it("structural proposals are stale after any edit on the sheet; chained proposals apply in order", () => {
    const wb = LEDGER();
    const base = proposalBase(wb, { type: "sort_range", sheet: "sh_1", range: "A1:D7", by: "C", has_header: true });
    expect(base[0].range).toBeNull();
    expect(staleReason(applyOp(wb, { type: "set_cells", sheet: "sh_1", cells: [{ ref: "H40", value: "x" }] }), base)).toMatch(/sheet "Sheet1"/);
    expect(staleReason(wb, base)).toBeNull();
    const { tools, proposals } = makeCtx(wb);
    call(tools, "set_cells", { cells: [{ ref: "F2", value: 1 }] });
    call(tools, "set_cells", { cells: [{ ref: "F2", value: 2 }] }); // depends on the first
    const items = proposals.map((p) => ({ id: p.id, op: (p.payload as { op: SheetOp }).op, base: (p.payload as { base: ProposalBase[] }).base }));
    expect(applyChecked(wb, items).failed).toEqual([]);
    expect(applyChecked(wb, [items[1]]).failed[0]?.stale).toBe(true); // out of order = stale, not rebased silently
  });
});

describe("read tools", () => {
  it("summarizes without dumping every cell and reads several ranges at once", () => {
    const rows = Array.from({ length: 400 }, (_, i) => [`Item ${i + 1}`, i * 10, `=B${i + 2}*2`]);
    const wb = wbWith([{ type: "build_table", anchor: "A1", headers: ["Item", "Qty", "Double"], rows, total_row: true }]);
    const { tools, snapshot } = makeCtx(wb);
    const summary = String(call(tools, "get_workbook_summary", {}) as unknown);
    expect(summary).toContain("C2:C401 ×400 like {=B2*2}");
    expect(summary).toContain("headers (row 1)");
    expect(summary).toContain("omitted; use get_range");
    expect(summary).not.toContain("Item 200");
    const rendered = renderSnapshot(snapshot, null);
    expect(rendered.length).toBeLessThan(6000);
    const multi = call(tools, "get_range", { ranges: ["A1:C2", "B402"], values_only: true }) as { ranges: { range: string; rows: Record<string, unknown>[] }[] };
    expect(multi.ranges.map((r) => r.range)).toEqual(["A1:C2", "B402"]);
    expect(multi.ranges[1].rows[0].B).toEqual({ v: 798000, f: "=SUM(B2:B401)" });
  });

  it("evaluates formulas with the engine and never needs model arithmetic", () => {
    const { tools } = makeCtx(LEDGER());
    expect(call(tools, "evaluate_formula", { formula: '=SUMIFS(C2:C7,A2:A7,"Experts")' })).toMatchObject({ value: 40500 });
    expect(call(tools, "evaluate_formula", { formula: "=1/0" })).toMatchObject({ isError: true });
  });

  it("explains a formula deterministically with referenced values", () => {
    const wb = wbWith([{ type: "set_cells", cells: [{ ref: "A1", value: "Gross" }, { ref: "B1", value: 250000 }, { ref: "A2", value: "Fee rate" }, { ref: "B2", value: 0.3333 }, { ref: "A3", value: "Fee" }, { ref: "B3", formula: "=ROUND(B1*B2,2)" }, { ref: "B4", formula: '=IF(B3>50000,"review","ok")' }] }]);
    const { tools } = makeCtx(wb);
    const e = call(tools, "explain_formula", { cell: "B3" }) as { explanation: string; value: number; functions: string[] };
    expect(e.value).toBe(83325);
    expect(e.explanation).toContain("rounded to 2 decimal place(s)");
    expect(e.explanation).toContain("B1 [Gross] (= 250000)");
    expect(e.functions).toEqual(["ROUND"]);
    const e2 = call(tools, "explain_formula", { cell: "B4" }) as { explanation: string; value: string };
    expect(e2.explanation).toMatch(/^B4 = if \(B3 \[Fee\] \(= 83325\) is greater than 50000\) then "review", otherwise "ok"\.$/);
    expect(e2.value).toBe("review");
    expect(() => parseFormula("=SUM(A1:A3")).toThrow(/Expected/);
    expect(call(tools, "explain_formula", { formula: '=XLOOKUP("x",A1:A3,B1:B3,"none")' }).explanation).toContain('or "none" if there is no match');
  });

  it("traces precedents and dependents across sheets and names", () => {
    const wb = wbWith([
      { type: "set_cells", cells: [{ ref: "A1", value: 100 }, { ref: "A2", value: 0.1 }, { ref: "A3", formula: "=A1*Rate" }, { ref: "A4", formula: "=A3+A1" }] },
      { type: "add_named_range", name: "Rate", ref: "Sheet1!A2" },
      { type: "add_sheet", name: "Summary", id: "sh_s" },
      { type: "set_cells", sheet: "sh_s", cells: [{ ref: "B1", formula: "=Sheet1!A4*2" }] },
    ]);
    const { tools } = makeCtx(wb);
    const pre = call(tools, "trace_precedents", { cell: "Summary!B1", depth: 3 }) as { precedents: { sheet: string; ref: string; via?: string; depth: number }[] };
    expect(pre.precedents.map((p) => `${p.sheet}!${p.ref}@${p.depth}`)).toEqual(["Sheet1!A4@1", "Sheet1!A3@2", "Sheet1!A1@3", "Sheet1!A2@3"]);
    expect(pre.precedents.find((p) => p.ref === "A2")?.via).toBe("Rate");
    const dep = call(tools, "trace_dependents", { cell: "A2", sheet: "Sheet1", depth: 3 }) as { dependents: { sheet: string; ref: string; value: unknown }[] };
    expect(dep.dependents.map((d) => `${d.sheet}!${d.ref}`)).toEqual(["Sheet1!A3", "Sheet1!A4", "Summary!B1"]);
    expect(dep.dependents[2].value).toBe(220);
  });
});

describe("audit_formulas", () => {
  it("finds every seeded error class", () => {
    let wb = wbWith([
      { type: "set_cells", cells: [
        { ref: "A1", value: "Qty" }, { ref: "B1", value: "Price" }, { ref: "C1", value: "Total" }, { ref: "D1", value: "Share" },
        ...[2, 3, 4, 5, 6, 7].map((r) => ({ ref: `A${r}`, value: r })), ...[2, 3, 4, 5, 6, 7].map((r) => ({ ref: `B${r}`, value: 10 * r })),
        { ref: "C2", formula: "=A2*B2" }, { ref: "C3", formula: "=A3*B3" }, { ref: "C4", value: 999 }, { ref: "C5", formula: "=A5*B5*1.0825" }, { ref: "C6", formula: "=A6*B6" }, { ref: "C7", formula: "=A7*B7" },
        { ref: "C8", formula: "=SUM(C2:C6)" },
        { ref: "D2", formula: "=C2/0" }, { ref: "D3", formula: "=D2+1" },
        { ref: "F1", formula: "=G1+1" }, { ref: "G1", formula: "=F1+1" },
        { ref: "H1", value: 5 }, { ref: "H2", value: 7 }, { ref: "H3", value: "12", type: "s" },
        { ref: "J1", value: 1 }, { ref: "J2", formula: "=J1*2" },
      ] },
    ]);
    wb = applyOp(wb, { type: "set_cells", sheet: "sh_1", cells: [{ ref: "L1", value: 4 }, { ref: "M1", formula: "=L1*3" }] });
    wb = applyOp(wb, { type: "delete_cols", sheet: "sh_1", index: 11, count: 1 }); // deletes L → M1 (now L1) becomes #REF!
    const { tools } = makeCtx(wb, "ask");
    const r = call(tools, "audit_formulas", {}) as { counts: Record<string, number>; findings: { kind: string; ref: string; root?: boolean; detail: string }[] };
    const at = (kind: string) => r.findings.filter((f) => f.kind === kind).map((f) => f.ref).sort();
    expect(at("circular")).toEqual(["F1", "G1"]);
    expect(r.findings.find((f) => f.ref === "D2")).toMatchObject({ kind: "error", root: true });
    expect(r.findings.find((f) => f.ref === "D3")).toMatchObject({ kind: "error", root: false });
    expect(r.findings.some((f) => f.kind === "error" && f.detail.includes("#REF!"))).toBe(true);
    expect(at("hardcoded_in_region")).toEqual(["C4"]);
    expect(at("hardcoded_in_formula")).toEqual(["C5"]);
    expect(at("inconsistent")).toEqual(["C5"]);
    expect(at("sum_gap")).toEqual(["C8"]);
    expect(at("number_as_text")).toEqual(["H3"]);
    // a clean model has no findings
    expect(auditFormulas(LEDGER(), computeWorkbook(LEDGER())).findings).toEqual([]);
  });
});

describe("date_math", () => {
  it("computes US federal holidays with weekend observance", () => {
    expect(usFederalHolidays(2026).map((h) => h.date)).toEqual(["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]);
  });
  it("rolls deadlines past weekends and holidays (FRCP 6(a)) and adds business days", () => {
    expect(dateMath({ op: "deadline", date: "2026-06-04", days: 30 })).toMatchObject({ result: "2026-07-06", weekday: "Monday" });
    expect(dateMath({ op: "deadline", date: "2026-11-12", days: 14 })).toMatchObject({ result: "2026-11-27" });
    expect(dateMath({ op: "add_business_days", date: "2026-12-23", days: 3 })).toMatchObject({ result: "2026-12-29" });
    expect(dateMath({ op: "add_business_days", date: "2026-12-29", days: -3 }).result).toBe("2026-12-23");
    expect(dateMath({ op: "business_days_between", date: "2026-01-01", end: "2026-01-31" }).result).toBe(20);
    expect(dateMath({ op: "add_months", date: "2026-01-31", months: 1 }).result).toBe("2026-02-28");
    expect(dateMath({ op: "is_business_day", date: "2026-07-03" }).result).toBe(false);
    expect(() => dateMath({ op: "deadline", date: "2026-02-30", days: 3 })).toThrow(/Invalid date/);
  });
  it("agrees with the spreadsheet engine's WORKDAY / NETWORKDAYS when no holidays apply", () => {
    const wb = emptyWorkbook();
    const engine = new SheetEngine();
    engine.sync(wb);
    for (const [date, days] of [["2026-03-05", 10], ["2026-09-30", 22], ["2027-01-15", -7]] as const) {
      const d = dateMath({ op: "add_business_days", date, days, calendar: "none" });
      const [y, m, dd] = date.split("-").map(Number);
      const serial = engine.evaluate("sh_1", `=WORKDAY(DATE(${y},${m},${dd}),${days})`).v as number;
      expect(new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10)).toBe(d.result);
    }
    expect(dateMath({ op: "business_days_between", date: "2026-01-01", end: "2026-01-31", calendar: "none" }).result).toBe(engine.evaluate("sh_1", "=NETWORKDAYS(DATE(2026,1,1),DATE(2026,1,31))").v);
    engine.destroy();
  });
  it("is exposed as a read tool", () => {
    const { tools } = makeCtx(emptyWorkbook(), "ask");
    expect(call(tools, "date_math", { op: "deadline", date: "2026-06-04", days: 30 })).toMatchObject({ result: "2026-07-06" });
  });
});

describe("edit tools", () => {
  it("write_range writes blocks and fills formulas; results are read back from the engine", () => {
    const { tools, snapshot } = makeCtx(LEDGER());
    const r1 = call(tools, "write_range", { anchor: "F1", values: [["Tax rate", 0.0825], ["Taxed total", "=SUM(C2:C7)*(1+G1)"]] });
    expect(r1.ok).toBe(true);
    expect(r1.verify?.results?.[0]).toMatchObject({ ref: "G2" });
    expect(r1.verify?.results?.[0].value).toBeCloseTo(46967.5 * 1.0825, 6);
    const r2 = call(tools, "write_range", { range: "E2:E7", formula: "=C2*$G$1", fill: "down" });
    expect(snapshot.workbook.sheets[0].cells.E7.f).toBe("=C7*$G$1");
    expect(r2.verify?.results).toHaveLength(6);
    const bad = call(tools, "write_range", { anchor: "I1", values: [["=I1+1"]] });
    expect(bad.ok).toBe(false);
    expect(bad.verify?.circular).toBe(true);
    expect(String(bad.action_required)).toMatch(/circular/);
  });

  it("styles, formats, merges/unmerges, hides, freezes, filters, validates and names", () => {
    const { tools, snapshot, proposals } = makeCtx(LEDGER());
    call(tools, "set_style", { range: "A1:D1", style: { bold: true, fill: "#1F3A5F", color: "#FFFFFF", borders: { bottom: { style: "medium", color: "#000000" } }, indent: 1 } });
    const st = snapshot.workbook.styles[snapshot.workbook.sheets[0].cells.A1.s!];
    expect(st).toMatchObject({ bold: true, borders: { bottom: { style: "medium" } }, indent: 1 });
    expect(st.border).toBeUndefined();
    call(tools, "set_number_format", { range: "C2:C7", numFmt: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)' });
    call(tools, "merge_cells", { range: "F10:H10" });
    expect(snapshot.workbook.sheets[0].merges).toContain("F10:H10");
    call(tools, "unmerge_cells", { range: "G10" });
    expect(snapshot.workbook.sheets[0].merges).not.toContain("F10:H10");
    call(tools, "hide_rows_cols", { rows: [3], columns: ["B"] });
    expect(snapshot.workbook.sheets[0]).toMatchObject({ hiddenRows: [3], hiddenCols: ["B"] });
    call(tools, "set_freeze_panes", { rows: 1, cols: 1 });
    call(tools, "add_filter", { range: "A1:D7", column: "A", values: ["Experts"] });
    expect(snapshot.workbook.sheets[0].filters?.criteria.A).toEqual({ values: ["Experts"] });
    call(tools, "clear_filter", {});
    expect(snapshot.workbook.sheets[0].filters).toBeNull();
    call(tools, "set_data_validation", { range: "A2:A7", kind: "list", list: ["Experts", "Filing", "Depositions"] });
    call(tools, "set_data_validation", { range: "C2:C7", kind: "decimal", min: 0, max: 100000, error: "Amount out of range" });
    call(tools, "set_data_validation", { range: "D2:D7", kind: "custom", formula: "=D2<=TODAY()" });
    expect(snapshot.workbook.sheets[0].validations?.map((v) => [v.kind, v.operator, v.formula1, v.formula2, v.error])).toEqual([["list", undefined, undefined, undefined, undefined], ["decimal", "between", "0", "100000", "Amount out of range"], ["custom", undefined, "D2<=TODAY()", undefined, undefined]]);
    call(tools, "create_named_range", { name: "Amounts", ref: "Sheet1!C2:C7" });
    expect(call(tools, "evaluate_formula", { formula: "=SUM(Amounts)" }).value).toBeCloseTo(46967.5, 6);
    expect(proposals.every((p) => Array.isArray((p.payload as { base?: unknown[] }).base))).toBe(true);
  });

  it("sorts by multiple keys", () => {
    const { tools, snapshot } = makeCtx(LEDGER());
    call(tools, "sort_range", { range: "A1:D7", keys: [{ column: "A" }, { column: "C", order: "desc" }] });
    const col = (L: string) => [2, 3, 4, 5, 6, 7].map((r) => snapshot.workbook.sheets[0].cells[`${L}${r}`].v);
    expect(col("A")).toEqual(["Depositions", "Depositions", "Experts", "Experts", "Filing", "Filing"]);
    expect(col("C")).toEqual([3120.5, 2890, 22000, 18500, 405, 52]);
  });

  it("adds conditional formats (expression rules evaluated by the engine) and charts", () => {
    const { tools, snapshot } = makeCtx(LEDGER());
    call(tools, "add_conditional_format", { range: "A2:D7", rule: { kind: "expression", formula: '=$A2="Experts"' }, style: { fill: "#FFF2CC" } });
    call(tools, "add_conditional_format", { range: "C2:C7", rule: { kind: "dataBar", color: "#638EC6" } });
    const cf = conditionalStyles(snapshot.workbook.sheets[0], snapshot.computed);
    expect(cf.get("B2")?.fill).toBe("#FFF2CC");
    expect(cf.get("B3")?.fill).toBeUndefined();
    expect(cf.get("C4")?.bar?.pct).toBe(100);
    const r = call(tools, "create_chart", { type: "bar", title: "Spend", range: "C1:C7", category_range: "A2:A7", horizontal: true });
    expect(r.ok).toBe(true);
    expect(snapshot.workbook.sheets[0].charts[0]).toMatchObject({ type: "bar", horizontal: true });
    expect(() => call(tools, "add_conditional_format", { range: "A2:A7", rule: { kind: "expression", formula: "=AND(A2" }, style: {} })).toThrow();
  });

  it("summarize_table emits live SUMIFS/COUNTIFS formulas that follow source edits", () => {
    const { tools, snapshot } = makeCtx(LEDGER());
    const r = call(tools, "summarize_table", { range: "A1:D7", group_by: ["A"], values: [{ column: "C", agg: "sum" }, { column: "C", agg: "count" }, { column: "C", agg: "average" }], new_sheet: "By category" }) as ReturnType<typeof call> & { groups: number; summaryRange: string };
    expect(r.ok).toBe(true);
    expect(r.groups).toBe(3);
    expect(r.summaryRange).toBe("By category!A1:D5");
    const s = snapshot.workbook.sheets.find((x) => x.name === "By category")!;
    expect(s.cells.A2.v).toBe("Depositions");
    expect(s.cells.B2.f).toBe("=SUMIFS(Sheet1!$C$2:$C$7,Sheet1!$A$2:$A$7,$A2)");
    expect(s.cells.C2.f).toBe("=COUNTIFS(Sheet1!$A$2:$A$7,$A2)");
    expect(s.cells.D3.f).toBe("=IFERROR(AVERAGEIFS(Sheet1!$C$2:$C$7,Sheet1!$A$2:$A$7,$A3),0)");
    expect(s.cells.B5.f).toBe("=SUM(B2:B4)");
    for (const c of Object.values(s.cells)) if (typeof c.v === "number") throw new Error("summary contains a static number");
    const v = (ref: string) => snapshot.computed[s.id][ref].v;
    expect([v("B2"), v("B3"), v("B4"), v("B5")]).toEqual([6010.5, 40500, 457, 46967.5]);
    // live: change a source amount → the summary recomputes
    const edited = applyOp(snapshot.workbook, { type: "set_cells", sheet: "sh_1", cells: [{ ref: "C2", value: 20000 }] });
    expect(computeWorkbook(edited)[s.id].B3.v).toBe(42000);
  });

  it("lookup_join writes XLOOKUP / INDEX-MATCH columns and reports matches", () => {
    const wb = wbWith([
      { type: "set_cells", cells: [{ ref: "A1", value: "Timekeeper" }, { ref: "B1", value: "Hours" }, { ref: "A2", value: "JDoe" }, { ref: "B2", value: 10 }, { ref: "A3", value: "RRoe" }, { ref: "B3", value: 4 }, { ref: "A4", value: "Ghost" }, { ref: "B4", value: 1 }] },
      { type: "add_sheet", name: "Rates", id: "sh_r" },
      { type: "set_cells", sheet: "sh_r", cells: [{ ref: "A1", value: "JDoe" }, { ref: "B1", value: "Partner" }, { ref: "C1", value: 950 }, { ref: "A2", value: "RRoe" }, { ref: "B2", value: "Associate" }, { ref: "C2", value: 525 }] },
      { type: "set_active_sheet", sheet: "Sheet1" },
    ]);
    const { tools, snapshot } = makeCtx(wb);
    const r = call(tools, "lookup_join", { key_column: "A", from_row: 2, to_row: 4, output_column: "C", lookup_range: "Rates!A1:C2", return_offset: 2, header: "Rate" }) as ReturnType<typeof call> & { matched: number; notFound: number; notFoundRows: number[] };
    expect(snapshot.workbook.sheets[0].cells.C2.f).toBe('=IFERROR(XLOOKUP(A2,Rates!$A$1:$A$2,Rates!$C$1:$C$2),"not found")');
    expect(r).toMatchObject({ matched: 2, notFound: 1, notFoundRows: [4] });
    call(tools, "lookup_join", { key_column: "A", from_row: 2, to_row: 4, output_column: "D", lookup_range: "Rates!A1:C2", return_offset: 1, method: "index_match", not_found: "n/a" });
    expect(snapshot.computed.sh_1.D3.v).toBe("Associate");
    call(tools, "write_range", { range: "E2:E4", formula: "=IFERROR(B2*C2,0)", fill: "down" });
    expect(snapshot.computed.sh_1.E2.v).toBe(9500);
  });

  it("damages_schedule builds a prejudgment-interest schedule whose totals come from the engine", () => {
    expect(interestPeriods({ start: "2024-01-01", end: "2026-01-01", rates: [{ from: "2024-01-01", rate: 0.1 }], splitByYear: true })).toEqual([
      { from: "2024-01-01", to: "2025-01-01", rate: 0.1 }, { from: "2025-01-01", to: "2026-01-01", rate: 0.1 },
    ]);
    const { tools, snapshot } = makeCtx(emptyWorkbook());
    const r = call(tools, "damages_schedule", { principal: 100000, start: "2024-01-01", end: "2026-01-01", rate: 0.1, split_by_year: true, new_sheet: "Interest" }) as ReturnType<typeof call> & { totalInterest: { value: number; display: string }; principalPlusInterest: { value: number } };
    expect(r.ok).toBe(true);
    expect(r.totalInterest.value).toBeCloseTo(20027.4, 6); // 100,000 × 10% × 366/365 + 100,000 × 10% × 365/365
    expect(r.totalInterest.display).toBe("$20,027.40");
    expect(r.principalPlusInterest.value).toBeCloseTo(120027.4, 6);
    const s = snapshot.workbook.sheets.find((x) => x.name === "Interest")!;
    expect(s.cells.E7.f).toBe("=ROUND($B$2*D7*C7/$B$3,2)");
    // rate changes split the periods; annual compounding adds prior interest to the base
    const { tools: t2 } = makeCtx(emptyWorkbook());
    const r2 = call(t2, "damages_schedule", { principal: 50000, start: "2025-01-01", end: "2025-12-31", rates: [{ from: "2025-01-01", rate: 0.07 }, { from: "2025-07-01", rate: 0.09 }], compounding: "annual" }) as ReturnType<typeof call> & { totalInterest: { value: number } };
    expect(r2.totalInterest.value).toBeCloseTo(Math.round(50000 * 0.07 * 181 / 365 * 100) / 100 + Math.round((50000 + Math.round(50000 * 0.07 * 181 / 365 * 100) / 100) * 0.09 * 183 / 365 * 100) / 100, 6);
    expect(() => call(t2, "damages_schedule", { principal: 1, start: "2025-01-01", end: "2025-02-01", rate: 10 })).toThrow(/decimal/);
  });

  it("insert/delete keep hidden rows, notes and hyperlinks aligned; delete reports #REF! via verify", () => {
    const base = LEDGER();
    const wb: Workbook = { ...base, sheets: [{ ...base.sheets[0], hiddenRows: [5], notes: { C5: { text: "check" } }, hyperlinks: [{ ref: "B5", target: "https://example.com" }] }] };
    const next = applyOp(wb, { type: "insert_rows", sheet: "sh_1", index: 1, count: 2 });
    expect(next.sheets[0]).toMatchObject({ hiddenRows: [7], notes: { C7: { text: "check" } }, hyperlinks: [{ ref: "B7" }] });
    const { tools } = makeCtx(wbWith([{ type: "set_cells", cells: [{ ref: "A1", value: 5 }, { ref: "B1", formula: "=A1*2" }] }]));
    const r = call(tools, "delete_cols", { at_column: "A" });
    expect(r.ok).toBe(false);
    expect(r.verify?.newErrors).toHaveLength(1);
  });
});
