import "server-only";
import type { OfficeTemplate } from "@/modules/office/shared/template-registry";
import { addDays, buildWorkbook, cells, inputs, section, table, title, widths, LABEL_STYLE, NOTE_STYLE, TOTAL_STYLE, type CellSpec } from "./builders";
import type { Workbook } from "./model";
import type { SheetOp } from "./ops";

const CUR = "$#,##0.00" as const;
const CUR0 = "$#,##0" as const;
const PCT = "0.0%" as const;
const DATE = "mmm d yyyy" as const;
const INT = "#,##0" as const;

// --------------------------------------------------------------- 1. Settlement tracker
export function settlementTrackerWorkbook(): Workbook {
  const rows: (string | number | null)[][] = [
    ["Alvarez, Marisol", "CLM-2026-0142", "Continental Casualty", 425000, 310000, 350000, 0.3333, null, 8420.55, 41200, null, "Settled", "2026-08-14", null, null],
    ["Okonkwo, David", "CLM-2026-0157", "Liberty Mutual", 180000, 95000, 125000, 0.3333, null, 3150, 12800, null, "Paid", "2026-07-02", null, null],
    ["Reyes-Tanaka, Lina", "CLM-2026-0163", "State Farm", 950000, 400000, null, 0.4, null, 22860.1, 96500, null, "Negotiating", null, null, null],
    ["Bennett, Charles", "CLM-2026-0171", "Travelers", 260000, 150000, 210000, 0.3333, null, 6210, 0, null, "Settled", "2026-09-03", null, null],
    ["Nakamura, Grace", "CLM-2026-0188", "Allstate", 75000, 42000, 60000, 0.3333, null, 1240, 9800, null, "Paid", "2026-06-11", null, null],
  ];
  const data = rows.map((r, i) => {
    const n = i + 5; // header at row 4, data from 5
    return [r[0], r[1], r[2], r[3], r[4], r[5], r[6], `=IF(F${n}="","",F${n}*G${n})`, r[8], r[9], `=IF(F${n}="","",F${n}-H${n}-I${n}-J${n})`, r[11], r[12], `=IF(M${n}="","",WORKDAY(M${n},30))`, `=IF(OR(N${n}="",L${n}="Paid"),"",MAX(0,TODAY()-N${n}))`];
  });
  const ops: SheetOp[] = [
    ...title("Settlement Tracker", "Demand → offer → settlement, fee and cost allocation, payment follow-up. Yellow cells are inputs; everything else is computed.", 1, 15),
    ...table({ anchor: "A4", headers: ["Claimant", "Claim No.", "Defendant / Carrier", "Demand", "Offer", "Settled Amount", "Fee %", "Attorney Fee", "Costs", "Liens", "Net to Client", "Status", "Settlement Date", "Payment Due", "Days Outstanding"], rows: data, formats: { 3: CUR, 4: CUR, 5: CUR, 6: PCT, 7: CUR, 8: CUR, 9: CUR, 10: CUR, 12: DATE, 13: DATE, 14: "0" }, total: { columns: [3, 4, 5, 7, 8, 9, 10], formulas: { 6: "=IFERROR(H10/F10,0)" } }, freeze: true, widths: [170, 120, 170, 110, 110, 120, 70, 110, 100, 100, 120, 100, 120, 120, 110] }),
    { type: "style_range", range: "G5:G9", style: { align: "right" } },
    { type: "add_filter", range: "A4:O9" },
    { type: "add_validation", range: "L5:L9", kind: "list", list: ["Negotiating", "Settled", "Paid", "Withdrawn"], message: "Choose a status" },
    { type: "conditional_format", range: "O5:O9", rule: { kind: "gt", value: 0 }, style: { fill: "#FDE2E1", color: "#9F1239", bold: true } },
    { type: "conditional_format", range: "L5:L9", rule: { kind: "eq", value: "Paid" }, style: { fill: "#DCFCE7", color: "#166534" } },
    { type: "conditional_format", range: "L5:L9", rule: { kind: "eq", value: "Negotiating" }, style: { fill: "#FEF3C7", color: "#92400E" } },
    { type: "freeze_panes", rows: 4, cols: 1 },
    cells([["A12", "Notes", LABEL_STYLE], ["A13", "Fee % per engagement letter (33⅓% pre-suit, 40% after filing). Liens are net of negotiated reductions. Payment due = 30 business days from settlement date.", NOTE_STYLE]]),
    { type: "merge_cells", range: "A13:H13" },
  ];
  return buildWorkbook([{ name: "Tracker", ops }]);
}

// --------------------------------------------------------------- 2. Settlement allocation statement
export function settlementAllocationWorkbook(): Workbook {
  const inp = inputs("A4", [
    { label: "Gross settlement", value: 1250000, fmt: CUR, name: "Gross" },
    { label: "Attorney fee %", value: 0.3333, fmt: PCT, name: "FeeRate", note: "Per engagement letter §4" },
    { label: "Fee computed on", value: "Gross", note: "Gross or Net-of-costs" },
    { label: "Client", value: "Marisol Alvarez" },
    { label: "Matter", value: "Alvarez v. Continental Casualty" },
    { label: "Statement date", value: "2026-09-24", fmt: DATE },
  ]);
  const costs: CellSpec[] = [];
  const costItems: [string, number][] = [["Filing and service fees", 1245], ["Medical records retrieval", 2180.5], ["Expert — Dr. Naomi Feld (orthopedics)", 18500], ["Deposition transcripts (4)", 6320.75], ["Mediation fee (JAMS, one-half)", 4750], ["Investigator and photographs", 1890], ["Postage, copies, courier", 412.3]];
  costItems.forEach(([label, amt], i) => { const r = 13 + i; costs.push([`A${r}`, label, { border: "thin" }], [`B${r}`, amt, { numFmt: CUR, border: "thin", fill: "#FFF8E1" }], [`C${r}`, `=B${r}/Gross`, { numFmt: PCT, border: "thin" }]); });
  const costTotalRow = 13 + costItems.length;
  const liens: CellSpec[] = [];
  const lienItems: [string, number, number][] = [["Medicare conditional payment (final demand)", 48210.33, 0], ["Blue Cross ERISA plan (self-funded)", 61540, 0.33], ["St. Luke's Regional (provider lien)", 12980, 0.25], ["Med-pay reimbursement", 5000, 0.5]];
  const lienStart = costTotalRow + 4;
  lienItems.forEach(([label, claimed, reduction], i) => { const r = lienStart + i; liens.push([`A${r}`, label, { border: "thin" }], [`B${r}`, claimed, { numFmt: CUR, border: "thin", fill: "#FFF8E1" }], [`C${r}`, reduction, { numFmt: PCT, border: "thin", fill: "#FFF8E1" }], [`D${r}`, `=B${r}*(1-C${r})`, { numFmt: CUR, border: "thin" }]); });
  const lienTotalRow = lienStart + lienItems.length;
  const sumStart = lienTotalRow + 3;
  const ops: SheetOp[] = [
    ...title("Settlement Allocation Statement", "Gross → attorney fee → case costs → liens → net to client", 1, 6),
    ...inp.ops,
    ...section("A11", "Case costs", 4),
    cells([["A12", "Item", { bold: true, border: "bottom" }], ["B12", "Amount", { bold: true, border: "bottom", align: "right" }], ["C12", "% of gross", { bold: true, border: "bottom", align: "right" }]]),
    cells(costs),
    cells([[`A${costTotalRow}`, "Total costs", TOTAL_STYLE], [`B${costTotalRow}`, `=SUM(B13:B${costTotalRow - 1})`, { ...TOTAL_STYLE, numFmt: CUR }], [`C${costTotalRow}`, `=B${costTotalRow}/Gross`, { ...TOTAL_STYLE, numFmt: PCT }]]),
    ...section(`A${lienStart - 2}`, "Liens and subrogation", 4),
    cells([[`A${lienStart - 1}`, "Lienholder", { bold: true, border: "bottom" }], [`B${lienStart - 1}`, "Claimed", { bold: true, border: "bottom", align: "right" }], [`C${lienStart - 1}`, "Negotiated reduction", { bold: true, border: "bottom", align: "right" }], [`D${lienStart - 1}`, "Payable", { bold: true, border: "bottom", align: "right" }]]),
    cells(liens),
    cells([[`A${lienTotalRow}`, "Total liens payable", TOTAL_STYLE], [`B${lienTotalRow}`, `=SUM(B${lienStart}:B${lienTotalRow - 1})`, { ...TOTAL_STYLE, numFmt: CUR }], [`C${lienTotalRow}`, null, TOTAL_STYLE], [`D${lienTotalRow}`, `=SUM(D${lienStart}:D${lienTotalRow - 1})`, { ...TOTAL_STYLE, numFmt: CUR }]]),
    ...section(`A${sumStart - 1}`, "Allocation summary", 4),
    cells([
      [`A${sumStart}`, "Gross settlement", LABEL_STYLE], [`B${sumStart}`, "=Gross", { numFmt: CUR }], [`C${sumStart}`, `=B${sumStart}/Gross`, { numFmt: PCT }],
      [`A${sumStart + 1}`, "Less: attorney fee", LABEL_STYLE], [`B${sumStart + 1}`, `=-IF(B6="Gross",Gross*FeeRate,(Gross-B${costTotalRow})*FeeRate)`, { numFmt: "$#,##0.00;($#,##0.00)" }], [`C${sumStart + 1}`, `=B${sumStart + 1}/Gross`, { numFmt: "0.0%;(0.0%)" }],
      [`A${sumStart + 2}`, "Less: case costs", LABEL_STYLE], [`B${sumStart + 2}`, `=-B${costTotalRow}`, { numFmt: "$#,##0.00;($#,##0.00)" }], [`C${sumStart + 2}`, `=B${sumStart + 2}/Gross`, { numFmt: "0.0%;(0.0%)" }],
      [`A${sumStart + 3}`, "Less: liens payable", LABEL_STYLE], [`B${sumStart + 3}`, `=-D${lienTotalRow}`, { numFmt: "$#,##0.00;($#,##0.00)" }], [`C${sumStart + 3}`, `=B${sumStart + 3}/Gross`, { numFmt: "0.0%;(0.0%)" }],
      [`A${sumStart + 4}`, "Net to client", { ...TOTAL_STYLE, fontSize: 13 }], [`B${sumStart + 4}`, `=SUM(B${sumStart}:B${sumStart + 3})`, { ...TOTAL_STYLE, numFmt: CUR, fontSize: 13 }], [`C${sumStart + 4}`, `=B${sumStart + 4}/Gross`, { ...TOTAL_STYLE, numFmt: PCT }],
      [`A${sumStart + 6}`, "Check: components sum to gross", NOTE_STYLE], [`B${sumStart + 6}`, `=IF(ROUND(-B${sumStart + 1}-B${sumStart + 2}-B${sumStart + 3}+B${sumStart + 4}-Gross,2)=0,"OK","MISMATCH")`, { bold: true }],
    ]),
    ...widths({ A: 300, B: 140, C: 140, D: 130 }),
  ];
  return buildWorkbook([{ name: "Allocation", ops }], { namedRanges: { Gross: "Allocation!B4", FeeRate: "Allocation!B5" } });
}

// --------------------------------------------------------------- 3. Damages model
export function damagesModelWorkbook(): Workbook {
  const inp = inputs("A4", [
    { label: "Date of loss / accrual", value: "2024-03-18", fmt: DATE, name: "AccrualDate" },
    { label: "Projected judgment date", value: "2027-06-30", fmt: DATE, name: "JudgmentDate" },
    { label: "Pre-judgment interest rate", value: 0.09, fmt: PCT, name: "PJIRate", note: "Statutory rate; confirm for the forum" },
    { label: "Post-judgment interest rate", value: 0.0525, fmt: "0.00%", name: "PostRate" },
    { label: "Discount rate (future damages)", value: 0.03, fmt: PCT, name: "DiscountRate" },
    { label: "Wage growth rate", value: 0.025, fmt: PCT, name: "WageGrowth" },
    { label: "Annual earnings (pre-injury)", value: 86500, fmt: CUR0, name: "Earnings" },
    { label: "Residual earning capacity", value: 41000, fmt: CUR0, name: "Residual" },
    { label: "Years to retirement", value: 19, fmt: "0", name: "WorkYears" },
    { label: "Future medical years", value: 31, fmt: "0", name: "MedYears" },
    { label: "Non-economic multiplier", value: 2.5, fmt: "0.0", name: "Multiplier" },
  ]);
  const past = [
    ["Emergency and inpatient (Mercy General)", 184320.5, 96210.44],
    ["Orthopedic surgery — L4/L5 fusion", 142800, 88450],
    ["Physical therapy (64 visits)", 19840, 15230],
    ["Pain management and imaging", 22610.75, 14980.1],
    ["Pharmacy", 6412.3, 5108.2],
  ];
  const pastRows = past.map((r) => [r[0], r[1], r[2], `=IFERROR(C{r}/B{r},0)`]);
  const pastOps = table({ anchor: "A17", headers: ["Past medical expenses", "Billed", "Paid / reasonable value", "Paid ÷ billed"], rows: pastRows.map((row, i) => row.map((v) => (typeof v === "string" ? v.replace(/\{r\}/g, String(18 + i)) : v))), formats: { 1: CUR, 2: CUR, 3: PCT }, total: { columns: [1, 2], formulas: { 3: "=IFERROR(C23/B23,0)" } }, widths: [330, 130, 170, 110] });
  const future = [
    ["Annual physician and imaging follow-up", 4200],
    ["Revision surgery reserve (annualized)", 6850],
    ["Medication", 3120],
    ["Assistive equipment and home modification (annualized)", 1900],
  ];
  const futureRows = future.map((r, i) => { const n = 28 + i; return [r[0], r[1], `=B${n}*MedYears`, `=B${n}*(1-(1+DiscountRate)^-MedYears)/DiscountRate`]; });
  const futureOps = table({ anchor: "A27", headers: ["Future medical (annual)", "Annual cost", "Undiscounted total", "Present value"], rows: futureRows, formats: { 1: CUR, 2: CUR, 3: CUR }, total: { columns: [1, 2, 3] } });
  const ops: SheetOp[] = [
    ...title("Damages Model", "Past and future medicals, wage loss, earning capacity, non-economic damages and interest. Inputs in yellow.", 1, 6),
    ...inp.ops,
    ...section("A16", "Economic damages — medical", 4),
    ...pastOps,
    ...section("A26", "Economic damages — future medical", 4),
    ...futureOps,
    ...section("A34", "Economic damages — wages", 4),
    cells([
      ["A35", "Past wage loss (accrual → today)", LABEL_STYLE], ["B35", "=Earnings*YEARFRAC(AccrualDate,TODAY())", { numFmt: CUR }], ["C35", "years", NOTE_STYLE], ["D35", "=YEARFRAC(AccrualDate,TODAY())", { numFmt: "0.00" }],
      ["A36", "Future loss of earning capacity (PV)", LABEL_STYLE], ["B36", "=(Earnings-Residual)*(1-((1+WageGrowth)/(1+DiscountRate))^WorkYears)/(DiscountRate-WageGrowth)", { numFmt: CUR }], ["C36", "growing annuity, WorkYears", NOTE_STYLE],
    ]),
    ...section("A38", "Summary", 4),
    cells([
      ["A39", "Past medical (paid / reasonable value)", LABEL_STYLE], ["B39", "=C23", { numFmt: CUR }],
      ["A40", "Future medical (PV)", LABEL_STYLE], ["B40", "=D32", { numFmt: CUR }],
      ["A41", "Past wage loss", LABEL_STYLE], ["B41", "=B35", { numFmt: CUR }],
      ["A42", "Future earning capacity (PV)", LABEL_STYLE], ["B42", "=B36", { numFmt: CUR }],
      ["A43", "Total economic damages", TOTAL_STYLE], ["B43", "=SUM(B39:B42)", { ...TOTAL_STYLE, numFmt: CUR }],
      ["A44", "Non-economic (multiplier × economic)", LABEL_STYLE], ["B44", "=B43*Multiplier", { numFmt: CUR }],
      ["A45", "Total compensatory damages", TOTAL_STYLE], ["B45", "=B43+B44", { ...TOTAL_STYLE, numFmt: CUR }],
      ["A46", "Pre-judgment interest (simple, accrual → judgment)", LABEL_STYLE], ["B46", "=B43*PJIRate*YEARFRAC(AccrualDate,JudgmentDate)", { numFmt: CUR }], ["C46", "on economic damages only — confirm forum rule", NOTE_STYLE],
      ["A47", "Projected judgment", { ...TOTAL_STYLE, fontSize: 13 }], ["B47", "=B45+B46", { ...TOTAL_STYLE, numFmt: CUR, fontSize: 13 }],
      ["A48", "Post-judgment interest per day", LABEL_STYLE], ["B48", "=B47*PostRate/365", { numFmt: CUR }],
    ]),
    ...section("A50", "Sensitivity (non-economic multiplier)", 4),
    cells([["A51", "Scenario", { bold: true, border: "bottom" }], ["B51", "Multiplier", { bold: true, border: "bottom", align: "right" }], ["C51", "Total compensatory", { bold: true, border: "bottom", align: "right" }], ["D51", "Projected judgment", { bold: true, border: "bottom", align: "right" }],
      ["A52", "Low", { border: "thin" }], ["B52", 1.5, { numFmt: "0.0", border: "thin", fill: "#FFF8E1" }], ["C52", "=$B$43*(1+B52)", { numFmt: CUR, border: "thin" }], ["D52", "=C52+$B$46", { numFmt: CUR, border: "thin" }],
      ["A53", "Base", { border: "thin" }], ["B53", "=Multiplier", { numFmt: "0.0", border: "thin" }], ["C53", "=$B$43*(1+B53)", { numFmt: CUR, border: "thin" }], ["D53", "=C53+$B$46", { numFmt: CUR, border: "thin" }],
      ["A54", "High", { border: "thin" }], ["B54", 4, { numFmt: "0.0", border: "thin", fill: "#FFF8E1" }], ["C54", "=$B$43*(1+B54)", { numFmt: CUR, border: "thin" }], ["D54", "=C54+$B$46", { numFmt: CUR, border: "thin" }],
    ]),
    ...widths({ A: 340, B: 150, C: 170, D: 150 }),
    { type: "add_chart", chart: { type: "bar", title: "Damages by category", range: "B39:B42", categoryRange: "A39:A42", hasHeader: false, position: { x: 720, y: 560, w: 520, h: 300 } } },
  ];
  return buildWorkbook([{ name: "Damages", ops }], { namedRanges: Object.fromEntries(Object.entries(inp.named).map(([k, v]) => [k, `Damages!${v}`])) });
}

// --------------------------------------------------------------- 4. Litigation budget
export function litigationBudgetWorkbook(opts: { title?: string; phases?: { name: string; partner: number; associate: number; paralegal: number; disbursements: number; note?: string }[] } = {}): Workbook {
  const phases = opts.phases ?? [
    { name: "Case assessment and pleadings", partner: 18, associate: 42, paralegal: 12, disbursements: 1800 },
    { name: "Written discovery", partner: 12, associate: 68, paralegal: 40, disbursements: 900 },
    { name: "Document collection and review", partner: 8, associate: 120, paralegal: 160, disbursements: 24500, note: "Vendor processing and hosting" },
    { name: "Fact depositions (8)", partner: 64, associate: 96, paralegal: 30, disbursements: 19200, note: "Transcripts, videography, travel" },
    { name: "Expert discovery", partner: 40, associate: 70, paralegal: 16, disbursements: 85000, note: "Two retained experts" },
    { name: "Dispositive motions", partner: 48, associate: 110, paralegal: 14, disbursements: 600 },
    { name: "Pretrial and trial preparation", partner: 90, associate: 160, paralegal: 80, disbursements: 12000 },
    { name: "Trial (est. 6 days)", partner: 84, associate: 96, paralegal: 60, disbursements: 22000 },
  ];
  const rows = phases.map((p, i) => { const n = 12 + i; return [p.name, p.partner, p.associate, p.paralegal, `=B${n}*Partner+C${n}*Associate+D${n}*Paralegal`, p.disbursements, `=E${n}+F${n}`, `=SUM($G$12:G${n})`, null, `=I${n}-G${n}`, p.note ?? null]; });
  const last = 11 + phases.length;
  const ops: SheetOp[] = [
    ...title(opts.title ?? "Litigation Budget & Fee Estimate", "Phase × timekeeper hours × rates, plus disbursements; running total and variance against actuals.", 1, 11),
    cells([["A4", "Hourly rates", { bold: true }]]),
    ...inputs("A5", [
      { label: "Partner", value: 895, fmt: CUR0, name: "Partner" },
      { label: "Senior associate", value: 640, fmt: CUR0, name: "Associate" },
      { label: "Paralegal", value: 285, fmt: CUR0, name: "Paralegal" },
      { label: "Contingency reserve", value: 0.1, fmt: PCT, name: "Reserve" },
    ]).ops,
    ...table({ anchor: "A11", headers: ["Phase", "Partner hrs", "Associate hrs", "Paralegal hrs", "Fees", "Disbursements", "Phase total", "Cumulative", "Actual to date", "Variance", "Notes"], rows, formats: { 1: "0", 2: "0", 3: "0", 4: CUR0, 5: CUR0, 6: CUR0, 7: CUR0, 8: CUR0, 9: "$#,##0;($#,##0)" }, total: { columns: [1, 2, 3, 4, 5, 6, 8, 9], formulas: { 7: `=G${last + 1}` } }, freeze: true, widths: [300, 100, 110, 110, 120, 130, 120, 120, 130, 110, 260] }),
    { type: "style_range", range: `I12:I${last}`, style: { fill: "#FFF8E1" } },
    cells([
      [`A${last + 3}`, "Subtotal fees and disbursements", LABEL_STYLE], [`B${last + 3}`, `=G${last + 1}`, { numFmt: CUR0 }],
      [`A${last + 4}`, "Contingency reserve", LABEL_STYLE], [`B${last + 4}`, `=B${last + 3}*Reserve`, { numFmt: CUR0 }],
      [`A${last + 5}`, "Total budget", { ...TOTAL_STYLE, fontSize: 13 }], [`B${last + 5}`, `=B${last + 3}+B${last + 4}`, { ...TOTAL_STYLE, numFmt: CUR0, fontSize: 13 }],
      [`A${last + 6}`, "Blended rate", LABEL_STYLE], [`B${last + 6}`, `=IFERROR(E${last + 1}/(B${last + 1}+C${last + 1}+D${last + 1}),0)`, { numFmt: CUR0 }],
    ]),
    { type: "conditional_format", range: `J12:J${last}`, rule: { kind: "lt", value: 0 }, style: { color: "#9F1239", bold: true } },
    { type: "add_chart", chart: { type: "bar", title: "Phase totals", range: "G11:G" + last, categoryRange: "A12:A" + last, hasHeader: true, position: { x: 8, y: (last + 8) * 24, w: 640, h: 300 } } },
  ];
  return buildWorkbook([{ name: "Budget", ops }], { namedRanges: { Partner: "Budget!B5", Associate: "Budget!B6", Paralegal: "Budget!B7", Reserve: "Budget!B8" } });
}

// --------------------------------------------------------------- 5. Deposition schedule
export function depositionScheduleWorkbook(opts: { title?: string; rows?: (string | number | null)[][] } = {}): Workbook {
  const rows = opts.rows ?? [
    ["Gregory Hale", "Director, EHS (Meridian)", "Plaintiffs", "2026-10-06", "9:30 AM ET", "Charleston, SC — Veritext", "Veritext / Dana Whitcomb", "J. Whitfield", "PX-201–PX-238", "Noticed"],
    ["Helen Voss", "Senior Toxicologist (Meridian)", "Plaintiffs", "2026-10-09", "9:00 AM ET", "Remote (Zoom)", "Veritext / Marcus Bell", "P. Raman", "PX-240–PX-262", "Noticed"],
    ["Dr. Linda Whitfield", "Toxicology expert (defense)", "Plaintiffs", "2026-11-12", "10:00 AM CT", "Chicago, IL — firm office", "Esquire / TBD", "P. Raman", "Report, reliance list", "Tentative"],
    ["Alan Pryce", "VP, Fire Suppression (Meridian)", "Plaintiffs", "2026-09-18", "9:30 AM ET", "Charleston, SC — Veritext", "Veritext / Dana Whitcomb", "J. Whitfield", "PX-180–PX-199", "Transcript pending"],
    ["Dr. Raj Patel", "Hydrogeology expert (defense)", "Plaintiffs", "2026-11-19", "9:00 AM PT", "Remote (Zoom)", "Esquire / TBD", "D. Okafor", "Report, model files", "Tentative"],
  ];
  const data = rows.map((r, i) => { const n = 5 + i; return [...r.slice(0, 10), `=IF(D${n}="","",D${n}-TODAY())`]; });
  const last = 4 + rows.length;
  const ops: SheetOp[] = [
    ...title(opts.title ?? "Deposition Schedule", "Noticed and tentative depositions; days-until updates daily. Filter by status or defending attorney.", 1, 11),
    ...table({ anchor: "A4", headers: ["Witness", "Role / affiliation", "Noticing party", "Date", "Time", "Location / platform", "Court reporter", "Defending attorney", "Exhibits", "Status", "Days until"], rows: data, formats: { 3: DATE, 10: "0" }, freeze: true, widths: [170, 220, 110, 110, 100, 220, 190, 140, 170, 130, 90] }),
    { type: "add_filter", range: `A4:K${last}` },
    { type: "add_validation", range: `J5:J${last}`, kind: "list", list: ["Tentative", "Noticed", "Confirmed", "Taken", "Transcript pending", "Transcript received", "Cancelled"] },
    { type: "conditional_format", range: `K5:K${last}`, rule: { kind: "between", min: 0, max: 7 }, style: { fill: "#FEF3C7", color: "#92400E", bold: true } },
    { type: "conditional_format", range: `K5:K${last}`, rule: { kind: "lt", value: 0 }, style: { color: "#6B7280" } },
    { type: "conditional_format", range: `J5:J${last}`, rule: { kind: "eq", value: "Transcript pending" }, style: { fill: "#FDE2E1", color: "#9F1239" } },
    { type: "freeze_panes", rows: 4, cols: 1 },
    cells([[`A${last + 2}`, "Upcoming (next 14 days)", LABEL_STYLE], [`B${last + 2}`, `=COUNTIFS(K5:K${last},">=0",K5:K${last},"<=14")`, { bold: true }], [`A${last + 3}`, "Transcripts outstanding", LABEL_STYLE], [`B${last + 3}`, `=COUNTIF(J5:J${last},"Transcript pending")`, { bold: true }]]),
  ];
  return buildWorkbook([{ name: "Schedule", ops }]);
}

// --------------------------------------------------------------- 6. Privilege log
export function privilegeLogWorkbook(): Workbook {
  const rows: (string | null)[][] = [
    ["MFC-0041877", "MFC-0041879", "2019-03-14", "Robert Kaine (Associate General Counsel)", "Gregory Hale", "Nadia Brooks", "Email", "Attorney-client", "Email from in-house counsel providing legal advice regarding TSCA §8(e) reporting obligations", "Withheld", "Final"],
    ["MFC-0042210", "MFC-0042214", "2019-04-02", "Helen Voss", "Robert Kaine (Associate General Counsel)", null, "Memo", "Attorney-client; Work product", "Memorandum prepared at the direction of counsel analyzing toxicology data for purposes of legal advice", "Withheld", "Final"],
    ["MFC-0043588", "MFC-0043588", "2019-06-21", "Martin Suarez (Regulatory Affairs Counsel)", "Alan Pryce", "Robert Kaine (Associate General Counsel)", "Email", "Attorney-client", "Email reflecting legal advice on product labeling in anticipation of regulatory inquiry", "Redacted", "Draft"],
    ["MFC-0044012", "MFC-0044019", "2020-01-30", "Outside counsel (Calloway & Reyes LLP)", "Robert Kaine (Associate General Counsel)", null, "Letter", "Attorney-client; Work product", "Letter from outside litigation counsel assessing litigation exposure", "Withheld", "Final"],
    ["MFC-0045101", "MFC-0045103", "2020-02-11", "Gregory Hale", "Robert Kaine (Associate General Counsel)", "Helen Voss", "Email", "Attorney-client", "Email requesting legal advice regarding response to state environmental agency request", "Withheld", "Final"],
  ];
  const last = 4 + rows.length;
  const ops: SheetOp[] = [
    ...title("Privilege Log", "Fed. R. Civ. P. 26(b)(5)(A) log. Descriptions must not reveal privileged content.", 1, 11),
    ...table({ anchor: "A4", headers: ["Bates begin", "Bates end", "Date", "Author", "Recipient(s)", "CC", "Document type", "Privilege basis", "Description", "Treatment", "Status"], rows, formats: { 2: DATE }, freeze: true, widths: [120, 120, 110, 230, 230, 200, 110, 190, 420, 100, 90] }),
    { type: "add_filter", range: `A4:K${last}` },
    { type: "add_validation", range: `H5:H${last}`, kind: "list", list: ["Attorney-client", "Work product", "Attorney-client; Work product", "Common interest", "Joint defense"] },
    { type: "add_validation", range: `J5:J${last}`, kind: "list", list: ["Withheld", "Redacted"] },
    { type: "add_validation", range: `K5:K${last}`, kind: "list", list: ["Draft", "Final"] },
    { type: "style_range", range: `I5:I${last}`, style: { wrap: true } },
    { type: "conditional_format", range: `K5:K${last}`, rule: { kind: "eq", value: "Draft" }, style: { fill: "#FEF3C7", color: "#92400E" } },
    cells([[`A${last + 2}`, "Entries", LABEL_STYLE], [`B${last + 2}`, `=COUNTA(A5:A${last})`, { bold: true }], [`A${last + 3}`, "Withheld in full", LABEL_STYLE], [`B${last + 3}`, `=COUNTIF(J5:J${last},"Withheld")`, { bold: true }], [`A${last + 4}`, "Draft entries", LABEL_STYLE], [`B${last + 4}`, `=COUNTIF(K5:K${last},"Draft")`, { bold: true }]]),
  ];
  return buildWorkbook([{ name: "Privilege Log", ops }]);
}

// --------------------------------------------------------------- 7. Document production tracker
export function productionTrackerWorkbook(): Workbook {
  const rows: (string | number | null)[][] = [
    ["VOL001", "MFC-0000001", "MFC-0018420", "2026-03-31", "Hale; Voss", "TIFF + load file", "Confidential", "Produced"],
    ["VOL002", "MFC-0018421", "MFC-0041876", "2026-05-15", "Brooks; Pryce", "TIFF + load file", "Confidential", "Produced"],
    ["VOL003", "MFC-0041877", "MFC-0058903", "2026-07-08", "Kaine; Suarez", "Native (Excel) + TIFF", "Highly Confidential", "Produced"],
    ["VOL004", "MFC-0058904", "MFC-0071250", "2026-09-30", "Hale (supplemental)", "TIFF + load file", "Confidential", "In QC"],
    ["VOL005", "MFC-0071251", null, null, "Tier 2 custodians", "TIFF + load file", "Confidential", "Planned"],
  ];
  const data = rows.map((r, i) => { const n = 5 + i; return [r[0], r[1], r[2], `=IF(C${n}="","",VALUE(RIGHT(C${n},7))-VALUE(RIGHT(B${n},7))+1)`, r[3], r[4], r[5], r[6], r[7]]; });
  const last = 4 + rows.length;
  const ops: SheetOp[] = [
    ...title("Document Production Tracker", "Volumes, Bates ranges, custodians and status. Page counts derive from the Bates numbers.", 1, 9),
    ...table({ anchor: "A4", headers: ["Volume", "Bates begin", "Bates end", "Pages", "Production date", "Custodians", "Format", "Designation", "Status"], rows: data, formats: { 3: INT, 4: DATE }, total: { columns: [3] }, freeze: true, widths: [90, 130, 130, 90, 130, 220, 190, 160, 110] }),
    { type: "add_filter", range: `A4:I${last}` },
    { type: "add_validation", range: `I5:I${last}`, kind: "list", list: ["Planned", "In review", "In QC", "Produced", "Clawed back"] },
    { type: "add_validation", range: `H5:H${last}`, kind: "list", list: ["Public", "Confidential", "Highly Confidential", "AEO"] },
    { type: "conditional_format", range: `I5:I${last}`, rule: { kind: "eq", value: "Produced" }, style: { fill: "#DCFCE7", color: "#166534" } },
    { type: "conditional_format", range: `I5:I${last}`, rule: { kind: "eq", value: "In QC" }, style: { fill: "#FEF3C7", color: "#92400E" } },
    cells([[`A${last + 3}`, "Next Bates number", LABEL_STYLE], [`B${last + 3}`, `="MFC-"&TEXT(MAX(IFERROR(VALUE(RIGHT(C5:C${last},7)),0))+1,"0000000")`, { bold: true }], [`A${last + 4}`, "Pages produced to date", LABEL_STYLE], [`B${last + 4}`, `=SUMIF(I5:I${last},"Produced",D5:D${last})`, { bold: true, numFmt: INT }]]),
  ];
  return buildWorkbook([{ name: "Productions", ops }]);
}

// --------------------------------------------------------------- 8. PAGA exposure model
export function pagaExposureWorkbook(opts: { title?: string; employees?: number; payPeriods?: number; aggrieved?: number; violations?: { code: string; label: string; rate: number; initial: number; subsequent: number }[] } = {}): Workbook {
  const inp = inputs("A4", [
    { label: "Employees in lookback period", value: opts.employees ?? 412, fmt: INT, name: "Employees" },
    { label: "Pay periods per year", value: opts.payPeriods ?? 26, fmt: "0", name: "PayPeriods", note: "Bi-weekly" },
    { label: "Lookback (years)", value: 1, fmt: "0.00", name: "Lookback", note: "PAGA notice date − 1 year" },
    { label: "Aggrieved employee share", value: opts.aggrieved ?? 0.72, fmt: PCT, name: "Aggrieved", note: "From payroll sample" },
    { label: "LWDA share of penalties", value: 0.75, fmt: "0%", name: "LWDAShare" },
    { label: "Discretionary reduction (Lab. Code §2699(e)(2))", value: 0.5, fmt: "0%", name: "Reduction", note: "Court may reduce unjust/oppressive penalties" },
  ]);
  const violations = opts.violations ?? [
    { code: "§226.7 / §512", label: "Meal period violations", rate: 0.31, initial: 100, subsequent: 200 },
    { code: "§226.7", label: "Rest break violations", rate: 0.18, initial: 100, subsequent: 200 },
    { code: "§510 / §1194", label: "Unpaid overtime (rounding)", rate: 0.12, initial: 100, subsequent: 200 },
    { code: "§226(a)", label: "Inaccurate wage statements", rate: 0.65, initial: 250, subsequent: 1000 },
    { code: "§203", label: "Waiting-time penalties (separated employees)", rate: 0.09, initial: 100, subsequent: 200 },
  ];
  const rows = violations.map((v, i) => { const n = 13 + i; return [v.code, v.label, v.rate, v.initial, v.subsequent, `=Employees*Aggrieved*PayPeriods*Lookback*C${n}`, `=Employees*Aggrieved*D${n}`, `=(F${n}-Employees*Aggrieved)*E${n}`, `=G${n}+H${n}`, `=I${n}*(1-Reduction)`]; });
  const last = 12 + violations.length;
  const ops: SheetOp[] = [
    ...title(opts.title ?? "PAGA Exposure Model", "Employees × pay periods × violation rate × penalty; initial vs subsequent periods; LWDA/employee split; discretionary reduction scenarios.", 1, 10),
    ...inp.ops,
    ...section("A11", "Penalty exposure by violation", 10),
    ...table({ anchor: "A12", headers: ["Labor Code", "Violation", "Violation rate", "Initial penalty", "Subsequent penalty", "Violation pay periods", "Initial-period penalties", "Subsequent-period penalties", "Gross exposure", "Reduced exposure"], rows, formats: { 2: PCT, 3: CUR0, 4: CUR0, 5: INT, 6: CUR0, 7: CUR0, 8: CUR0, 9: CUR0 }, total: { columns: [5, 6, 7, 8, 9] }, freeze: true, widths: [120, 300, 110, 120, 140, 150, 170, 190, 140, 140] }),
    { type: "style_range", range: `C13:E${last}`, style: { fill: "#FFF8E1" } },
    ...section(`A${last + 3}`, "Allocation and scenarios", 4),
    cells([
      [`A${last + 4}`, "Gross exposure (stacked)", LABEL_STYLE], [`B${last + 4}`, `=I${last + 1}`, { numFmt: CUR0 }],
      [`A${last + 5}`, "Reduced exposure", LABEL_STYLE], [`B${last + 5}`, `=J${last + 1}`, { numFmt: CUR0 }],
      [`A${last + 6}`, "  to LWDA (75%)", LABEL_STYLE], [`B${last + 6}`, `=B${last + 5}*LWDAShare`, { numFmt: CUR0 }],
      [`A${last + 7}`, "  to aggrieved employees (25%)", LABEL_STYLE], [`B${last + 7}`, `=B${last + 5}*(1-LWDAShare)`, { numFmt: CUR0 }],
      [`A${last + 8}`, "Per aggrieved employee", LABEL_STYLE], [`B${last + 8}`, `=IFERROR(B${last + 7}/(Employees*Aggrieved),0)`, { numFmt: CUR }],
      [`A${last + 10}`, "Scenario", { bold: true, border: "bottom" }], [`B${last + 10}`, "Reduction", { bold: true, border: "bottom", align: "right" }], [`C${last + 10}`, "Exposure", { bold: true, border: "bottom", align: "right" }],
      [`A${last + 11}`, "No reduction", { border: "thin" }], [`B${last + 11}`, 0, { numFmt: "0%", border: "thin" }], [`C${last + 11}`, `=$I$${last + 1}*(1-B${last + 11})`, { numFmt: CUR0, border: "thin" }],
      [`A${last + 12}`, "Moderate", { border: "thin" }], [`B${last + 12}`, 0.3, { numFmt: "0%", border: "thin", fill: "#FFF8E1" }], [`C${last + 12}`, `=$I$${last + 1}*(1-B${last + 12})`, { numFmt: CUR0, border: "thin" }],
      [`A${last + 13}`, "Base (input)", { border: "thin" }], [`B${last + 13}`, "=Reduction", { numFmt: "0%", border: "thin" }], [`C${last + 13}`, `=$I$${last + 1}*(1-B${last + 13})`, { numFmt: CUR0, border: "thin" }],
      [`A${last + 14}`, "Aggressive", { border: "thin" }], [`B${last + 14}`, 0.75, { numFmt: "0%", border: "thin", fill: "#FFF8E1" }], [`C${last + 14}`, `=$I$${last + 1}*(1-B${last + 14})`, { numFmt: CUR0, border: "thin" }],
    ]),
    { type: "add_chart", chart: { type: "bar", title: "Gross exposure by violation", range: `I12:I${last}`, categoryRange: `B13:B${last}`, hasHeader: true, position: { x: 560, y: (last + 3) * 24, w: 560, h: 300 } } },
  ];
  return buildWorkbook([{ name: "Exposure", ops }], { namedRanges: Object.fromEntries(Object.entries(inp.named).map(([k, v]) => [k, `Exposure!${v}`])) });
}

// --------------------------------------------------------------- 9. Closing checklist (M&A)
export function closingChecklistWorkbook(opts: { title?: string; items?: (string | null)[][]; signing?: string } = {}): Workbook {
  const signing = opts.signing ?? "2026-10-15";
  const items = opts.items ?? [
    ["1", "Stock Purchase Agreement — execution version", "Transaction documents", "Buyer counsel", "Seller counsel", "In progress", addDays(signing, -3), "Open issues: indemnity cap, R&W survival"],
    ["2", "Disclosure schedules (final)", "Transaction documents", "Seller counsel", "Buyer counsel", "In progress", addDays(signing, -2), null],
    ["3", "Escrow agreement (Citibank N.A.)", "Transaction documents", "Buyer counsel", "Escrow agent", "Draft circulated", addDays(signing, -5), null],
    ["4", "R&W insurance binder and policy", "Financing / insurance", "Buyer", "Broker (Lockton)", "Binder received", addDays(signing, -7), "Retention 0.75% of EV"],
    ["5", "HSR filing and waiting period expiry", "Regulatory", "Buyer counsel", "Seller counsel", "Filed", addDays(signing, 30), "Early termination requested"],
    ["6", "Change-of-control consents — top 20 customers", "Third-party consents", "Seller", "Buyer counsel", "12 of 20 received", addDays(signing, 20), "Outstanding: Halden, Vireo, Cordant"],
    ["7", "IP assignment agreements — founders and contractors (ML models)", "IP", "Seller counsel", "Buyer counsel", "Chain gap identified", addDays(signing, -1), "Two contractor assignments missing"],
    ["8", "Payoff letters and lien releases (SVB facility)", "Debt / liens", "Seller", "Lender", "Requested", addDays(signing, 25), null],
    ["9", "Board and stockholder approvals (Seller)", "Corporate approvals", "Seller counsel", "Seller", "Scheduled", addDays(signing, -1), null],
    ["10", "Employment agreements — key employees (4)", "Employment", "Buyer", "Key employees", "Signed (3 of 4)", addDays(signing, 0), null],
    ["11", "Good standing certificates (DE, CA, NY)", "Corporate", "Seller counsel", "—", "Ordered", addDays(signing, 27), null],
    ["12", "Closing funds flow memorandum", "Closing mechanics", "Buyer counsel", "All parties", "Draft", addDays(signing, 28), null],
    ["13", "Officer's and secretary's certificates", "Closing deliverables", "Seller counsel", "Buyer counsel", "Draft", addDays(signing, 28), null],
    ["14", "Resignations of directors and officers", "Closing deliverables", "Seller counsel", "Buyer counsel", "Not started", addDays(signing, 29), null],
    ["15", "Post-closing: 8-K / press release", "Post-closing", "Buyer counsel", "Buyer IR", "Not started", addDays(signing, 31), null],
  ];
  const data = items.map((r, i) => { const n = 7 + i; return [...r.slice(0, 7), `=IF(F${n}="Complete","",IF(G${n}<TODAY(),"OVERDUE",G${n}-TODAY()))`, r[7]]; });
  const last = 6 + items.length;
  const ops: SheetOp[] = [
    ...title(opts.title ?? "Closing Checklist", "Transaction deliverables by category with responsible parties, status and days to due date.", 1, 9),
    ...inputs("A3", [{ label: "Signing date", value: signing, fmt: DATE, name: "Signing" }, { label: "Target closing", value: addDays(signing, 30), fmt: DATE, name: "Closing" }]).ops,
    ...table({ anchor: "A6", headers: ["#", "Deliverable", "Category", "Responsible", "Counterparty", "Status", "Due", "Days to due", "Notes"], rows: data, formats: { 6: DATE, 7: "0" }, freeze: true, widths: [40, 380, 170, 130, 150, 160, 110, 100, 300], align: { 0: "center" } }),
    { type: "add_filter", range: `A6:I${last}` },
    { type: "add_validation", range: `F7:F${last}`, kind: "list", list: ["Not started", "Draft", "In progress", "Draft circulated", "Requested", "Filed", "Scheduled", "Complete"] },
    { type: "conditional_format", range: `H7:H${last}`, rule: { kind: "contains", text: "OVERDUE" }, style: { fill: "#FDE2E1", color: "#9F1239", bold: true } },
    { type: "conditional_format", range: `H7:H${last}`, rule: { kind: "between", min: 0, max: 3 }, style: { fill: "#FEF3C7", color: "#92400E" } },
    { type: "conditional_format", range: `F7:F${last}`, rule: { kind: "eq", value: "Complete" }, style: { fill: "#DCFCE7", color: "#166534" } },
    cells([[`K3`, "Summary", { bold: true }], [`K4`, "Items", LABEL_STYLE], [`L4`, `=COUNTA(B7:B${last})`, { bold: true }], [`K5`, "Complete", LABEL_STYLE], [`L5`, `=COUNTIF(F7:F${last},"Complete")`, { bold: true }], [`K6`, "Overdue", LABEL_STYLE], [`L6`, `=COUNTIF(H7:H${last},"OVERDUE")`, { bold: true, color: "#9F1239" }], [`K7`, "% complete", LABEL_STYLE], [`L7`, `=IFERROR(L5/L4,0)`, { bold: true, numFmt: "0%" }]]),
    ...widths({ K: 110, L: 80 }),
  ];
  return buildWorkbook([{ name: "Checklist", ops }], { namedRanges: { Signing: "Checklist!B3", Closing: "Checklist!B4" } });
}

// --------------------------------------------------------------- 10. Cap table lite
export function capTableWorkbook(): Workbook {
  const holders: (string | number)[][] = [
    ["Priya Sethi (founder)", "Common", 4200000, 0, 250000],
    ["Marcus Lindqvist (founder)", "Common", 3800000, 0, 250000],
    ["Employee option pool", "Options", 0, 1500000, 0],
    ["Seed — Northwind Ventures", "Series Seed Preferred", 2100000, 0, 2500000],
    ["Series A — Halcyon Capital", "Series A Preferred", 3500000, 0, 12000000],
    ["Series A — Northwind Ventures (pro rata)", "Series A Preferred", 900000, 0, 3085714],
  ];
  const rows = holders.map((h, i) => { const n = 5 + i; return [h[0], h[1], h[2], h[3], `=C${n}+D${n}`, `=E${n}/$E$11`, h[4], `=IFERROR(G${n}/C${n},0)`]; });
  const ops: SheetOp[] = [
    ...title("Capitalization Table", "Fully diluted ownership by holder and class. Liquidation preference and option pool shown as inputs.", 1, 8),
    ...table({ anchor: "A4", headers: ["Holder", "Class", "Shares", "Options / RSUs", "Fully diluted", "Ownership", "Invested", "Price / share"], rows, formats: { 2: INT, 3: INT, 4: INT, 5: "0.00%", 6: CUR0, 7: "$0.0000" }, total: { columns: [2, 3, 4, 5, 6] }, freeze: true, widths: [300, 200, 120, 130, 130, 110, 130, 110] }),
    { type: "style_range", range: "C5:D10", style: { fill: "#FFF8E1" } },
    { type: "style_range", range: "G5:G10", style: { fill: "#FFF8E1" } },
    ...section("A13", "Class summary", 4),
    cells([["A14", "Class", { bold: true, border: "bottom" }], ["B14", "Fully diluted", { bold: true, border: "bottom", align: "right" }], ["C14", "Ownership", { bold: true, border: "bottom", align: "right" }], ["D14", "Invested", { bold: true, border: "bottom", align: "right" }],
      ["A15", "Common", { border: "thin" }], ["B15", '=SUMIF($B$5:$B$10,A15,$E$5:$E$10)', { numFmt: INT, border: "thin" }], ["C15", "=B15/$E$11", { numFmt: "0.00%", border: "thin" }], ["D15", '=SUMIF($B$5:$B$10,A15,$G$5:$G$10)', { numFmt: CUR0, border: "thin" }],
      ["A16", "Options", { border: "thin" }], ["B16", '=SUMIF($B$5:$B$10,A16,$E$5:$E$10)', { numFmt: INT, border: "thin" }], ["C16", "=B16/$E$11", { numFmt: "0.00%", border: "thin" }], ["D16", '=SUMIF($B$5:$B$10,A16,$G$5:$G$10)', { numFmt: CUR0, border: "thin" }],
      ["A17", "Series Seed Preferred", { border: "thin" }], ["B17", '=SUMIF($B$5:$B$10,A17,$E$5:$E$10)', { numFmt: INT, border: "thin" }], ["C17", "=B17/$E$11", { numFmt: "0.00%", border: "thin" }], ["D17", '=SUMIF($B$5:$B$10,A17,$G$5:$G$10)', { numFmt: CUR0, border: "thin" }],
      ["A18", "Series A Preferred", { border: "thin" }], ["B18", '=SUMIF($B$5:$B$10,A18,$E$5:$E$10)', { numFmt: INT, border: "thin" }], ["C18", "=B18/$E$11", { numFmt: "0.00%", border: "thin" }], ["D18", '=SUMIF($B$5:$B$10,A18,$G$5:$G$10)', { numFmt: CUR0, border: "thin" }],
      ["A19", "Total", TOTAL_STYLE], ["B19", "=SUM(B15:B18)", { ...TOTAL_STYLE, numFmt: INT }], ["C19", "=SUM(C15:C18)", { ...TOTAL_STYLE, numFmt: "0.00%" }], ["D19", "=SUM(D15:D18)", { ...TOTAL_STYLE, numFmt: CUR0 }],
      ["A21", "Post-money valuation (Series A price × FD shares)", LABEL_STYLE], ["B21", "=H9*E11", { numFmt: CUR0, bold: true }],
      ["A22", "Check: ownership sums to 100%", NOTE_STYLE], ["B22", '=IF(ROUND(F11,6)=1,"OK","MISMATCH")', { bold: true }],
    ]),
    { type: "add_chart", chart: { type: "pie", title: "Fully diluted ownership by class", range: "B14:B18", categoryRange: "A15:A18", hasHeader: true, position: { x: 620, y: 320, w: 440, h: 300 } } },
  ];
  return buildWorkbook([{ name: "Cap Table", ops }]);
}

/** Sheet editor templates. Each build() returns this editor's Workbook content model. */
export const SHEET_TEMPLATES: OfficeTemplate[] = [
  { id: "sheet-settlement-tracker", kind: "sheet", name: "Settlement tracker", description: "Demand, offer, settlement, fee and cost allocation and payment follow-up per claimant, with status filters and overdue highlighting.", category: "Litigation", practiceArea: "Litigation", tags: ["settlement", "tracker", "finance"], build: () => settlementTrackerWorkbook() },
  { id: "sheet-settlement-allocation", kind: "sheet", name: "Settlement allocation statement", description: "Gross → attorney fee → itemized costs → liens (with negotiated reductions) → net to client, with percent-of-gross checks.", category: "Finance", practiceArea: "Litigation", tags: ["settlement", "allocation", "client statement"], build: () => settlementAllocationWorkbook() },
  { id: "sheet-damages-model", kind: "sheet", name: "Damages model", description: "Past and future medicals, wage loss and earning capacity (present value), non-economic multiplier, pre- and post-judgment interest, sensitivity table and chart.", category: "Finance", practiceArea: "Litigation", tags: ["damages", "interest", "present value"], build: () => damagesModelWorkbook() },
  { id: "sheet-litigation-budget", kind: "sheet", name: "Litigation budget & fee estimate", description: "Phases × timekeeper hours × rates, disbursements, cumulative total, variance vs actuals and contingency reserve.", category: "Finance", practiceArea: "Litigation", tags: ["budget", "fees", "phases"], build: () => litigationBudgetWorkbook() },
  { id: "sheet-deposition-schedule", kind: "sheet", name: "Deposition schedule", description: "Witnesses, noticing party, dates, locations, court reporters, defending attorneys, exhibits and status with days-until highlighting.", category: "Litigation", practiceArea: "Litigation", tags: ["depositions", "schedule"], build: () => depositionScheduleWorkbook() },
  { id: "sheet-privilege-log", kind: "sheet", name: "Privilege log", description: "Rule 26(b)(5) privilege log with Bates ranges, authors, recipients, basis, privilege-safe descriptions and treatment.", category: "Litigation", practiceArea: "Litigation", tags: ["privilege", "discovery"], build: () => privilegeLogWorkbook() },
  { id: "sheet-production-tracker", kind: "sheet", name: "Document production tracker", description: "Production volumes with Bates ranges (page counts computed), custodians, formats, designations and status.", category: "Litigation", practiceArea: "Litigation", tags: ["production", "bates", "e-discovery"], build: () => productionTrackerWorkbook() },
  { id: "sheet-paga-exposure", kind: "sheet", name: "PAGA exposure model", description: "Employees × pay periods × violation rates × initial/subsequent penalties, LWDA/employee split and discretionary reduction scenarios.", category: "Finance", practiceArea: "Employment", tags: ["PAGA", "wage and hour", "exposure"], build: () => pagaExposureWorkbook() },
  { id: "sheet-closing-checklist", kind: "sheet", name: "Closing checklist (M&A)", description: "Transaction deliverables by category with responsible parties, status, due dates and an overdue summary.", category: "Transactional", practiceArea: "Corporate / M&A", tags: ["M&A", "closing", "checklist"], build: () => closingChecklistWorkbook() },
  { id: "sheet-cap-table", kind: "sheet", name: "Cap table lite", description: "Fully diluted ownership by holder and class, invested capital, price per share and post-money valuation.", category: "Transactional", practiceArea: "Corporate / M&A", tags: ["cap table", "equity"], build: () => capTableWorkbook() },
];
