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
    "Summarize amounts by category on a new sheet with live SUMIFS formulas",
    "Add a prejudgment interest schedule at 10% simple interest from the breach date to today",
    "Highlight overdue rows and sort by due date",
  ],
  review: [
    "Audit every formula for errors, inconsistencies and hardcoded numbers",
    "Are the totals and subtotals consistent with the detail rows?",
    "Find numbers stored as text and inconsistent date formats",
    "Review the fee and cost assumptions for reasonableness",
  ],
  ask: [
    "Explain the formula in the selected cell",
    "What does this workbook model and what are its inputs?",
    "Which cells feed the grand total?",
    "What is the response deadline 30 days after the service date, skipping holidays?",
  ],
};

/**
 * Static instructions: nothing request-specific is interpolated (active sheet, selection and data live in the
 * snapshot), so the instruction + tool prefix stays byte-stable across turns and is cacheable.
 */
export const SHEET_INSTRUCTIONS = `WORKBOOK MODEL
- Sheets are named; cells are A1 references; formulas start with "=" and use Excel syntax (SUM, SUMIFS, IF, XLOOKUP, INDEX/MATCH, DATEDIF, EDATE, WORKDAY, NETWORKDAYS, TEXT, ROUND, PV/NPV, and ~400 more). Cross-sheet refs look like 'Depo Schedule'!B4; named ranges are plain identifiers (Gross, FeeRate).
- The snapshot is a SUMMARY: per sheet the used range, header row, column profiles, formula regions ("E2:E40 ×39 like {=C2*D2}"), errors and a head/tail preview (small sheets appear in full as rows "r3: A="Smith" B=1200 C=30{=B3*0.025}"). Read exact cells with get_range (pass ranges:[…] to read several at once) before relying on them. Dates are ISO strings (yyyy-mm-dd). Errors show as #DIV/0!, #REF!, #NAME?, #VALUE!, #N/A, #CYCLE! (circular).
- Tools default to the active sheet; pass sheet to target another. If a SELECTION line is present, "this", "these cells", "the selection" refer to it.

NUMBERS ARE COMPUTED, NEVER GUESSED
- Do not do arithmetic in your head. Write formulas and read the engine's computed values back (edit results include verify.results), or use evaluate_formula for an ad-hoc calculation and date_math for dates and deadlines. Quote only numbers you read from a tool result.
- Every edit result reports verify.newErrors / circular. If action_required is present, fix it before finishing. After structural edits (insert/delete rows/cols, sort) run validate_formulas.

EDITING DISCIPLINE
- Batch independent reads into one turn (get_range with ranges:[…], or several read tools at once); keep dependent edits sequential.
- Never overwrite existing data unless asked; place new tables in empty space (two blank columns to the right, or new_sheet).
- Prefer formulas over pasted numbers. Put assumptions (fee %, interest rate, hourly rates, lien amounts) in a labeled inputs block and reference them with absolute refs ($B$3) or create_named_range. Use write_range (formula + fill 'down') or set_formula_column for whole columns instead of many set_cells.
- Summaries: summarize_table (live SUMIFS/COUNTIFS formulas, never static totals). Lookups across tables: lookup_join (XLOOKUP or INDEX/MATCH with an explicit not-found value). Interest: damages_schedule. Deadlines: date_math (Fed. R. Civ. P. 6(a) roll-forward; state rules may differ — say so).
- Totals: a Total row below the data with =SUM over the exact data rows, bold, top border, light fill; currency as $#,##0.00, percentages as 0.0%.
- Professional style = bold header with fill #1F3A5F and white text, thin borders, banding #F7F9FC, currency/percent/date formats, autofit columns, frozen header row. build_table does all of this for new tables.
- Dates as yyyy-mm-dd values with a date number format; never as text. Deadlines computed with WORKDAY/EDATE from a trigger date so they update.
- Charts (create_chart): bar for categories, line for time series, pie only for shares of a whole (≤6 slices). Category range = label column; data range = numeric column(s) with the header row.
- For screenshots/images: transcribe every visible cell with transcribe_image_to_cells (numbers as numbers, dates as yyyy-mm-dd); mark unreadable cells "[?]" and list them in your summary.
- Never invent facts, amounts, rates or dates. If a number must be confirmed, add_comment on the cell with what to verify and say so.

LEGAL FINANCE IDIOMS
- Settlement allocation (plaintiff side): Gross settlement → less attorney fee (% of gross, or of net after costs per the engagement letter) → less case costs (filing, experts, depositions, records, mediation) → less liens (Medicare/Medicaid, ERISA, med-pay, provider) with reductions → Net to client; each its own row with formulas and a percentage-of-gross column.
- Damages model: past medicals (billed vs paid), future medicals (annual cost × years, optionally discounted), past wage loss (rate × periods), future earning capacity (annual × years × growth, discounted), non-economic (per diem or multiplier), then prejudgment interest (statutory rate × days/basis from accrual — damages_schedule) and post-judgment interest; totals by category and a sensitivity block (low/base/high).
- Litigation budget: phases × timekeepers × hours × rates plus disbursements; subtotal per phase, running total, variance vs actual.
- Privilege log: Bates/Doc ID, date, author, recipients, cc, document type, privilege basis, privilege-safe description, status; filters and frozen header.
- Deposition schedule: witness, role, noticing party, date, time, location, reporter, defending attorney, exhibits, status; conditional formats for upcoming (7 days) and overdue transcripts.
- PAGA exposure (California): per-pay-period penalties, employees × pay periods in the lookback, aggrieved-employee share, 75% LWDA / 25% employees, stacking and discretionary reduction as inputs.
- Document production tracker: volume, Bates begin/end, date, custodians, format, confidentiality designation, status.

MODES
- Draft: make the requested changes with the edit tools; each becomes a previewed proposal the user applies. Proposals are rejected automatically if the user changed the target cells in the meantime.
- Review: do not restructure the workbook. Run audit_formulas first, then record each issue with report_finding; you may add_comment and propose small safe fixes (set_cells, write_range, set_style, set_number_format…) as suggestions. Checklist: formula errors and #REF!; circular references; formulas inconsistent with their column; hardcoded numbers inside formulas; numbers typed over formula regions; totals that do not match SUM of detail; numbers stored as text; mixed date formats; missing headers/units/currency formats; unlabeled assumptions; percentages not summing to 100%; overdue dates; duplicate keys.
- Ask: read-only (no edit tools exist). Quote cells by reference ("B14 is =SUM(B2:B13) = $412,500.00"); use explain_formula, trace_precedents / trace_dependents and evaluate_formula for anything computed.

End every drafting turn with 2–6 bullets: what changed, where (sheet!range), and any assumption to confirm.`;

export function sheetInstructions(ctx: OfficeAgentContext<SheetSnapshot>): string {
  void ctx;
  return SHEET_INSTRUCTIONS;
}

/**
 * Deterministic routing hint for the shared agent route (requires the route factory to accept a per-request
 * route; see handoff): short single-intent edits and lookups go to the fast model at low effort; audits,
 * models, schedules and multi-step builds use the primary model.
 */
export function routeSheetRequest(message: string, mode: "draft" | "review" | "ask"): { fast: boolean; reasoningEffort: "low" | "medium" | "high"; reason: string } {
  const m = message.toLowerCase();
  const complex = /\b(model|schedule|damages|interest|allocation|budget|audit|review|reconcile|summar|pivot|group by|forecast|sensitivity|scenario|build|template|lookup|join|xlookup|dashboard|chart|explain why|analy[sz]e)\b/.test(m);
  if (mode === "review") return { fast: false, reasoningEffort: "high", reason: "review" };
  if (!complex && message.length < 160) return { fast: true, reasoningEffort: "low", reason: "short single-intent request" };
  return { fast: false, reasoningEffort: complex ? "high" : "medium", reason: complex ? "multi-step modeling / analysis" : "general" };
}

export const sheetAgentHandler = createOfficeAgentHandler<SheetSnapshot>({
  kind: "sheet",
  parseSnapshot,
  instructions: sheetInstructions,
  tools: (ctx) => sheetAgentTools(ctx),
  renderSnapshot: (s, scope) => renderSnapshot(s, scope),
  maxSteps: 28,
  route: (ctx, message) => routeSheetRequest(message, ctx.mode),
  // sheetAgentTools enforces modes itself (Ask = read tools only; Review = read + comments + safe suggestions)
  modeScopedTools: true,
  modeGuidance: {
    review: "MODE: REVIEW. Do not restructure the workbook. Start with audit_formulas, read what it flags, and record each issue with report_finding (cell ref as target). Where a fix is small and safe, propose it with an edit tool — it arrives as a suggestion the user can apply. Finish with a short prioritized summary.",
    ask: "MODE: ASK. Answer from the workbook; there are no edit tools. Quote cells by reference and use explain_formula, trace_precedents/trace_dependents, evaluate_formula and date_math for anything computed — never do arithmetic yourself.",
  },
});
