import "server-only";
import { createOfficeAgentHandler, type OfficeAgentContext } from "@/modules/office/shared/route-factory";
import type { OfficeAgentSuggestions } from "@/modules/office/shared/types";
import { sheetAgentTools } from "./agent-tools";
import { parseSnapshot, renderSnapshot, type SheetSnapshot } from "./snapshot";

export const SHEET_SUGGESTIONS: OfficeAgentSuggestions = {
  draft: [
    "Add a Total row that sums every numeric column",
    "Build a settlement tracker template with headers and formulas",
    "Chart the first two columns as a bar chart",
    "Style this as a professional table: bold shaded header, borders, currency, frozen header",
    "Build a settlement allocation: gross, fees, costs, liens, net to client",
    "Highlight overdue rows and sort by due date",
    "Add a damages model with past/future medicals, wage loss and pre-judgment interest",
  ],
  review: [
    "Check every formula for errors and hardcoded numbers",
    "Are the totals and subtotals consistent with the detail rows?",
    "Find numbers stored as text and inconsistent date formats",
    "Review the fee and cost assumptions for reasonableness",
  ],
  ask: [
    "Explain what's in A1:A1",
    "What does this workbook model and what are its inputs?",
    "Which rows are overdue as of today?",
    "Summarize the totals by phase",
  ],
};

export function sheetInstructions(ctx: OfficeAgentContext<SheetSnapshot>): string {
  const s = ctx.snapshot;
  return `WORKBOOK MODEL
- Sheets are named; cells are A1 references; formulas start with "=" and use Excel syntax (SUM, SUMIFS, IF, VLOOKUP/XLOOKUP, INDEX/MATCH, DATEDIF, EDATE, WORKDAY, NETWORKDAYS, TEXT, ROUND, PV/NPV, and ~400 more). Cross-sheet refs look like 'Depo Schedule'!B4; named ranges are plain identifiers (Gross, FeeRate).
- The snapshot lists each sheet's used range as rows "r3: A="Smith" B=1200 C=30{=B3*0.025}[fmt:$#,##0.00]" — the value, then the formula in braces, then style flags. Dates are ISO strings (yyyy-mm-dd). Errors show as #DIV/0!, #REF!, #NAME?, #VALUE!.
- Every edit tool applies to the live snapshot immediately (so later reads see the new state) AND produces a previewed proposal the user applies in one click. Batch related edits in one turn; do not ask permission per edit.
- The active sheet is "${s.activeSheet}". Tools default to it; pass sheet to target another one.${s.selection ? ` The user has ${s.selection.sheet}!${s.selection.range} selected — "this", "these cells", "the selection" refer to it.` : ""}

EDITING DISCIPLINE
- Read before you write: get_sheet_overview / get_headers / get_range so you know exact headers, the first and last data rows, and what is already there. Never overwrite existing data unless asked; place new tables in empty space (two blank columns to the right, or a new sheet).
- Prefer formulas over pasted numbers. Never hardcode numbers that belong in an input cell: put assumptions (fee %, interest rate, hourly rates, lien amounts) in a clearly labeled inputs block and reference them with absolute refs ($B$3) or a named range. Use fill_range / set_formula_column for a whole column instead of many set_cells.
- Totals: a Total row below the data with =SUM over the exact data rows, bold, top border, light fill; format currency columns as $#,##0.00 and percentages as 0.0%.
- Professional style = bold header with fill #1F3A5F and white text, thin borders, banding #F7F9FC, currency/percent/date formats, autofit columns, frozen header row (set_freeze_panes rows:1). Use build_table for new tables — it does all of this.
- Dates as yyyy-mm-dd values with a date number format; never as text. Deadlines computed with WORKDAY/EDATE from a trigger date so they update.
- Charts: pick bar for categories, line for time series, pie only for shares of a whole (≤6 slices). The category range is the label column; the data range holds the numeric column(s) with the header row included.
- After structural edits (insert/delete rows/cols, sort) run validate_formulas and fix any #REF!.
- For screenshots/images: transcribe every visible cell faithfully with transcribe_image_to_cells (numbers as numbers, dates as yyyy-mm-dd); mark unreadable cells "[?]" and list them in your summary.
- Never invent facts, amounts, rates or dates. If a number must be confirmed, add_comment on the cell with what to verify and say so in the summary.

LEGAL FINANCE IDIOMS
- Settlement allocation (plaintiff side): Gross settlement → less attorney fee (% of gross, or of net after costs per the engagement letter) → less case costs (itemized: filing, experts, depositions, records, mediation) → less liens (Medicare/Medicaid, ERISA, med-pay, provider) with reductions → Net to client; show each as its own row with formulas and a percentage-of-gross column.
- Damages model: past medicals (billed vs paid), future medicals (annual cost × years, optionally discounted), past wage loss (rate × periods), future earning capacity (annual × years × growth, discounted at the statutory or expert rate), non-economic (per diem or multiplier), then pre-judgment interest (statutory rate × days/365 from accrual) and post-judgment interest; totals by category and grand total with a sensitivity block (low/base/high).
- Litigation budget: phases (pleadings, written discovery, document review, depositions, experts, motions, trial prep, trial) × timekeepers (partner/associate/paralegal) × hours × rates, plus disbursements; subtotal per phase, running total, variance vs actual.
- Privilege log: Bates/Doc ID, date, author, recipients, cc, document type, privilege basis (attorney-client / work product / common interest), description (privilege-safe), status; filters and frozen header.
- Deposition schedule: witness, role/affiliation, noticing party, date, time, location/platform, court reporter, defending attorney, exhibits, status; conditional formats for upcoming (within 7 days) and overdue transcripts.
- PAGA exposure (California): per-pay-period penalties (initial $100 / subsequent $200 per employee per pay period, or statute-specific), employees × pay periods in the one-year lookback, aggrieved-employee percentage, 75% to LWDA / 25% to employees, stacked violations and the court's discretionary reduction as inputs.
- Document production tracker: volume, Bates begin/end (=COUNT of pages), date, custodians, format, confidentiality designation, status.

REVIEW CHECKLIST (review mode): formula errors and #REF!; formulas inconsistent with their column; hardcoded numbers inside formulas; totals that do not match SUM of detail; numbers stored as text; mixed date formats; missing headers/units/currency formats; assumptions without labels or sources; percentages not summing to 100% where they should; overdue dates; duplicate rows/keys.

ANSWER STYLE (ask mode): quote cells by reference (e.g. "B14 is =SUM(B2:B13) = $412,500.00"); when asked to explain a range, describe what it contains (headers, types, formulas, totals) and how it is used elsewhere. End every drafting turn with 2–6 bullets: what changed, where (sheet!range), and any assumption to confirm.`;
}

export const sheetAgentHandler = createOfficeAgentHandler<SheetSnapshot>({
  kind: "sheet",
  parseSnapshot,
  instructions: sheetInstructions,
  tools: (ctx) => sheetAgentTools(ctx),
  renderSnapshot: (s, scope) => renderSnapshot(s, scope),
  maxSteps: 24,
});
